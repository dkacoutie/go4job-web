import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type DigestBody = {
  limit_users?: number | null;
  dry_run?: boolean | null;
  date_yyyy_mm_dd?: string | null;
  target_email?: string | null;
  target_user_id?: string | null;
  variant?: "default" | "non_paying_desired_role" | null;
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
  job_family?: string | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
  source_url?: string | null;
  apply_url?: string | null;
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
  badge?: string | null;
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
const TOP_MIN = 70;
const SIMPLE_MIN = 20;
const DATA_QUALITY_MIN = 0.6;
const JOB_LIMIT = 600;
const AI_DESC_MIN_QUALITY = 0.65;
const SUMMARY_MAX_SENTENCES = 2;
const SUMMARY_MAX_CHARS = 220;
const WHY_MAX_LEN = 72;

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

const GENERIC_TITLE_TOKENS = new Set([
  "assistant",
  "officer",
  "agent",
  "manager",
  "associate",
  "specialist",
  "coordinator",
  "generalist",
  "intern",
  "internship",
  "stage",
]);

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  finance: ["finance", "financial", "budget", "budgetaire", "comptabilite", "accounting", "audit", "treasury", "controle", "reporting"],
  operations: ["operations", "operational", "exploitation", "logistique", "logistics", "procurement", "achats", "supply", "inventory", "maintenance"],
  administration: ["administration", "administratif", "assistant", "office", "secretariat", "coordination", "support"],
  project: ["project", "projet", "programme", "pmo", "chef de projet"],
  data: ["data", "analytics", "bi", "sql", "power bi", "tableau"],
  engineering: ["developer", "software", "engineer", "it", "cloud", "network", "devops"],
  marketing: ["marketing", "communication", "brand", "media", "pr", "relations presse", "digital"],
  sales: ["sales", "vente", "commercial", "business development", "bd"],
  legal: ["legal", "juridique", "compliance", "contract"],
  health: ["health", "sante", "medical", "pharmacy", "clinique", "hospital"],
};

const PROFILE_EXPANSIONS: Array<{ triggers: string[]; add: string[] }> = [
  {
    triggers: ["evenement", "event", "eventiel", "evenementiel"],
    add: ["conference", "press conference", "relations presse", "pr", "media", "logistique", "coordination"],
  },
  {
    triggers: ["communication", "relations presse", "pr"],
    add: ["press", "public relations", "media"],
  },
  {
    triggers: ["budget", "budgetaire", "finance", "financial"],
    add: ["budgeting", "reporting", "controle", "control", "treasury"],
  },
];

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

function keyify(input: string) {
  return canonicalize(input).replace(/[^a-z0-9]+/g, " ").trim();
}

function humanizeAlertKeyword(input: string) {
  const key = keyify(input);
  if (!key) return input;
  if (key === "ngo" || key === "ong" || ((key.includes("ngo") || key.includes("ong")) && (key.includes("programme") || key.includes("program")))) {
    return "ONG / programmes";
  }
  if (key.includes("monitoring") || key.includes("evaluation") || key.includes("m e") || key.includes("suivi evaluation")) {
    return "suivi-évaluation";
  }
  if ((key.includes("administration") || key.includes("admin")) && (key.includes("operation") || key.includes("operations") || key.includes("ops"))) {
    return "administration / opérations";
  }
  if (key.includes("data") && (key.includes("analyse") || key.includes("analytics") || key.includes("analyst"))) {
    return "data / analyse";
  }
  if (key === "data" || key === "analyse" || key === "analysis") return "data / analyse";
  return input;
}

function humanizeSkillLabel(input: string) {
  const key = keyify(input);
  if (!key) return input;
  if (key.includes("analyse des ecarts")) return "analyse des écarts";
  if (key.includes("parties prenantes")) return "gestion des parties prenantes";
  if (key.includes("appel d offres") || key.includes("appels d offres")) return "appels d’offres";
  if (key.includes("gestion budgetaire")) return "gestion budgétaire";
  if (key.includes("tresorerie")) return "gestion de trésorerie";
  if (key.includes("coordination de projets") || key.includes("coordination projet")) return "coordination de projets";
  if (key.includes("reporting financier")) return "reporting financier";
  if (key.includes("excel")) return "excel avancé";
  if (key.includes("powerpoint")) return "powerpoint";
  if (key.includes("sap")) return "SAP";
  if (key.includes("fournisseurs")) return "gestion des fournisseurs";
  if (key.includes("achats") || key.includes("approvisionnements")) return "achats / approvisionnements";
  if (key.includes("pilotage financier") || key.includes("suivi de performance")) return "pilotage financier";
  if (key.includes("conformite") || key.includes("compliance") || key.includes("audit")) return "conformité & audits";
  if (key.includes("management d equipe") || key.includes("management d equipes") || key.includes("team management")) {
    return "management d’équipe";
  }
  return input;
}

