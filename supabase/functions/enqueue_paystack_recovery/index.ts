import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type RecoverySegment =
  | "card_abandoned"
  | "mobile_money_failed"
  | "mobile_money_expired_or_abandoned"
  | "multiple_attempts_without_success";

type RecoveryRequest = {
  dry_run?: boolean | null;
  campaign_key?: string | null;
  template_key?: string | null;
  priority_filter?: string | null;
  limit?: number | null;
  allow_enqueue?: boolean | null;
  confirm?: string | null;
  trigger?: string | null;
};

type RecoveryLead = {
  id: string;
  email: string;
  priority: string;
  recovery_segment: RecoverySegment;
  attempt_count: number | null;
  last_status: string | null;
  last_channel: string | null;
  last_attempt_at: string | null;
  inferred_plan: string | null;
};

type AuthUser = {
  id: string;
  email?: string | null;
};

type EligibleLead = {
  lead: RecoveryLead;
  email: string;
  user_id: string | null;
  segment_message: string;
  recovery_url: string;
};

const CAMPAIGN_KEY = "paystack_abandoned_checkout";
const TEMPLATE_KEY = "paystack_abandoned_checkout_email_1";
const SEQUENCE_KEY = CAMPAIGN_KEY;
const STEP_KEY = "email_1";
const MAX_DRY_RUN_LIMIT = 100;
const MAX_PRIORITY_ENQUEUE_LIMIT = 5;
const MAX_PENDING_ENQUEUE_LIMIT = 31;
const PRIORITY_ENQUEUE_CONFIRM = "ENQUEUE_PAYSTACK_RECOVERY_LIMIT_5";
const PENDING_ENQUEUE_CONFIRM = "ENQUEUE_PAYSTACK_RECOVERY_PENDING_LIMIT_31";

