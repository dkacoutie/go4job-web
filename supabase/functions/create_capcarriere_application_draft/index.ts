import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2";

type RequestBody = {
  user_id?: string | null;
  apply_intel_id?: string | null;
  dry_run?: boolean | null;
  confirm?: string | null;
};

type NormalizedRequestBody = {
  user_id: string;
  apply_intel_id: string;
  dry_run: boolean;
  confirm: string;
};

type ApplyIntelRow = {
  id: string;
  job_id: string;
  apply_channel: string | null;
  apply_email: string | null;
  apply_url: string | null;
  email_reliability: string | null;
  automation_level: string | null;
  confidence: number | null;
  detection_method: string | null;
  status: string | null;
  metadata_json: Record<string, unknown> | null;
};

type JobRow = {
  id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  country: string | null;
  contract_type: string | null;
  apply_url: string | null;
  source_url: string | null;
  external_id: string | null;
  description_text: string | null;
  description_html: string | null;
  official_desc: string | null;
  ai_description: string | null;
  job_json: Record<string, unknown> | null;
  is_active: boolean | null;
  is_expired: boolean | null;
  expires_at: string | null;
  job_status: string | null;
};

type DraftPayload = {
  user_id: string;
  job_id: string;
  apply_intel_id: string;
  draft_type: "email_application";
  application_channel: string;
  recipient_email: string;
  cc_emails: string[];
  subject: string;
  email_body: null;
  cover_letter_body: null;
  language: "fr";
  tone: "professional";
  cv_required: true;
  cover_letter_required: false;
  draft_gate: "needs_human_review_before_draft";
  status: "draft";
  risk_level: "low";
  risk_flags: string[];
  evidence_json: Record<string, unknown>;
  source_snapshot_json: Record<string, unknown>;
  generation_input_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
};

type AuthResult =
  | { ok: true; mode: "cron_secret" | "admin_preview_jwt" }
  | { ok: false; status: number; reason: string; details?: unknown };

const FUNCTION_NAME = "create_capcarriere_application_draft";
const FUNCTION_VERSION = "v1";
const CONFIRM_TOKEN = "CREATE_CC_DRAFT_INTERNAL_TEST_V1";
const INTERNAL_TEST_USER_ID = "d8069021-87ff-452a-beb3-e5b708378a7e";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) v = v.slice(7).trim();
  return v;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value.trim());
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBody(body: RequestBody): NormalizedRequestBody {
  return {
    user_id: typeof body.user_id === "string" ? body.user_id.trim() : "",
    apply_intel_id: typeof body.apply_intel_id === "string" ? body.apply_intel_id.trim() : "",
    dry_run: body.dry_run !== false,
    confirm: typeof body.confirm === "string" ? body.confirm.trim() : "",
  };
}