function pickDescText(job: JobRow): string {
  return (
    clean(job.official_desc) ||
    clean(job.description_text) ||
    clean(job.ai_description) ||
    clean(stripHtml(job.description_html ?? ""))
  );
}

function buildProfileTokens(alertKeywords: string[], cvSkills: string[]): string[] {
  const raw = uniq([...alertKeywords, ...cvSkills]).map((x) => canonicalize(x)).filter(Boolean);
  const phrases = raw.filter((p) => p.length >= 3);
  const words = raw.flatMap((p) => p.split(/\s+/).filter(Boolean));
  const tokens = uniq([...phrases, ...words]).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  return tokens.slice(0, 80);
}

function expandProfileTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const rule of PROFILE_EXPANSIONS) {
      if (rule.triggers.some((tr) => t.includes(tr))) {
        rule.add.forEach((a) => out.add(canonicalize(a)));
      }
    }
  }
  return Array.from(out).filter((t) => t && t.length >= 3 && !STOP_WORDS.has(t));
}

function isGenericToken(token: string): boolean {
  const t = canonicalize(token);
  if (!t) return false;
  if (GENERIC_TITLE_TOKENS.has(t)) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => GENERIC_TITLE_TOKENS.has(p));
}

function tokenWeight(token: string): number {
  return isGenericToken(token) ? 0.5 : 1;
}

function computeTokenScore(tokens: string[], text: string) {
  if (!tokens.length || !text) {
    return { score: 0, matched: [] as string[] };
  }
  let matchedWeight = 0;
  let totalWeight = 0;
  const matched: string[] = [];
  for (const token of tokens) {
    const w = tokenWeight(token);
    totalWeight += w;
    if (text.includes(token)) {
      matchedWeight += w;
      matched.push(token);
    }
  }
  const score = totalWeight ? matchedWeight / totalWeight : 0;
  return { score, matched: uniq(matched) };
}

function scoreDomains(text: string) {
  const scores: Record<string, number> = {};
  const t = canonicalize(text);
  for (const [domain, keys] of Object.entries(DOMAIN_KEYWORDS)) {
    let hit = 0;
    for (const key of keys) {
      if (t.includes(canonicalize(key))) hit += 1;
    }
    if (hit > 0) scores[domain] = hit;
  }
  return scores;
}

function pickTopDomains(scores: Record<string, number>, max = 3) {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([d]) => d);
}

function pickPrimaryDomain(scores: Record<string, number>): string | null {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  if (sorted[0][1] <= 0) return null;
  return sorted[0][0];
}

function isGenericTitle(title: string): boolean {
  const t = canonicalize(title);
  if (!t) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length <= 2 && parts.every((p) => GENERIC_TITLE_TOKENS.has(p))) return true;
  if (parts.length === 1 && GENERIC_TITLE_TOKENS.has(parts[0])) return true;
  if (t.length <= 7) return true;
  return false;
}

function computeLayerWeights(jobIsSparse: boolean, metaConsidered: boolean, descConsidered: boolean) {
  const base = jobIsSparse
    ? { title: 0.55, meta: 0.35, desc: 0.1 }
    : { title: 0.3, meta: 0.3, desc: 0.4 };
  const weights = { ...base };
  if (!metaConsidered) weights.meta = 0;
  if (!descConsidered) weights.desc = 0;
  const total = weights.title + weights.meta + weights.desc || 1;
  return {
    title: weights.title / total,
    meta: weights.meta / total,
    desc: weights.desc / total,
  };
}

