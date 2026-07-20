import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

type PlannerBody = {
  dry_run?: boolean | null;
  allow_enqueue?: boolean | null;
  confirm?: string | null;
  campaign_key?: string | null;
  segment_key?: string | null;
  template_key?: string | null;
  limit?: number | null;
  write_log?: boolean | null;
  trigger?: string | null;
};

type CampaignSettings = {
  campaign_key: string;
  enabled: boolean;
  dry_run: boolean;
  segment_key: string;
  sequence_key: string;
  step_key: string;
  template_key: string;
  daily_enqueue_limit: number;
  daily_send_limit: number;
  cooldown_days: number;
  min_user_age_hours: number;
  priority: number;
  max_emails_per_sequence: number;
  metadata: Record<string, unknown> | null;
};

type GlobalSetting = {
  key: string;
  value: string;
};

type Candidate = {
  user_id: string;
  email: string;
  email_normalized: string;
  registered_at: string | null;
  segment: string;
  suggested_email_key: string;
};

const DEFAULT_CAMPAIGN_KEY = "non_paying_without_alert";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const CONTROLLED_ENQUEUE_CONFIRM = "ENQUEUE_CREATE_ALERT_EMAIL_1_LIMIT_1";
const CONTROLLED_DAILY_ENQUEUE_CONFIRM =
  "ENQUEUE_CREATE_ALERT_EMAIL_1_DAILY_LIMIT_10";
