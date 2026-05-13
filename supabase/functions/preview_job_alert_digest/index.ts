import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  baseDiagnostics,
  buildBlocks,
  buildCriteria,
  buildPreheader,
  buildSubject,
  cleanString,
  finalizeDiagnostics,
  isIncompleteProfile,
  normalizeOptions,
  pickHeroJob,
  reasonForCount,
  recordBelowPreviewThresholdJobs,
  selectRelevantJobs,
  type AlertRow,
  type JobRow,
  type PreviewJobAlertBody,
  type ProfileRow,
} from "./_lib.ts";

/*
Future target table, documentation only. Do not create a migration from this
preview function and do not write to this table before real sends exist.

public.job_alert_sent_jobs:
- user_id uuid
- job_id uuid
- alert_id uuid nullable
- sent_at timestamptz
- email_subject text
- digest_key text
- score numeric nullable
- block_key text nullable
*/

type NotificationPrefsRow = {
  digest_enabled?: boolean | null;
  unsubscribed_at?: string | null;
};

type ApplicationRow = {
  job_id?: string | null;
};

type FeedbackRow = {
  job_id?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
  const secret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!secret) return { ok: false, status: 500, error: "server_misconfigured" };

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();

  if (bearer === secret || cronHeader === secret) {
    return { ok: true, status: 200, error: null };
  }

  return { ok: false, status: 401, error: "unauthorized" };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function emptyPreview(params: {
  userId: string;
  minJobsPreview: number;
  minJobsToSend: number;
  minScorePreview: number;
  minScoreToSend: number;
  reason: string;
  diagnostics: ReturnType<typeof baseDiagnostics>;
}) {
  if (!params.diagnostics.notes.includes("subject_not_generated: not_enough_relevant_jobs")) {
    params.diagnostics.notes.push("subject_not_generated: not_enough_relevant_jobs");
  }
  const diagnostics = finalizeDiagnostics(params.diagnostics, 0);

  return {
    ok: true,
    dry_run: true,
    user_id: params.userId,
    eligible_to_send: false,
    reason: params.reason,
    subject: "",
    preheader: "",
    total_selected_jobs: 0,
    total_real_send_eligible_jobs: 0,
    min_jobs_preview: params.minJobsPreview,
    min_jobs_to_send: params.minJobsToSend,
    min_score_preview: params.minScorePreview,
    min_score_to_send: params.minScoreToSend,
    hero_job: {},
    blocks: [],
    primary_cta: {
      label: "Voir mes offres sélectionnées",
      url: "/jobradar/feed?source=email_digest",
    },
    edit_preferences_cta: {
      label: "Modifier mes critères",
      url: "/jobradar/onboarding?source=email_digest",
    },
    deduplication_status: "table_not_yet_created",
    diagnostics,
  };
}