function computeDataQuality(job: JobRow) {
  const desc = pickDescText(job);
  const descLen = desc.length;
  const hasTags = (job.tags ?? []).length > 0;
  const hasSkills =
    (job.job_skills ?? []).length > 0 ||
    (job.required_skills ?? []).length > 0 ||
    (job.optional_skills ?? []).length > 0;
  const hasLocation = Boolean(clean(job.location) || clean(job.country));
  const hasTitle = Boolean(clean(job.title));
  const hasRemote = Boolean(clean(job.remote_type));

  const descScore = Math.min(1, descLen / 800);
  let score = 0;
  score += descScore * 0.45;
  score += hasSkills ? 0.2 : 0;
  score += hasTags ? 0.1 : 0;
  score += hasLocation ? 0.1 : 0;
  score += hasTitle ? 0.1 : 0;
  score += hasRemote ? 0.05 : 0;
  score = Math.min(1, Math.max(0, score));

  return {
    score,
    desc_len: descLen,
    job_is_sparse: descLen < 350,
    has_tags: hasTags,
    has_skills: hasSkills,
    has_location: hasLocation,
    has_title: hasTitle,
    has_remote: hasRemote,
  };
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

function extractDesiredRole(profile: Record<string, unknown> | null): string | null {
  const onboarding = profile?.["jobradar_onboarding"];
  if (!onboarding || typeof onboarding !== "object" || Array.isArray(onboarding)) return null;
  const onboardingProfile = (onboarding as Record<string, unknown>)["profile"];
  if (!onboardingProfile || typeof onboardingProfile !== "object" || Array.isArray(onboardingProfile)) return null;
  const desiredRole = clean(String((onboardingProfile as Record<string, unknown>)["desiredRole"] ?? ""));
  return desiredRole ? collapseWhitespace(desiredRole) : null;
}

function desiredRoleForCopy(desiredRole: string | null): string | null {
  if (!desiredRole) return null;
  const normalized = collapseWhitespace(desiredRole).replace(/[.,;:!?]+$/g, "");
  if (!normalized) return null;
  return clampText(normalized, 48);
}

function buildDigestCopy(params: {
  variant: "default" | "non_paying_desired_role";
  desiredRole: string | null;
  totalCount: number;
}) {
  const { variant, desiredRole, totalCount } = params;
  const roleLabel = desiredRoleForCopy(desiredRole);
  const fallback = {
    subject: "JobRadar — Tes meilleures opportunités du jour",
    preview: totalCount === 0
      ? "Aucune offre aujourd'hui. Ajuste tes alertes pour demain."
      : "Tes meilleures opportunités du jour, sélectionnées pour toi.",
    introText: "Sélectionnées selon tes alertes et ton profil.",
  };

  if (variant !== "non_paying_desired_role" || !roleLabel) return fallback;

  return {
    subject: `JobRadar — Des opportunités ${roleLabel} pour toi`,
    preview: totalCount === 0
      ? `Pas encore d'offre ${roleLabel} aujourd'hui. On continue la veille pour toi.`
      : `Des opportunités ${roleLabel} sélectionnées pour toi aujourd'hui.`,
    introText: totalCount === 0
      ? `Ta veille ${roleLabel} reste active pour les prochaines opportunités.`
      : `Sélectionnées pour ton objectif ${roleLabel}.`,
  };
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

function shortenReasonValue(value: string, maxLen: number) {
  const cleaned = collapseWhitespace(value);
  if (cleaned.length <= maxLen) return cleaned;
  const separators = [" / ", " - ", " | ", ", "];
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const part = cleaned.split(sep)[0]?.trim();
      if (part && part.length <= maxLen) return part;
    }
  }
  const cut = cleaned.slice(0, maxLen + 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= Math.max(10, maxLen - 12)) return cut.slice(0, lastSpace).trim() + "...";
  return cleaned.slice(0, maxLen).trim() + "...";
}

function fitReason(prefix: string, value?: string | null, suffix = "") {
  if (!value) return null;
  const base = collapseWhitespace(value);
  if (!base) return null;
  const budget = Math.max(12, WHY_MAX_LEN - prefix.length - suffix.length - 2);
  const trimmed = shortenReasonValue(base, budget);
  const out = `${prefix} ${trimmed}${suffix}`.trim();
  return out.length <= WHY_MAX_LEN ? out : null;
}

function pickLocationLabel(job: JobRow) {
  const remote = labelRemoteType(job.remote_type);
  if (remote) return remote;
  const loc = clean(job.location);
  if (loc && loc.length > 2) return loc;
  const country = clean(job.country);
  if (country && country.length > 2) return country;
  return null;
}

function pickAlertKeywordMatch(
  matchedTokens: string[],
  kwAlerts: string[],
  kwDisplay: Map<string, string>,
) {
  for (const token of matchedTokens) {
    if (!kwAlerts.includes(token)) continue;
    const display = kwDisplay.get(token);
    if (display) return display;
  }
  return null;
}

