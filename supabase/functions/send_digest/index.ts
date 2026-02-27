import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type DigestBody = {
  limit_users?: number | null;
  dry_run?: boolean | null;
  date_yyyy_mm_dd?: string | null;
  target_email?: string | null;
  target_user_id?: string | null;
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
  description_html?: string | null;
  official_desc?: string | null;
  tags?: string[] | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
  source_url?: string | null;
  external_id?: string | null;
  ai_description?: string | null;
  ai_description_status?: string | null;
  ai_description_quality?: number | null;
  ai_description_model?: string | null;
  ai_description_error?: string | null;
  ai_description_updated_at?: string | null;
};

type DigestItem = {
  job: JobRow;
  summary_fr: string;
  language?: string | null;
  why?: string[];
  tags?: string[];
  meta?: {
    remote?: string | null;
    location?: string | null;
    date?: string | null;
    freshness?: string | null;
    source?: string | null;
  };
};

const MAX_ITEMS = 8;
const MIN_TOP = 3;
const TOP_MIN = 65;
const EXP_MIN = 50;
const EXP_MAX = 64;
const JOB_LIMIT = 600;
const AI_DESC_MIN_QUALITY = 0.65;
const SUMMARY_MAX_SENTENCES = 2;
const SUMMARY_MAX_CHARS = 220;

const EMAIL_COLORS = {
  brand: "#0052CC",
  header: "#0F172A",
  headerAlt: "#102042",
  badgeBg: "#EEF4FF",
  bg: "#F5F7FB",
  border: "#E5E7EB",
  text: "#111827",
  muted: "#64748B",
  white: "#FFFFFF",
} as const;

const STOP_WORDS = new Set([
  "de","des","du","la","le","les","un","une","et","en","a","au","aux","pour","avec","sans","sur","dans","chez","ou",
  "the","a","an","and","or","for","with","without","in","on","at","to","from",
  "remote","remotely","hybrid","freelance","intern","internship","stage","alternance","junior","senior",
  "poste","mission","missions","role","responsibilities","responsibility","experience","skills","competences",
  "company","entreprise","team","equipe","equipee","profile","profil",
]);

const FR_HINTS = [
  " le "," la "," les "," des "," pour "," avec "," poste "," mission "," responsabilite "," competences ",
  "experience ","experiences ","gestion ","budget ","equipe ","formation ","diplome ","sante ","finance ",
];
const EN_HINTS = [
  " the "," and "," with "," for "," position "," responsibilities "," skills "," experience "," team "," manager ",
  "role ","benefits ","requirements ",
];

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

function formatDateFr(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const fmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
    return fmt.format(d);
  } catch {
    return formatDate(dateStr);
  }
}

function formatFreshness(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const msDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((now.getTime() - d.getTime()) / msDay);
  if (diff <= 0) return "Aujourd\u2019hui";
  if (diff === 1) return "Hier";
  if (diff <= 7) return `Il y a ${diff} jours`;
  return formatDateFr(dateStr);
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtmlEntities(s: string) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function stripHtml(html: string) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " "));
}

function collapseWhitespace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return collapseWhitespace(text)
    .replace(/([.!?])\s+/g, "$1|")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clampSentences(text: string, maxSentences = SUMMARY_MAX_SENTENCES, maxChars = SUMMARY_MAX_CHARS) {
  const sentences = splitSentences(text);
  let out = sentences.slice(0, maxSentences).join(" ");
  if (out.length > maxChars) out = out.slice(0, maxChars).trim() + "...";
  return out;
}

function detectLanguage(text: string): string | null {
  const t = ` ${normalizeText(text)} `;
  let fr = 0;
  let en = 0;

  for (const h of FR_HINTS) if (t.includes(normalizeText(h))) fr += 1;
  for (const h of EN_HINTS) if (t.includes(normalizeText(h))) en += 1;

  if (/[\u00E0\u00E2\u00E4\u00E7\u00E9\u00E8\u00EA\u00EB\u00EE\u00EF\u00F4\u00F6\u00F9\u00FB\u00FC\u00FF]/i.test(text)) fr += 2;

  if (fr >= en + 1) return "FR";
  if (en >= fr + 1) return "EN";
  return null;
}

