import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type DigestBody = {
  limit_users?: number | null;
  dry_run?: boolean | null;
  date_yyyy_mm_dd?: string | null;
};

type AlertRow = {
  name?: string | null;
  keywords?: string[] | null;
  country?: string | null;
  countries?: string[] | null;
};

type CvRow = {
  skills?: string[] | null;
  cv_json?: Record<string, unknown> | null;
};

type JobRow = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  description_text?: string | null;
  official_desc?: string | null;
  tags?: string[] | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
  source_url?: string | null;
  external_id?: string | null;
};

const MAX_ITEMS = 8;
const MIN_TOP = 3;
const TOP_MIN = 65;
const EXP_MIN = 50;
const EXP_MAX = 64;
const JOB_LIMIT = 600;

const STOP_WORDS = new Set([
  "de","des","du","la","le","les","un","une","et","en","a","au","aux","pour","avec","sans","sur","dans","chez","ou",
  "the","a","an","and","or","for","with","without","in","on","at","to","from",
  "remote","remotely","hybrid","freelance","intern","internship","stage","alternance","junior","senior",
]);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function normalizeText(input: string): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function canonicalize(input: string): string {
  return normalizeText(input).replace(/[^a-z0-9\s+.#-]/g, " ").replace(/\s+/g, " ").trim();
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean)));
}

function extractKeywordsFromAlertName(name: string): string[] {
  const t = canonicalize(name);
  if (!t) return [];
  const phrase = t.replace(/\s+/g, " ").trim();
  const tokens = t
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 3)
    .filter((w) => !STOP_WORDS.has(w));
  return uniq([phrase, ...tokens]).slice(0, 5);
}

