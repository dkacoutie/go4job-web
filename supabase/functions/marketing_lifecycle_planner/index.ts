import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

type PlannerBody = {
  dry_run?: boolean | null;
  campaign_key?: string | null;
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

const DEFAULT_CAMPAIGN_KEY = "non_paying_without_alert";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  if (!dryRun) {
    return json(409, {
      ok: false,
      error: "planner_v1_dry_run_only",
      message: "marketing_lifecycle_planner V1 only accepts dry_run=true.",
      queue_written: false,
      email_sent: false,
      real_enqueue_attempted: false,
    });
  }

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

  const lifecyclePaused = parseBoolSetting(globalSettings.lifecycle_paused, true);
  const parsedDailyGlobalCap = Number.parseInt(
    globalSettings.daily_global_cap ?? "0",
    10,
  );
  const dailyGlobalCap = Number.isFinite(parsedDailyGlobalCap)
    ? parsedDailyGlobalCap
    : 0;

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

  let blockedReason: string | null = null;
  if (lifecyclePaused) {
    blockedReason = "lifecycle_paused";
  } else if (!typedCampaign.enabled) {
    blockedReason = "campaign_disabled";
  } else if (!typedCampaign.dry_run) {
    blockedReason = "campaign_not_in_dry_run";
  }

  const wouldEnqueueCount = blockedReason ? 0 : wouldPlanBeforeBlocks;
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
        dry_run: true,
        status: "dry_run",
        started_at: startedAt,
        finished_at: finishedAt,
        eligible_count: candidateCount,
        enqueued_count: 0,
        skipped_daily_cap_count: 0,
        skipped_global_cap_count: 0,
        error: null,
        metadata: {
          planner_version: "v1",
          trigger: body.trigger ?? "manual",
          candidate_source: "jobradar_marketing_reactivation_candidates",
          lifecycle_paused: lifecyclePaused,
          campaign_enabled: typedCampaign.enabled,
          campaign_dry_run: typedCampaign.dry_run,
          blocked_reason: blockedReason,
          requested_limit: requestedLimit,
          effective_limit: effectiveLimit,
          would_plan_before_blocks: wouldPlanBeforeBlocks,
          queue_written: false,
          email_sent: false,
          real_enqueue_attempted: false,
        },
      });

    if (logError) {
      plannerLogError = logError.message;
    } else {
      plannerLogWritten = true;
    }
  }

  return json(200, {
    ok: true,
    dry_run: true,
    planner_version: "v1",
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
    requested_limit: requestedLimit,
    effective_limit: effectiveLimit,
    candidate_source: "jobradar_marketing_reactivation_candidates",
    candidate_count: candidateCount,
    would_plan_before_blocks: wouldPlanBeforeBlocks,
    would_enqueue_count: wouldEnqueueCount,
    blocked_reason: blockedReason,
    queue_written: false,
    email_sent: false,
    real_enqueue_attempted: false,
    planner_log_written: plannerLogWritten,
    planner_log_error: plannerLogError,
  });
});