const SEGMENT_MESSAGES: Record<RecoverySegment, string> = {
  card_abandoned:
    "Ce n'est peut-être qu'une interruption — ça arrive. Tu peux reprendre là où tu t'étais arrêté.",
  mobile_money_failed:
    "Le paiement Mobile Money n'a pas pu être confirmé. Parfois une simple nouvelle tentative suffit — ou on peut t'aider à trouver une autre option.",
  mobile_money_expired_or_abandoned:
    "La validation n'a pas pu se finaliser à temps. Tu peux relancer le processus en quelques secondes.",
  multiple_attempts_without_success:
    "Si quelque chose a bloqué malgré plusieurs essais, réponds à ce mail et on règle ça ensemble.",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function cleanSecret(value: string | null | undefined) {
  let cleaned = clean(value);
  cleaned = cleaned.replace(/^['"]|['"]$/g, "");
  if (cleaned.toLowerCase().startsWith("bearer ")) {
    cleaned = cleaned.slice(7).trim();
  }
  return cleaned;
}

function normalizeEmail(email: string) {
  return clean(email).toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isInternalOrTestEmail(email: string) {
  return email.endsWith("@example.com") ||
    email.endsWith("@example.org") ||
    email.endsWith("@go4jobapp.com") ||
    email.endsWith(".test") ||
    /(^|[+._-])test([+._-]|@)/.test(email) ||
    [
      "contact.jobradar@gmail.com",
      "infos.go4job@gmail.com",
      "d.kacoutie@gmail.com",
      "kacoutiedieudonne@gmail.com",
    ].includes(email);
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  const visibleStart = localPart.slice(0, 2);
  const visibleEnd = localPart.length > 4 ? localPart.slice(-1) : "";
  return `${visibleStart}${"*".repeat(Math.max(3, localPart.length - visibleStart.length - visibleEnd.length))}${visibleEnd}@${domain}`;
}

function isAuthorized(req: Request) {
  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) return false;

  const authHeader = clean(req.headers.get("authorization"));
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cronHeader = clean(req.headers.get("x-cron-secret"));
  return bearer === cronSecret || cronHeader === cronSecret;
}

function parseLimit(value: number | null | undefined) {
  if (!Number.isInteger(value) || (value as number) < 1) return null;
  return Math.min(value as number, MAX_DRY_RUN_LIMIT);
}

function recoveryUrl(segment: RecoverySegment) {
  return `/jobradar/feed?utm_source=email&utm_medium=recovery&utm_campaign=${TEMPLATE_KEY}&utm_content=${encodeURIComponent(segment)}`;
}

function summarizeEligibleLead(eligible: EligibleLead) {
  return {
    lead_id: eligible.lead.id,
    email: maskEmail(eligible.email),
    priority: eligible.lead.priority,
    recovery_segment: eligible.lead.recovery_segment,
    attempt_count: eligible.lead.attempt_count,
    last_status: eligible.lead.last_status,
    last_channel: eligible.lead.last_channel,
    last_attempt_at: eligible.lead.last_attempt_at,
    inferred_plan: eligible.lead.inferred_plan,
    template_key: TEMPLATE_KEY,
    segment_message: eligible.segment_message,
    recovery_url: eligible.recovery_url,
  };
}

async function findUserIdsByEmail(
  supabase: SupabaseClient,
  targetEmails: Set<string>,
) {
  const idsByEmail = new Map<string, string>();
  if (targetEmails.size === 0) return idsByEmail;

  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth_users_lookup_failed:${error.message}`);

    const users = (data?.users ?? []) as AuthUser[];
    for (const user of users) {
      const email = normalizeEmail(user.email ?? "");
      if (targetEmails.has(email) && user.id) {
        idsByEmail.set(email, user.id);
      }
    }

    if (idsByEmail.size === targetEmails.size || users.length < perPage) break;
  }

  return idsByEmail;
}

async function loadConvertedUserIds(
  supabase: SupabaseClient,
  userIds: string[],
) {
  const converted = new Set<string>();
  if (userIds.length === 0) return converted;

  const now = new Date().toISOString();
  const [paidPayments, subscriptions, currentPasses] = await Promise.all([
    supabase
      .from("billing_payments")
      .select("user_id")
      .eq("status", "paid")
      .not("paid_at", "is", null)
      .in("user_id", userIds),
    supabase
      .from("billing_subscriptions")
      .select("user_id")
      .eq("status", "active")
      .not("activated_at", "is", null)
      .gt("ends_at", now)
      .in("user_id", userIds),
    supabase
      .from("current_user_pass")
      .select("user_id")
      .eq("status", "active")
      .not("activated_at", "is", null)
      .gt("ends_at", now)
      .in("user_id", userIds),
  ]);

  if (paidPayments.error) {
    throw new Error(`paid_payments_lookup_failed:${paidPayments.error.message}`);
  }
  if (subscriptions.error) {
    throw new Error(`active_subscriptions_lookup_failed:${subscriptions.error.message}`);
  }
  if (currentPasses.error) {
    throw new Error(`current_pass_lookup_failed:${currentPasses.error.message}`);
  }

  for (const row of [
    ...(paidPayments.data ?? []),
    ...(subscriptions.data ?? []),
    ...(currentPasses.data ?? []),
  ]) {
    if (row.user_id) converted.add(String(row.user_id));
  }
  return converted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (!isAuthorized(req)) return json(401, { ok: false, error: "unauthorized" });

  let body: RecoveryRequest;
  try {
    body = (await req.json()) as RecoveryRequest;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const campaignKey = clean(body.campaign_key);
  const templateKey = clean(body.template_key);
  const priorityFilter = clean(body.priority_filter);
  const trigger = clean(body.trigger);
  const limit = parseLimit(body.limit);

  if (typeof body.dry_run !== "boolean") {
    return json(400, { ok: false, error: "dry_run_required" });
  }

  if (campaignKey !== CAMPAIGN_KEY || templateKey !== TEMPLATE_KEY) {
    return json(400, {
      ok: false,
      dry_run: body.dry_run === true,
      error: "campaign_template_mismatch",
      expected_campaign_key: CAMPAIGN_KEY,
      expected_template_key: TEMPLATE_KEY,
    });
  }

  if (priorityFilter && !["P1", "P2"].includes(priorityFilter)) {
    return json(400, { ok: false, dry_run: body.dry_run, error: "invalid_priority_filter" });
  }

  if (limit === null) {
    return json(400, {
      ok: false,
      dry_run: body.dry_run === true,
      error: "valid_limit_required",
    });
  }

  if (!body.dry_run) {
    const isPriorityEnqueue = body.allow_enqueue === true &&
      body.confirm === PRIORITY_ENQUEUE_CONFIRM &&
      priorityFilter === "P1" &&
      Number.isInteger(body.limit) &&
      (body.limit as number) >= 1 &&
      (body.limit as number) <= MAX_PRIORITY_ENQUEUE_LIMIT;
    const isPendingEnqueue = body.allow_enqueue === true &&
      body.confirm === PENDING_ENQUEUE_CONFIRM &&
      trigger === "manual" &&
      Number.isInteger(body.limit) &&
      (body.limit as number) >= 1 &&
      (body.limit as number) <= MAX_PENDING_ENQUEUE_LIMIT;

    if (!isPriorityEnqueue && !isPendingEnqueue) {
      return json(400, {
        ok: false,
        dry_run: false,
        campaign_key: CAMPAIGN_KEY,
        template_key: TEMPLATE_KEY,
        queue_written: false,
        stop_reason: "real_enqueue_guardrails_not_satisfied",
        required: {
          priority_batch: {
            allow_enqueue: true,
            confirm: PRIORITY_ENQUEUE_CONFIRM,
            priority_filter: "P1",
            maximum_limit: MAX_PRIORITY_ENQUEUE_LIMIT,
          },
          pending_batch: {
            allow_enqueue: true,
            confirm: PENDING_ENQUEUE_CONFIRM,
            trigger: "manual",
            maximum_limit: MAX_PENDING_ENQUEUE_LIMIT,
            priority_filter: "optional",
          },
        },
      });
    }
  }

  const dryRun = body.dry_run;

  if (!dryRun && limit !== body.limit) {
    return json(400, {
      ok: false,
      dry_run: false,
      campaign_key: CAMPAIGN_KEY,
      template_key: TEMPLATE_KEY,
      queue_written: false,
      stop_reason: "real_enqueue_limit_invalid",
    });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, dry_run: dryRun, error: "server_misconfigured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    let leadsQuery = supabase
      .from("paystack_checkout_recovery_leads")
      .select(
        "id,email,priority,recovery_segment,attempt_count,last_status,last_channel,last_attempt_at,inferred_plan",
      )
      .eq("recommended_state", "pending")
      .eq("template_key", TEMPLATE_KEY)
      .order("last_attempt_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (priorityFilter) leadsQuery = leadsQuery.eq("priority", priorityFilter);

    const { data, error } = await leadsQuery.returns<RecoveryLead[]>();
    if (error) throw new Error(`lead_lookup_failed:${error.message}`);

    const leads = data ?? [];
    const normalizedEmails = Array.from(
      new Set(leads.map((lead) => normalizeEmail(lead.email)).filter(Boolean)),
    );
    const contactableEmails = normalizedEmails
      .filter((email) => isValidEmail(email) && !isInternalOrTestEmail(email));

    const [suppressions, unsubscribeTokens, queueRows, logRows, idsByEmail] =
      await Promise.all([
        contactableEmails.length
          ? supabase
            .from("email_suppressions")
            .select("email_normalized,reason")
            .in("email_normalized", contactableEmails)
          : Promise.resolve({ data: [], error: null }),
        contactableEmails.length
          ? supabase
            .from("email_unsubscribe_tokens")
            .select("email_normalized")
            .in("email_normalized", contactableEmails)
            .not("used_at", "is", null)
          : Promise.resolve({ data: [], error: null }),
        contactableEmails.length
          ? supabase
            .from("marketing_email_queue")
            .select("email")
            .eq("sequence_key", SEQUENCE_KEY)
            .eq("step_key", STEP_KEY)
            .eq("template_key", TEMPLATE_KEY)
            .in("email", contactableEmails)
          : Promise.resolve({ data: [], error: null }),
        contactableEmails.length
          ? supabase
            .from("email_logs")
            .select("email_normalized,email_key,metadata")
            .in("email_normalized", contactableEmails)
          : Promise.resolve({ data: [], error: null }),
        findUserIdsByEmail(supabase, new Set(contactableEmails)),
      ]);

    if (suppressions.error) {
      throw new Error(`suppression_lookup_failed:${suppressions.error.message}`);
    }
    if (unsubscribeTokens.error) {
      throw new Error(`unsubscribe_lookup_failed:${unsubscribeTokens.error.message}`);
    }
    if (queueRows.error) throw new Error(`queue_lookup_failed:${queueRows.error.message}`);
    if (logRows.error) throw new Error(`email_log_lookup_failed:${logRows.error.message}`);

    const suppressedByEmail = new Map(
      (suppressions.data ?? []).map((row) => [
        normalizeEmail(String(row.email_normalized ?? "")),
        String(row.reason ?? ""),
      ]),
    );
    const unsubscribed = new Set(
      (unsubscribeTokens.data ?? []).map((row) =>
        normalizeEmail(String(row.email_normalized ?? ""))
      ),
    );
    const alreadyQueued = new Set(
      (queueRows.data ?? []).map((row) => normalizeEmail(String(row.email ?? ""))),
    );
    const alreadyLogged = new Set(
      (logRows.data ?? [])
        .filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null;
          return row.email_key === `${SEQUENCE_KEY}:${STEP_KEY}` ||
            row.email_key === TEMPLATE_KEY ||
            metadata?.template_key === TEMPLATE_KEY;
        })
        .map((row) => normalizeEmail(String(row.email_normalized ?? ""))),
    );
    const convertedUserIds = await loadConvertedUserIds(
      supabase,
      Array.from(idsByEmail.values()),
    );

    const eligible: EligibleLead[] = [];
    const counters = {
      excluded_suppressed: 0,
      excluded_unsubscribed: 0,
      excluded_internal: 0,
      excluded_already_converted: 0,
      excluded_already_queued_or_sent: 0,
      excluded_invalid_email: 0,
    };

    for (const lead of leads) {
      const email = normalizeEmail(lead.email);
      if (!isValidEmail(email)) {
        counters.excluded_invalid_email += 1;
        continue;
      }
      if (isInternalOrTestEmail(email)) {
        counters.excluded_internal += 1;
        continue;
      }

      const suppressionReason = suppressedByEmail.get(email);
      if (suppressionReason === "unsubscribed" || unsubscribed.has(email)) {
        counters.excluded_unsubscribed += 1;
        continue;
      }
      if (suppressionReason) {
        counters.excluded_suppressed += 1;
        continue;
      }

      const userId = idsByEmail.get(email);
      if (userId && convertedUserIds.has(userId)) {
        counters.excluded_already_converted += 1;
        continue;
      }
      if (alreadyQueued.has(email) || alreadyLogged.has(email)) {
        counters.excluded_already_queued_or_sent += 1;
        continue;
      }

      eligible.push({
        lead,
        email,
        user_id: userId ?? null,
        segment_message: SEGMENT_MESSAGES[lead.recovery_segment],
        recovery_url: recoveryUrl(lead.recovery_segment),
      });
    }

    if (!dryRun) {
      const queuedLeads: Array<Record<string, unknown>> = [];

      for (const candidate of eligible) {
        const { data: insertedQueueRow, error: insertError } = await supabase
          .from("marketing_email_queue")
          .insert({
            user_id: candidate.user_id,
            email: candidate.email,
            sequence_key: SEQUENCE_KEY,
            step_key: STEP_KEY,
            template_key: TEMPLATE_KEY,
            segment_key: CAMPAIGN_KEY,
            status: "queued",
            priority: 10,
            metadata: {
              source: "paystack_checkout_recovery_leads",
              lead_id: candidate.lead.id,
              recovery_segment: candidate.lead.recovery_segment,
              segment_message: candidate.segment_message,
              recovery_url: candidate.recovery_url,
              cta_url: candidate.recovery_url,
              inferred_plan: candidate.lead.inferred_plan,
              last_status: candidate.lead.last_status,
              last_channel: candidate.lead.last_channel,
              last_attempt_at: candidate.lead.last_attempt_at,
            },
          })
          .select("id")
          .single<{ id: string }>();

        if (insertError?.code === "23505") {
          counters.excluded_already_queued_or_sent += 1;
          continue;
        }

        if (insertError || !insertedQueueRow?.id) {
          return json(500, {
            ok: false,
            dry_run: false,
            campaign_key: CAMPAIGN_KEY,
            template_key: TEMPLATE_KEY,
            queue_written: queuedLeads.length > 0,
            queued_count: queuedLeads.length,
            candidates_checked: leads.length,
            eligible_count: eligible.length,
            ...counters,
            queued_leads: queuedLeads,
            stop_reason: "queue_insert_failed_partial_write_review_required",
            error: insertError?.message ?? "queue_insert_missing_id",
          });
        }

        const queuedAt = new Date().toISOString();
        const { data: updatedLead, error: updateError } = await supabase
          .from("paystack_checkout_recovery_leads")
          .update({
            recommended_state: "queued",
            queued_at: queuedAt,
          })
          .eq("id", candidate.lead.id)
          .eq("recommended_state", "pending")
          .select("id")
          .maybeSingle<{ id: string }>();

        const queuedSummary = {
          ...summarizeEligibleLead(candidate),
          queue_id: insertedQueueRow.id,
          queued_at: queuedAt,
        };

        if (updateError || !updatedLead?.id) {
          return json(500, {
            ok: false,
            dry_run: false,
            campaign_key: CAMPAIGN_KEY,
            template_key: TEMPLATE_KEY,
            queue_written: true,
            queued_count: queuedLeads.length + 1,
            candidates_checked: leads.length,
            eligible_count: eligible.length,
            ...counters,
            queued_leads: [...queuedLeads, queuedSummary],
            stop_reason: "queue_inserted_lead_state_update_failed_manual_review_required",
            error: updateError?.message ?? "lead_no_longer_pending",
          });
        }

        queuedLeads.push(queuedSummary);
      }

      return json(200, {
        ok: true,
        dry_run: false,
        campaign_key: CAMPAIGN_KEY,
        template_key: TEMPLATE_KEY,
        priority_filter: priorityFilter,
        trigger: trigger || null,
        limit_applied: limit,
        queue_written: queuedLeads.length > 0,
        queued_count: queuedLeads.length,
        candidates_checked: leads.length,
        eligible_count: eligible.length,
        ...counters,
        queued_leads: queuedLeads,
        stop_reason: queuedLeads.length > 0
          ? "queued_only_no_email_send"
          : "no_eligible_leads_no_queue_write",
      });
    }

    return json(200, {
      ok: true,
      dry_run: true,
      campaign_key: CAMPAIGN_KEY,
      template_key: TEMPLATE_KEY,
      priority_filter: priorityFilter || null,
      limit_applied: limit,
      candidates_checked: leads.length,
      eligible_count: eligible.length,
      would_enqueue_count: eligible.length,
      ...counters,
      sample_eligible_leads: eligible.slice(0, 10).map(summarizeEligibleLead),
      stop_reason: "dry_run_only_no_queue_write_no_email_send",
    });
  } catch (error) {
    return json(500, {
      ok: false,
      dry_run: dryRun,
      campaign_key: CAMPAIGN_KEY,
      template_key: TEMPLATE_KEY,
      queue_written: false,
      candidates_checked: 0,
      eligible_count: 0,
      would_enqueue_count: 0,
      excluded_suppressed: 0,
      excluded_unsubscribed: 0,
      excluded_internal: 0,
      excluded_already_converted: 0,
      excluded_already_queued_or_sent: 0,
      excluded_invalid_email: 0,
      sample_eligible_leads: [],
      stop_reason: dryRun
        ? "dry_run_failed_no_write_performed"
        : "enqueue_eligibility_failed_no_write_performed",
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
});
