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
  last_sign_in_at?: string | null;
  poste_recherche: string | null;
  total_payment_attempts: number | null;
  last_payment_attempt_at: string | null;
  payment_statuses: string[] | null;
  segment: string | null;
  suggested_email_key: string | null;
};

type AuthUserCandidate = {
  id?: string;
  email?: string;
  created_at?: string;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  deleted_at?: string | null;
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
const CREATE_ALERT_CONFIRM_PHRASE = "ENQUEUE_CREATE_ALERT_EMAIL_1_LIMIT_1";
const DEFAULT_SEQUENCE_KEY = "jobradar_reactivation_v1";
const DEFAULT_STEP_KEY = "email_1";
const DEFAULT_TEMPLATE_KEY = "payment_attempt_no_success_email_1";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const CANDIDATE_BATCH_SIZE = 100;

const ALLOWED_SEGMENTS = new Set([
  "payment_attempt_no_success",
  "interested_no_payment_attempt",
  "non_paying_without_alert",
]);

const ALLOWED_TEMPLATE_KEYS = new Set([
  "payment_attempt_no_success_email_1",
  "interested_no_payment_attempt_email_1",
  "create_alert_email_1",
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

function isExcludedMarketingEmail(emailNormalized: string) {
  return emailNormalized.endsWith("@example.com") ||
    emailNormalized.endsWith("@go4jobapp.com") ||
    [
      "contact.jobradar@gmail.com",
      "infos.go4job@gmail.com",
      "d.kacoutie@gmail.com",
      "kacoutiedieudonne@gmail.com",
    ].includes(emailNormalized);
}

function isConfirmedUser(user: AuthUserCandidate) {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function extractDesiredRole(profile: Record<string, unknown> | undefined) {
  const onboarding = profile?.jobradar_onboarding;
  if (!onboarding || typeof onboarding !== "object" || Array.isArray(onboarding)) {
    return null;
  }

  const profileBlock = (onboarding as Record<string, unknown>).profile;
  if (!profileBlock || typeof profileBlock !== "object" || Array.isArray(profileBlock)) {
    return null;
  }

  const desiredRole = (profileBlock as Record<string, unknown>).desiredRole;
  return typeof desiredRole === "string" && desiredRole.trim()
    ? desiredRole.trim()
    : null;
}

async function fetchCreateAlertCandidates(
  supabase: SupabaseClient,
  limit: number,
  sequenceKey: string,
  stepKey: string,
) {
  const queueRows: QueueRow[] = [];
  const seenInRequest = new Set<string>();
  let candidatesChecked = 0;
  let skippedSuppressedCount = 0;
  let skippedDuplicateCount = 0;
  let skippedInvalidEmailCount = 0;
  let skippedUnconfirmedCount = 0;
  let skippedDeletedCount = 0;
  let skippedExcludedEmailCount = 0;
  let skippedActivePassCount = 0;
  let skippedActiveAlertCount = 0;
  let page = 1;

  while (queueRows.length < limit) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: CANDIDATE_BATCH_SIZE,
    });

    if (error) throw new Error(`auth_users_lookup_failed: ${error.message}`);

    const users = ((data?.users ?? []) as AuthUserCandidate[])
      .filter((user) => Boolean(user.id));

    if (users.length === 0) break;

    candidatesChecked += users.length;

    const contactableUsers = users.filter((user) => {
      const emailNormalized = normalizeEmail(user.email ?? "");
      if (!user.email || !emailNormalized) {
        skippedInvalidEmailCount += 1;
        return false;
      }
      if (user.deleted_at) {
        skippedDeletedCount += 1;
        return false;
      }
      if (!isConfirmedUser(user)) {
        skippedUnconfirmedCount += 1;
        return false;
      }
      if (isExcludedMarketingEmail(emailNormalized)) {
        skippedExcludedEmailCount += 1;
        return false;
      }
      if (seenInRequest.has(emailNormalized)) {
        skippedDuplicateCount += 1;
        return false;
      }
      return true;
    });

    const userIds = contactableUsers.map((user) => user.id as string);
    const emailNormalized = contactableUsers.map((user) => normalizeEmail(user.email ?? ""));

    const [
      suppressedEmails,
      duplicateEmails,
      profilesRes,
      activeAlertsRes,
      activeSubscriptionsRes,
      paidPaymentsRes,
    ] = await Promise.all([
      fetchSuppressedEmails(supabase, emailNormalized),
      fetchDuplicateEmails(supabase, emailNormalized, sequenceKey, stepKey),
      userIds.length
        ? supabase
          .from("profiles")
          .select("user_id, created_at, jobradar_onboarding")
          .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
          .from("alerts")
          .select("user_id")
          .eq("is_active", true)
          .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
          .from("billing_subscriptions")
          .select("user_id")
          .eq("status", "active")
          .not("activated_at", "is", null)
          .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase
          .from("billing_payments")
          .select("user_id")
          .eq("status", "paid")
          .not("paid_at", "is", null)
          .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesRes.error) throw new Error(`profiles_lookup_failed: ${profilesRes.error.message}`);
    if (activeAlertsRes.error) throw new Error(`active_alerts_lookup_failed: ${activeAlertsRes.error.message}`);
    if (activeSubscriptionsRes.error) {
      throw new Error(`active_subscriptions_lookup_failed: ${activeSubscriptionsRes.error.message}`);
    }
    if (paidPaymentsRes.error) throw new Error(`paid_payments_lookup_failed: ${paidPaymentsRes.error.message}`);

    const profilesByUserId = new Map(
      ((profilesRes.data ?? []) as Record<string, unknown>[])
        .map((profile) => [String(profile.user_id), profile]),
    );
    const usersWithActiveAlerts = new Set(
      ((activeAlertsRes.data ?? []) as Array<{ user_id?: string | null }>)
        .map((row) => row.user_id)
        .filter(Boolean),
    );
    const usersWithActivePass = new Set([
      ...((activeSubscriptionsRes.data ?? []) as Array<{ user_id?: string | null }>)
        .map((row) => row.user_id)
        .filter(Boolean),
      ...((paidPaymentsRes.data ?? []) as Array<{ user_id?: string | null }>)
        .map((row) => row.user_id)
        .filter(Boolean),
    ]);

    for (const user of contactableUsers) {
      if (queueRows.length >= limit) break;

      const userId = user.id as string;
      const normalizedEmail = normalizeEmail(user.email ?? "");

      if (suppressedEmails.has(normalizedEmail)) {
        skippedSuppressedCount += 1;
        continue;
      }
      if (duplicateEmails.has(normalizedEmail)) {
        skippedDuplicateCount += 1;
        continue;
      }
      if (usersWithActivePass.has(userId)) {
        skippedActivePassCount += 1;
        continue;
      }
      if (usersWithActiveAlerts.has(userId)) {
        skippedActiveAlertCount += 1;
        continue;
      }

      const profile = profilesByUserId.get(userId);
      seenInRequest.add(normalizedEmail);
      queueRows.push({
        user_id: userId,
        email: normalizedEmail,
        sequence_key: sequenceKey,
        step_key: stepKey,
        template_key: "create_alert_email_1",
        segment_key: "non_paying_without_alert",
        status: "queued",
        priority: 100,
        metadata: {
          source: "enqueue_marketing_lifecycle_emails",
          dry_run_only_segment: true,
          candidate_email: user.email,
          email_normalized: normalizedEmail,
          registered_at: String(profile?.created_at ?? user.created_at ?? ""),
          last_sign_in_at: user.last_sign_in_at ?? null,
          poste_recherche: extractDesiredRole(profile),
          suggested_email_key: "create_alert_email_1",
          alert_url: "https://jobradar.go4jobapp.com/jobradar/alerts",
        },
      });
    }

    if (users.length < CANDIDATE_BATCH_SIZE) break;
    page += 1;
  }

  return {
    queueRows,
    candidatesChecked,
    skippedSuppressedCount,
    skippedDuplicateCount,
    skippedInvalidEmailCount,
    extraCounts: {
      skipped_unconfirmed_count: skippedUnconfirmedCount,
      skipped_deleted_count: skippedDeletedCount,
      skipped_excluded_email_count: skippedExcludedEmailCount,
      skipped_active_pass_count: skippedActivePassCount,
      skipped_active_alert_count: skippedActiveAlertCount,
    },
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

  let body: EnqueueMarketingLifecycleEmailsBody = {};
  try {
    const rawBody = await req.text();
    body = rawBody.trim()
      ? JSON.parse(rawBody) as EnqueueMarketingLifecycleEmailsBody
      : {};
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const allowDefaultEnqueue = body.allow_enqueue === true &&
    body.confirm === CONFIRM_PHRASE;
  const allowCreateAlertEnqueue = body.allow_enqueue === true &&
    body.confirm === CREATE_ALERT_CONFIRM_PHRASE;
  const requestedRealRun = body.dry_run === false;
  const limit = parseLimit(body.limit);
  const sequenceKey = cleanText(body.sequence_key, DEFAULT_SEQUENCE_KEY);
  const stepKey = cleanText(body.step_key, DEFAULT_STEP_KEY);
  const templateKey = cleanText(body.template_key, DEFAULT_TEMPLATE_KEY);
  const segmentKey = (body.segment_key ?? "").trim() || null;
  const isCreateAlertSegment =
    segmentKey === "non_paying_without_alert" ||
    templateKey === "create_alert_email_1";
  const allowEnqueue = isCreateAlertSegment
    ? allowCreateAlertEnqueue
    : allowDefaultEnqueue;
  const dryRun = body.dry_run !== false || !allowEnqueue;

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

  if (isCreateAlertSegment) {
    if (segmentKey !== "non_paying_without_alert" || templateKey !== "create_alert_email_1") {
      return json(400, {
        ok: false,
        error: "segment_template_mismatch",
        message: "non_paying_without_alert must use create_alert_email_1.",
      });
    }

    if (requestedRealRun) {
      if (!allowCreateAlertEnqueue) {
        return json(400, {
          ok: false,
          dry_run: dryRun,
          error: "create_alert_confirm_required",
          message: `Real enqueue for non_paying_without_alert requires confirm=${CREATE_ALERT_CONFIRM_PHRASE}.`,
        });
      }

      if (body.limit !== 1 || limit !== 1) {
        return json(400, {
          ok: false,
          dry_run: dryRun,
          error: "create_alert_limit_one_required",
          message: "Real enqueue for non_paying_without_alert requires requested and effective limit=1.",
        });
      }

      if (sequenceKey !== "non_paying_without_alert" || stepKey !== "email_1") {
        return json(400, {
          ok: false,
          dry_run: dryRun,
          error: "create_alert_sequence_step_required",
          message: "Real enqueue for non_paying_without_alert requires sequence_key=non_paying_without_alert and step_key=email_1.",
        });
      }
    }

    try {
      const result = await fetchCreateAlertCandidates(
        supabase,
        limit,
        sequenceKey,
        stepKey,
      );

      let enqueuedCount = 0;
      let skippedDuplicateCount = result.skippedDuplicateCount;

      if (!dryRun) {
        for (const row of result.queueRows) {
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
            would_enqueue_count: result.queueRows.length,
            enqueued_count: enqueuedCount,
            skipped_suppressed_count: result.skippedSuppressedCount,
            skipped_duplicate_count: skippedDuplicateCount,
            skipped_invalid_email_count: result.skippedInvalidEmailCount,
            candidates_checked: result.candidatesChecked,
            ...result.extraCounts,
            sample: sampleRows(result.queueRows),
          });
        }
      }

      return json(200, {
        ok: true,
        dry_run: dryRun,
        segment_key: "non_paying_without_alert",
        template_key: "create_alert_email_1",
        sequence_key: sequenceKey,
        step_key: stepKey,
        would_enqueue_count: result.queueRows.length,
        enqueued_count: enqueuedCount,
        skipped_suppressed_count: result.skippedSuppressedCount,
        skipped_duplicate_count: skippedDuplicateCount,
        skipped_invalid_email_count: result.skippedInvalidEmailCount,
        candidates_checked: result.candidatesChecked,
        ...result.extraCounts,
        sample: sampleRows(result.queueRows),
        message: dryRun
          ? "Dry-run only. No marketing emails were queued or sent."
          : "One create-alert marketing lifecycle email was queued. No emails were sent.",
      });
    } catch (error) {
      return json(500, {
        ok: false,
        dry_run: true,
        error: "create_alert_candidates_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  try {
    let skippedSuppressedCount = 0;
    let skippedDuplicateCount = 0;
    let skippedInvalidEmailCount = 0;
    let candidatesChecked = 0;

    const queueRows: QueueRow[] = [];
    const seenInRequest = new Set<string>();

    for (let from = 0; queueRows.length < limit; from += CANDIDATE_BATCH_SIZE) {
      const to = from + CANDIDATE_BATCH_SIZE - 1;
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
        .range(from, to);

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

      const rawCandidates = candidates ?? [];

      if (rawCandidates.length === 0) {
        break;
      }

      const normalizedCandidates = rawCandidates
        .map((candidate) => ({
          ...candidate,
          email: (candidate.email ?? "").trim(),
          email_normalized: normalizeEmail(
            candidate.email_normalized || candidate.email || "",
          ),
        }));

      const uniqueEmails = Array.from(
        new Set(
          normalizedCandidates
            .map((candidate) => candidate.email_normalized)
            .filter(Boolean),
        ),
      );

      const [suppressedEmails, duplicateEmails] = await Promise.all([
        fetchSuppressedEmails(supabase, uniqueEmails),
        fetchDuplicateEmails(supabase, uniqueEmails, sequenceKey, stepKey),
      ]);

      for (const candidate of normalizedCandidates) {
        if (queueRows.length >= limit) {
          break;
        }

        candidatesChecked += 1;

        const emailNormalized = candidate.email_normalized;

        if (!candidate.email || !emailNormalized) {
          skippedInvalidEmailCount += 1;
          continue;
        }

        if (suppressedEmails.has(emailNormalized)) {
          skippedSuppressedCount += 1;
          continue;
        }

        if (
          duplicateEmails.has(emailNormalized) ||
          seenInRequest.has(emailNormalized)
        ) {
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

      if (rawCandidates.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
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
          skipped_invalid_email_count: skippedInvalidEmailCount,
          candidates_checked: candidatesChecked,
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
      skipped_invalid_email_count: skippedInvalidEmailCount,
      candidates_checked: candidatesChecked,
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
