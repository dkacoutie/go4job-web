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
  type DigestBlock,
  type JobRow,
  type PreviewJobAlertBody,
  type ProfileRow,
  type SelectedJob,
} from "../preview_job_alert_digest/_lib.ts";
import { buildRelevanceOrFilter } from "../preview_job_alert_digest/_lib.ts";

/** Colonnes du vivier d'offres. Partagees par la requete recente et la requete ciblee. */
const JOB_SELECT_COLUMNS = `
  id, title, company_name, location, country, remote_type, contract_type, seniority,
  published_at, posted_at, scraped_at, created_at, updated_at, last_seen_at,
  description_text, official_desc, tags, job_skills, required_skills, optional_skills,
  job_family, source_url, apply_url, external_id, is_active, is_expired, job_status
`;

type SendJobAlertDigestV2Body = PreviewJobAlertBody & {
  allow_send?: boolean | null;
  confirm?: string | null;
  date_yyyy_mm_dd?: string | null;
};

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

// JR-0052 (07/08/2026) : ligne renvoyee par la requete d'historique des
// digests deja envoyes a cet utilisateur, utilisee pour eviter de renvoyer
// la meme offre plusieurs jours de suite.
type RecentDigestItemRow = {
  job_id?: string | null;
};

type ExistingNotificationLog = {
  id: number | string;
  channel: string;
  status: string;
};

type ResendResult = {
  ok: boolean;
  id: string | null;
  status: number;
  message: string;
};

const CONFIRM_SEND = "SEND_JOB_ALERT_DIGEST_V2";
const NOTIFICATION_CHANNEL = "job_alert_digest_v2";
const DUPLICATE_CHANNELS = ["email", "email_non_paying_digest", NOTIFICATION_CHANNEL];
const REQUEST_TIMEOUT_MS = 15_000;
const CODE_VERSION = "digest_history_v1_recent_exclusion";

// JR-0052 (07/08/2026) : fenetre pendant laquelle une offre deja envoyee a un
// utilisateur (via jobradar_digest_items/jobradar_digest_runs) n'est pas
// reproposee, meme si elle reste pertinente et active. Avant ce correctif,
// aucune exclusion de ce type n'existait : un audit reel a montre 53 paires
// (utilisateur, offre) renvoyees au moins deux fois en 7 jours, jusqu'a 7
// fois pour une seule offre. La table dediee job_alert_sent_jobs prevue a
// l'origine (voir commentaire dans preview_job_alert_digest/index.ts)
// n'a jamais ete creee ; jobradar_digest_items/jobradar_digest_runs jouent
// deja ce role et sont reutilisees ici sans nouvelle table.
const RECENT_DIGEST_EXCLUSION_DAYS = 7;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ code_version: CODE_VERSION, ...body }), {
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
  if (v.toLowerCase().startsWith("bearer ")) v = v.slice(7).trim();
  return v;
}

