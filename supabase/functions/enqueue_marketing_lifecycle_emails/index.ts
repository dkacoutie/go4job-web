import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

type EnqueueMarketingLifecycleEmailsBody = {
  dry_run?: boolean | null;
  allow_enqueue?: boolean | null;
  confirm?: string | null;
  limit?: number | null;
  segment_key?: string | null;
  sequence_key?: string | null;
  step_key?: string | null;
  template_key?: string | null;
};

type Candidate = {
  user_id: string | null;
  email: string;
  email_normalized: string | null;
  registered_at: string | null;
  poste_recherche: string | null;
  total_payment_attempts: number | null;
  last_payment_attempt_at: string | null;
  payment_statuses: string[] | null;
  segment: string | null;
  suggested_email_key: string | null;
};

type QueueRow = {
  user_id: string | null;
  email: string;
  sequence_key: string;
  step_key: string;
  template_key: string;
  segment_key: string | null;
  status: "queued";
  priority: number;
  metadata: Record<string, unknown>;
};

const CONFIRM_PHRASE = "ENQUEUE_MARKETING_LIFECYCLE_EMAILS";
const DEFAULT_SEQUENCE_KEY = "jobradar_reactivation_v1";
const DEFAULT_STEP_KEY = "email_1";
const DEFAULT_TEMPLATE_KEY = "payment_attempt_no_success_email_1";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const ALLOWED_SEGMENTS = new Set([
  "payment_attempt_no_success",
  "interested_no_payment_attempt",
]);

const ALLOWED_TEMPLATE_KEYS = new Set([
  "payment_attempt_no_success_email_1",
  "interested_no_payment_attempt_email_1",
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

function cleanText(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? "").trim();
  return cleaned || fallback;
}

function parseLimit(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value as number), 1), MAX_LIMIT);
}

function sampleRows(rows: QueueRow[]) {
  return rows.slice(0, 10).map((row) => ({
    user_id: row.user_id,
    email: row.email,
    sequence_key: row.sequence_key,
    step_key: row.step_key,
    template_key: row.template_key,
    segment_key: row.segment_key,
  }));
}