function pickCvSkillMatch(kwCv: string[], hay: string, kwDisplay: Map<string, string>) {
  for (const token of kwCv) {
    if (!token || !hay.includes(token)) continue;
    const display = kwDisplay.get(token);
    if (display) return display;
  }
  return null;
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

function buildJobLink(appUrl: string, job: JobRow): string {
  const base = appUrl.replace(/\/$/, "");
  const src = clean(job.apply_url) || clean(job.source_url);
  const srcParam = src ? `?src=${encodeURIComponent(src)}` : "";
  return `${base}/jobradar/jobs/${job.id}${srcParam}`;
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

function buildItems(list: JobRow[], reasonsByJobId?: Map<string, string[]>, badgeLabel?: string | null): DigestItem[] {
  return list.map((job) => {
    const baseText =
      clean(job.description_text) ||
      clean(stripHtml(job.description_html ?? "")) ||
      clean(job.official_desc) ||
      clean(job.title) ||
      "";
    const language = baseText ? detectLanguage(baseText) : null;
    const summary = clampText(buildSummaryFr(job), SUMMARY_MAX_CHARS);

    const dateCandidate = job.published_at || job.posted_at || job.scraped_at || job.created_at || job.updated_at;
    const meta = {
      remote: labelRemoteType(job.remote_type),
      location: clean(job.location) || clean(job.country) || null,
      date: dateCandidate ? formatDateFr(dateCandidate) : null,
      freshness: dateCandidate ? formatFreshness(dateCandidate) : null,
      source: sourceLabel(job),
    };

    const why = (reasonsByJobId?.get(job.id) ?? []).map((w) => shortLabel(w)).slice(0, 2);

    return {
      job,
      summary_fr: summary,
      language,
      why: why.length ? why : undefined,
      badge: badgeLabel ?? null,
      meta,
    };
  });
}

function buildEmailHtml(params: {
  salutation: string;
  preview: string;
  introText: string;
  topTitle: string;
  exploreTitle: string;
  exploreHelper: string;
  top: DigestItem[];
  explore: DigestItem[];
  appBaseUrl: string;
  unsubscribeUrl: string;
  alertCount: number;
}) {
  const { preview, introText, topTitle, exploreTitle, exploreHelper, top, explore, appBaseUrl, unsubscribeUrl, alertCount, salutation } = params;
  const appUrl = appBaseUrl.replace(/\/$/, "");
  const radarUrl = `${appUrl}/jobradar`;
  const manageUrl = `${appUrl}/jobradar/alerts`;
  const topCount = top.length;
  const exploreCount = explore.length;
  const totalCount = topCount + exploreCount;
  const alertsLabel = `${alertCount} alerte${alertCount > 1 ? "s" : ""} active${alertCount > 1 ? "s" : ""}`;
  const topLabel = `${topCount} offre${topCount > 1 ? "s" : ""} recommandée${topCount > 1 ? "s" : ""}`;
  const newLabel = `${totalCount} nouvelle${totalCount > 1 ? "s" : ""} offre${totalCount > 1 ? "s" : ""}`;
  const summaryLine = `${alertsLabel} \u2022 ${topLabel} \u2022 ${newLabel}`;

  const primaryCta = { label: "Voir mes meilleures offres", url: radarUrl };

  const badge = (text: string, strong = false) =>
    `<span style="display:inline-block;background:${strong ? EMAIL_COLORS.brand : EMAIL_COLORS.badgeBg};color:${strong ? EMAIL_COLORS.white : EMAIL_COLORS.brand};border:1px solid ${strong ? EMAIL_COLORS.brand : EMAIL_COLORS.border};padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:800;white-space:nowrap;">${escapeHtml(text)}</span>`;

  const whyList = (items?: string[]) => {
    if (!items || items.length === 0) return "";
    const out = items
      .slice(0, 2)
      .map((x) => `<li style="margin:0 0 4px 0;">${escapeHtml(x)}</li>`)
      .join("");
    return `
      <div style="margin-top:10px;">
        <div style="font-size:12px;font-weight:800;color:${EMAIL_COLORS.text};margin-bottom:6px;">Pourquoi cette offre ?</div>
        <ul style="margin:0;padding-left:18px;color:${EMAIL_COLORS.muted};font-size:12.5px;line-height:1.5;">
          ${out}
        </ul>
      </div>
    `;
  };

  const itemHtml = (item: DigestItem, showWhy: boolean) => {
    const job = item.job;
    const title = escapeHtml(job.title ?? "Offre");
    const link = buildJobLink(appUrl, job);
    const company = job.company_name ? escapeHtml(job.company_name) : "";
    const metaLine = [company, item.meta?.location ?? null, item.meta?.remote ?? null].filter(Boolean).join(" \u00B7 ");
    const badgeHtml = item.badge ? badge(item.badge, item.badge === "Recommandée") : "";

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid ${EMAIL_COLORS.border};border-radius:12px;overflow:hidden;background:${EMAIL_COLORS.white};">
        <tr>
          <td style="padding:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:16px;font-weight:800;color:${EMAIL_COLORS.text};line-height:1.35;">
                  <a href="${link}" style="color:${EMAIL_COLORS.text};text-decoration:none;">${title}</a>
                </td>
                <td align="right" style="white-space:nowrap;padding-left:10px;">${badgeHtml}</td>
              </tr>
            </table>
            ${metaLine ? `<div style="margin-top:6px;font-size:13px;color:${EMAIL_COLORS.muted};">${escapeHtml(metaLine)}</div>` : ""}
            ${showWhy ? whyList(item.why) : ""}
            <div style="margin-top:12px;">
              <a href="${link}" style="display:inline-block;background:${EMAIL_COLORS.brand};color:${EMAIL_COLORS.white};text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:800;font-size:12.5px;">Voir l\u2019offre</a>
            </div>
          </td>
        </tr>
      </table>
    `;
  };

  const topEmptyHtml = `
    <div style="padding:14px;border:1px dashed ${EMAIL_COLORS.border};border-radius:12px;background:${EMAIL_COLORS.white};color:${EMAIL_COLORS.muted};font-size:13px;line-height:1.55;">
      Aucune offre recommandée aujourd\u2019hui, mais tu peux explorer d\u2019autres offres ci-dessous.
    </div>
  `;

  const allEmptyHtml = `
    <div style="padding:16px;border:1px solid ${EMAIL_COLORS.border};border-radius:12px;background:${EMAIL_COLORS.white};color:${EMAIL_COLORS.text};font-size:13px;line-height:1.55;">
      <div style="font-weight:800;">Aucune offre aujourd\u2019hui.</div>
      <div style="margin-top:6px;color:${EMAIL_COLORS.muted};">Ajuste tes alertes pour recevoir plus d\u2019opportunit\u00E9s pertinentes.</div>
    </div>
  `;

  const topHtml = topCount ? top.map((item) => itemHtml(item, true)).join("") : topEmptyHtml;
  const exploreHtml = exploreCount ? explore.map((item) => itemHtml(item, false)).join("") : "";
  const profileUrl = `${appUrl}/jobradar/profile`;
  const supportUrl = `${appUrl}/contact`;

  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.bg};padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:${EMAIL_COLORS.white};border-radius:16px;border:1px solid ${EMAIL_COLORS.border};overflow:hidden;">
          <tr>
            <td style="height:6px;background:${EMAIL_COLORS.brand};line-height:6px;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:22px 24px 10px 24px;">
              <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${EMAIL_COLORS.muted};font-weight:800;">JOBRADAR</div>
              <div style="font-size:22px;font-weight:900;margin-top:6px;color:${EMAIL_COLORS.header};">Tes meilleures opportunit\u00E9s du jour</div>
              <div style="font-size:13px;color:${EMAIL_COLORS.muted};margin-top:6px;">${escapeHtml(introText)}</div>
              <div style="margin-top:10px;font-size:13px;color:${EMAIL_COLORS.text};font-weight:700;">${escapeHtml(salutation)}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 18px 24px;">
              <div style="padding:14px 16px;border:1px solid ${EMAIL_COLORS.border};border-radius:12px;background:${EMAIL_COLORS.bg};">
                <div style="font-size:13px;color:${EMAIL_COLORS.text};font-weight:700;">${summaryLine}</div>
                <div style="margin-top:12px;">
                  <a href="${primaryCta.url}" style="display:inline-block;background:${EMAIL_COLORS.brand};color:${EMAIL_COLORS.white};text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:900;font-size:13px;">
                    ${primaryCta.label}
                  </a>
                </div>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 24px 8px 24px;">
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
            <td style="padding:16px 24px;color:${EMAIL_COLORS.muted};font-size:12px;text-align:center;border-top:1px solid ${EMAIL_COLORS.border};">
              <a href="${manageUrl}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">G\u00E9rer mes alertes</a> \u00B7
              <a href="${profileUrl}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">Modifier mon profil</a> \u00B7
              <a href="${supportUrl}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;">Support</a> \u00B7
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
  introText: string;
  topTitle: string;
  exploreTitle: string;
  exploreHelper: string;
  top: DigestItem[];
  explore: DigestItem[];
  appBaseUrl: string;
  unsubscribeUrl: string;
  alertCount: number;
}) {
  const { salutation, introText, topTitle, exploreTitle, exploreHelper, top, explore, appBaseUrl, unsubscribeUrl, alertCount } = params;
  const appUrl = appBaseUrl.replace(/\/$/, "");
  const manageUrl = `${appUrl}/jobradar/alerts`;
  const radarUrl = `${appUrl}/jobradar`;
  const profileUrl = `${appUrl}/jobradar/profile`;
  const supportUrl = `${appUrl}/contact`;
  const topCount = top.length;
  const exploreCount = explore.length;
  const totalCount = topCount + exploreCount;
  const alertsLabel = `${alertCount} alerte${alertCount > 1 ? "s" : ""} active${alertCount > 1 ? "s" : ""}`;
  const topLabel = `${topCount} offre${topCount > 1 ? "s" : ""} recommandée${topCount > 1 ? "s" : ""}`;
  const newLabel = `${totalCount} nouvelle${totalCount > 1 ? "s" : ""} offre${totalCount > 1 ? "s" : ""}`;
  const summaryLine = `${alertsLabel} \u2022 ${topLabel} \u2022 ${newLabel}`;
  const primaryCta = { label: "Voir mes meilleures offres", url: radarUrl };
  const itemText = (item: DigestItem) => {
    const job = item.job;
    const title = job.title ?? "Offre";
    const company = job.company_name ? ` - ${job.company_name}` : "";
    const meta = [item.meta?.location ?? "", item.meta?.remote ?? ""].filter(Boolean).join(" - ");
    const link = buildJobLink(appUrl, job);
    const badge = item.badge ? ` [${item.badge}]` : "";
    const why = item.why && item.why.length ? `Pourquoi cette offre: ${item.why.join(", ")}` : "";
    const lines = [
      `- ${title}${badge}${company}`,
      meta ? `  ${meta}` : "",
      why ? `  ${why}` : "",
      `  Voir l'offre: ${link}`,
    ].filter(Boolean);
    return lines.join("\n");
  };

  const topText = topCount
    ? top.map(itemText).join("\n\n")
    : "- Aucune offre recommandée aujourd’hui. Consulte la section Explorer plus d’opportunités.";
  const exploreText = exploreCount ? explore.map(itemText).join("\n\n") : "";

  return [
    "JobRadar",
    "Tes meilleures opportunités du jour",
    introText,
    summaryLine,
    salutation,
    "",
    topTitle,
    totalCount === 0
      ? "Aucune offre aujourd’hui. Ajuste tes alertes pour recevoir plus d’opportunités pertinentes."
      : topText,
    exploreCount ? "" : "",
    exploreCount ? exploreTitle : "",
    exploreCount ? exploreHelper : "",
    exploreCount ? exploreText : "",
    "",
    `${primaryCta.label}: ${primaryCta.url}`,
    `Gerer mes alertes: ${manageUrl}`,
    `Modifier mon profil: ${profileUrl}`,
    `Support: ${supportUrl}`,
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
  supabase: any,
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
  const digestVariant = body.variant === "non_paying_desired_role" ? "non_paying_desired_role" : "default";
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
      tags, job_skills, required_skills, optional_skills, job_family,
      experience_years_min, experience_years_max,
      source_url, apply_url, external_id,
      ai_description, ai_description_status, ai_description_quality,
      ai_description_model, ai_description_error, ai_description_updated_at
    `)
    .eq("is_active", true)
    .or("is_expired.eq.false,is_expired.is.null")
    .or("quality_status.eq.ok,quality_status.is.null")
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
        j.job_family,
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

  const activePaidUserIds = new Set<string>();
  if (digestVariant === "non_paying_desired_role") {
    const nowIso = new Date().toISOString();
    const { data: activeSubscriptions, error: activeSubscriptionsError } = await supabase
      .from("billing_subscriptions")
      .select("user_id")
      .eq("status", "active")
      .gt("ends_at", nowIso);

    if (activeSubscriptionsError) {
      return json(500, {
        ok: false,
        error: "subscriptions_fetch_failed",
        message: activeSubscriptionsError.message,
      });
    }

    for (const sub of activeSubscriptions ?? []) {
      const userId = clean(String(sub.user_id ?? ""));
      if (userId) activePaidUserIds.add(userId);
    }
  }

  const notificationChannel = digestVariant === "non_paying_desired_role" ? "email_non_paying_digest" : "email";
  const targetedUsers = digestVariant === "non_paying_desired_role"
    ? users.filter((user) => !activePaidUserIds.has(user.id)).length
    : users.length;
  const stats = {
    digest_date: digestDate,
    variant: digestVariant,
    users_targeted: targetedUsers,
    emails_planned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  let sample: Record<string, unknown> | null = null;

  for (const user of users) {
    const toEmail = user.email;

    if (digestVariant === "non_paying_desired_role") {
      if (activePaidUserIds.has(user.id)) {
        stats.skipped += 1;
        continue;
      }
    } else {
      const { data: hasPass, error: passErr } = await supabase.rpc("has_active_pass", {
        p_user_id: user.id,
      });
      if (passErr) {
        stats.skipped += 1;
        await logStatus(supabase, {
          user_id: user?.id ?? null,
          to_email: toEmail,
          channel: notificationChannel,
          digest_date: digestDate,
          status: "skipped",
          provider: "resend",
          error: "pass_check_failed",
        });
        continue;
      }
      if (!hasPass) {
        stats.skipped += 1;
        await logStatus(supabase, {
          user_id: user?.id ?? null,
          to_email: toEmail,
          channel: notificationChannel,
          digest_date: digestDate,
          status: "skipped",
          provider: "resend",
          error: "pass_required",
        });
        continue;
      }
    }

    const { data: logExists } = await supabase
      .from("notification_logs")
      .select("id, status")
      .eq("to_email", toEmail)
      .eq("channel", notificationChannel)
      .eq("digest_date", digestDate)
      .limit(1);

    if (logExists && logExists.length > 0 && logExists[0].status === "sent") {
      stats.skipped += 1;
      continue;
    }

    let profile: Record<string, unknown> | null = null;
    const prof1 = await supabase
      .from("profiles")
      .select("first_name, display_name, full_name, jobradar_onboarding")
      .eq("id", user.id)
      .maybeSingle();
    if (prof1?.data) profile = prof1.data as Record<string, unknown>;
    if (!profile) {
      const prof2 = await supabase
        .from("profiles")
        .select("first_name, display_name, full_name, jobradar_onboarding")
        .eq("user_id", user.id)
        .maybeSingle();
      if (prof2?.data) profile = prof2.data as Record<string, unknown>;
    }

    const firstName = pickFirstName(profile, user.user_metadata ?? {});
    const desiredRole = extractDesiredRole(profile);
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
        channel: notificationChannel,
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

    const kwDisplayAlerts = new Map<string, string>();
    for (const raw of cappedAlertKeywords) {
      const cleaned = clean(raw);
      const c = canonicalize(cleaned).toLowerCase();
      if (c && !kwDisplayAlerts.has(c)) kwDisplayAlerts.set(c, humanizeAlertKeyword(cleaned));
    }
    const kwDisplayCv = new Map<string, string>();
    for (const raw of cvSkills) {
      const cleaned = clean(raw);
      const c = canonicalize(cleaned).toLowerCase();
      if (c && !kwDisplayCv.has(c)) kwDisplayCv.set(c, humanizeSkillLabel(cleaned));
    }

    const kwAlerts = uniq(cappedAlertKeywords.map((k) => canonicalize(k)).map((x) => x.toLowerCase())).filter(Boolean);
    const kwCv = uniq(cvSkills.map((k) => canonicalize(k)).map((x) => x.toLowerCase())).filter(Boolean);
    const profileTextForDomain = [cappedAlertKeywords.join(" "), cvSkills.join(" ")].filter(Boolean).join(" ");
    const profileDomainScores = scoreDomains(profileTextForDomain);
    const profileDomains = pickTopDomains(profileDomainScores, 3);
    const topProfileScore = profileDomains.length ? profileDomainScores[profileDomains[0]] ?? 0 : 0;
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
        const advancedScore = denom ? Math.round((weighted / denom) * 100) : 0;

        const dataQuality = computeDataQuality(job);
        const jobIsSparse = dataQuality.job_is_sparse;

        const profileTokens = expandProfileTokens(buildProfileTokens(cappedAlertKeywords, cvSkills));
        const titleText = canonicalize([job.title, job.company_name].filter(Boolean).join(" "));
        const metaText = canonicalize(
          [
            job.job_family,
            ...(job.tags ?? []),
            ...(job.required_skills ?? []),
            ...(job.optional_skills ?? []),
            ...(job.job_skills ?? []),
          ]
            .filter(Boolean)
            .join(" "),
        );
        const descText = canonicalize(pickDescText(job));

        const jobTextForDomain = [
          job.job_family,
          ...(job.tags ?? []),
          ...(job.required_skills ?? []),
          ...(job.optional_skills ?? []),
          ...(job.job_skills ?? []),
        ]
          .filter(Boolean)
          .join(" ");
        const jobDomainScores = scoreDomains(jobTextForDomain);
        const jobDomain = pickPrimaryDomain(jobDomainScores);
        const jobDomainScore = jobDomain ? jobDomainScores[jobDomain] ?? 0 : 0;
        const domainMatch = Boolean(jobDomain && profileDomains.includes(jobDomain));
        const strongMismatch =
          Boolean(jobDomain) && profileDomains.length > 0 && !domainMatch && jobDomainScore >= 2 && topProfileScore >= 2;

        const titleScoreRes = computeTokenScore(profileTokens, titleText);
        const metaScoreRes = metaText ? computeTokenScore(profileTokens, metaText) : { score: 0, matched: [] as string[] };
        const descScoreRes = descText ? computeTokenScore(profileTokens, descText) : { score: 0, matched: [] as string[] };

        const metaConsidered = metaText.length >= 3;
        const descConsidered = descText.length >= 50;
        const weights = computeLayerWeights(jobIsSparse, metaConsidered, descConsidered);

        let simpleScore = Math.round(
          (titleScoreRes.score * weights.title +
            (metaConsidered ? metaScoreRes.score * weights.meta : 0) +
            (descConsidered ? descScoreRes.score * weights.desc : 0)) * 100,
        );

        if (jobIsSparse && isGenericTitle(job.title ?? "") && !metaConsidered && simpleScore > 45) {
          simpleScore = 45;
        }

        if (strongMismatch) return null;

        const evidenceTitle = titleScoreRes.matched.length > 0;
        const evidenceMeta = metaScoreRes.matched.length > 0;
        const evidenceDesc = descScoreRes.matched.length > 0;
        const evidenceDomain = domainMatch;
        const evidenceExp = expOk;
        const evidenceCount = [
          evidenceTitle,
          evidenceMeta,
          evidenceDesc,
          evidenceDomain,
          evidenceExp,
        ].filter(Boolean).length;

        const sparseNeedsStrongTitle = jobIsSparse && !metaConsidered;
        const strongTitle = titleScoreRes.score >= 0.35;
        const titleVeryStrong = titleScoreRes.score >= 0.55 && !isGenericTitle(job.title ?? "");
        const effectiveEvidenceCount = evidenceCount + (titleVeryStrong && evidenceTitle ? 1 : 0);
        const passesEvidence =
          (effectiveEvidenceCount >= 2 && (!sparseNeedsStrongTitle || strongTitle)) ||
          (sparseNeedsStrongTitle && titleVeryStrong);

        if (simpleScore < SIMPLE_MIN || !passesEvidence) return null;

        if (!allowAllCountries) {
          const jc = (job.country ?? "").trim().toUpperCase();
          if (jc && jc.length === 2 && !allowedCountries.has(jc)) return null;
        }

        const reasons: string[] = [];
        const used = new Set<string>();
        const add = (text: string | null) => {
          if (!text || reasons.length >= 2) return;
          const t = collapseWhitespace(text);
          if (!t || used.has(t)) return;
          used.add(t);
          reasons.push(t);
        };

        const matchedTokens = [
          ...titleScoreRes.matched,
          ...metaScoreRes.matched,
          ...descScoreRes.matched,
        ];

        const alertKeyword = pickAlertKeywordMatch(matchedTokens, kwAlerts, kwDisplayAlerts);
        add(fitReason("Correspond à ton alerte", alertKeyword));

        const loc = pickLocationLabel(job);
        add(fitReason("Compatible avec ta recherche de postes en", loc));

        const cvSkill = pickCvSkillMatch(kwCv, hay, kwDisplayCv);
        add(fitReason("Compétences en", cvSkill, " proches du besoin"));

        if (expOk) {
          add(fitReason("Missions cohérentes avec ton expérience", job.title ?? null));
        }

        if (domainMatch) {
          add("Secteur aligné avec ton profil");
        }

        if (!reasons.length) {
          add("Profil compatible avec cette offre");
        }

        const isTopMatch = advancedScore >= TOP_MIN && dataQuality.score >= DATA_QUALITY_MIN;

        return {
          job,
          simpleScore,
          advancedScore,
          why: reasons.slice(0, 2),
          isTopMatch,
        };
      })
      .filter(Boolean) as Array<{ job: JobRow; simpleScore: number; advancedScore: number; why: string[]; isTopMatch: boolean }>;

    exploreMatches.sort((a, b) => {
      if (b.simpleScore !== a.simpleScore) return b.simpleScore - a.simpleScore;
      if (b.advancedScore !== a.advancedScore) return b.advancedScore - a.advancedScore;
      return getJobTimeMs(b.job) - getJobTimeMs(a.job);
    });

    const topMatches = exploreMatches.filter((x) => x.isTopMatch).map((x) => x.job);
    const explore = exploreMatches.filter((x) => !x.isTopMatch).map((x) => x.job);

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

    const topCount = selectedTop.length;
    const exploreCount = selectedExplore.length;
    const totalCount = topCount + exploreCount;
    const copy = buildDigestCopy({ variant: digestVariant, desiredRole, totalCount });
    const unsubToken = await sign(cronSecret, `unsubscribe:${user.id}`);
    const unsubscribeUrl = `${functionsBase}/unsubscribe?uid=${encodeURIComponent(user.id)}&t=${encodeURIComponent(unsubToken)}`;

    const html = buildEmailHtml({
      salutation,
      preview: copy.preview,
      introText: copy.introText,
      topTitle: "Offres recommandées",
      exploreTitle: "Explorer plus d\u2019opportunit\u00E9s",
      exploreHelper: "D\u00E9couvre plus d\u2019offres s\u00E9lectionn\u00E9es pour aujourd\u2019hui.",
      top: buildItems(selectedTop, reasonsByJobId, "Recommandée"),
      explore: buildItems(selectedExplore, reasonsByJobId, "Tr\u00E8s pertinent"),
      appBaseUrl,
      unsubscribeUrl,
      alertCount: alerts.length,
    });
    const text = buildEmailText({
      salutation,
      introText: copy.introText,
      topTitle: "Offres recommandées",
      exploreTitle: "Explorer plus d\u2019opportunit\u00E9s",
      exploreHelper: "D\u00E9couvre plus d\u2019offres s\u00E9lectionn\u00E9es pour aujourd\u2019hui.",
      top: buildItems(selectedTop, reasonsByJobId, "Recommandée"),
      explore: buildItems(selectedExplore, reasonsByJobId, "Tr\u00E8s pertinent"),
      appBaseUrl,
      unsubscribeUrl,
      alertCount: alerts.length,
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
        subject: copy.subject,
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
        channel: notificationChannel,
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
      channel: notificationChannel,
      digest_date: digestDate,
      status: "sent",
      provider: "resend",
      provider_id: data?.id ?? null,
    });

    stats.sent += 1;
  }

  return json(200, { ok: true, dry_run: dryRun, stats, sample });
});