const CONTROLLED_DAILY_MAX_LIMIT = 10;
const PLANNER_VERSION = "v1.1";
const PENDING_QUEUE_STATUSES = ["queued", "locked", "processing"];
const CONTROLLED_DAILY_TRIGGERS = new Set(["cron", "manual_daily_test"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function isAuthorized(req: Request) {
  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();

  if (bearer === cronSecret || cronHeader === cronSecret) {
    return { ok: true, status: 200, error: null };
  }

  return { ok: false, status: 401, error: "unauthorized" };
}

function supabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("missing_supabase_env");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseBoolSetting(value: string | null | undefined, fallback: boolean) {
  const v = (value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function clampLimit(value: number | null | undefined, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(n)));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function utcDayStartIso() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function hoursAgoIso(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function logStatus(dryRun: boolean, blockedReason: string | null) {
  if (dryRun) return "dry_run";
  return blockedReason ? "skipped" : "success";
}

function controlledEnqueueGate(
  body: PlannerBody,
  campaign: CampaignSettings,
  requestedLimit: number,
  dryRun: boolean,
) {
  if (dryRun) return { ok: true, mode: "dry_run", reason: null };
  if (body.allow_enqueue !== true) {
    return {
      ok: false,
      mode: "none",
      reason: "controlled_enqueue_confirmation_missing",
    };
  }
  if (campaign.campaign_key !== DEFAULT_CAMPAIGN_KEY) {
    return {
      ok: false,
      mode: "none",
      reason: "controlled_enqueue_confirmation_missing",
    };
  }

  if (body.confirm === CONTROLLED_ENQUEUE_CONFIRM) {
    if (requestedLimit !== 1) {
      return {
        ok: false,
        mode: "limit_1",
        reason: "controlled_enqueue_confirmation_missing",
      };
    }
    return { ok: true, mode: "limit_1", reason: null };
  }

  if (body.confirm === CONTROLLED_DAILY_ENQUEUE_CONFIRM) {
    const trigger = body.trigger ?? "manual";
    const campaignKey = (body.campaign_key ?? "").trim();
    const segmentKey = (body.segment_key ?? "").trim();
    const templateKey = (body.template_key ?? "").trim();

    if (!CONTROLLED_DAILY_TRIGGERS.has(trigger)) {
      return {
        ok: false,
        mode: "daily_limit_10",
        reason: "controlled_enqueue_trigger_not_allowed",
      };
    }
    if (campaignKey !== DEFAULT_CAMPAIGN_KEY) {
      return {
        ok: false,
        mode: "daily_limit_10",
        reason: "controlled_enqueue_campaign_mismatch",
      };
    }
    if (
      segmentKey !== DEFAULT_CAMPAIGN_KEY || segmentKey !== campaign.segment_key
    ) {
      return {
        ok: false,
        mode: "daily_limit_10",
        reason: "controlled_enqueue_segment_mismatch",
      };
    }
    if (
      templateKey !== "create_alert_email_1" ||
      templateKey !== campaign.template_key
    ) {
      return {
        ok: false,
        mode: "daily_limit_10",
        reason: "controlled_enqueue_template_mismatch",
      };
    }
    if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
      return {
        ok: false,
        mode: "daily_limit_10",
        reason: "controlled_enqueue_limit_not_integer",
      };
    }
    if (requestedLimit <= 1 || requestedLimit > CONTROLLED_DAILY_MAX_LIMIT) {
      return {
        ok: false,
        mode: "daily_limit_10",
        reason: "controlled_enqueue_limit_not_allowed",
      };
    }
    return { ok: true, mode: "daily_limit_10", reason: null };
  }

  return {
    ok: false,
    mode: "none",
    reason: "controlled_enqueue_confirmation_missing",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const auth = isAuthorized(req);
  if (!auth.ok) {
    return json(auth.status, { ok: false, error: auth.error });
  }

  let body: PlannerBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body.dry_run !== false;
  const writeLog = body.write_log !== false;
  const campaignKey = (body.campaign_key ?? DEFAULT_CAMPAIGN_KEY).trim();
  const requestedLimit = clampLimit(body.limit, DEFAULT_LIMIT);
  const trigger = body.trigger ?? "manual";
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const realEnqueueAttempted = !dryRun;

  let supabase: SupabaseClient;
  try {
    supabase = supabaseAdmin();
  } catch (error) {
    return json(500, {
      ok: false,
      error: "server_misconfigured",
      details: error instanceof Error ? error.message : String(error),
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: false,
    });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("marketing_campaign_settings")
    .select("*")
    .eq("campaign_key", campaignKey)
    .maybeSingle();

  if (campaignError) {
    return json(500, {
      ok: false,
      error: "campaign_settings_read_failed",
      details: campaignError.message,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: false,
    });
  }

  if (!campaign) {
    return json(404, {
      ok: false,
      error: "campaign_not_found",
      campaign_key: campaignKey,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: false,
    });
  }

  const typedCampaign = campaign as CampaignSettings;

  const { data: globalRows, error: globalError } = await supabase
    .from("marketing_global_settings")
    .select("key,value")
    .in("key", ["lifecycle_paused", "daily_global_cap"]);

  if (globalError) {
    return json(500, {
      ok: false,
      error: "global_settings_read_failed",
      details: globalError.message,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: false,
    });
  }

  const globalSettings = Object.fromEntries(
    ((globalRows ?? []) as GlobalSetting[]).map((row) => [row.key, row.value]),
  );

  const lifecyclePaused = parseBoolSetting(
    globalSettings.lifecycle_paused,
    true,
  );
  const parsedDailyGlobalCap = Number.parseInt(
    globalSettings.daily_global_cap ?? "0",
    10,
  );
  const dailyGlobalCap = Number.isFinite(parsedDailyGlobalCap)
    ? parsedDailyGlobalCap
    : 0;

  const enqueueGate = controlledEnqueueGate(
    body,
    typedCampaign,
    requestedLimit,
    dryRun,
  );

  let blockedReason: string | null = null;
  if (!dryRun && !enqueueGate.ok) {
    blockedReason = enqueueGate.reason;
  } else if (lifecyclePaused) {
    blockedReason = "lifecycle_paused";
  } else if (!typedCampaign.enabled) {
    blockedReason = "campaign_disabled";
  } else if (!dryRun && typedCampaign.dry_run) {
    blockedReason = "campaign_dry_run_enabled";
  }

  const effectiveLimit = Math.max(
    0,
    Math.min(
      requestedLimit,
      typedCampaign.daily_enqueue_limit,
      dailyGlobalCap > 0 ? dailyGlobalCap : requestedLimit,
    ),
  );

  const { count: candidateCountRaw, error: candidatesError } = await supabase
    .from("jobradar_marketing_reactivation_candidates")
    .select("*", { count: "exact", head: true })
    .eq("segment", typedCampaign.segment_key)
    .eq("suggested_email_key", typedCampaign.template_key);

  if (candidatesError) {
    return json(500, {
      ok: false,
      error: "candidate_count_failed",
      details: candidatesError.message,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: false,
    });
  }

  const candidateCount = candidateCountRaw ?? 0;
  const wouldPlanBeforeBlocks = Math.min(candidateCount, effectiveLimit);
  const todayStart = utcDayStartIso();

  const { count: campaignQueuedTodayRaw, error: campaignQueuedTodayError } =
    await supabase
      .from("marketing_email_queue")
      .select("*", { count: "exact", head: true })
      .eq("segment_key", typedCampaign.segment_key)
      .eq("template_key", typedCampaign.template_key)
      .gte("created_at", todayStart);

  if (campaignQueuedTodayError) {
    return json(500, {
      ok: false,
      error: "campaign_daily_queue_count_failed",
      details: campaignQueuedTodayError.message,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: realEnqueueAttempted,
    });
  }

  const { count: globalQueuedTodayRaw, error: globalQueuedTodayError } =
    await supabase
      .from("marketing_email_queue")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart);

  if (globalQueuedTodayError) {
    return json(500, {
      ok: false,
      error: "global_daily_queue_count_failed",
      details: globalQueuedTodayError.message,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: realEnqueueAttempted,
    });
  }

  const campaignQueuedToday = campaignQueuedTodayRaw ?? 0;
  const globalQueuedToday = globalQueuedTodayRaw ?? 0;
  const { count: successfulRunTodayRaw, error: successfulRunTodayError } =
    await supabase
      .from("marketing_planner_logs")
      .select("*", { count: "exact", head: true })
      .eq("campaign_key", typedCampaign.campaign_key)
      .eq("run_date", todayIsoDate())
      .eq("dry_run", false)
      .eq("status", "success");

  if (successfulRunTodayError) {
    return json(500, {
      ok: false,
      error: "successful_run_count_failed",
      details: successfulRunTodayError.message,
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: realEnqueueAttempted,
    });
  }

  const successfulRunToday = successfulRunTodayRaw ?? 0;
  const campaignDailyRemaining = Math.max(
    0,
    typedCampaign.daily_enqueue_limit - campaignQueuedToday,
  );
  const globalDailyRemaining = dailyGlobalCap > 0
    ? Math.max(0, dailyGlobalCap - globalQueuedToday)
    : requestedLimit;

  const selectedCandidates: Candidate[] = [];
  let selectedCountBeforeInsert = 0;
  let queueWritten = false;
  let enqueueError: string | null = null;
  let skippedSuppressedCount = 0;
  let skippedCooldownCount = 0;
  let skippedTooRecentCount = 0;
  let skippedDuplicateCount = 0;
  let skippedDailyCapCount = 0;
  let skippedGlobalCapCount = 0;
  if (!blockedReason && campaignDailyRemaining <= 0) {
    blockedReason = "daily_enqueue_limit_reached";
    skippedDailyCapCount = candidateCount;
  }
  if (!blockedReason && globalDailyRemaining <= 0) {
    blockedReason = "daily_global_cap_reached";
    skippedGlobalCapCount = candidateCount;
  }
  if (!dryRun && !blockedReason && successfulRunToday > 0) {
    blockedReason = "successful_real_run_already_exists_today";
    skippedDuplicateCount = candidateCount;
  }

  const cappedLimit = Math.max(
    0,
    Math.min(effectiveLimit, campaignDailyRemaining, globalDailyRemaining),
  );
  const wouldEnqueueCount = blockedReason
    ? 0
    : Math.min(candidateCount, cappedLimit);

  if (!dryRun && !blockedReason) {
    const { data: candidates, error: candidateSelectError } = await supabase
      .from("jobradar_marketing_reactivation_candidates")
      .select(
        "user_id,email,email_normalized,registered_at,segment,suggested_email_key",
      )
      .eq("segment", typedCampaign.segment_key)
      .eq("suggested_email_key", typedCampaign.template_key)
      .order("registered_at", { ascending: true })
      .limit(Math.max(1, Math.min(MAX_LIMIT, candidateCount)));

    if (candidateSelectError) {
      blockedReason = "candidate_select_failed";
      enqueueError = candidateSelectError.message;
    } else {
      for (const candidate of (candidates ?? []) as Candidate[]) {
        selectedCountBeforeInsert += 1;

        const { count: suppressionCountRaw, error: suppressionError } =
          await supabase
            .from("email_suppressions")
            .select("*", { count: "exact", head: true })
            .eq("email_normalized", candidate.email_normalized);

        if (suppressionError) {
          blockedReason = "suppression_check_failed";
          enqueueError = suppressionError.message;
          break;
        }
        if ((suppressionCountRaw ?? 0) > 0) {
          skippedSuppressedCount += 1;
          continue;
        }

        const minRegisteredAt = hoursAgoIso(typedCampaign.min_user_age_hours);
        if (
          candidate.registered_at &&
          new Date(candidate.registered_at).getTime() >
            new Date(minRegisteredAt).getTime()
        ) {
          skippedTooRecentCount += 1;
          continue;
        }

        const { count: activeAlertCountRaw, error: activeAlertError } =
          await supabase
            .from("alerts")
            .select("*", { count: "exact", head: true })
            .eq("user_id", candidate.user_id)
            .eq("is_active", true);

        if (activeAlertError) {
          blockedReason = "active_alert_check_failed";
          enqueueError = activeAlertError.message;
          break;
        }
        if ((activeAlertCountRaw ?? 0) > 0) {
          skippedDuplicateCount += 1;
          continue;
        }

        const { count: sentCountRaw, error: sentError } = await supabase
          .from("email_logs")
          .select("*", { count: "exact", head: true })
          .eq("email_normalized", candidate.email_normalized)
          .eq("status", "sent")
          .or(
            `email_key.eq.${typedCampaign.template_key},segment.eq.${typedCampaign.segment_key}`,
          );

        if (sentError) {
          blockedReason = "sent_log_check_failed";
          enqueueError = sentError.message;
          break;
        }
        if ((sentCountRaw ?? 0) > 0) {
          skippedDuplicateCount += 1;
          continue;
        }

        const cooldownSince = daysAgoIso(typedCampaign.cooldown_days);
        const { count: cooldownCountRaw, error: cooldownError } = await supabase
          .from("email_logs")
          .select("*", { count: "exact", head: true })
          .eq("email_normalized", candidate.email_normalized)
          .eq("status", "sent")
          .gte("sent_at", cooldownSince);

        if (cooldownError) {
          blockedReason = "cooldown_check_failed";
          enqueueError = cooldownError.message;
          break;
        }
        if ((cooldownCountRaw ?? 0) > 0) {
          skippedCooldownCount += 1;
          continue;
        }

        const { count: pendingCountRaw, error: pendingError } = await supabase
          .from("marketing_email_queue")
          .select("*", { count: "exact", head: true })
          .eq("user_id", candidate.user_id)
          .eq("sequence_key", typedCampaign.sequence_key)
          .eq("step_key", typedCampaign.step_key)
          .eq("template_key", typedCampaign.template_key)
          .in("status", PENDING_QUEUE_STATUSES);

        if (pendingError) {
          blockedReason = "pending_queue_check_failed";
          enqueueError = pendingError.message;
          break;
        }
        if ((pendingCountRaw ?? 0) > 0) {
          skippedDuplicateCount += 1;
          continue;
        }

        // Le check "pending" ci-dessus ne couvre que les statuts en file
        // d'attente (PENDING_QUEUE_STATUSES) et filtre par user_id. La
        // contrainte unique reelle (marketing_email_queue_email_sequence_step_uidx)
        // porte elle sur (lower(email), sequence_key, step_key), tous statuts
        // confondus. Un candidat deja present sous un autre statut (sent,
        // failed...) passait donc ce filtre puis faisait echouer l'insert en
        // bloc sur une violation de contrainte unique, bloquant tout l'envoi
        // marketing du jour meme pour les autres candidats propres du batch.
        // Bug confirme en prod du 17 au 19/07/2026 (marketing_planner_logs,
        // error "duplicate key value violates unique constraint
        // marketing_email_queue_email_sequence_step_uidx").
        const {
          count: existingAnyStatusCountRaw,
          error: existingAnyStatusError,
        } = await supabase
          .from("marketing_email_queue")
          .select("*", { count: "exact", head: true })
          .ilike("email", candidate.email)
          .eq("sequence_key", typedCampaign.sequence_key)
          .eq("step_key", typedCampaign.step_key);

        if (existingAnyStatusError) {
          blockedReason = "existing_queue_check_failed";
          enqueueError = existingAnyStatusError.message;
          break;
        }
        if ((existingAnyStatusCountRaw ?? 0) > 0) {
          skippedDuplicateCount += 1;
          continue;
        }

        selectedCandidates.push(candidate);
        if (selectedCandidates.length >= cappedLimit) {
          break;
        }
      }
    }

    if (!blockedReason && selectedCandidates.length === 0) {
      blockedReason = "no_clean_candidate";
    }

    if (!blockedReason && selectedCandidates.length > 0) {
      const { error: insertError } = await supabase
        .from("marketing_email_queue")
        .insert(selectedCandidates.map((candidate) => ({
          user_id: candidate.user_id,
          email: candidate.email,
          sequence_key: typedCampaign.sequence_key,
          step_key: typedCampaign.step_key,
          template_key: typedCampaign.template_key,
          segment_key: typedCampaign.segment_key,
          status: "queued",
          priority: typedCampaign.priority,
          scheduled_for: new Date().toISOString(),
          attempts: 0,
          max_attempts: 3,
          provider: "resend",
          metadata: {
            planner_version: PLANNER_VERSION,
            planner_run_id: runId,
            trigger,
            controlled_activation: true,
            controlled_enqueue_mode: enqueueGate.mode,
          },
        })));

      if (insertError) {
        blockedReason = "queue_insert_failed";
        enqueueError = insertError.message;
      } else {
        queueWritten = true;
      }
    }
  }

  const enqueuedCount = queueWritten ? selectedCandidates.length : 0;
  const selectedUserIds = selectedCandidates.map((candidate) =>
    candidate.user_id
  );

  const finishedAt = new Date().toISOString();

  let plannerLogWritten = false;
  let plannerLogError: string | null = null;

  if (writeLog) {
    const { error: logError } = await supabase
      .from("marketing_planner_logs")
      .insert({
        run_id: runId,
        run_date: todayIsoDate(),
        campaign_key: typedCampaign.campaign_key,
        dry_run: dryRun,
        status: enqueueError ? "failed" : logStatus(dryRun, blockedReason),
        started_at: startedAt,
        finished_at: finishedAt,
        eligible_count: candidateCount,
        enqueued_count: enqueuedCount,
        skipped_suppressed_count: skippedSuppressedCount,
        skipped_cooldown_count: skippedCooldownCount,
        skipped_too_recent_count: skippedTooRecentCount,
        skipped_daily_cap_count: skippedDailyCapCount,
        skipped_duplicate_count: skippedDuplicateCount,
        skipped_global_cap_count: skippedGlobalCapCount,
        error: enqueueError,
        metadata: {
          planner_version: PLANNER_VERSION,
          trigger,
          candidate_source: "jobradar_marketing_reactivation_candidates",
          lifecycle_paused: lifecyclePaused,
          campaign_enabled: typedCampaign.enabled,
          campaign_dry_run: typedCampaign.dry_run,
          blocked_reason: blockedReason,
          requested_limit: requestedLimit,
          effective_limit: effectiveLimit,
          capped_limit: cappedLimit,
          campaign_queued_today: campaignQueuedToday,
          global_queued_today: globalQueuedToday,
          successful_real_runs_today: successfulRunToday,
          campaign_daily_remaining: campaignDailyRemaining,
          global_daily_remaining: globalDailyRemaining,
          would_plan_before_blocks: wouldPlanBeforeBlocks,
          queue_written: queueWritten,
          email_sent: false,
          real_enqueue_attempted: realEnqueueAttempted,
          selected_count_before_insert: selectedCountBeforeInsert,
          selected_count: selectedCandidates.length,
          selected_user_ids: selectedUserIds,
          controlled_enqueue_mode: enqueueGate.mode,
        },
      });

    if (logError) {
      plannerLogError = logError.message;
    } else {
      plannerLogWritten = true;
    }
  }

  const responseStatus = enqueueError
    ? 500
    : (!dryRun && !queueWritten ? 409 : 200);

  return json(responseStatus, {
    ok: dryRun || queueWritten,
    dry_run: dryRun,
    planner_version: PLANNER_VERSION,
    run_id: runId,
    campaign_key: typedCampaign.campaign_key,
    segment_key: typedCampaign.segment_key,
    sequence_key: typedCampaign.sequence_key,
    step_key: typedCampaign.step_key,
    template_key: typedCampaign.template_key,
    lifecycle_paused: lifecyclePaused,
    campaign_enabled: typedCampaign.enabled,
    campaign_dry_run: typedCampaign.dry_run,
    daily_enqueue_limit: typedCampaign.daily_enqueue_limit,
    daily_send_limit: typedCampaign.daily_send_limit,
    daily_global_cap: dailyGlobalCap || null,
    campaign_queued_today: campaignQueuedToday,
    global_queued_today: globalQueuedToday,
    successful_real_runs_today: successfulRunToday,
    campaign_daily_remaining: campaignDailyRemaining,
    global_daily_remaining: globalDailyRemaining,
    requested_limit: requestedLimit,
    effective_limit: effectiveLimit,
    capped_limit: cappedLimit,
    candidate_source: "jobradar_marketing_reactivation_candidates",
    candidate_count: candidateCount,
    would_plan_before_blocks: wouldPlanBeforeBlocks,
    would_enqueue_count: dryRun ? wouldEnqueueCount : 0,
    enqueued_count: enqueuedCount,
    skipped_suppressed_count: skippedSuppressedCount,
    skipped_cooldown_count: skippedCooldownCount,
    skipped_too_recent_count: skippedTooRecentCount,
    skipped_daily_cap_count: skippedDailyCapCount,
    skipped_duplicate_count: skippedDuplicateCount,
    skipped_global_cap_count: skippedGlobalCapCount,
    blocked_reason: blockedReason,
    queue_written: queueWritten,
    email_sent: false,
    real_enqueue_attempted: realEnqueueAttempted,
    selected_count_before_insert: selectedCountBeforeInsert,
    selected_count: selectedCandidates.length,
    selected_user_ids: selectedUserIds,
    controlled_enqueue_mode: enqueueGate.mode,
    planner_log_written: plannerLogWritten,
    planner_log_error: plannerLogError,
    enqueue_error: enqueueError,
  });
});