function getJobTimeMs(job: JobRow): number {
  const candidates = [
    job.published_at, job.posted_at, job.scraped_at, job.created_at, job.updated_at,
  ].filter(Boolean) as string[];
  for (const d of candidates) {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function pickFirstName(profile: Record<string, unknown> | null, meta: Record<string, unknown> | null): string | null {
  const p = profile ?? {};
  const m = meta ?? {};
  const fromProfile =
    clean(String(p["first_name"] ?? "")) ||
    clean(String(p["display_name"] ?? "")) ||
    clean(String(p["full_name"] ?? ""));
  if (fromProfile) return fromProfile.split(/\s+/)[0];

  const fromMeta =
    clean(String(m["full_name"] ?? "")) ||
    clean(String(m["name"] ?? ""));
  if (fromMeta) return fromMeta.split(/\s+/)[0];

  return null;
}

function buildEmailHtml(params: {
  salutation: string;
  preview: string;
  intro: string;
  topTitle: string;
  exploreTitle: string;
  exploreHelper: string;
  top: JobRow[];
  explore: JobRow[];
  appBaseUrl: string;
}) {
  const { preview, intro, topTitle, exploreTitle, exploreHelper, top, explore, appBaseUrl } = params;

  const itemHtml = (job: JobRow) => {
    const title = job.title ?? "Offre";
    const company = job.company_name ? ` • ${job.company_name}` : "";
    const location = job.location ? ` • ${job.location}` : "";
    const date = formatDate(job.published_at || job.posted_at || job.scraped_at || job.created_at) || "";
    const link = job.source_url || `${appBaseUrl}/jobradar/jobs/${job.id}`;
    return `
      <div style="padding:12px 0;border-bottom:1px solid #eef1f5;">
        <div style="font-size:15px;font-weight:600;color:#0f172a;">${title}${company}</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px;">${location}${date ? " • " + date : ""}</div>
        <div style="margin-top:6px;">
          <a href="${link}" style="color:#2563eb;text-decoration:none;font-weight:600;">Voir l’offre</a>
        </div>
      </div>
    `;
  };

  const topHtml = top.map(itemHtml).join("");
  const exploreHtml = explore.map(itemHtml).join("");

  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
  <div style="background:#f6f8fb;padding:24px 0;">
    <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,0.08);overflow:hidden;">
      <div style="padding:20px 24px;border-bottom:1px solid #eef1f5;">
        <div style="font-size:16px;color:#0f172a;line-height:1.5;">
          ${intro}
        </div>
      </div>

      <div style="padding:18px 24px;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px;">${topTitle}</div>
        ${topHtml || `<div style="color:#94a3b8;">Aucune offre en Top match aujourd’hui.</div>`}
      </div>

      ${explore.length > 0 ? `
      <div style="padding:0 24px 18px 24px;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">${exploreTitle}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:6px;">${exploreHelper}</div>
        ${exploreHtml}
      </div>` : ""}

      <div style="padding:20px 24px;border-top:1px solid #eef1f5;text-align:center;">
        <a href="${appBaseUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">
          Ouvrir JobRadar
        </a>
      </div>

      <div style="padding:16px 24px;color:#94a3b8;font-size:12px;text-align:center;">
        Tu reçois cet email parce que tu testes Go4Job.<br/>© Go4Job — JobRadar
      </div>
    </div>
  </div>
  `;
}

serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const cronSecret = clean(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) return json(500, { ok: false, error: "server_misconfigured" });

  const authHeader = req.headers.get("authorization") || "";
  const bearer =
    authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
  const cronHeader = clean(req.headers.get("x-cron-secret"));
  if (!((bearer && bearer === cronSecret) || (cronHeader && cronHeader === cronSecret))) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let body: DigestBody = {};
  try {
    body = (await req.json()) as DigestBody;
  } catch {
    // body optional
  }

  const limitUsers = body.limit_users ?? null;
  const dryRun = Boolean(body.dry_run);
  const digestDate = body.date_yyyy_mm_dd && /^\d{4}-\d{2}-\d{2}$/.test(body.date_yyyy_mm_dd)
    ? body.date_yyyy_mm_dd
    : new Date().toISOString().slice(0, 10);

  const resendKey = clean(Deno.env.get("RESEND_API_KEY"));
  const resendFrom = clean(Deno.env.get("RESEND_FROM"));
  const resendReplyTo = clean(Deno.env.get("RESEND_REPLY_TO"));
  const appBaseUrl = clean(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com";

  if (!resendKey || !resendFrom) {
    return json(500, { ok: false, error: "missing_resend_config" });
  }

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceRole = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRole) {
    return json(500, { ok: false, error: "missing_supabase_env" });
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  // Jobs
  const { data: jobsData, error: jobsErr } = await supabase
    .from("jobs")
    .select(`
      id, title, company_name, location, country, remote_type,
      published_at, posted_at, scraped_at, created_at, updated_at,
      description_text, official_desc,
      tags, job_skills, required_skills, optional_skills,
      experience_years_min, experience_years_max,
      source_url, external_id
    `)
    .eq("is_active", true)
    .eq("is_expired", false)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(JOB_LIMIT);

  if (jobsErr) return json(500, { ok: false, error: "jobs_fetch_failed", message: jobsErr.message });

  const jobs = (jobsData ?? []) as JobRow[];
  const jobHay = new Map<string, string>();
  for (const j of jobs) {
    const hay = canonicalize(
      [
        j.title,
        j.company_name,
        j.location,
        j.country,
        j.remote_type,
        j.description_text,
        j.official_desc,
        ...(j.required_skills ?? []),
        ...(j.optional_skills ?? []),
        ...(j.job_skills ?? []),
        ...(j.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
    );
    jobHay.set(j.id, hay);
  }

  // Users
  const users: Array<{ id: string; email: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> }> = [];
  const perPage = 500;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return json(500, { ok: false, error: "users_fetch_failed", message: error.message });
    const batch = data?.users ?? [];
    for (const u of batch) {
      if (u.email && u.email_confirmed_at) {
        users.push({ id: u.id, email: u.email, email_confirmed_at: u.email_confirmed_at, user_metadata: u.user_metadata });
        if (limitUsers && users.length >= limitUsers) break;
      }
    }
    if (limitUsers && users.length >= limitUsers) break;
    if (batch.length < perPage) break;
    page += 1;
  }

  const stats = { digest_date: digestDate, users_targeted: users.length, emails_planned: 0, sent: 0, failed: 0, skipped: 0 };
  let sample: Record<string, unknown> | null = null;

  for (const user of users) {
    const toEmail = user.email;

    const { data: logExists } = await supabase
      .from("notification_logs")
      .select("id, status")
      .eq("to_email", toEmail)
      .eq("channel", "email")
      .eq("digest_date", digestDate)
      .limit(1);

    if (logExists && logExists.length > 0 && logExists[0].status === "sent") {
      stats.skipped += 1;
      continue;
    }

    let profile: Record<string, unknown> | null = null;
    const prof1 = await supabase.from("profiles").select("first_name, display_name, full_name").eq("id", user.id).maybeSingle();
    if (prof1?.data) profile = prof1.data as Record<string, unknown>;
    if (!profile) {
      const prof2 = await supabase.from("profiles").select("first_name, display_name, full_name").eq("user_id", user.id).maybeSingle();
      if (prof2?.data) profile = prof2.data as Record<string, unknown>;
    }

    const firstName = pickFirstName(profile, user.user_metadata ?? {});
    const salutation = firstName ? `Bonjour ${firstName},` : "Bonjour,";

    const { data: aData } = await supabase
      .from("alerts")
      .select("name, keywords, country, countries, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const alerts = (aData ?? []) as AlertRow[];

    const alertKeywords = uniq([
      ...alerts.flatMap((a) => a.keywords ?? []),
      ...alerts.flatMap((a) => extractKeywordsFromAlertName(a.name ?? "")),
    ]);

    const cappedAlertKeywords = alertKeywords.slice(0, 20);

    const { data: cvData } = await supabase
      .from("user_cvs")
      .select("skills, cv_json")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const cv = (cvData ?? {}) as CvRow;
    const cvSkills = Array.isArray(cv.skills) ? cv.skills : [];
    const cvJson = (cv.cv_json ?? {}) as Record<string, unknown>;
    const expMin = cvJson?.["experience_years_min"] as number | null;
    const expMax = cvJson?.["experience_years_max"] as number | null;
    const cvExpValue = (expMax ?? expMin) ?? null;

    const kwAlerts = uniq(cappedAlertKeywords.map((k) => canonicalize(k)).map((x) => x.toLowerCase())).filter(Boolean);
    const kwCv = uniq(cvSkills.map((k) => canonicalize(k)).map((x) => x.toLowerCase())).filter(Boolean);
    const kwCount = kwAlerts.length + kwCv.length;

    const allowAllCountries = (() => {
      if (!alerts.length) return true;
      let allowAll = false;
      const set = new Set<string>();
      for (const a of alerts) {
        const list = (a.countries && a.countries.length ? a.countries : a.country ? [a.country] : [])
          .map((x) => (x ?? "").trim().toUpperCase())
          .filter(Boolean);
        if (!list.length) allowAll = true;
        for (const c of list) set.add(c);
      }
      if (set.size === 0) allowAll = true;
      return allowAll;
    })();

    const allowedCountries = (() => {
      const set = new Set<string>();
      for (const a of alerts) {
        const list = (a.countries && a.countries.length ? a.countries : a.country ? [a.country] : [])
          .map((x) => (x ?? "").trim().toUpperCase())
          .filter(Boolean);
        for (const c of list) set.add(c);
      }
      return set;
    })();

    const exploreMatches = jobs
      .map((job) => {
        const hay = jobHay.get(job.id) ?? "";
        let sAlert = 0;
        let sCv = 0;
        for (const k of kwAlerts) if (k && hay.includes(k)) sAlert += 1;
        for (const k of kwCv) if (k && hay.includes(k)) sCv += 1;

        const jobMin = job.experience_years_min ?? null;
        const jobMax = job.experience_years_max ?? null;
        const expConsidered = cvExpValue != null && (jobMin != null || jobMax != null);
        let expOk = false;
        if (expConsidered && cvExpValue != null) {
          let ok = true;
          if (jobMin != null) ok = ok && cvExpValue >= jobMin;
          if (jobMax != null) ok = ok && cvExpValue <= jobMax + 2;
          expOk = ok;
        }

        const denom = kwAlerts.length * 2 + kwCv.length * 1 + (expConsidered ? 2 : 0);
        const weighted = sAlert * 2 + sCv * 1 + (expOk ? 2 : 0);
        const p = denom ? Math.round((weighted / denom) * 100) : 0;

        const signalCount = kwCount + (expOk ? 1 : 0);
        if (signalCount && !(sAlert + sCv >= 1 || expOk)) return null;

        if (!allowAllCountries) {
          const jc = (job.country ?? "").trim().toUpperCase();
          if (jc && jc.length === 2 && !allowedCountries.has(jc)) return null;
        }

        return { job, p, s: sAlert + sCv };
      })
      .filter(Boolean) as Array<{ job: JobRow; p: number; s: number }>;

    exploreMatches.sort((a, b) => {
      if (b.p !== a.p) return b.p - a.p;
      if (b.s !== a.s) return b.s - a.s;
      return getJobTimeMs(b.job) - getJobTimeMs(a.job);
    });

    const topMatches = exploreMatches.filter((x) => x.p >= TOP_MIN).map((x) => x.job);
    const explore = exploreMatches.filter((x) => x.p >= EXP_MIN && x.p <= EXP_MAX).map((x) => x.job);

    let selectedTop = topMatches.slice(0, MAX_ITEMS);
    let selectedExplore: JobRow[] = [];

    if (selectedTop.length < MIN_TOP) {
      const remain = MAX_ITEMS - selectedTop.length;
      selectedExplore = explore.slice(0, remain);
    }

    const seen = new Set<string>();
    const dedup = (list: JobRow[]) =>
      list.filter((j) => {
        const key = j.id || j.external_id || j.source_url || "";
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    selectedTop = dedup(selectedTop);
    selectedExplore = dedup(selectedExplore);

    const allItems = [...selectedTop, ...selectedExplore];
    if (allItems.length === 0) {
      await supabase.from("notification_logs").insert({
        user_id: user?.id ?? null,
        to_email: toEmail,
        channel: "email",
        digest_date: digestDate,
        status: "skipped",
        provider: "resend",
        error: "no_jobs",
      });
      stats.skipped += 1;
      continue;
    }

    stats.emails_planned += 1;

    const subject = "Go4Job — Tes offres du jour";
    const preview = "Une sélection d’offres correspondant à ton profil.";
    const intro = `${salutation}<br/>Voici ta sélection d’offres du jour correspondant à ton profil.<br/>Clique sur une offre pour voir les détails et la sauvegarder.`;

    const html = buildEmailHtml({
      salutation,
      preview,
      intro,
      topTitle: "Top matchs (≥ 65)",
      exploreTitle: "Explorer (50–64)",
      exploreHelper: "Tu peux aussi explorer ces opportunités proches de ton profil.",
      top: selectedTop,
      explore: selectedExplore,
      appBaseUrl,
    });

    if (dryRun) {
      if (!sample) {
        sample = {
          to: toEmail,
          top: selectedTop.length,
          explore: selectedExplore.length,
          html_preview: html.slice(0, 800),
        };
      }
      continue;
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: toEmail,
        reply_to: resendReplyTo || undefined,
        subject,
        html,
      }),
    });

    let data: any = {};
    try { data = await resp.json(); } catch { data = {}; }

    if (!resp.ok) {
      await supabase.from("notification_logs").insert({
        user_id: user?.id ?? null,
        to_email: toEmail,
        channel: "email",
        digest_date: digestDate,
        status: "failed",
        provider: "resend",
        error: data?.message || "resend_error",
      });
      stats.failed += 1;
      continue;
    }

    await supabase.from("notification_logs").insert({
      user_id: user?.id ?? null,
      to_email: toEmail,
      channel: "email",
      digest_date: digestDate,
      status: "sent",
      provider: "resend",
      provider_id: data?.id ?? null,
    });

    stats.sent += 1;
  }

  return json(200, { ok: true, dry_run: dryRun, stats, sample });
});
