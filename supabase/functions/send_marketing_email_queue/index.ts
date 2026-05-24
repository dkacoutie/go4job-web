import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  isMarketingEmailKey,
  renderMarketingEmail,
  type MarketingEmailKey,
} from "../_shared/marketingEmails/templates.ts";

type SendMarketingEmailQueueBody = {
  dry_run?: boolean | null;
  limit?: number | null;
  confirm?: string | null;
  segment_key?: string | null;
  template_key?: string | null;
  trigger?: string | null;
};

type QueueItem = {
  id: string;
  user_id: string | null;
  email: string;
  sequence_key: string;
  step_key: string;
  template_key: string;
  segment_key: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  metadata: Record<string, unknown> | null;
};

type EmailLogPayload = {
  user_id?: string | null;
  email: string;
  email_normalized: string;
  segment: string;
  email_key: string;
  template_version?: string | null;
  subject?: string | null;
  dry_run: boolean;
  status: "queued" | "sent" | "skipped" | "failed";
  resend_message_id?: string | null;
  sent_at?: string | null;
  metadata: Record<string, unknown>;
};

type ExistingEmailLog = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

type ReservedEmailLog = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type ResponseItem = {
  queue_id: string;
  email: string;
  sequence_key: string;
  step_key: string;
  action: string;
  reason: string;
};

type ResendResult = {
  ok: boolean;
  resendEmailId: string | null;
  status: number | null;
  code: string;
  message: string;
  temporary: boolean;
};

type InsertedUnsubscribeToken = {
  token: string;
};

type CampaignSettings = {
  campaign_key: string;
  enabled: boolean;
  dry_run: boolean;
  segment_key: string;
  sequence_key: string;
  step_key: string;
  template_key: string;
  daily_send_limit: number;
};

type DailySendLimitDiagnostics = {
  campaign_key: string | null;
  segment_key: string | null;
  template_key: string | null;
  campaign_enabled: boolean | null;
  campaign_dry_run: boolean | null;
  daily_send_limit: number | null;
  sent_today: number;
  daily_send_remaining: number | null;
  daily_send_limit_enforced: boolean;
};

const MAX_LIMIT = 31;
const SEND_CREATE_ALERT_DAILY_CONFIRM_PHRASE =
  "SEND_CREATE_ALERT_EMAIL_1_DAILY_LIMIT_10";
const CREATE_ALERT_DAILY_MAX_LIMIT = 10;
const SEND_PAYSTACK_RECOVERY_CONFIRM_PHRASE = "SEND_PAYSTACK_RECOVERY_LIMIT_5";
const SEND_PAYSTACK_PENDING_CONFIRM_PHRASE = "SEND_PAYSTACK_RECOVERY_PENDING_LIMIT_31";
const PAYSTACK_RECOVERY_MAX_LIMIT = 5;
const PAYSTACK_PENDING_MAX_LIMIT = 31;
const PAYSTACK_RECOVERY_SEGMENT_KEY = "paystack_abandoned_checkout";
const PAYSTACK_RECOVERY_SEQUENCE_KEY = "paystack_abandoned_checkout";
const PAYSTACK_RECOVERY_STEP_KEY = "email_1";
const LOCKED_BY = "send_marketing_email_queue_v1";
const REQUEST_TIMEOUT_MS = 15_000;
const UNSUBSCRIBE_BASE_URL =
  "https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/email_unsubscribe";
const COUNTED_SENT_STATUSES = ["sent", "delivered", "opened", "clicked"];
const PAYSTACK_RECOVERY_TEMPLATE_KEY = "paystack_abandoned_checkout_email_1";

const TEMPLATE_KEY_TO_SEGMENT: Record<MarketingEmailKey, string> = {
  payment_attempt_no_success_email_1: "payment_attempt_no_success",
  interested_no_payment_attempt_email_1: "interested_no_payment_attempt",
  buyer_feedback_email_1: "buyer_feedback",
  create_alert_email_1: "non_paying_without_alert",
  paystack_abandoned_checkout_email_1: "paystack_abandoned_checkout",
};

const VALID_SEGMENTS = new Set([
  "payment_attempt_no_success",
  "interested_no_payment_attempt",
  "buyer_feedback",
  "non_paying_without_alert",
  "paystack_abandoned_checkout",
  "incomplete_onboarding",
  "expired_pass",
  "former_buyer",
  "job_alert",
]);

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  const start = localPart.slice(0, 2);
  const end = localPart.length > 4 ? localPart.slice(-1) : "";
  return `${start}${"*".repeat(Math.max(3, localPart.length - start.length - end.length))}${end}@${domain}`;
}