function textFrom(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function metadataString(row: ApplyIntelRow, key: string): string {
  return textFrom(row.metadata_json?.[key]);
}

function restrictedApplicantsReason(applyIntel: ApplyIntelRow, job: JobRow): string | null {
  const haystack = [
    job.title,
    job.company_name,
    job.description_text,
    job.description_html,
    job.official_desc,
    job.ai_description,
    textFrom(job.job_json),
    metadataString(applyIntel, "evidence_snippet"),
  ].join(" ").toLowerCase();

  const checks: Array<[string, string]> = [
    ["redeployee applicants only", "redeployee_applicants_only"],
    ["redeployment", "redeployment"],
    ["internal applicants only", "internal_applicants_only"],
    ["reserved applicants only", "reserved_applicants_only"],
  ];

  return checks.find(([needle]) => haystack.includes(needle))?.[1] ?? null;
}

function isJobExpired(job: JobRow): boolean {
  if (job.is_expired === true) return true;
  if (job.is_active === false) return true;
  if (job.job_status && !["active", "stale"].includes(job.job_status)) return true;
  if (job.expires_at && new Date(job.expires_at).getTime() < Date.now()) return true;
  return false;
}

function extractReference(applyIntel: ApplyIntelRow, job: JobRow): string {
  const haystack = [
    metadataString(applyIntel, "evidence_snippet"),
    job.title,
    job.description_text,
    job.official_desc,
    job.ai_description,
    textFrom(job.job_json),
  ].join(" ");

  const match = haystack.match(/\b\d{2}\s+[A-Z]{2,}\s+\d{6}\b/);
  return match?.[0] ?? "44 TSEF 052026";
}

function buildSubject(job: JobRow, reference: string): string {
  return `Candidature - ${job.title ?? "Offre"} - Ref. ${reference}`;
}

function buildPreview(applyIntel: ApplyIntelRow, job: JobRow) {
  const reference = extractReference(applyIntel, job);

  return {
    job_title: job.title,
    company_name: job.company_name,
    recipient_email: normalizeEmail(applyIntel.apply_email ?? ""),
    subject: buildSubject(job, reference),
    reference,
    deadline: job.expires_at,
    status_label: "Brouillon de candidature pret a verifier",
    safety: {
      email_sent: false,
      real_application_created: false,
      database_write: false,
      requires_human_validation: true,
    },
    next_step: "Verifier le destinataire, le sujet et les pieces attendues avant toute creation de brouillon.",
  };
}

function buildPayload(
  userId: string,
  applyIntel: ApplyIntelRow,
  job: JobRow,
  dryRun: boolean,
): DraftPayload {
  const recipientEmail = normalizeEmail(applyIntel.apply_email ?? "");
  const reference = extractReference(applyIntel, job);
  const evidenceSnippet = metadataString(applyIntel, "evidence_snippet");

  return {
    user_id: userId,
    job_id: job.id,
    apply_intel_id: applyIntel.id,
    draft_type: "email_application",
    application_channel: applyIntel.apply_channel ?? "email_direct_reliable",
    recipient_email: recipientEmail,
    cc_emails: [],
    subject: buildSubject(job, reference),
    email_body: null,
    cover_letter_body: null,
    language: "fr",
    tone: "professional",
    cv_required: true,
    cover_letter_required: false,
    draft_gate: "needs_human_review_before_draft",
    status: "draft",
    risk_level: "low",
    risk_flags: [],
    evidence_json: {
      detected_email: recipientEmail,
      email_reliability: applyIntel.email_reliability,
      confidence: applyIntel.confidence,
      detection_method: applyIntel.detection_method,
      evidence_snippet: evidenceSnippet,
      apply_url: applyIntel.apply_url,
      no_send: true,
    },
    source_snapshot_json: {
      job_title: job.title,
      company_name: job.company_name,
      location: job.location,
      country: job.country,
      contract_type: job.contract_type,
      apply_url: job.apply_url ?? applyIntel.apply_url,
      source_url: job.source_url,
      external_id: job.external_id,
      description_text: job.description_text,
    },
    generation_input_json: {
      user_id: userId,
      apply_intel_id: applyIntel.id,
      job_id: job.id,
      candidate_profile_status: "known_internal_admin_test_user",
      instruction: "No email send. Draft creation only.",
    },
    metadata_json: {
      dry_run: dryRun,
      internal_test_only: true,
      no_email_send: true,
      no_real_application: true,
      function_name: FUNCTION_NAME,
      version: FUNCTION_VERSION,
    },
  };
}

async function loadApplyIntelAndJob(
  supabase: SupabaseClient,
  applyIntelId: string,
): Promise<
  | { ok: true; applyIntel: ApplyIntelRow; job: JobRow }
  | { ok: false; status: number; reason: string; details?: unknown }
> {
  const applyIntelResult = await supabase
    .from("cc_job_apply_intel")
    .select("*")
    .eq("id", applyIntelId)
    .maybeSingle();

  if (applyIntelResult.error) {
    return { ok: false, status: 500, reason: "apply_intel_lookup_failed", details: applyIntelResult.error.message };
  }

  if (!applyIntelResult.data) {
    return { ok: false, status: 404, reason: "apply_intel_not_found" };
  }

  const applyIntel = applyIntelResult.data as ApplyIntelRow;
  const jobResult = await supabase
    .from("jobs")
    .select(
      "id,title,company_name,location,country,contract_type,apply_url,source_url,external_id,description_text,description_html,official_desc,ai_description,job_json,is_active,is_expired,expires_at,job_status",
    )
    .eq("id", applyIntel.job_id)
    .maybeSingle();

  if (jobResult.error) {
    return { ok: false, status: 500, reason: "job_lookup_failed", details: jobResult.error.message };
  }

  if (!jobResult.data) {
    return { ok: false, status: 404, reason: "job_not_found" };
  }

  return {
    ok: true,
    applyIntel,
    job: jobResult.data as JobRow,
  };
}

function validateGuardrails(userId: string, applyIntel: ApplyIntelRow, job: JobRow): string | null {
  if (!userId) return "missing_user_id";
  if (!applyIntel.id) return "missing_apply_intel_id";
  if (applyIntel.apply_channel !== "email_direct_reliable") return "apply_channel_not_email_direct_reliable";
  if (applyIntel.email_reliability !== "high") return "email_reliability_not_high";
  if (applyIntel.automation_level !== "send_email_after_review") return "automation_level_not_send_email_after_review";
  if (!applyIntel.apply_email) return "missing_apply_email";
  if (applyIntel.status !== "detected") return "apply_intel_status_not_detected";
  if (isJobExpired(job)) return "job_inactive_or_expired";
  return restrictedApplicantsReason(applyIntel, job);
}

async function findActiveDraft(supabase: SupabaseClient, userId: string, jobId: string) {
  return await supabase
    .from("cc_application_drafts")
    .select("id,status,job_id,apply_intel_id")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .not("status", "in", "(cancelled,blocked)")
    .limit(1)
    .maybeSingle();
}

async function authorizeRequest(
  req: Request,
  body: NormalizedRequestBody,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<AuthResult> {
  const expectedSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!expectedSecret) {
    return { ok: false, status: 500, reason: "server_misconfigured_missing_cron_secret" };
  }

  const providedSecret = cleanSecret(req.headers.get("x-cron-secret"));
  if (providedSecret === expectedSecret) {
    return { ok: true, mode: "cron_secret" };
  }

  if (!body.dry_run) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    return { ok: false, status: 401, reason: "missing_access_token" };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user?.id) {
    return { ok: false, status: 401, reason: "invalid_access_token", details: userError?.message };
  }

  if (userData.user.id !== INTERNAL_TEST_USER_ID || body.user_id !== INTERNAL_TEST_USER_ID) {
    return { ok: false, status: 403, reason: "user_not_allowed_for_internal_test_v1" };
  }

  const profileResult = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (profileResult.error) {
    return { ok: false, status: 500, reason: "admin_profile_lookup_failed", details: profileResult.error.message };
  }

  if (profileResult.data?.is_admin !== true) {
    return { ok: false, status: 403, reason: "admin_required_for_preview" };
  }

  // Admin JWT auth is reserved for visible dry-run previews. It must never send email or write durable drafts.
  return { ok: true, mode: "admin_preview_jwt" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }

  let rawBody: RequestBody;
  try {
    rawBody = await req.json() as RequestBody;
  } catch {
    return json(400, { ok: false, reason: "invalid_json_body" });
  }

  const body = normalizeBody(rawBody);
  if (!body.user_id || !isUuid(body.user_id)) {
    return json(400, { ok: false, reason: "missing_or_invalid_user_id" });
  }

  if (body.user_id !== INTERNAL_TEST_USER_ID) {
    return json(403, { ok: false, reason: "user_not_allowed_for_internal_test_v1" });
  }

  if (!body.apply_intel_id || !isUuid(body.apply_intel_id)) {
    return json(400, { ok: false, reason: "missing_or_invalid_apply_intel_id" });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, reason: "server_misconfigured_missing_supabase_env" });
  }

  const auth = await authorizeRequest(req, body, supabaseUrl, serviceRoleKey);
  if (!auth.ok) {
    return json(auth.status, { ok: false, reason: auth.reason, details: auth.details });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loaded = await loadApplyIntelAndJob(supabase, body.apply_intel_id);
  if (!loaded.ok) {
    return json(loaded.status, { ok: false, reason: loaded.reason, details: loaded.details });
  }

  const guardrailReason = validateGuardrails(body.user_id, loaded.applyIntel, loaded.job);
  if (guardrailReason) {
    return json(200, { ok: false, reason: guardrailReason });
  }

  const activeDraftResult = await findActiveDraft(supabase, body.user_id, loaded.job.id);
  if (activeDraftResult.error) {
    return json(500, {
      ok: false,
      reason: "active_draft_lookup_failed",
      details: activeDraftResult.error.message,
    });
  }

  if (activeDraftResult.data) {
    return json(200, {
      ok: false,
      reason: "active_draft_already_exists",
      existing_draft: activeDraftResult.data,
    });
  }

  const payload = buildPayload(body.user_id, loaded.applyIntel, loaded.job, body.dry_run);

  if (body.dry_run) {
    const preview = buildPreview(loaded.applyIntel, loaded.job);

    if (auth.mode === "admin_preview_jwt") {
      return json(200, {
        ok: true,
        dry_run: true,
        would_insert: true,
        auth_mode: auth.mode,
        preview,
      });
    }

    return json(200, {
      ok: true,
      dry_run: true,
      would_insert: true,
      auth_mode: auth.mode,
      payload,
      preview,
    });
  }

  if (body.confirm !== CONFIRM_TOKEN) {
    return json(400, {
      ok: false,
      dry_run: false,
      reason: "missing_or_invalid_confirm",
      expected_confirm: CONFIRM_TOKEN,
    });
  }

  const draftInsertResult = await supabase
    .from("cc_application_drafts")
    .insert(payload)
    .select("id")
    .single();

  if (draftInsertResult.error) {
    return json(500, {
      ok: false,
      dry_run: false,
      reason: "draft_insert_failed",
      details: draftInsertResult.error.message,
    });
  }

  const insertedDraftId = (draftInsertResult.data as { id: string }).id;
  const eventInsertResult = await supabase
    .from("cc_application_events")
    .insert({
      draft_id: insertedDraftId,
      user_id: body.user_id,
      event_type: "draft_created",
      triggered_by: "edge_function",
      from_status: null,
      to_status: "draft",
      metadata_json: {
        function_name: FUNCTION_NAME,
        version: FUNCTION_VERSION,
        dry_run: false,
        no_email_send: true,
      },
    });

  if (eventInsertResult.error) {
    const compensationDeleteResult = await supabase
      .from("cc_application_drafts")
      .delete()
      .eq("id", insertedDraftId);

    return json(500, {
      ok: false,
      dry_run: false,
      reason: "event_insert_failed",
      inserted_draft_id: insertedDraftId,
      compensation_delete_attempted: true,
      compensation_delete_ok: !compensationDeleteResult.error,
      compensation_delete_error: compensationDeleteResult.error?.message,
      details: eventInsertResult.error.message,
    });
  }

  return json(200, {
    ok: true,
    dry_run: false,
    inserted_draft_id: insertedDraftId,
  });
});