function labelRemoteType(remoteType?: string | null): string | null {
  const rt = (remoteType ?? "").trim().toLowerCase();
  if (!rt) return null;
  if (rt.includes("remote")) return "Remote";
  if (rt.includes("hybrid")) return "Hybride";
  if (rt.includes("on") || rt.includes("office") || rt.includes("site")) return "Sur site";
  return rt.charAt(0).toUpperCase() + rt.slice(1);
}

function safeHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sourceLabel(job: JobRow): string | null {
  const ext = clean(job.external_id);
  if (ext && ext.includes(":")) {
    const prefix = ext.split(":")[0].toLowerCase();
    const map: Record<string, string> = {
      remotive: "Remotive",
      weworkremotely: "We Work Remotely",
      wwr: "We Work Remotely",
      himalayas: "Himalayas",
      bourbon: "Bourbon",
      aej: "AEJ",
      agl: "AGL",
    };
    if (map[prefix]) return map[prefix];
  }
  if (job.source_url) {
    const host = safeHost(job.source_url);
    if (host) return host;
  }
  return null;
}

function clampText(text: string, maxChars: number): string {
  const t = collapseWhitespace(text);
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trim() + "...";
}

function shortLabel(text: string, maxChars = 26): string {
  const t = collapseWhitespace(text);
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 3)).trim() + "...";
}

function extractKeywordsFromText(text: string): string[] {
  const t = canonicalize(text);
  if (!t) return [];
  const tokens = t
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 4)
    .filter((w) => !STOP_WORDS.has(w));
  return uniq(tokens).slice(0, 5);
}

function buildSummaryFr(job: JobRow): string {
  const ai = clean(job.ai_description);
  if (ai && job.ai_description_status === "done" && (job.ai_description_quality ?? 0) >= AI_DESC_MIN_QUALITY) {
    return clampSentences(stripHtml(ai), SUMMARY_MAX_SENTENCES, SUMMARY_MAX_CHARS);
  }

  const baseText = clean(job.description_text) ||
    clean(stripHtml(job.description_html ?? "")) ||
    clean(job.official_desc) ||
    clean(job.title) ||
    "";

  const title = clean(job.title) || "Ce poste";
  const company = clean(job.company_name);
  const location = clean(job.location) || clean(job.country);

  let s1 = title;
  if (company) s1 += ` chez ${company}`;
  if (location) s1 += ` (${location})`;
  s1 += ".";

  const keywords = extractKeywordsFromText(baseText);
  const s2 = keywords.length
    ? `Points cl\u00E9s: ${keywords.join(", ")}.`
    : "Consulte l'annonce pour les missions et comp\u00E9tences demand\u00E9es.";

  return clampSentences(`${s1} ${s2}`, 2, SUMMARY_MAX_CHARS);
}

function buildItems(list: JobRow[], reasonsByJobId?: Map<string, string[]>): DigestItem[] {
  return list.map((job) => {
    const baseText =
      clean(job.description_text) ||
      clean(stripHtml(job.description_html ?? "")) ||
      clean(job.official_desc) ||
      clean(job.title) ||
      "";
    const language = baseText ? detectLanguage(baseText) : null;
    const summary = clampText(buildSummaryFr(job), SUMMARY_MAX_CHARS);

    const tags = uniq([
      ...(job.tags ?? []),
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
      ...(job.job_skills ?? []),
    ])
      .map((t) => shortLabel(clean(t)))
      .filter(Boolean)
      .slice(0, 4);

    const dateCandidate = job.published_at || job.posted_at || job.scraped_at || job.created_at || job.updated_at;
    const meta = {
      remote: labelRemoteType(job.remote_type),
      location: clean(job.location) || clean(job.country) || null,
      date: dateCandidate ? formatDateFr(dateCandidate) : null,
      freshness: dateCandidate ? formatFreshness(dateCandidate) : null,
      source: sourceLabel(job),
    };

    const why = (reasonsByJobId?.get(job.id) ?? []).map((w) => shortLabel(w)).slice(0, 4);

    return {
      job,
      summary_fr: summary,
      language,
      why: why.length ? why : undefined,
      tags: tags.length ? tags : undefined,
      meta,
    };
  });
}