function parseLimit(value: number) {
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function isValidCreateAlertDailyLimit(value: number | null | undefined) {
  return Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= CREATE_ALERT_DAILY_MAX_LIMIT;
}

function cleanText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function logEmailKey(item: QueueItem) {
  return `${item.sequence_key}:${item.step_key}`;
}

function segmentFor(item: QueueItem) {
  const fromQueue = (item.segment_key ?? "").trim();
  if (VALID_SEGMENTS.has(fromQueue)) return fromQueue;
  if (isMarketingEmailKey(item.template_key)) {
    return TEMPLATE_KEY_TO_SEGMENT[item.template_key];
  }
  return "job_alert";
}

function metadataString(item: QueueItem, key: string) {
  return asString(item.metadata?.[key]);
}

function utcDayStartIso() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function buildResponseItem(
  item: QueueItem,
  action: string,
  reason: string,
): ResponseItem {
  return {
    queue_id: item.id,
    email: maskEmail(item.email),
    sequence_key: item.sequence_key,
    step_key: item.step_key,
    action,
    reason,
  };
}

function isTemporaryResendStatus(status: number) {
  return status === 429 || status >= 500;
}

function isPermanentResendStatus(status: number) {
  return status === 400 || status === 422;
}

function ensureUnsubscribeFooter(html: string, text: string, unsubscribeUrl: string) {
  const htmlHasLink = html.includes(unsubscribeUrl);
  const textHasLink = text.includes(unsubscribeUrl);

  return {
    html: htmlHasLink
      ? html
      : `${html}<p style="font-size:12px;color:#64748b;">Se desinscrire : <a href="${unsubscribeUrl}">${unsubscribeUrl}</a></p>`,
    text: textHasLink
      ? text
      : `${text}\n\nSe desinscrire : ${unsubscribeUrl}`,
  };
}

async function countExact(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  errorPrefix: string,
) {
  const { count, error } = await query;
  if (error) throw new Error(`${errorPrefix}:${error.message}`);
  return count ?? 0;
}

async function checkSendCreateAlertDailySafety(supabase: SupabaseClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    lockedCount,
    recentFailedCount,
    recentSuppressionCount,
    recentWebhookEventCount,
  ] = await Promise.all([
    countExact(
      supabase
        .from("marketing_email_queue")
        .select("id", { count: "exact", head: true })
        .eq("segment_key", "non_paying_without_alert")
        .eq("template_key", "create_alert_email_1")
        .eq("status", "locked"),
      "daily_locked_queue_lookup_failed",
    ),
    countExact(
      supabase
        .from("marketing_email_queue")
        .select("id", { count: "exact", head: true })
        .eq("segment_key", "non_paying_without_alert")
        .eq("template_key", "create_alert_email_1")
        .eq("status", "failed")
        .gte("updated_at", since),
      "daily_failed_queue_lookup_failed",
    ),
    countExact(
      supabase
        .from("email_suppressions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .or("reason.ilike.%bounce%,reason.ilike.%complaint%"),
      "daily_suppression_lookup_failed",
    ),
    countExact(
      supabase
        .from("resend_webhook_events")
        .select("id", { count: "exact", head: true })
        .gte("received_at", since)
        .or("event_type.ilike.%bounce%,event_type.ilike.%complaint%"),
      "daily_webhook_lookup_failed",
    ),
  ]);

  const counts = {
    locked_count: lockedCount,
    recent_failed_count: recentFailedCount,
    recent_bounce_or_complaint_suppression_count: recentSuppressionCount,
    recent_bounce_or_complaint_webhook_count: recentWebhookEventCount,
  };

  return {
    ok: Object.values(counts).every((count) => count === 0),
    since,
    counts,
  };
}

function emptyDailySendLimitDiagnostics(
  segmentKey: string,
  templateKey: string,
): DailySendLimitDiagnostics {
  return {
    campaign_key: null,
    segment_key: segmentKey || null,
    template_key: templateKey || null,
    campaign_enabled: null,
    campaign_dry_run: null,
    daily_send_limit: null,
    sent_today: 0,
    daily_send_remaining: null,
    daily_send_limit_enforced: false,
  };
}

async function fetchCampaignSettingsForSend(
  supabase: SupabaseClient,
  filters: { segmentKey: string; templateKey: string },
) {
  if (!filters.segmentKey || !filters.templateKey) return null;

  const { data, error } = await supabase
    .from("marketing_campaign_settings")
    .select(
      "campaign_key,enabled,dry_run,segment_key,sequence_key,step_key,template_key,daily_send_limit",
    )
    .eq("segment_key", filters.segmentKey)
    .eq("template_key", filters.templateKey)
    .maybeSingle<CampaignSettings>();

  if (error) throw new Error(`campaign_settings_lookup_failed:${error.message}`);
  return data;
}

async function countCampaignSentToday(
  supabase: SupabaseClient,
  campaign: CampaignSettings,
) {
  const todayStart = utcDayStartIso();
  const base = () =>
    supabase
      .from("email_logs")
      .select("id", { count: "exact", head: true })
      .in("status", COUNTED_SENT_STATUSES)
      .eq("segment", campaign.segment_key)
      .eq("email_key", `${campaign.sequence_key}:${campaign.step_key}`)
      .eq("metadata->>template_key", campaign.template_key);

  const [sentAtCount, createdAtFallbackCount] = await Promise.all([
    countExact(
      base().gte("sent_at", todayStart),
      "daily_send_sent_at_lookup_failed",
    ),
    countExact(
      base().is("sent_at", null).gte("created_at", todayStart),
      "daily_send_created_at_lookup_failed",
    ),
  ]);

  return sentAtCount + createdAtFallbackCount;
}

async function getDailySendLimitDiagnostics(
  supabase: SupabaseClient,
  filters: { segmentKey: string; templateKey: string },
): Promise<DailySendLimitDiagnostics> {
  const campaign = await fetchCampaignSettingsForSend(supabase, filters);
  if (!campaign) {
    return emptyDailySendLimitDiagnostics(filters.segmentKey, filters.templateKey);
  }

  const sentToday = await countCampaignSentToday(supabase, campaign);
  const dailySendRemaining = Math.max(0, campaign.daily_send_limit - sentToday);

  return {
    campaign_key: campaign.campaign_key,
    segment_key: campaign.segment_key,
    template_key: campaign.template_key,
    campaign_enabled: campaign.enabled,
    campaign_dry_run: campaign.dry_run,
    daily_send_limit: campaign.daily_send_limit,
    sent_today: sentToday,
    daily_send_remaining: dailySendRemaining,
    daily_send_limit_enforced: true,
  };
}

function blockedBeforeSendResponse(params: {
  dryRun: boolean;
  limitRequested: number;
  limitApplied: number;
  blockedReason: string;
  items: ResponseItem[];
  diagnostics: DailySendLimitDiagnostics;
}) {
  return json(200, {
    ok: true,
    dry_run: params.dryRun,
    limit_requested: params.limitRequested,
    limit_applied: params.limitApplied,
    selected_count: 0,
    would_send_count: 0,
    sent_count: 0,
    skipped_count: 0,
    failed_count: 0,
    blocked_reason: params.blockedReason,
    resend_called: false,
    items: params.items,
    ...params.diagnostics,
  });
}

async function fetchQueueItems(
  supabase: SupabaseClient,
  limit: number,
  filters: {
    segmentKey?: string;
    sequenceKey?: string;
    stepKey?: string;
    templateKey?: string;
    excludeTemplateKey?: string;
  } = {},
) {
  const now = new Date().toISOString();
  let query = supabase
    .from("marketing_email_queue")
    .select(
      [
        "id",
        "user_id",
        "email",
        "sequence_key",
        "step_key",
        "template_key",
        "segment_key",
        "status",
        "attempts",
        "max_attempts",
        "metadata",
      ].join(","),
    )
    .eq("status", "queued")
    .lte("scheduled_for", now);

  if (filters.segmentKey) {
    query = query.eq("segment_key", filters.segmentKey);
  }

  if (filters.sequenceKey) {
    query = query.eq("sequence_key", filters.sequenceKey);
  }

  if (filters.stepKey) {
    query = query.eq("step_key", filters.stepKey);
  }

  if (filters.templateKey) {
    query = query.eq("template_key", filters.templateKey);
  }

  if (filters.excludeTemplateKey) {
    query = query.neq("template_key", filters.excludeTemplateKey);
  }

  const { data, error } = await query
    .order("priority", { ascending: true })
    .order("scheduled_for", { ascending: true })
    .limit(limit * 3)
    .returns<QueueItem[]>();

  if (error) throw new Error(`queue_select_failed:${error.message}`);
  return (data ?? [])
    .filter((item) => item.attempts < item.max_attempts)
    .slice(0, limit);
}

async function fetchSuppression(supabase: SupabaseClient, emailNormalized: string) {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("reason, source")
    .eq("email_normalized", emailNormalized)
    .maybeSingle<{ reason: string; source: string | null }>();

  if (error) throw new Error(`suppression_lookup_failed:${error.message}`);
  return data;
}

async function fetchExistingEmailLog(
  supabase: SupabaseClient,
  emailNormalized: string,
  emailKey: string,
) {
  const { data, error } = await supabase
    .from("email_logs")
    .select("id, status, metadata")
    .eq("email_normalized", emailNormalized)
    .eq("email_key", emailKey)
    .maybeSingle<ExistingEmailLog>();

  if (error) throw new Error(`email_log_lookup_failed:${error.message}`);
  return data;
}

function reasonForExistingEmailLog(status: string) {
  if (["sent", "delivered", "opened", "clicked"].includes(status)) {
    return "already_sent";
  }
  if (status === "unsubscribed") return "already_unsubscribed";
  if (status === "bounced") return "already_bounced";
  if (status === "complained") return "already_complained";
  if (status === "queued") return "email_log_already_reserved";
  if (status === "failed") return "previous_failed_requires_manual_review";
  if (status === "skipped") return "already_skipped";
  return "email_log_already_exists";
}

async function insertSkippedEmailLogIfAbsent(
  supabase: SupabaseClient,
  payload: EmailLogPayload,
) {
  const { error } = await supabase.from("email_logs").insert(payload);

  if (!error) return { inserted: true, reason: "inserted" };

  if (error.code === "23505") {
    await fetchExistingEmailLog(
      supabase,
      payload.email_normalized,
      payload.email_key,
    );
    return { inserted: false, reason: "existing_log_preserved" };
  }

  throw new Error(`email_log_insert_failed:${error.message}`);
}

async function reserveEmailLog(
  supabase: SupabaseClient,
  payload: EmailLogPayload,
) {
  const { data, error } = await supabase
    .from("email_logs")
    .insert(payload)
    .select("id, metadata")
    .single<ReservedEmailLog>();

  if (!error && data?.id) {
    return { reserved: true, log: data, existing: null };
  }

  if (error?.code === "23505") {
    const existing = await fetchExistingEmailLog(
      supabase,
      payload.email_normalized,
      payload.email_key,
    );
    return { reserved: false, log: null, existing };
  }

  throw new Error(`email_log_reserve_failed:${error?.message ?? "missing_log_id"}`);
}

async function updateReservedEmailLog(
  supabase: SupabaseClient,
  logId: string,
  payload: Partial<EmailLogPayload>,
) {
  const { error } = await supabase
    .from("email_logs")
    .update(payload)
    .eq("id", logId)
    .neq("status", "sent");

  if (error) throw new Error(`email_log_update_failed:${error.message}`);
}

async function failReservedEmailLogIfPossible(
  supabase: SupabaseClient,
  log: ReservedEmailLog | null,
  details: {
    errorCode: string;
    errorMessage: string;
    queueId: string;
    sequenceKey: string;
    stepKey: string;
    templateKey: string;
  },
) {
  if (!log?.id) return;

  try {
    await updateReservedEmailLog(supabase, log.id, {
      status: "failed",
      metadata: {
        ...(log.metadata ?? {}),
        queue_id: details.queueId,
        sequence_key: details.sequenceKey,
        step_key: details.stepKey,
        template_key: details.templateKey,
        provider: "resend",
        error_code: details.errorCode,
        error_message: details.errorMessage,
      },
    });
  } catch {
    // A best-effort failure update must never overwrite a sent log or hide the original failure.
  }
}

async function lockQueueItem(supabase: SupabaseClient, item: QueueItem) {
  const { data, error } = await supabase
    .from("marketing_email_queue")
    .update({
      status: "locked",
      locked_at: new Date().toISOString(),
      locked_by: LOCKED_BY,
      attempts: item.attempts + 1,
      last_error: null,
    })
    .eq("id", item.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`queue_lock_failed:${error.message}`);
  return Boolean(data?.id);
}

async function markQueueSent(
  supabase: SupabaseClient,
  item: QueueItem,
  resendEmailId: string | null,
) {
  const { error } = await supabase
    .from("marketing_email_queue")
    .update({
      status: "sent",
      provider: "resend",
      provider_message_id: resendEmailId,
      sent_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .eq("id", item.id)
    .eq("status", "locked");

  if (error) throw new Error(`queue_sent_update_failed:${error.message}`);
}

async function markPaystackRecoveryLeadSent(
  supabase: SupabaseClient,
  item: QueueItem,
  sentAt: string,
) {
  if (item.template_key !== PAYSTACK_RECOVERY_TEMPLATE_KEY) return true;

  const leadId = metadataString(item, "lead_id");
  if (!leadId) return false;

  const { data, error } = await supabase
    .from("paystack_checkout_recovery_leads")
    .update({
      recommended_state: "sent",
      sent_at: sentAt,
    })
    .eq("id", leadId)
    .eq("recommended_state", "queued")
    .select("id")
    .maybeSingle<{ id: string }>();

  return !error && Boolean(data?.id);
}

async function markQueueSkipped(
  supabase: SupabaseClient,
  item: QueueItem,
  reason: string,
) {
  const { error } = await supabase
    .from("marketing_email_queue")
    .update({
      status: "skipped",
      locked_at: null,
      locked_by: null,
      last_error: reason,
    })
    .eq("id", item.id)
    .in("status", ["queued", "locked"]);

  if (error) throw new Error(`queue_skipped_update_failed:${error.message}`);
}

async function markQueueFailed(
  supabase: SupabaseClient,
  item: QueueItem,
  reason: string,
) {
  const { error } = await supabase
    .from("marketing_email_queue")
    .update({
      status: "failed",
      locked_at: null,
      locked_by: null,
      last_error: reason,
    })
    .eq("id", item.id)
    .eq("status", "locked");

  if (error) throw new Error(`queue_failed_update_failed:${error.message}`);
}

async function createUnsubscribeUrl(supabase: SupabaseClient, item: QueueItem) {
  const emailNormalized = normalizeEmail(item.email);
  const segment = segmentFor(item);

  const { data, error } = await supabase
    .from("email_unsubscribe_tokens")
    .insert({
      user_id: item.user_id,
      email: item.email,
      email_normalized: emailNormalized,
      email_key: logEmailKey(item),
      segment,
    })
    .select("token")
    .single<InsertedUnsubscribeToken>();

  if (error || !data?.token) {
    throw new Error(`unsubscribe_token_insert_failed:${error?.message ?? "missing_token"}`);
  }

  return `${UNSUBSCRIBE_BASE_URL}?token=${encodeURIComponent(data.token)}`;
}

async function sendWithResend(payload: Record<string, unknown>, resendKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let data: Record<string, unknown> = {};
    try {
      data = await resp.json();
    } catch {
      data = {};
    }

    const resendEmailId = typeof data.id === "string" ? data.id : null;
    const message = typeof data.message === "string" ? data.message : `resend_status_${resp.status}`;

    if (resp.ok) {
      return {
        ok: true,
        resendEmailId,
        status: resp.status,
        code: "accepted",
        message,
        temporary: false,
      } satisfies ResendResult;
    }

    return {
      ok: false,
      resendEmailId,
      status: resp.status,
      code: isTemporaryResendStatus(resp.status)
        ? "temporary_failed"
        : isPermanentResendStatus(resp.status)
        ? "failed"
        : "resend_rejected",
      message,
      temporary: isTemporaryResendStatus(resp.status),
    } satisfies ResendResult;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      resendEmailId: null,
      status: null,
      code: aborted ? "timeout_uncertain" : "network_uncertain",
      message: aborted ? "resend_timeout" : "resend_network_error",
      temporary: true,
    } satisfies ResendResult;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function inspectItem(supabase: SupabaseClient, item: QueueItem) {
  const emailNormalized = normalizeEmail(item.email);
  const emailKey = logEmailKey(item);

  if (!isMarketingEmailKey(item.template_key)) {
    return { action: "skipped", reason: "unknown_template_key" };
  }

  const suppression = await fetchSuppression(supabase, emailNormalized);
  if (suppression) {
    return { action: "skipped", reason: suppression.reason || "suppressed" };
  }

  const existingLog = await fetchExistingEmailLog(supabase, emailNormalized, emailKey);
  if (existingLog) {
    return {
      action: "skipped",
      reason: reasonForExistingEmailLog(existingLog.status),
    };
  }

  return { action: "send", reason: "eligible" };
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

  let body: SendMarketingEmailQueueBody;
  try {
    body = (await req.json()) as SendMarketingEmailQueueBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (typeof body.dry_run !== "boolean") {
    return json(400, { ok: false, error: "dry_run_required" });
  }

  if (typeof body.limit !== "number" || !Number.isFinite(body.limit)) {
    return json(400, { ok: false, error: "limit_required" });
  }

  const dryRun = body.dry_run;
  const limitRequested = body.limit;
  const limitApplied = parseLimit(limitRequested);
  const isCreateAlertDailyMode =
    body.confirm === SEND_CREATE_ALERT_DAILY_CONFIRM_PHRASE;
  const isPaystackRecoveryLimit5Mode =
    body.confirm === SEND_PAYSTACK_RECOVERY_CONFIRM_PHRASE;
  const isPaystackPendingMode =
    body.confirm === SEND_PAYSTACK_PENDING_CONFIRM_PHRASE;
  const isPaystackRecoveryMode = isPaystackRecoveryLimit5Mode || isPaystackPendingMode;
  const segmentKey = cleanText(body.segment_key);
  const templateKey = cleanText(body.template_key);
  const trigger = cleanText(body.trigger);

  if (isCreateAlertDailyMode) {
    if (!isValidCreateAlertDailyLimit(body.limit)) {
      return json(400, {
        ok: false,
        error: "send_create_alert_daily_limit_invalid",
        message: "Daily send for create_alert_email_1 requires integer limit between 1 and 10.",
      });
    }

    if (
      segmentKey !== "non_paying_without_alert" ||
      templateKey !== "create_alert_email_1" ||
      !["cron", "manual_daily_test"].includes(trigger)
    ) {
      return json(400, {
        ok: false,
        error: "send_create_alert_daily_request_invalid",
        message:
          "Daily send requires segment_key=non_paying_without_alert, template_key=create_alert_email_1, and trigger=cron or manual_daily_test.",
      });
    }
  }

  if (isPaystackRecoveryLimit5Mode) {
    if (
      dryRun ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > PAYSTACK_RECOVERY_MAX_LIMIT ||
      segmentKey !== PAYSTACK_RECOVERY_SEGMENT_KEY ||
      templateKey !== PAYSTACK_RECOVERY_TEMPLATE_KEY ||
      trigger !== "manual"
    ) {
      return json(400, {
        ok: false,
        error: "send_paystack_recovery_request_invalid",
        message:
          "Paystack recovery send requires dry_run=false, confirm=SEND_PAYSTACK_RECOVERY_LIMIT_5, segment_key=paystack_abandoned_checkout, template_key=paystack_abandoned_checkout_email_1, trigger=manual, and integer limit between 1 and 5.",
      });
    }
  }

  if (isPaystackPendingMode) {
    if (
      dryRun ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > PAYSTACK_PENDING_MAX_LIMIT ||
      segmentKey !== PAYSTACK_RECOVERY_SEGMENT_KEY ||
      templateKey !== PAYSTACK_RECOVERY_TEMPLATE_KEY ||
      trigger !== "manual"
    ) {
      return json(400, {
        ok: false,
        error: "send_paystack_pending_request_invalid",
        message:
          "Pending Paystack recovery send requires dry_run=false, confirm=SEND_PAYSTACK_RECOVERY_PENDING_LIMIT_31, segment_key=paystack_abandoned_checkout, template_key=paystack_abandoned_checkout_email_1, trigger=manual, and integer limit between 1 and 31.",
      });
    }
  }

  if (
    !dryRun &&
    !isPaystackRecoveryMode &&
    (
      segmentKey === PAYSTACK_RECOVERY_SEGMENT_KEY ||
      templateKey === PAYSTACK_RECOVERY_TEMPLATE_KEY
    )
  ) {
    return json(400, {
      ok: false,
      error: "send_paystack_recovery_confirm_required",
      message:
        "Paystack recovery real send requires confirm=SEND_PAYSTACK_RECOVERY_LIMIT_5 or confirm=SEND_PAYSTACK_RECOVERY_PENDING_LIMIT_31.",
    });
  }

  if (!dryRun && !isCreateAlertDailyMode && !isPaystackRecoveryMode && limitApplied !== 1) {
    return json(400, {
      ok: false,
      error: "real_send_limit_one_required",
      message: "V1 only allows dry_run=false with limit=1.",
    });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
  const resendFrom = cleanSecret(Deno.env.get("RESEND_FROM"));
  const resendReplyTo = cleanSecret(Deno.env.get("MARKETING_REPLY_TO_EMAIL")) ||
    cleanSecret(Deno.env.get("RESEND_REPLY_TO"));

  if (!dryRun && (!resendKey || !resendFrom)) {
    return json(500, {
      ok: false,
      error: "needs_resend_config",
      message: "RESEND_API_KEY and RESEND_FROM are required for real sends.",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const items: ResponseItem[] = [];
  let wouldSendCount = 0;
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let leadStateUpdateFailedCount = 0;

  try {
    const dailySendLimitDiagnostics = await getDailySendLimitDiagnostics(
      supabase,
      { segmentKey, templateKey },
    );

    if (
      !dryRun &&
      dailySendLimitDiagnostics.daily_send_limit_enforced &&
      dailySendLimitDiagnostics.campaign_enabled === false
    ) {
      return blockedBeforeSendResponse({
        dryRun,
        limitRequested,
        limitApplied,
        blockedReason: "campaign_disabled",
        items,
        diagnostics: dailySendLimitDiagnostics,
      });
    }

    if (
      !dryRun &&
      dailySendLimitDiagnostics.daily_send_limit_enforced &&
      dailySendLimitDiagnostics.campaign_dry_run === true
    ) {
      return blockedBeforeSendResponse({
        dryRun,
        limitRequested,
        limitApplied,
        blockedReason: "campaign_dry_run",
        items,
        diagnostics: dailySendLimitDiagnostics,
      });
    }

    if (
      !dryRun &&
      dailySendLimitDiagnostics.daily_send_limit_enforced &&
      dailySendLimitDiagnostics.daily_send_remaining !== null &&
      dailySendLimitDiagnostics.daily_send_remaining <= 0
    ) {
      return blockedBeforeSendResponse({
        dryRun,
        limitRequested,
        limitApplied,
        blockedReason: "daily_send_limit_reached",
        items,
        diagnostics: dailySendLimitDiagnostics,
      });
    }

    if (!dryRun && isCreateAlertDailyMode) {
      const safety = await checkSendCreateAlertDailySafety(supabase);
      if (!safety.ok) {
        return json(409, {
          ok: false,
          dry_run: false,
          error: "send_create_alert_daily_safety_stop",
          details: safety,
        });
      }
    }

    const queueLimit = !dryRun &&
        dailySendLimitDiagnostics.daily_send_limit_enforced &&
        dailySendLimitDiagnostics.daily_send_remaining !== null
      ? Math.min(limitApplied, dailySendLimitDiagnostics.daily_send_remaining)
      : limitApplied;

    const queueItems = await fetchQueueItems(
      supabase,
      queueLimit,
      isCreateAlertDailyMode
        ? {
          segmentKey: "non_paying_without_alert",
          templateKey: "create_alert_email_1",
        }
        : isPaystackRecoveryMode
        ? {
          segmentKey: PAYSTACK_RECOVERY_SEGMENT_KEY,
          sequenceKey: PAYSTACK_RECOVERY_SEQUENCE_KEY,
          stepKey: PAYSTACK_RECOVERY_STEP_KEY,
          templateKey: PAYSTACK_RECOVERY_TEMPLATE_KEY,
        }
        : !dryRun
        ? {
          excludeTemplateKey: PAYSTACK_RECOVERY_TEMPLATE_KEY,
        }
        : {
          ...(segmentKey ? { segmentKey } : {}),
          ...(templateKey ? { templateKey } : {}),
        },
    );

    for (const item of queueItems) {
      const emailNormalized = normalizeEmail(item.email);
      const emailKey = logEmailKey(item);
      const segment = segmentFor(item);
      const inspection = await inspectItem(supabase, item);

      if (inspection.action !== "send") {
        skippedCount += 1;
        items.push(buildResponseItem(item, inspection.action, inspection.reason));

        if (!dryRun) {
          await markQueueSkipped(supabase, item, inspection.reason);
          await insertSkippedEmailLogIfAbsent(supabase, {
            user_id: item.user_id,
            email: item.email,
            email_normalized: emailNormalized,
            segment,
            email_key: emailKey,
            dry_run: false,
            status: "skipped",
            resend_message_id: null,
            metadata: {
              queue_id: item.id,
              sequence_key: item.sequence_key,
              step_key: item.step_key,
              template_key: item.template_key,
              reason: inspection.reason,
            },
          });
        }
        continue;
      }

      wouldSendCount += 1;

      if (dryRun) {
        items.push(buildResponseItem(item, "would_send", "eligible"));
        continue;
      }

      if (item.template_key === PAYSTACK_RECOVERY_TEMPLATE_KEY && !resendReplyTo) {
        failedCount += 1;
        items.push(buildResponseItem(item, "blocked", "missing_marketing_reply_to"));
        continue;
      }

      const locked = await lockQueueItem(supabase, item);
      if (!locked) {
        skippedCount += 1;
        items.push(buildResponseItem(item, "skipped", "lock_not_acquired"));
        continue;
      }

      // V1 has no automatic retry loop. Locked/failed queue rows and reserved logs
      // must be monitored manually before any later retry worker is introduced.
      let reservedLog: ReservedEmailLog | null = null;
      try {
        const existingLogBeforeReservation = await fetchExistingEmailLog(
          supabase,
          emailNormalized,
          emailKey,
        );
        if (existingLogBeforeReservation) {
          const reason = reasonForExistingEmailLog(existingLogBeforeReservation.status);
          skippedCount += 1;
          await markQueueSkipped(supabase, item, reason);
          items.push(buildResponseItem(item, "skipped", reason));
          continue;
        }

        const suppression = await fetchSuppression(supabase, emailNormalized);
        if (suppression) {
          skippedCount += 1;
          await markQueueSkipped(supabase, item, suppression.reason || "suppressed");
          await insertSkippedEmailLogIfAbsent(supabase, {
            user_id: item.user_id,
            email: item.email,
            email_normalized: emailNormalized,
            segment,
            email_key: emailKey,
            dry_run: false,
            status: "skipped",
            resend_message_id: null,
            metadata: {
              queue_id: item.id,
              sequence_key: item.sequence_key,
              step_key: item.step_key,
              template_key: item.template_key,
              reason: suppression.reason || "suppressed",
              suppression_source: suppression.source,
            },
          });
          items.push(buildResponseItem(item, "skipped", suppression.reason || "suppressed"));
          continue;
        }

        const unsubscribeUrl = await createUnsubscribeUrl(supabase, item);
        const rendered = renderMarketingEmail(item.template_key, {
          email: item.email,
          poste_recherche: metadataString(item, "poste_recherche") || null,
          unsubscribe_url: unsubscribeUrl,
          app_url: metadataString(item, "app_url") || null,
          pricing_url: metadataString(item, "pricing_url") || null,
          feed_url: metadataString(item, "feed_url") || null,
          recovery_url: metadataString(item, "recovery_url") ||
            metadataString(item, "cta_url") || null,
          segment_message: metadataString(item, "segment_message") || null,
        });
        const withFooter = ensureUnsubscribeFooter(
          rendered.html,
          rendered.text,
          unsubscribeUrl,
        );

        const resendPayload: Record<string, unknown> = {
          from: resendFrom,
          to: item.email,
          subject: rendered.subject,
          html: withFooter.html,
          text: withFooter.text,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [
            { name: "source", value: "send_marketing_email_queue" },
            { name: "sequence_key", value: item.sequence_key },
            { name: "step_key", value: item.step_key },
            { name: "template_key", value: item.template_key },
          ],
        };

        if (resendReplyTo) {
          resendPayload.reply_to = resendReplyTo;
        }

        const reservation = await reserveEmailLog(supabase, {
          user_id: item.user_id,
          email: item.email,
          email_normalized: emailNormalized,
          segment,
          email_key: emailKey,
          dry_run: false,
          status: "queued",
          resend_message_id: null,
          metadata: {
            queue_id: item.id,
            sequence_key: item.sequence_key,
            step_key: item.step_key,
            template_key: item.template_key,
            provider: "resend",
            reason: "reserved_before_send",
          },
        });

        if (!reservation.reserved) {
          const reason = reservation.existing?.status === "sent"
            ? "already_sent"
            : "email_log_already_reserved";
          skippedCount += 1;
          await markQueueSkipped(supabase, item, reason);
          items.push(buildResponseItem(item, "skipped", reason));
          continue;
        }

        reservedLog = reservation.log;
        if (!reservedLog) {
          throw new Error("email_log_reserve_missing");
        }

        const resendResult = await sendWithResend(resendPayload, resendKey);

        if (resendResult.ok) {
          sentCount += 1;
          const now = new Date().toISOString();
          await updateReservedEmailLog(supabase, reservedLog.id, {
            template_version: rendered.template_version,
            subject: rendered.subject,
            status: "sent",
            resend_message_id: resendResult.resendEmailId,
            sent_at: now,
            metadata: {
              ...(reservedLog.metadata ?? {}),
              queue_id: item.id,
              sequence_key: item.sequence_key,
              step_key: item.step_key,
              template_key: item.template_key,
              unsubscribe_url: unsubscribeUrl,
              provider: "resend",
              reason: "accepted",
            },
          });
          await markQueueSent(supabase, item, resendResult.resendEmailId);
          const leadStateUpdated = await markPaystackRecoveryLeadSent(supabase, item, now);
          if (!leadStateUpdated && item.template_key === PAYSTACK_RECOVERY_TEMPLATE_KEY) {
            leadStateUpdateFailedCount += 1;
          }
          items.push(buildResponseItem(
            item,
            "sent",
            leadStateUpdated ? "accepted" : "accepted_lead_state_update_failed",
          ));
          continue;
        }

        failedCount += 1;
        await updateReservedEmailLog(supabase, reservedLog.id, {
          template_version: rendered.template_version,
          subject: rendered.subject,
          status: "failed",
          resend_message_id: resendResult.resendEmailId,
          metadata: {
            ...(reservedLog.metadata ?? {}),
            queue_id: item.id,
            sequence_key: item.sequence_key,
            step_key: item.step_key,
            template_key: item.template_key,
            provider: "resend",
            error_code: resendResult.code,
            error_message: resendResult.message,
            resend_status: resendResult.status,
            temporary: resendResult.temporary,
          },
        });

        const queueFailureReason = resendResult.temporary
          ? "temporary_failed_requires_manual_review"
          : resendResult.code;
        await markQueueFailed(supabase, item, queueFailureReason);

        items.push(buildResponseItem(item, "failed", queueFailureReason));
      } catch (error) {
        failedCount += 1;
        const reason = error instanceof Error ? error.message : "unknown_error";
        if (reservedLog) {
          await failReservedEmailLogIfPossible(supabase, reservedLog, {
            errorCode: "worker_exception_after_reservation",
            errorMessage: reason,
            queueId: item.id,
            sequenceKey: item.sequence_key,
            stepKey: item.step_key,
            templateKey: item.template_key,
          });
        }
        await markQueueFailed(
          supabase,
          item,
          reservedLog ? "worker_exception_after_reservation" : reason,
        );
        items.push(buildResponseItem(item, "failed", reason));
      }
    }

    return json(200, {
      ok: true,
      dry_run: dryRun,
      limit_requested: limitRequested,
      limit_applied: limitApplied,
      queue_limit_applied: queueLimit,
      selected_count: queueItems.length,
      would_send_count: wouldSendCount,
      sent_count: sentCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      lead_state_update_failed_count: leadStateUpdateFailedCount,
      items,
      ...dailySendLimitDiagnostics,
    });
  } catch (error) {
    return json(500, {
      ok: false,
      dry_run: dryRun,
      limit_requested: limitRequested,
      limit_applied: limitApplied,
      selected_count: 0,
      would_send_count: wouldSendCount,
      sent_count: sentCount,
      skipped_count: skippedCount,
      failed_count: failedCount + 1,
      lead_state_update_failed_count: leadStateUpdateFailedCount,
      items,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
});