function isAuthorized(req: Request) {
  const secret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!secret) return { ok: false, status: 500, error: "server_misconfigured" };

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cronHeader = cleanSecret(req.headers.get("x-cron-secret"));

  if (bearer === secret || cronHeader === secret) {
    return { ok: true, status: 200, error: null };
  }

  return { ok: false, status: 401, error: "unauthorized" };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function digestDateFrom(body: SendJobAlertDigestV2Body) {
  const raw = cleanString(body.date_yyyy_mm_dd);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

// JR-0052 (07/08/2026) : date de coupure (YYYY-MM-DD) a partir de laquelle on
// considere qu'une offre a ete "recemment envoyee" a cet utilisateur.
function recentExclusionCutoffFrom(digestDate: string, days: number) {
  const base = new Date(`${digestDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() - days);
    return fallback.toISOString().slice(0, 10);
  }
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

function base64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64Url(new Uint8Array(sig));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appUrlFromEnv() {
  return (cleanSecret(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com").replace(/\/$/, "");
}

function jobUrl(appUrl: string, jobId: string) {
  return `${appUrl}/jobradar/jobs/${encodeURIComponent(jobId)}?source=email_digest_v2`;
}

function buildHtml(params: {
  subject: string;
  preheader: string;
  jobs: SelectedJob[];
  blocks: DigestBlock[];
  appUrl: string;
  unsubscribeUrl: string;
}) {
  const primaryUrl = `${params.appUrl}/jobradar/feed?source=email_digest_v2`;
  const editUrl = `${params.appUrl}/jobradar/onboarding?source=email_digest_v2`;
  const rows = params.jobs.slice(0, 5).map((job) => {
    const meta = [job.company_name, job.location || job.country, job.remote_type, job.contract_type]
      .filter(Boolean)
      .join(" · ");
    return `
      <tr>
        <td style="padding:14px 0;border-top:1px solid #e5e7eb;">
          <a href="${jobUrl(params.appUrl, job.id)}" style="font-weight:800;color:#111827;text-decoration:none;">
            ${escapeHtml(job.title || "Offre JobRadar")}
          </a>
          ${meta ? `<div style="margin-top:4px;color:#64748b;font-size:13px;">${escapeHtml(meta)}</div>` : ""}
        </td>
      </tr>
    `;
  }).join("");
  const blockLabels = params.blocks
    .map((block) => `<li>${escapeHtml(block.title)} (${block.count})</li>`)
    .join("");

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="height:6px;background:#0052cc;font-size:0;line-height:6px;">&nbsp;</td></tr>
            <tr>
              <td style="padding:24px;">
                <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#64748b;font-weight:800;">JobRadar</div>
                <h1 style="margin:8px 0 8px 0;color:#0f172a;font-size:22px;line-height:1.25;">${escapeHtml(params.subject)}</h1>
                <p style="margin:0;color:#64748b;font-size:14px;line-height:1.5;">${escapeHtml(params.preheader)}</p>
                <p style="margin:18px 0 0 0;">
                  <a href="${primaryUrl}" style="display:inline-block;background:#0052cc;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:800;">Voir mes offres selectionnees</a>
                </p>
              </td>
            </tr>
            <tr><td style="padding:0 24px 8px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
            ${blockLabels ? `<tr><td style="padding:8px 24px 20px 24px;color:#111827;"><ul style="margin:0;padding-left:18px;">${blockLabels}</ul></td></tr>` : ""}
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;text-align:center;">
                <a href="${editUrl}" style="color:#64748b;text-decoration:underline;">Modifier mes criteres</a> ·
                <a href="${params.unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Se desinscrire</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildText(params: {
  subject: string;
  preheader: string;
  jobs: SelectedJob[];
  appUrl: string;
  unsubscribeUrl: string;
}) {
  const lines = params.jobs.slice(0, 5).flatMap((job) => [
    `- ${job.title || "Offre JobRadar"}${job.company_name ? ` - ${job.company_name}` : ""}`,
    `  ${jobUrl(params.appUrl, job.id)}`,
  ]);

  return [
    "JobRadar",
    params.subject,
    params.preheader,
    "",
    ...lines,
    "",
    `Voir mes offres selectionnees: ${params.appUrl}/jobradar/feed?source=email_digest_v2`,
    `Modifier mes criteres: ${params.appUrl}/jobradar/onboarding?source=email_digest_v2`,
    `Se desinscrire: ${params.unsubscribeUrl}`,
  ].join("\n");
}

async function fetchProfile(supabase: SupabaseClient, userId: string) {
  const full = await supabase
    .from("profiles")
    .select("user_id, full_name, headline, location, experience_years, jobradar_onboarding")
    .eq("user_id", userId)
    .maybeSingle<ProfileRow>();

  if (!full.error) return full;

  return await supabase
    .from("profiles")
    .select("user_id, full_name, headline, location, experience_years")
    .eq("user_id", userId)
    .maybeSingle<ProfileRow>();
}

async function findDuplicateLog(supabase: SupabaseClient, email: string, digestDate: string) {
  const { data, error } = await supabase
    .from("notification_logs")
    .select("id, channel, status")
    .eq("to_email", email)
    .eq("digest_date", digestDate)
    .in("channel", DUPLICATE_CHANNELS)
    .eq("status", "sent")
    .limit(1)
    .returns<ExistingNotificationLog[]>();

  if (error) throw new Error(`notification_log_lookup_failed:${error.message}`);
  return data?.[0] ?? null;
}

// JR-0052 (07/08/2026) : recupere les job_id deja envoyes a cet utilisateur
// dans un digest depuis sinceDigestDate (inclus), via l'historique reel
// jobradar_digest_runs/jobradar_digest_items (aucune nouvelle table). Erreur
// non fatale : en cas d'echec, on ne bloque pas l'envoi, on ne fait juste pas
// d'exclusion (comportement identique a avant ce correctif).
async function fetchRecentlySentJobIds(
  supabase: SupabaseClient,
  userId: string,
  sinceDigestDate: string,
): Promise<{ data: RecentDigestItemRow[] | null; error: { message: string } | null }> {
  const runsRes = await supabase
    .from("jobradar_digest_runs")
    .select("id")
    .eq("user_id", userId)
    .gte("digest_date", sinceDigestDate);

  if (runsRes.error) return { data: null, error: runsRes.error };

  const runIds = (runsRes.data ?? [])
    .map((row: { id?: string | null }) => row.id)
    .filter((id): id is string => Boolean(id));

  if (runIds.length === 0) return { data: [], error: null };

  return await supabase
    .from("jobradar_digest_items")
    .select("job_id")
    .in("run_id", runIds)
    .returns<RecentDigestItemRow[]>();
}

async function logStatus(
  supabase: SupabaseClient,
  payload: {
    user_id: string;
    to_email: string;
    digest_date: string;
    status: "sent" | "failed";
    provider_id?: string | null;
    error?: string | null;
  },
) {
  const { error } = await supabase.from("notification_logs").upsert({
    user_id: payload.user_id,
    to_email: payload.to_email,
    channel: NOTIFICATION_CHANNEL,
    digest_date: payload.digest_date,
    status: payload.status,
    provider: "resend",
    provider_id: payload.provider_id ?? null,
    error: payload.error ?? null,
  }, { onConflict: "to_email,channel,digest_date" });

  if (error) throw new Error(`notification_log_write_failed:${error.message}`);
}

async function recordDigestRun(
  supabase: SupabaseClient,
  payload: {
    user_id: string;
    digest_date: string;
    channel: string;
    subject: string;
    preheader: string;
    jobs: SelectedJob[];
  },
): Promise<string> {
  const items = payload.jobs.map((job, index) => ({
    job_id: job.id,
    rank: index + 1,
    title: cleanString(job.title) || "Offre JobRadar",
    company_name: cleanString(job.company_name) || null,
    location: cleanString(job.location) || null,
    country: cleanString(job.country) || null,
    score: job.score,
  }));

  const { data, error } = await supabase.rpc("record_job_alert_digest", {
    p_user_id: payload.user_id,
    p_digest_date: payload.digest_date,
    p_channel: payload.channel,
    p_subject: payload.subject,
    p_preheader: payload.preheader,
    p_items: items,
  });

  if (error) throw new Error(`digest_run_record_failed:${error.message}`);
  return String(data);
}

async function sendWithResend(payload: Record<string, unknown>, resendKey: string): Promise<ResendResult> {
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

    return {
      ok: resp.ok,
      id: typeof data.id === "string" ? data.id : null,
      status: resp.status,
      message: typeof data.message === "string" ? data.message : `resend_status_${resp.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      id: null,
      status: 0,
      message: error instanceof Error ? error.message : "resend_request_failed",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const auth = isAuthorized(req);
  if (!auth.ok) return json(auth.status, { ok: false, error: auth.error });

  let body: SendJobAlertDigestV2Body;
  try {
    body = (await req.json()) as SendJobAlertDigestV2Body;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const dryRun = body.dry_run !== false;
  const mode = dryRun ? "dry_run" : "controlled_send";
  const userId = cleanString(body.user_id);
  const digestDate = digestDateFrom(body);

  if (!userId) return json(400, { ok: false, error: "missing_user_id" });
  if (!isUuid(userId)) return json(400, { ok: false, error: "invalid_user_id" });
  if (!dryRun && (body.allow_send !== true || cleanString(body.confirm) !== CONFIRM_SEND)) {
    return json(400, {
      ok: false,
      dry_run: false,
      mode,
      user_id: userId,
      eligible_to_send: false,
      reason: "real_send_not_confirmed",
      resend_called: false,
      notification_log_written: false,
      diagnostics: {
        required_confirm: CONFIRM_SEND,
        allow_send_required: true,
      },
    });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
  const resendFrom = cleanSecret(Deno.env.get("RESEND_FROM"));
  const resendReplyTo = cleanSecret(Deno.env.get("RESEND_REPLY_TO"));
  if (!dryRun && (!resendKey || !resendFrom)) {
    return json(500, { ok: false, error: "missing_resend_config" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { limit, minJobsPreview, minJobsToSend, minScorePreview, minScoreToSend, maxBlocks } = normalizeOptions(body);
  const diagnostics = baseDiagnostics();
  diagnostics.notes.push("send_job_alert_digest_v2 handles one user per invocation; scheduled batching is orchestrated by private.cron_send_job_alert_digest.");
  diagnostics.notes.push("job_alert_sent_jobs is not used in V1; per-job deduplication remains for V1.1.");

  const recentExclusionCutoff = recentExclusionCutoffFrom(digestDate, RECENT_DIGEST_EXCLUSION_DAYS);

  try {
    const userResult = await supabase.auth.admin.getUserById(userId);
    if (userResult.error) {
      return json(404, { ok: false, error: "user_lookup_failed", message: userResult.error.message });
    }
    const email = normalizeEmail(cleanString(userResult.data.user?.email));
    if (!email) return json(400, { ok: false, error: "user_email_unavailable" });

    const [
      profileRes,
      prefsRes,
      alertsRes,
      applicationsRes,
      feedbackRes,
      recentDigestRes,
      suppressionRes,
      duplicateLog,
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
        .select("id, name, keywords, country, countries, search_query, employment_types, work_modes, skills_keywords, excluded_keywords, frequency, channels, is_active")
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
      fetchRecentlySentJobIds(supabase, userId, recentExclusionCutoff),
      supabase
        .from("email_suppressions")
        .select("reason, source")
        .eq("email_normalized", email)
        .maybeSingle(),
      findDuplicateLog(supabase, email, digestDate),
      supabase
        .from("jobs")
        .select(JOB_SELECT_COLUMNS)
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
    if (recentDigestRes.error) diagnostics.notes.push(`recent_digest_items_lookup_failed: ${recentDigestRes.error.message}`);
    if (suppressionRes.error) diagnostics.notes.push(`email_suppressions lookup failed: ${suppressionRes.error.message}`);
    if (jobsRes.error) return json(500, { ok: false, error: "jobs_lookup_failed", message: jobsRes.error.message });

    diagnostics.notification_prefs_checked = !prefsRes.error;
    diagnostics.notification_prefs_digest_enabled = prefsRes.data?.digest_enabled ?? null;
    diagnostics.notification_prefs_unsubscribed_at = prefsRes.data?.unsubscribed_at ?? null;
    diagnostics.suppression_checked = !suppressionRes.error;
    diagnostics.suppression_found = suppressionRes.data ? true : false;

    const profile = profileRes.data ?? null;
    const alerts = alertsRes.data ?? [];
    const criteria = buildCriteria(profile, alerts);
    let subject = "";
    let preheader = "";
    let selectedJobs: SelectedJob[] = [];
    let blocks: DigestBlock[] = [];
    let reason = "preview_only";

    if (isIncompleteProfile(criteria)) {
      diagnostics.excluded_incomplete_profile = true;
      diagnostics.notes.push("No desired role, keyword, country/zone or exploitable active alert was found.");
      reason = "incomplete_profile";
    } else {
      const savedOrAppliedIds = new Set(
        (applicationsRes.data ?? []).map((row) => cleanString(row.job_id)).filter(Boolean),
      );
      // JR-0052 (07/08/2026) : les offres deja envoyees dans un digest recent
      // (fenetre RECENT_DIGEST_EXCLUSION_DAYS) rejoignent les offres explicitement
      // rejetees par l'utilisateur (job_feedback action=dismissed) dans le meme
      // ensemble d'exclusion, deja gere nativement par selectRelevantJobs.
      const recentlySentIds = new Set(
        (recentDigestRes.data ?? []).map((row) => cleanString(row.job_id)).filter(Boolean),
      );
      const dismissedIds = new Set([
        ...(feedbackRes.data ?? []).map((row) => cleanString(row.job_id)).filter(Boolean),
        ...recentlySentIds,
      ]);
      diagnostics.notes.push(
        `recent_digest_exclusion: ${recentlySentIds.size} job(s) already sent since ${recentExclusionCutoff} excluded from re-selection (JR-0052, window=${RECENT_DIGEST_EXCLUSION_DAYS}d).`,
      );
      // Vivier complementaire : les offres du catalogue qui correspondent
      // vraiment aux criteres, cherchees en base au lieu d'etre esperees dans
      // les 240 dernieres publiees. Purement additif, aucun candidat retire.
      const relevanceFilter = buildRelevanceOrFilter(criteria);
      const candidateJobs: JobRow[] = [...(jobsRes.data ?? [])];
      if (relevanceFilter) {
        const targetedRes = await supabase
          .from("jobs")
          .select(JOB_SELECT_COLUMNS)
          .eq("is_active", true)
          .or("is_expired.eq.false,is_expired.is.null")
          .in("job_status", ["active", "stale"])
          .or(relevanceFilter)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(300)
          .returns<JobRow[]>();

        if (targetedRes.error) {
          diagnostics.notes.push(`targeted_jobs_lookup_failed: ${targetedRes.error.message}`);
        } else {
          const seen = new Set(candidateJobs.map((job) => job.id));
          let added = 0;
          for (const job of targetedRes.data ?? []) {
            if (seen.has(job.id)) continue;
            seen.add(job.id);
            candidateJobs.push(job);
            added += 1;
          }
          diagnostics.notes.push(
            `targeted_pool: +${added} offres pertinentes ajoutees au vivier (${candidateJobs.length} au total)`,
          );
        }
      }

      selectedJobs = selectRelevantJobs({
        jobs: candidateJobs,
        criteria,
        savedOrAppliedIds,
        dismissedIds,
        limit,
        minScorePreview,
        diagnostics,
      });
      const realSendEligibleJobs = selectedJobs.filter((job) => job.score >= minScoreToSend);
      reason = reasonForCount({
        previewCount: selectedJobs.length,
        sendEligibleCount: realSendEligibleJobs.length,
        minPreview: minJobsPreview,
        minSend: minJobsToSend,
      });

      if (selectedJobs.length < minJobsPreview) {
        recordBelowPreviewThresholdJobs(diagnostics, selectedJobs);
      } else {
        const heroJob = pickHeroJob(selectedJobs);
        subject = buildSubject(heroJob, selectedJobs.length);
        preheader = buildPreheader(selectedJobs.length, minJobsToSend);
        blocks = buildBlocks(selectedJobs, criteria, maxBlocks);
      }
    }

    const finalizedDiagnostics = finalizeDiagnostics(
      diagnostics,
      selectedJobs.length >= minJobsPreview ? selectedJobs.length : 0,
    );
    const guardReason =
      prefsRes.data?.digest_enabled === false ? "notification_prefs_disabled" :
      prefsRes.data?.unsubscribed_at ? "notification_prefs_unsubscribed" :
      suppressionRes.data ? "email_suppressed" :
      duplicateLog ? "already_sent_today" :
      reason !== "preview_only" ? reason :
      selectedJobs.length < minJobsPreview ? "not_enough_relevant_jobs" :
      !subject || !preheader ? "missing_subject_or_preheader" :
      null;

    const eligibleToSend = guardReason === null;
    const appUrl = appUrlFromEnv();
    const functionsBase = supabaseUrl.replace(/\/$/, "") + "/functions/v1";
    const unsubToken = await sign(cleanSecret(Deno.env.get("CRON_SECRET")), `unsubscribe:${userId}`);
    const unsubscribeUrl = `${functionsBase}/unsubscribe?uid=${encodeURIComponent(userId)}&t=${encodeURIComponent(unsubToken)}`;
    const responseBase = {
      dry_run: dryRun,
      mode,
      user_id: userId,
      eligible_to_send: eligibleToSend,
      reason: guardReason ?? (dryRun ? "preview_only" : "ready_to_send"),
      subject,
      preheader,
      total_selected_jobs: selectedJobs.length >= minJobsPreview ? selectedJobs.length : 0,
      min_jobs_preview: minJobsPreview,
      min_jobs_to_send: minJobsToSend,
      min_score_preview: minScorePreview,
      min_score_to_send: minScoreToSend,
      resend_called: false,
      notification_log_written: false,
      digest_run_recorded: false,
      digest_run_id: null,
      diagnostics: {
        ...finalizedDiagnostics,
        digest_date: digestDate,
        notification_channel: NOTIFICATION_CHANNEL,
        duplicate_log_checked: true,
        duplicate_log_found: Boolean(duplicateLog),
        job_alert_sent_jobs_status: "not_used_in_v1",
        recent_digest_exclusion_days: RECENT_DIGEST_EXCLUSION_DAYS,
        recent_digest_exclusion_cutoff: recentExclusionCutoff,
      },
    };

    if (dryRun || !eligibleToSend) {
      return json(200, { ok: true, ...responseBase });
    }

    const html = buildHtml({ subject, preheader, jobs: selectedJobs, blocks, appUrl, unsubscribeUrl });
    const text = buildText({ subject, preheader, jobs: selectedJobs, appUrl, unsubscribeUrl });
    const resend = await sendWithResend({
      from: resendFrom,
      to: email,
      reply_to: resendReplyTo || undefined,
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }, resendKey);

    if (!resend.ok) {
      await logStatus(supabase, {
        user_id: userId,
        to_email: email,
        digest_date: digestDate,
        status: "failed",
        error: resend.message,
      });
      return json(502, {
        ok: false,
        ...responseBase,
        reason: "resend_failed",
        resend_called: true,
        notification_log_written: true,
        diagnostics: {
          ...responseBase.diagnostics,
          resend_status: resend.status,
          resend_message: resend.message,
        },
      });
    }

    await logStatus(supabase, {
      user_id: userId,
      to_email: email,
      digest_date: digestDate,
      status: "sent",
      provider_id: resend.id,
    });

    let digestRunId: string | null = null;
    let digestRunError: string | null = null;
    try {
      digestRunId = await recordDigestRun(supabase, {
        user_id: userId,
        digest_date: digestDate,
        channel: NOTIFICATION_CHANNEL,
        subject,
        preheader,
        jobs: selectedJobs,
      });
    } catch (error) {
      digestRunError = error instanceof Error ? error.message : "digest_run_record_failed";
    }

    return json(200, {
      ok: true,
      ...responseBase,
      reason: "sent",
      resend_called: true,
      notification_log_written: true,
      digest_run_recorded: digestRunId !== null,
      digest_run_id: digestRunId,
      diagnostics: {
        ...responseBase.diagnostics,
        resend_status: resend.status,
        resend_message_id: resend.id,
        digest_run_error: digestRunError,
      },
    });
  } catch (error) {
    return json(500, {
      ok: false,
      dry_run: dryRun,
      mode,
      user_id: userId,
      eligible_to_send: false,
      reason: "send_job_alert_digest_v2_failed",
      resend_called: false,
      notification_log_written: false,
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
});