function buildEmailHtml(params: {
  salutation: string;
  preview: string;
  intro: string;
  topTitle: string;
  exploreTitle: string;
  exploreHelper: string;
  top: DigestItem[];
  explore: DigestItem[];
  appBaseUrl: string;
  unsubscribeUrl: string;
}) {
  const { preview, intro, topTitle, exploreTitle, exploreHelper, top, explore, appBaseUrl, unsubscribeUrl } = params;
  const appUrl = appBaseUrl.replace(/\/$/, "");
  const radarUrl = `${appUrl}/jobradar`;
  const manageUrl = `${appUrl}/jobradar/alerts`;
  const topCount = top.length;
  const exploreCount = explore.length;
  const totalCount = topCount + exploreCount;

  const statsLine = `S\u00E9lectionn\u00E9es pour ton profil \u2022 ${totalCount} opportunit\u00E9${totalCount > 1 ? "s" : ""} aujourd\u2019hui`;
  const chip = (text: string, bg = EMAIL_COLORS.badgeBg, color = EMAIL_COLORS.header) =>
    `<span style="display:inline-block;background:${bg};color:${color};border:1px solid ${EMAIL_COLORS.border};padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;margin-right:6px;margin-bottom:6px;white-space:nowrap;">${escapeHtml(text)}</span>`;

  const primaryCta =
    totalCount === 0
      ? { label: "Ajuster mes alertes", url: manageUrl }
      : topCount > 0
        ? { label: "Voir mes top matchs", url: radarUrl }
        : { label: `Explorer mes ${totalCount} offres`, url: radarUrl };

  const badgeList = (items: Array<string | null | undefined>, limit = 5) => {
    const vals = items.filter(Boolean) as string[];
    if (!vals.length) return "";
    return vals.slice(0, limit).map((x) => chip(x)).join("");
  };

  const tagList = (items?: string[]) => {
    if (!items || items.length === 0) return "";
    const out = items.slice(0, 4).map((x) => chip(x, "#F8FAFF", EMAIL_COLORS.text)).join("");
    return out ? `<div style="margin-top:10px;">${out}</div>` : "";
  };

  const whyList = (items?: string[]) => {
    if (!items || items.length === 0) return "";
    const out = items.slice(0, 4).map((x) => chip(x, EMAIL_COLORS.badgeBg, EMAIL_COLORS.header)).join("");
    return out
      ? `
        <div style="margin-top:10px;">
          <div style="font-size:12px;font-weight:800;color:${EMAIL_COLORS.text};margin-bottom:6px;">Pourquoi cette offre ?</div>
          ${out}
        </div>
      `
      : "";
  };

  const itemHtml = (item: DigestItem) => {
    const job = item.job;
    const title = escapeHtml(job.title ?? "Offre");
    const company = job.company_name ? ` \u00B7 ${escapeHtml(job.company_name)}` : "";
    const link = job.source_url || `${appUrl}/jobradar/jobs/${job.id}`;
    const summary = item.summary_fr ? escapeHtml(item.summary_fr) : "";
    const metaBadges = badgeList([
      item.meta?.remote ?? null,
      item.meta?.location ?? null,
      item.meta?.freshness ?? item.meta?.date ?? null,
      item.language ? `Langue: ${item.language}` : null,
      item.meta?.source ? `Source: ${item.meta.source}` : null,
    ]);

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid ${EMAIL_COLORS.border};border-radius:12px;overflow:hidden;background:${EMAIL_COLORS.white};">
        <tr>
          <td style="padding:16px 16px 14px 16px;">
            <div style="font-size:16px;font-weight:800;color:${EMAIL_COLORS.text};line-height:1.35;">
              <a href="${link}" style="color:${EMAIL_COLORS.brand};text-decoration:none;">${title}</a>${company}
            </div>
            <div style="margin-top:8px;">${metaBadges}</div>
            ${summary ? `<div style="margin-top:10px;font-size:13px;line-height:1.6;color:${EMAIL_COLORS.text};"><span style="font-weight:800;">En bref</span> \u2014 ${summary}</div>` : ""}
            ${whyList(item.why)}
            ${tagList(item.tags)}
            <div style="margin-top:12px;">
              <a href="${link}" style="color:${EMAIL_COLORS.brand};text-decoration:none;font-weight:800;">Voir l\u2019offre \u2192</a>
            </div>
          </td>
        </tr>
      </table>
    `;
  };

  const topEmptyHtml = `
    <div style="padding:14px;border:1px dashed ${EMAIL_COLORS.border};border-radius:12px;background:${EMAIL_COLORS.badgeBg};color:${EMAIL_COLORS.muted};font-size:13px;line-height:1.55;">
      Aucun top match aujourd\u2019hui, mais nous avons des offres \u00E0 explorer ci-dessous.
      <div style="margin-top:8px;">
        <a href="${manageUrl}" style="color:${EMAIL_COLORS.brand};text-decoration:none;font-weight:800;">Ajuster mes alertes</a>
      </div>
    </div>
  `;

  const allEmptyHtml = `
    <div style="padding:16px;border:1px solid ${EMAIL_COLORS.border};border-radius:12px;background:${EMAIL_COLORS.badgeBg};color:${EMAIL_COLORS.text};font-size:13px;line-height:1.55;">
      <div style="font-weight:800;">Aucune offre aujourd\u2019hui.</div>
      <div style="margin-top:6px;color:${EMAIL_COLORS.muted};">Ajuste tes alertes pour affiner la s\u00E9lection et recevoir plus d\u2019opportunit\u00E9s pertinentes.</div>
      <div style="margin-top:10px;">
        <a href="${manageUrl}" style="color:${EMAIL_COLORS.brand};text-decoration:none;font-weight:800;">Ajuster mes alertes</a>
      </div>
    </div>
  `;

  const topHtml = topCount ? top.map(itemHtml).join("") : topEmptyHtml;
  const exploreHtml = exploreCount ? explore.map(itemHtml).join("") : "";

  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.bg};padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:${EMAIL_COLORS.white};border-radius:16px;border:1px solid ${EMAIL_COLORS.border};overflow:hidden;">
          <tr>
            <td style="padding:22px 24px;background:${EMAIL_COLORS.header};color:${EMAIL_COLORS.white};">
              <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;opacity:.85;">GO4JOB \u2014 JOBRADAR</div>
              <div style="font-size:22px;font-weight:900;margin-top:6px;">Tes offres du jour</div>
              <div style="font-size:13px;opacity:.9;margin-top:6px;">${statsLine}</div>
              <div style="margin-top:10px;">
                ${chip(`Top matchs: ${topCount}`, "#1E293B", EMAIL_COLORS.white)}
                ${chip(`\u00C0 explorer: ${exploreCount}`, "#1E293B", EMAIL_COLORS.white)}
              </div>
              <div style="font-size:12px;opacity:.9;margin-top:8px;">Offres filtr\u00E9es selon ton profil et r\u00E9sum\u00E9es en fran\u00E7ais.</div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 24px;border-bottom:1px solid ${EMAIL_COLORS.border};">
              <div style="font-size:15px;color:${EMAIL_COLORS.text};line-height:1.6;">
                ${intro}
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 24px 8px 24px;">
              <div style="font-size:14px;font-weight:900;color:${EMAIL_COLORS.text};margin-bottom:10px;">${topTitle}</div>
              ${totalCount === 0 ? allEmptyHtml : topHtml}
            </td>
          </tr>

          ${exploreCount > 0 ? `
          <tr>
            <td style="padding:8px 24px 18px 24px;">
              <div style="font-size:14px;font-weight:900;color:${EMAIL_COLORS.text};margin-bottom:6px;">${exploreTitle}</div>
              <div style="font-size:12px;color:${EMAIL_COLORS.muted};margin-bottom:6px;">${exploreHelper}</div>
              ${exploreHtml}
            </td>
          </tr>` : ""}

          <tr>
            <td style="padding:18px 24px;border-top:1px solid ${EMAIL_COLORS.border};text-align:center;">
              <a href="${primaryCta.url}" style="display:inline-block;background:${EMAIL_COLORS.brand};color:${EMAIL_COLORS.white};text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:900;">
                ${primaryCta.label}
              </a>
              <div style="margin-top:10px;font-size:12px;">
                <a href="${manageUrl}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">G\u00E9rer mes alertes</a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 24px;color:${EMAIL_COLORS.muted};font-size:12px;text-align:center;">
              JobRadar by Go4Job \u2014 l\u2019assistant qui filtre et r\u00E9sume vos opportunit\u00E9s.<br/>
              Tu re\u00E7ois cet email car tu as activ\u00E9 une alerte JobRadar.<br/>
              <a href="${manageUrl}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">G\u00E9rer mes alertes</a> \u00B7
              <a href="${unsubscribeUrl}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">Se d\u00E9sinscrire</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  `;
}

function buildEmailText(params: {
  salutation: string;
  intro: string;
  topTitle: string;
  exploreTitle: string;
  exploreHelper: string;
  top: DigestItem[];
  explore: DigestItem[];
  appBaseUrl: string;
  unsubscribeUrl: string;
}) {
  const { salutation, intro, topTitle, exploreTitle, exploreHelper, top, explore, appBaseUrl, unsubscribeUrl } = params;
  const appUrl = appBaseUrl.replace(/\/$/, "");
  const manageUrl = `${appUrl}/jobradar/alerts`;
  const radarUrl = `${appUrl}/jobradar`;
  const topCount = top.length;
  const exploreCount = explore.length;
  const totalCount = topCount + exploreCount;
  const statsLine = `Selectionnees pour ton profil • ${totalCount} opportunite${totalCount > 1 ? "s" : ""} aujourd'hui`;
  const primaryCta =
    totalCount === 0
      ? { label: "Ajuster mes alertes", url: manageUrl }
      : topCount > 0
        ? { label: "Voir mes top matchs", url: radarUrl }
        : { label: `Explorer mes ${totalCount} offres`, url: radarUrl };

  const itemText = (item: DigestItem) => {
    const job = item.job;
    const title = job.title ?? "Offre";
    const company = job.company_name ? ` - ${job.company_name}` : "";
    const location = item.meta?.location ? ` (${item.meta.location})` : "";
    const date = item.meta?.freshness || item.meta?.date || "";
    const link = job.source_url || `${appBaseUrl}/jobradar/jobs/${job.id}`;
    const summary = item.summary_fr ? item.summary_fr : "";
    const lang = item.language ? ` [Langue: ${item.language}]` : "";
    const source = item.meta?.source ? ` [Source: ${item.meta.source}]` : "";
    const why = item.why && item.why.length ? `Pourquoi cette offre: ${item.why.join(", ")}` : "";
    const tags = item.tags && item.tags.length ? `Points cles: ${item.tags.join(", ")}` : "";
    const lines = [
      `- ${title}${company}${location}${lang}${source}`,
      date ? `  Publie: ${date}` : "",
      summary ? `  En bref: ${summary}` : "",
      why ? `  ${why}` : "",
      tags ? `  ${tags}` : "",
      `  Voir l'offre: ${link}`,
    ].filter(Boolean);
    return lines.join("\n");
  };

  const topText = topCount ? top.map(itemText).join("\n\n") : "- Aucun top match aujourd'hui. Voir la section Explorer ou ajuster tes alertes.";
  const exploreText = exploreCount ? explore.map(itemText).join("\n\n") : "";

  return [
    "Go4Job - JobRadar",
    "Tes offres du jour",
    statsLine,
    salutation,
    intro,
    "",
    topTitle,
    totalCount === 0 ? "Aucune offre aujourd'hui. Ajuste tes alertes pour recevoir des opportunites pertinentes." : topText,
    exploreCount ? "" : "",
    exploreCount ? exploreTitle : "",
    exploreCount ? exploreHelper : "",
    exploreCount ? exploreText : "",
    "",
    `${primaryCta.label}: ${primaryCta.url}`,
    `Gerer mes alertes: ${manageUrl}`,
    `Se desinscrire: ${unsubscribeUrl}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
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

async function logStatus(
  supabase: ReturnType<typeof createClient>,
  payload: {
    user_id?: string | null;
    to_email: string;
    channel: string;
    digest_date: string;
    status: string;
    provider?: string;
    provider_id?: string | null;
    error?: string | null;
  },
) {
  await supabase
    .from("notification_logs")
    .upsert(payload, { onConflict: "to_email,channel,digest_date" });
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
  const targetEmail = clean(body.target_email);
  const targetUserId = clean(body.target_user_id);
  const hasTarget = Boolean(targetEmail || targetUserId);
  const digestDate = body.date_yyyy_mm_dd && /^\d{4}-\d{2}-\d{2}$/.test(body.date_yyyy_mm_dd)
    ? body.date_yyyy_mm_dd
    : new Date().toISOString().slice(0, 10);

  const resendKey = clean(Deno.env.get("RESEND_API_KEY"));
  const resendFrom = clean(Deno.env.get("RESEND_FROM"));
  const resendReplyTo = clean(Deno.env.get("RESEND_REPLY_TO"));
  const appBaseUrl = clean(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com/";

  if (!resendKey || !resendFrom) {
    return json(500, { ok: false, error: "missing_resend_config" });
  }

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceRole = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRole) {
    return json(500, { ok: false, error: "missing_supabase_env" });
  }
  const functionsBase = supabaseUrl.replace(/\/$/, "") + "/functions/v1";

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  const { data: jobsData, error: jobsErr } = await supabase
    .from("jobs")
    .select(`
      id, title, company_name, location, country, remote_type,
      published_at, posted_at, scraped_at, created_at, updated_at,
      description_text, description_html, official_desc,
      tags, job_skills, required_skills, optional_skills,
      experience_years_min, experience_years_max,
      source_url, external_id,
      ai_description, ai_description_status, ai_description_quality,
      ai_description_model, ai_description_error, ai_description_updated_at
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
        .join(" "),
    );
    jobHay.set(j.id, hay);
  }

  const users: Array<{ id: string; email: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> }> = [];
  const perPage = 500;
  let page = 1;
  const targetEmailLower = targetEmail.toLowerCase();

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return json(500, { ok: false, error: "users_fetch_failed", message: error.message });
    const batch = data?.users ?? [];
    for (const u of batch) {
      if (u.email && u.email_confirmed_at) {
        if (targetUserId && u.id !== targetUserId) continue;
        if (targetEmailLower && (u.email ?? "").toLowerCase() !== targetEmailLower) continue;
        users.push({ id: u.id, email: u.email, email_confirmed_at: u.email_confirmed_at, user_metadata: u.user_metadata });
        if ((limitUsers && users.length >= limitUsers) || (hasTarget && users.length >= 1)) break;
      }
    }
    if ((limitUsers && users.length >= limitUsers) || (hasTarget && users.length >= 1)) break;
    if (batch.length < perPage) break;
    page += 1;
  }

  if (hasTarget && users.length === 0) {
    return json(404, { ok: false, error: "target_user_not_found" });
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

    const { data: prefs } = await supabase
      .from("notification_prefs")
      .select("digest_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (prefs && prefs.digest_enabled === false) {
      await logStatus(supabase, {
        user_id: user?.id ?? null,
        to_email: toEmail,
        channel: "email",
        digest_date: digestDate,
        status: "skipped",
        provider: "resend",
        error: "unsubscribed",
      });
      stats.skipped += 1;
      continue;
    }

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

    const kwDisplay = new Map<string, string>();
    for (const raw of cappedAlertKeywords) {
      const c = canonicalize(raw).toLowerCase();
      if (c && !kwDisplay.has(c)) kwDisplay.set(c, raw);
    }
    for (const raw of cvSkills) {
      const c = canonicalize(raw).toLowerCase();
      if (c && !kwDisplay.has(c)) kwDisplay.set(c, raw);
    }

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
        const reasons: string[] = [];
        for (const k of kwAlerts) if (k && hay.includes(k)) {
          sAlert += 1;
          reasons.push(kwDisplay.get(k) ?? k);
        }
        for (const k of kwCv) if (k && hay.includes(k)) {
          sCv += 1;
          reasons.push(kwDisplay.get(k) ?? k);
        }
        const why = uniq(reasons).slice(0, 4);

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

        return { job, p, s: sAlert + sCv, why };
      })
      .filter(Boolean) as Array<{ job: JobRow; p: number; s: number; why: string[] }>;

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

    let seen = new Set<string>();
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

    let allItems = [...selectedTop, ...selectedExplore];

    if (allItems.length === 0) {
      seen = new Set<string>();
      const fallback = jobs
        .filter((job) => {
          if (!allowAllCountries) {
            const jc = (job.country ?? "").trim().toUpperCase();
            if (jc && jc.length === 2 && !allowedCountries.has(jc)) return false;
          }
          return true;
        })
        .sort((a, b) => getJobTimeMs(b) - getJobTimeMs(a))
        .slice(0, MAX_ITEMS);

      if (fallback.length > 0) {
        selectedTop = [];
        selectedExplore = dedup(fallback);
        allItems = [...selectedExplore];
      }
    }

    const reasonsByJobId = new Map<string, string[]>();
    for (const m of exploreMatches) {
      if (m?.job?.id && m?.why?.length) reasonsByJobId.set(m.job.id, m.why);
    }

    stats.emails_planned += 1;

    const subject = "Go4Job \u2014 Tes offres du jour";
    const topCount = selectedTop.length;
    const exploreCount = selectedExplore.length;
    const totalCount = topCount + exploreCount;
    const preview = totalCount === 0
      ? "Aucune offre aujourd\u2019hui. Ajuste tes alertes pour plus d\u2019opportunit\u00E9s."
      : `${topCount} top match${topCount > 1 ? "s" : ""} \u00B7 ${exploreCount} \u00E0 explorer`;
    const introText = totalCount === 0
      ? `${salutation}\nAucune offre aujourd\u2019hui pour tes crit\u00E8res. Ajuste tes alertes pour recevoir des opportunit\u00E9s plus proches de ton profil.`
      : `${salutation}\nVoici ta synth\u00E8se du jour : ${topCount} top match${topCount > 1 ? "s" : ""} et ${exploreCount} \u00E0 explorer.\nChaque offre est filtr\u00E9e selon ton profil et r\u00E9sum\u00E9e en fran\u00E7ais pour gagner du temps.`;
    const introHtml = totalCount === 0
      ? `${salutation}<br/>Aucune offre aujourd\u2019hui pour tes crit\u00E8res. Ajuste tes alertes pour recevoir des opportunit\u00E9s plus proches de ton profil.`
      : `${salutation}<br/>Voici ta synth\u00E8se du jour : <b>${topCount} top match${topCount > 1 ? "s" : ""}</b> et <b>${exploreCount} \u00E0 explorer</b>.<br/>Chaque offre est filtr\u00E9e selon ton profil et r\u00E9sum\u00E9e en fran\u00E7ais pour gagner du temps.`;
    const unsubToken = await sign(cronSecret, `unsubscribe:${user.id}`);
    const unsubscribeUrl = `${functionsBase}/unsubscribe?uid=${encodeURIComponent(user.id)}&t=${encodeURIComponent(unsubToken)}`;

    const html = buildEmailHtml({
      salutation,
      preview,
      intro: introHtml,
      topTitle: "Top matchs (\u2265 65)",
      exploreTitle: "Explorer (50\u201364)",
      exploreHelper: "Tu peux aussi explorer ces opportunit\u00E9s proches de ton profil.",
      top: buildItems(selectedTop, reasonsByJobId),
      explore: buildItems(selectedExplore, reasonsByJobId),
      appBaseUrl,
      unsubscribeUrl,
    });
    const text = buildEmailText({
      salutation,
      intro: introText,
      topTitle: "Top matchs (\u2265 65)",
      exploreTitle: "Explorer (50\u201364)",
      exploreHelper: "Tu peux aussi explorer ces opportunit\u00E9s proches de ton profil.",
      top: buildItems(selectedTop, reasonsByJobId),
      explore: buildItems(selectedExplore, reasonsByJobId),
      appBaseUrl,
      unsubscribeUrl,
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
        text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    let data: any = {};
    try { data = await resp.json(); } catch { data = {}; }

    if (!resp.ok) {
      await logStatus(supabase, {
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

    await logStatus(supabase, {
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