async function fetchProfile(supabase: SupabaseClient, userId: string) {
  const full = await supabase
    .from("profiles")
    .select("user_id, full_name, headline, location, experience_years, jobradar_onboarding")
    .eq("user_id", userId)
    .maybeSingle<ProfileRow>();

  if (!full.error) return full;

  const fallback = await supabase
    .from("profiles")
    .select("user_id, full_name, headline, location, experience_years")
    .eq("user_id", userId)
    .maybeSingle<ProfileRow>();

  return fallback;
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

  let body: PreviewJobAlertBody;
  try {
    body = (await req.json()) as PreviewJobAlertBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (body.dry_run !== true) {
    return json(400, {
      ok: false,
      error: "dry_run_required",
      message: "preview_job_alert_digest only renders JSON previews and requires dry_run=true.",
    });
  }

  const userId = cleanString(body.user_id);
  if (!userId) return json(400, { ok: false, error: "missing_user_id" });
  if (!isUuid(userId)) return json(400, { ok: false, error: "invalid_user_id" });

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  const { limit, minJobsPreview, minJobsToSend, minScorePreview, minScoreToSend, maxBlocks } = normalizeOptions(body);
  const diagnostics = baseDiagnostics();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const userResult = await supabase.auth.admin.getUserById(userId);
    const email = cleanString(userResult.data.user?.email).toLowerCase();
    if (!email) diagnostics.notes.push("User email was not accessible; suppression lookup skipped.");

    const [
      profileRes,
      prefsRes,
      alertsRes,
      applicationsRes,
      feedbackRes,
      suppressionRes,
      jobsRes,
    ] = await Promise.all([
      fetchProfile(supabase, userId),
      supabase
        .from("notification_prefs")
        .select("digest_enabled, unsubscribed_at")
        .eq("user_id", userId)
        .maybeSingle<NotificationPrefsRow>(),
      supabase
        .from("alerts")
        .select("id, name, keywords, country, countries, frequency, channels, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .returns<AlertRow[]>(),
      supabase
        .from("applications")
        .select("job_id")
        .eq("user_id", userId)
        .limit(5000)
        .returns<ApplicationRow[]>(),
      supabase
        .from("job_feedback")
        .select("job_id")
        .eq("user_id", userId)
        .eq("action", "dismissed")
        .limit(5000)
        .returns<FeedbackRow[]>(),
      email
        ? supabase
          .from("email_suppressions")
          .select("reason, source")
          .eq("email_normalized", email)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("jobs")
        .select(`
          id, title, company_name, location, country, remote_type, contract_type, seniority,
          published_at, posted_at, scraped_at, created_at, updated_at, last_seen_at,
          description_text, official_desc, tags, job_skills, required_skills, optional_skills,
          job_family, source_url, apply_url, external_id, is_active, is_expired, job_status
        `)
        .eq("is_active", true)
        .or("is_expired.eq.false,is_expired.is.null")
        .in("job_status", ["active", "stale"])
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("scraped_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(limit * 8, 120))
        .returns<JobRow[]>(),
    ]);

    if (profileRes.error) return json(500, { ok: false, error: "profile_lookup_failed", message: profileRes.error.message });
    if (prefsRes.error) diagnostics.notes.push(`notification_prefs lookup failed: ${prefsRes.error.message}`);
    if (alertsRes.error) return json(500, { ok: false, error: "alerts_lookup_failed", message: alertsRes.error.message });
    if (applicationsRes.error) return json(500, { ok: false, error: "applications_lookup_failed", message: applicationsRes.error.message });
    if (feedbackRes.error) return json(500, { ok: false, error: "feedback_lookup_failed", message: feedbackRes.error.message });
    if (suppressionRes.error) diagnostics.notes.push(`email_suppressions lookup failed: ${suppressionRes.error.message}`);
    if (jobsRes.error) return json(500, { ok: false, error: "jobs_lookup_failed", message: jobsRes.error.message });

    diagnostics.notification_prefs_checked = !prefsRes.error;
    diagnostics.notification_prefs_digest_enabled = prefsRes.data?.digest_enabled ?? null;
    diagnostics.notification_prefs_unsubscribed_at = prefsRes.data?.unsubscribed_at ?? null;
    diagnostics.suppression_checked = Boolean(email) && !suppressionRes.error;
    diagnostics.suppression_found = suppressionRes.data ? true : email ? false : null;

    const profile = profileRes.data ?? null;
    const alerts = alertsRes.data ?? [];
    const criteria = buildCriteria(profile, alerts);

    if (isIncompleteProfile(criteria)) {
      diagnostics.excluded_incomplete_profile = true;
      diagnostics.notes.push("No desired role, keyword, country/zone or exploitable active alert was found.");
      return json(200, emptyPreview({
        userId,
        minJobsPreview,
        minJobsToSend,
        minScorePreview,
        minScoreToSend,
        reason: "incomplete_profile",
        diagnostics,
      }));
    }

    const savedOrAppliedIds = new Set(
      (applicationsRes.data ?? []).map((row) => cleanString(row.job_id)).filter(Boolean),
    );
    const dismissedIds = new Set(
      (feedbackRes.data ?? []).map((row) => cleanString(row.job_id)).filter(Boolean),
    );
    const selectedJobs = selectRelevantJobs({
      jobs: jobsRes.data ?? [],
      criteria,
      savedOrAppliedIds,
      dismissedIds,
      limit,
      minScorePreview,
      diagnostics,
    });

    const realSendEligibleJobs = selectedJobs.filter((job) => job.score >= minScoreToSend);
    const reason = reasonForCount({
      previewCount: selectedJobs.length,
      sendEligibleCount: realSendEligibleJobs.length,
      minPreview: minJobsPreview,
      minSend: minJobsToSend,
    });
    if (selectedJobs.length < minJobsPreview) {
      recordBelowPreviewThresholdJobs(diagnostics, selectedJobs);
      return json(200, emptyPreview({
        userId,
        minJobsPreview,
        minJobsToSend,
        minScorePreview,
        minScoreToSend,
        reason,
        diagnostics,
      }));
    }

    const heroJob = pickHeroJob(selectedJobs);
    const subject = buildSubject(heroJob, selectedJobs.length);
    const blocks = buildBlocks(selectedJobs, criteria, maxBlocks);
    const finalizedDiagnostics = finalizeDiagnostics(diagnostics, selectedJobs.length);

    return json(200, {
      ok: true,
      dry_run: true,
      user_id: userId,
      eligible_to_send: false,
      reason,
      subject,
      preheader: buildPreheader(selectedJobs.length, minJobsToSend),
      total_selected_jobs: selectedJobs.length,
      total_real_send_eligible_jobs: realSendEligibleJobs.length,
      min_jobs_preview: minJobsPreview,
      min_jobs_to_send: minJobsToSend,
      min_score_preview: minScorePreview,
      min_score_to_send: minScoreToSend,
      hero_job: heroJob,
      blocks,
      primary_cta: {
        label: "Voir mes offres sélectionnées",
        url: "/jobradar/feed?source=email_digest",
      },
      edit_preferences_cta: {
        label: "Modifier mes critères",
        url: "/jobradar/onboarding?source=email_digest",
      },
      deduplication_status: "table_not_yet_created",
      diagnostics: finalizedDiagnostics,
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: "preview_job_alert_digest_failed",
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
});