async function fetchSuppressedEmails(
  supabase: SupabaseClient,
  emailNormalized: string[],
) {
  if (emailNormalized.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("email_suppressions")
    .select("email_normalized")
    .in("email_normalized", emailNormalized);

  if (error) throw new Error(`suppression_lookup_failed: ${error.message}`);

  return new Set(
    (data ?? [])
      .map((row) => String(row.email_normalized ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
}

async function fetchDuplicateEmails(
  supabase: SupabaseClient,
  emailNormalized: string[],
  sequenceKey: string,
  stepKey: string,
) {
  if (emailNormalized.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("marketing_email_queue")
    .select("email")
    .eq("sequence_key", sequenceKey)
    .eq("step_key", stepKey)
    .in("email", emailNormalized);

  if (error) throw new Error(`duplicate_lookup_failed: ${error.message}`);

  return new Set(
    (data ?? [])
      .map((row) => normalizeEmail(String(row.email ?? "")))
      .filter(Boolean),
  );
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

  let body: EnqueueMarketingLifecycleEmailsBody = {};
  try {
    const rawBody = await req.text();
    body = rawBody.trim()
      ? JSON.parse(rawBody) as EnqueueMarketingLifecycleEmailsBody
      : {};
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const allowEnqueue = body.allow_enqueue === true &&
    body.confirm === CONFIRM_PHRASE;
  const dryRun = body.dry_run !== false || !allowEnqueue;
  const limit = parseLimit(body.limit);
  const sequenceKey = cleanText(body.sequence_key, DEFAULT_SEQUENCE_KEY);
  const stepKey = cleanText(body.step_key, DEFAULT_STEP_KEY);
  const templateKey = cleanText(body.template_key, DEFAULT_TEMPLATE_KEY);
  const segmentKey = (body.segment_key ?? "").trim() || null;

  if (segmentKey && !ALLOWED_SEGMENTS.has(segmentKey)) {
    return json(400, {
      ok: false,
      error: "unsupported_segment_key",
      allowed_segment_keys: Array.from(ALLOWED_SEGMENTS),
    });
  }

  if (!ALLOWED_TEMPLATE_KEYS.has(templateKey)) {
    return json(400, {
      ok: false,
      error: "unsupported_template_key",
      allowed_template_keys: Array.from(ALLOWED_TEMPLATE_KEYS),
    });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    let query = supabase
      .from("jobradar_marketing_reactivation_candidates")
      .select(
        [
          "user_id",
          "email",
          "email_normalized",
          "registered_at",
          "poste_recherche",
          "total_payment_attempts",
          "last_payment_attempt_at",
          "payment_statuses",
          "segment",
          "suggested_email_key",
        ].join(","),
      )
      .eq("suggested_email_key", templateKey)
      .order("registered_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (segmentKey) {
      query = query.eq("segment", segmentKey);
    }

    const { data: candidates, error: candidatesError } = await query
      .returns<Candidate[]>();

    if (candidatesError) {
      return json(500, {
        ok: false,
        error: "candidate_lookup_failed",
        message: candidatesError.message,
      });
    }

    const normalizedCandidates = (candidates ?? [])
      .map((candidate) => ({
        ...candidate,
        email: (candidate.email ?? "").trim(),
        email_normalized: normalizeEmail(
          candidate.email_normalized || candidate.email || "",
        ),
      }))
      .filter((candidate) => candidate.email && candidate.email_normalized);

    const uniqueEmails = Array.from(
      new Set(normalizedCandidates.map((candidate) => candidate.email_normalized)),
    );

    const [suppressedEmails, duplicateEmails] = await Promise.all([
      fetchSuppressedEmails(supabase, uniqueEmails),
      fetchDuplicateEmails(supabase, uniqueEmails, sequenceKey, stepKey),
    ]);

    let skippedSuppressedCount = 0;
    let skippedDuplicateCount = 0;

    const queueRows: QueueRow[] = [];
    const seenInRequest = new Set<string>();

    for (const candidate of normalizedCandidates) {
      const emailNormalized = candidate.email_normalized;

      if (suppressedEmails.has(emailNormalized)) {
        skippedSuppressedCount += 1;
        continue;
      }

      if (duplicateEmails.has(emailNormalized) || seenInRequest.has(emailNormalized)) {
        skippedDuplicateCount += 1;
        continue;
      }

      seenInRequest.add(emailNormalized);
      queueRows.push({
        user_id: candidate.user_id,
        email: emailNormalized,
        sequence_key: sequenceKey,
        step_key: stepKey,
        template_key: templateKey,
        segment_key: candidate.segment,
        status: "queued",
        priority: 100,
        metadata: {
          source: "enqueue_marketing_lifecycle_emails",
          candidate_email: candidate.email,
          email_normalized: emailNormalized,
          registered_at: candidate.registered_at,
          poste_recherche: candidate.poste_recherche,
          total_payment_attempts: candidate.total_payment_attempts ?? 0,
          last_payment_attempt_at: candidate.last_payment_attempt_at,
          payment_statuses: candidate.payment_statuses ?? [],
          suggested_email_key: candidate.suggested_email_key,
        },
      });
    }

    let enqueuedCount = 0;

    if (!dryRun) {
      for (const row of queueRows) {
        const { error: insertError } = await supabase
          .from("marketing_email_queue")
          .insert(row);

        if (!insertError) {
          enqueuedCount += 1;
          continue;
        }

        if (insertError.code === "23505") {
          skippedDuplicateCount += 1;
          continue;
        }

        return json(500, {
          ok: false,
          dry_run: dryRun,
          error: "queue_insert_failed",
          message: insertError.message,
          would_enqueue_count: queueRows.length,
          enqueued_count: enqueuedCount,
          skipped_suppressed_count: skippedSuppressedCount,
          skipped_duplicate_count: skippedDuplicateCount,
          candidates_checked: normalizedCandidates.length,
          sample: sampleRows(queueRows),
        });
      }
    }

    return json(200, {
      ok: true,
      dry_run: dryRun,
      would_enqueue_count: queueRows.length,
      enqueued_count: enqueuedCount,
      skipped_suppressed_count: skippedSuppressedCount,
      skipped_duplicate_count: skippedDuplicateCount,
      candidates_checked: normalizedCandidates.length,
      sample: sampleRows(queueRows),
      message: dryRun
        ? "Dry-run only. No marketing emails were queued or sent."
        : "Marketing lifecycle emails were queued. No emails were sent.",
    });
  } catch (error) {
    return json(500, {
      ok: false,
      dry_run: dryRun,
      error: "enqueue_marketing_lifecycle_failed",
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
});
