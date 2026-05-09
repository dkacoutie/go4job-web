import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type RemotePreference = "any" | "remote" | "hybrid" | "onsite";
export type CandidatePath = "role_title" | "skills_meta" | "geo_recent" | "cold_start_onboarding";
export type MatchSurface = "top_match" | "for_you" | "explore";

type JsonObject = Record<string, unknown>;

export type MatchingProfileSignalFlags = {
  has_desired_role: boolean;
  has_desired_role_fallback: boolean;
  has_alerts: boolean;
  has_geo: boolean;
  has_cv_skills: boolean;
  has_profile_skills: boolean;
  has_effective_experience: boolean;
  is_cold_start: boolean;
  alert_count: number;
  alert_keyword_count: number;
  cv_skill_count: number;
  profile_skill_count: number;
};

export type MatchingProfile = {
  user_id: string;
  desired_role: string | null;
  desired_role_fallback: string | null;
  alert_keywords_raw: string[];
  alert_keywords_norm: string[];
  alert_countries: string[];
  remote_preference: RemotePreference;
  cv_skills: string[];
  profile_skills: string[];
  experience_years_profile: number | null;
  experience_years_cv_min: number | null;
  experience_years_cv_max: number | null;
  experience_years_effective: number | null;
  experience_level: string | null;
  employment_types: string[];
  country_codes_onboarding: string[];
  work_modes_onboarding: string[];
  sectors_onboarding: string[];
  signal_flags: MatchingProfileSignalFlags;
  source_snapshot: JsonObject;
  source_hash: string;
  profile_version: number;
  schema_version: number;
  generated_at: string;
  created_at?: string;
  updated_at?: string;
};

export type MatchingProfileRecord = MatchingProfile & {
  created_at: string;
  updated_at: string;
};

export type ProfileMode = "rich" | "alerts_only" | "cv_only" | "cold_start";

export type ProfileStrategy = {
  profile_mode: ProfileMode;
  primary_surface_strategy:
    | "ranking_primary"
    | "alerts_guided_discovery"
    | "skills_family_guided_matching"
    | "recent_quality_discovery";
  fallback_reason: string | null;
};

export type CandidateJob = {
  id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  country: string | null;
  remote_type: string | null;
  contract_type: string | null;
  seniority: string | null;
  published_at: string | null;
  posted_at: string | null;
  scraped_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  description_text: string | null;
  official_desc: string | null;
  tags: string[] | string | null;
  job_skills: string[] | null;
  required_skills: string[] | null;
  optional_skills: string[] | null;
  job_family: string | null;
  experience_years_min: number | null;
  experience_years_max: number | null;
  quality_status: string | null;
  job_status?: string | null;
  is_active?: boolean | null;
  is_expired?: boolean | null;
};

export type GeneratedCandidate = {
  job: CandidateJob;
  candidate_paths: CandidatePath[];
};

export type CandidateGenerationResult = {
  candidates: GeneratedCandidate[];
  debug: {
    budgets: Record<CandidatePath, number>;
    path_counts: Record<CandidatePath, number>;
    pooled_count: number;
    fallback_applied: boolean;
  };
};

export type RoleRelation = "match" | "adjacent" | "mismatch" | "unknown";

export type JobScoreBreakdown = {
  total: number;
  title_role: number;
  title_fallback: number;
  meta: number;
  alert: number;
  skills: number;
  geo: number;
  experience: number;
  role_family: number;
  seniority_balance: number;
  quality: number;
  freshness: number;
  evidence_count: number;
  data_quality: number;
  matched_role_terms: string[];
  matched_alert_keywords: string[];
  matched_required_skills: string[];
  matched_optional_skills: string[];
  candidate_paths: CandidatePath[];
  profile_family: string | null;
  job_family_detected: string | null;
  role_relation: RoleRelation;
  penalties: string[];
  caps: string[];
  flags: {
    job_non_enriched: boolean;
    strong_underqualified: boolean;
    overqualified_operational: boolean;
    role_family_mismatch: boolean;
    explicit_geo_mismatch: boolean;
  };
};

export type MatchExplanation = {
  summary: string;
  reasons: string[];
  warnings: string[];
  breakdown: JobScoreBreakdown;
};

export type ScoredCandidate = {
  job: CandidateJob;
  score: number;
  candidate_paths: CandidatePath[];
  explanation: MatchExplanation;
  breakdown: JobScoreBreakdown;
};

export type SurfaceBuckets = {
  top_match: ScoredCandidate[];
  for_you: ScoredCandidate[];
  explore: ScoredCandidate[];
};

type RawProfileRow = {
  user_id: string;
  headline?: string | null;
  experience_years?: number | null;
  jobradar_onboarding?: Record<string, unknown> | null;
};

type RawAlertRow = {
  id?: string;
  name?: string | null;
  keywords?: string[] | null;
  country?: string | null;
  countries?: string[] | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

type RawCvRow = {
  skills?: string[] | null;
  cv_json?: Record<string, unknown> | null;
  updated_at?: string | null;
};

type RawApplicationRow = {
  job_id?: string | null;
  status?: string | null;
};

type RawFeedbackRow = {
  job_id?: string | null;
  action?: string | null;
};

type UserMatchingContext = {
  profile: RawProfileRow | null;
  alerts: RawAlertRow[];
  cv: RawCvRow | null;
  applications: RawApplicationRow[];
  feedback: RawFeedbackRow[];
  previous_matching_profile: MatchingProfileRecord | null;
};

type Taxonomy = {
  skills: Record<string, string[]>;
  roles: Record<string, string[]>;
};

const PROFILE_SCHEMA_VERSION = 1;

const ROLE_TITLE_BUDGET = 80;
const SKILLS_META_BUDGET = 80;
const GEO_RECENT_BUDGET = 60;
const COLD_START_BUDGET = 60;
const CANDIDATE_POOL_LIMIT = 220;
const RECENT_FALLBACK_LIMIT = 100;

const TOP_MATCH_LIMIT = 6;
const FOR_YOU_LIMIT = 18;
const EXPLORE_LIMIT = 24;

const GENERIC_TERMS = new Set([
  "emploi",
  "job",
  "poste",
  "role",
  "mission",
  "remote",
  "hybrid",
  "onsite",
  "teletravail",
  "hybride",
  "senior",
  "junior",
  "manager",
  "lead",
  "director",
  "assistant",
  "officer",
  "agent",
  "specialist",
  "coordinator",
  "associate",
  "responsable",
  "generalist",
]);

const STOP_WORDS = new Set([
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "un",
  "une",
  "et",
  "en",
  "a",
  "au",
  "aux",
  "pour",
  "avec",
  "sans",
  "sur",
  "dans",
  "chez",
  "ou",
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "without",
  "in",
  "on",
  "at",
  "to",
  "from",
  "poste",
  "emploi",
  "job",
  "role",
  "mission",
  "cdi",
  "cdd",
  "stage",
  "alternance",
  "remote",
  "hybrid",
  "hybride",
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
  "junior",
  "senior",
]);

const WEAK_ALERT_SINGLE_TERMS = new Set([
  "m",
  "e",
  "m e",
  "job",
  "emploi",
  "opportunity",
  "project",
  "projet",
  "budget",
  "indicator",
  "baseline",
  "assistant",
  "officer",
  "manager",
  "chef",
  "remote",
  "scrum",
  "kanban",
  "agile",
]);

const REMOTE_TERMS: Record<Exclude<RemotePreference, "any">, string[]> = {
  remote: ["remote", "teletravail", "work from home", "home based", "full remote", "100 remote"],
  hybrid: ["hybrid", "hybride", "partly remote"],
  onsite: ["onsite", "on site", "sur site", "office based", "site based"],
};

const taxonomyV1: Taxonomy = {
  skills: {
    sql: ["sql", "postgres", "postgresql", "mysql", "mssql", "sql server", "t-sql"],
    "power bi": ["power bi", "powerbi", "pbi", "dax", "power query"],
    excel: ["excel", "ms excel", "microsoft excel", "tableur", "vba"],
    tableau: ["tableau", "tableau software"],
    python: ["python", "py", "pandas", "numpy"],
    "data analysis": ["data analysis", "analyse de donnees", "analytics", "reporting"],
    javascript: ["javascript", "js", "ecmascript"],
    typescript: ["typescript", "ts"],
    react: ["react", "reactjs", "react.js"],
    "node.js": ["node", "nodejs", "node.js"],
    api: ["api", "rest", "rest api", "graphql"],
    "project management": ["project management", "gestion de projet", "gestion de projets", "pm"],
    scrum: ["scrum", "scrum master", "scrum mastering"],
    agile: ["agile", "agilite", "agile methodology", "methode agile", "kanban"],
    accounting: ["accounting", "comptabilite", "compta"],
    sales: ["sales", "vente", "ventes", "business development", "bd", "commercial"],
  },
  roles: {
    "data analyst": [
      "data analyst",
      "analyste data",
      "analyste de donnees",
      "analyste donnees",
      "bi analyst",
      "analyste bi",
    ],
    "data engineer": ["data engineer", "ingenieur data", "data pipeline engineer"],
    "frontend developer": [
      "frontend developer",
      "front-end developer",
      "developpeur front-end",
      "developpeur frontend",
    ],
    "full stack developer": ["full stack developer", "fullstack developer", "developpeur full stack"],
    "project manager": [
      "project manager",
      "chef de projet",
      "cheffe de projet",
      "pm",
      "gestionnaire de projet",
      "programme manager",
      "program manager",
    ],
    "product manager": ["product manager", "chef de produit", "product owner", "po"],
    accountant: ["accountant", "comptable", "responsable comptable"],
    "sales representative": ["sales representative", "commercial", "charge commercial", "sales exec"],
  },
};

type RoleFamilyRule = {
  id: string;
  label: string;
  terms: string[];
  adjacent: string[];
};

const ROLE_FAMILY_RULES: RoleFamilyRule[] = [
  {
    id: "data_ai",
    label: "Data / IA",
    terms: ["data analyst", "data engineer", "data", "analytics", "bi", "sql", "power bi", "tableau", "reporting"],
    adjacent: ["engineering", "finance_accounting", "project_programme"],
  },
  {
    id: "engineering",
    label: "Ingenierie / software",
    terms: ["developer", "software", "frontend", "backend", "full stack", "react", "node", "devops", "engineer"],
    adjacent: ["data_ai", "project_programme"],
  },
  {
    id: "project_programme",
    label: "Projet / programme",
    terms: ["project manager", "programme manager", "program manager", "chef de projet", "delivery", "pmo", "coordination"],
    adjacent: ["operations_supply", "data_ai", "engineering", "ngo_development"],
  },
  {
    id: "marketing_comms",
    label: "Marketing / communication",
    terms: ["marketing", "communication", "content", "social media", "brand", "growth", "relations presse"],
    adjacent: ["sales_bizdev", "ngo_development"],
  },
  {
    id: "sales_bizdev",
    label: "Sales / business development",
    terms: ["sales", "commercial", "business development", "account manager", "prospection", "crm"],
    adjacent: ["marketing_comms", "operations_supply"],
  },
  {
    id: "finance_accounting",
    label: "Finance / comptabilite",
    terms: ["finance", "accounting", "comptabilite", "audit", "treasury", "controle", "controller", "budget"],
    adjacent: ["data_ai", "operations_supply", "hr_admin"],
  },
  {
    id: "hr_admin",
    label: "RH / administration",
    terms: ["rh", "ressources humaines", "human resources", "recruitment", "talent", "administration", "office"],
    adjacent: ["operations_supply", "finance_accounting", "ngo_development"],
  },
  {
    id: "operations_supply",
    label: "Operations / logistique",
    terms: ["operations", "logistique", "procurement", "supply", "maintenance", "office manager", "coordination"],
    adjacent: ["project_programme", "hr_admin", "sales_bizdev", "finance_accounting"],
  },
  {
    id: "legal_compliance",
    label: "Legal / compliance",
    terms: ["legal", "juridique", "compliance", "contract", "governance", "statutory"],
    adjacent: ["finance_accounting", "hr_admin"],
  },
  {
    id: "ngo_development",
    label: "ONG / developpement",
    terms: ["ong", "ngo", "development", "developpement", "programme", "program", "suivi evaluation", "m e", "humanitarian"],
    adjacent: ["project_programme", "marketing_comms", "hr_admin"],
  },
];

const JOB_SELECT_FIELDS = `
  id,
  title,
  company_name,
  location,
  country,
  remote_type,
  contract_type,
  seniority,
  published_at,
  posted_at,
  scraped_at,
  created_at,
  updated_at,
  description_text,
  official_desc,
  tags,
  job_skills,
  required_skills,
  optional_skills,
  job_family,
  experience_years_min,
  experience_years_max,
  quality_status,
  job_status,
  is_active,
  is_expired
`;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIntOrNull(value: unknown): number | null {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.round(raw));
}

function normalizeText(input: string): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+.#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const cleaned = item.trim();
    const key = normalizeText(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

const COUNTRY_ALIAS_MAP: Record<string, string[]> = {
  CI: ["ci", "côte d’ivoire", "côte d'ivoire", "cote d ivoire", "cote ivoire", "ivory coast"],
  SN: ["sn", "sénégal", "senegal"],
  FR: ["fr", "france"],
  GB: ["gb", "uk", "united kingdom", "royaume uni", "angleterre"],
  US: ["us", "usa", "united states", "états-unis", "etats unis"],
  CA: ["ca", "canada"],
  BE: ["be", "belgique", "belgium"],
  CH: ["ch", "suisse", "switzerland"],
  DE: ["de", "allemagne", "germany"],
  MA: ["ma", "maroc", "morocco"],
  TN: ["tn", "tunisie", "tunisia"],
  DZ: ["dz", "algérie", "algerie", "algeria"],
  CM: ["cm", "cameroun", "cameroon"],
  BJ: ["bj", "bénin", "benin"],
  TG: ["tg", "togo"],
  BF: ["bf", "burkina", "burkina faso"],
  ML: ["ml", "mali"],
  NE: ["ne", "niger"],
  GN: ["gn", "guinée", "guinee", "guinea"],
  GH: ["gh", "ghana"],
  NG: ["ng", "nigeria"],
  KE: ["ke", "kenya"],
  RW: ["rw", "rwanda"],
  ZA: ["za", "afrique du sud", "south africa"],
};

const COUNTRY_ALIAS_INDEX = new Map<string, string>();
for (const [code, aliases] of Object.entries(COUNTRY_ALIAS_MAP)) {
  for (const alias of aliases) {
    COUNTRY_ALIAS_INDEX.set(normalizeText(alias), code);
  }
}

function getCountryAliases(countryValue: string | null | undefined): string[] {
  const raw = cleanString(countryValue);
  const code = normalizeCountryCode(raw) ?? COUNTRY_ALIAS_INDEX.get(normalizeText(raw)) ?? null;
  return code ? COUNTRY_ALIAS_MAP[code] ?? [] : [];
}

function uniqNormalized(items: string[]): string[] {
  return uniq(items.map((item) => normalizeText(canonicalizeText(item))));
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalizeText(input: string, tax: Taxonomy = taxonomyV1): string {
  let text = normalizeText(input);

  const replaceFrom = (dict: Record<string, string[]>) => {
    for (const [canonical, synonyms] of Object.entries(dict)) {
      const variants = [canonical, ...(synonyms ?? [])]
        .map((value) => normalizeText(value))
        .filter(Boolean);

      for (const variant of variants) {
        const re = new RegExp(`\\b${escapeRegExp(variant)}\\b`, "g");
        text = text.replace(re, normalizeText(canonical));
      }
    }
  };

  replaceFrom(tax.roles);
  replaceFrom(tax.skills);

  return text;
}

function normalizeKeyword(input: string): string {
  return normalizeText(canonicalizeText(input));
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return uniq(
    input
      .map((value) => cleanString(value))
      .filter(Boolean),
  );
}

function normalizeCodeArray(input: unknown): string[] {
  return uniq(
    normalizeStringArray(input)
      .map((value) => value.toUpperCase())
      .filter(Boolean),
  );
}

function parseSkillsFromHeadline(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return uniq(
    raw
      .split(/[,;\n•]/)
      .map((item) => cleanString(item))
      .filter(Boolean),
  ).slice(0, 20);
}

function extractKeywordsFromAlertName(name: string): string[] {
  const normalized = normalizeText(name);
  if (!normalized) return [];

  const phrase = normalized.replace(/\s+/g, " ").trim();
  const tokens = normalized
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.length >= 4)
    .filter((value) => !STOP_WORDS.has(value));

  return uniq([phrase, ...tokens]).filter((item) => !isWeakAlertKeyword(item)).slice(0, 5);
}

function normalizeTagList(tags: CandidateJob["tags"]): string[] {
  if (Array.isArray(tags)) {
    return uniq(tags.map((item) => cleanString(item)).filter(Boolean));
  }

  if (typeof tags === "string") {
    return uniq(
      tags
        .replace(/^\{|\}$/g, "")
        .split(/[,;|\n]/)
        .map((item) => cleanString(item.replace(/^"+|"+$/g, "")))
        .filter(Boolean),
    );
  }

  return [];
}

function parseProfileSkillsFromHeadline(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return uniq(
    raw
      .split(/[,;\n|]/)
      .map((item) => cleanString(item))
      .filter(Boolean),
  ).slice(0, 20);
}

function pickJobDescription(job: CandidateJob): string {
  return cleanString(job.official_desc) || cleanString(job.description_text);
}

function buildJobHay(job: CandidateJob): string {
  return normalizeText(
    [
      job.title,
      job.company_name,
      job.location,
      job.country,
      ...getCountryAliases(job.country),
      job.remote_type,
      job.job_family,
      pickJobDescription(job),
      ...normalizeTagList(job.tags),
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
      ...(job.job_skills ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function looksReadableJobLabel(value: string | null | undefined): boolean {
  const raw = cleanString(value);
  if (!raw) return false;
  const normalized = normalizeText(raw);
  if (!normalized) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const alphaChars = (normalized.match(/[a-z]/g) ?? []).length;
  const digitChars = (normalized.match(/[0-9]/g) ?? []).length;

  if (tokens.length >= 2 && tokens.some((token) => token.length >= 4)) return true;
  if (alphaChars >= 8 && alphaChars > digitChars * 2) return true;
  return false;
}

function hasReadableJobLabel(job: CandidateJob): boolean {
  return looksReadableJobLabel(job.title) || looksReadableJobLabel(job.company_name);
}

function getJobTimeMs(job: CandidateJob): number {
  const raw = [
    job.published_at,
    job.posted_at,
    job.scraped_at,
    job.updated_at,
    job.created_at,
  ].find(Boolean);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function stableSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableSortKeys(item));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries) out[key] = stableSortKeys(child);
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortKeys(value));
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getOnboardingState(raw: unknown): {
  desiredRole: string | null;
  countryCodes: string[];
  experienceLevel: string | null;
  employmentTypes: string[];
  workModes: string[];
  sectors: string[];
  keywords: string[];
  alertDrafts: Array<{ name?: string | null; keywords?: string[] | null; countries?: string[] | null }>;
} {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profile = source.profile && typeof source.profile === "object" ? (source.profile as Record<string, unknown>) : {};
  const preferences =
    source.preferences && typeof source.preferences === "object" ? (source.preferences as Record<string, unknown>) : {};

  const alertDrafts = Array.isArray(preferences.alertDrafts)
    ? preferences.alertDrafts
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          name: cleanString(item.name) || null,
          keywords: normalizeStringArray(item.keywords),
          countries: normalizeCodeArray(item.countries),
        }))
    : [];

  return {
    desiredRole: cleanString(profile.desiredRole) || null,
    countryCodes: normalizeCodeArray(profile.countryCodes),
    experienceLevel: cleanString(profile.experienceLevel) || null,
    employmentTypes: normalizeStringArray(profile.employmentTypes).map((item) => item.toLowerCase()),
    workModes: normalizeStringArray(preferences.workModes).map((item) => item.toLowerCase()),
    sectors: normalizeStringArray(preferences.sectors),
    keywords: normalizeStringArray(preferences.keywords),
    alertDrafts,
  };
}

function pickRemotePreference(scores: { remote: number; hybrid: number; onsite: number }): RemotePreference {
  const max = Math.max(scores.remote, scores.hybrid, scores.onsite);
  if (max <= 0) return "any";
  if (scores.remote === max && scores.remote > scores.hybrid && scores.remote > scores.onsite) return "remote";
  if (scores.hybrid === max && scores.hybrid > scores.onsite) return "hybrid";
  if (scores.onsite === max) return "onsite";
  return "any";
}

function buildRemotePreference(alerts: RawAlertRow[], workModes: string[]): RemotePreference {
  const scores = { remote: 0, hybrid: 0, onsite: 0 };

  for (const alert of alerts) {
    const text = normalizeText([alert.name, ...(alert.keywords ?? [])].filter(Boolean).join(" "));
    if (!text) continue;
    if (REMOTE_TERMS.remote.some((term) => text.includes(normalizeText(term)))) scores.remote += 1;
    if (REMOTE_TERMS.hybrid.some((term) => text.includes(normalizeText(term)))) scores.hybrid += 1;
    if (REMOTE_TERMS.onsite.some((term) => text.includes(normalizeText(term)))) scores.onsite += 1;
  }

  for (const mode of workModes) {
    if (mode === "remote") scores.remote += 2;
    if (mode === "hybrid") scores.hybrid += 2;
    if (mode === "onsite") scores.onsite += 2;
  }

  return pickRemotePreference(scores);
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  const raw = cleanString(value).toUpperCase();
  if (!raw) return null;
  if (raw === "UNKNOWN" || raw === "REMOTE" || raw === "WORLDWIDE" || raw === "GLOBAL") return null;
  return raw.length === 2 ? raw : null;
}

function isAmbiguousCountry(value: string | null | undefined): boolean {
  const raw = cleanString(value).toUpperCase();
  if (!raw) return true;
  return raw === "UNKNOWN" || raw === "REMOTE" || raw === "WORLDWIDE" || raw === "GLOBAL" || raw.length !== 2;
}

function isJobEligible(row: CandidateJob): boolean {
  if (!row?.id) return false;
  if (row.is_active === false) return false;
  if (row.is_expired === true) return false;
  const lifecycle = normalizeText(row.job_status ?? "");
  if (lifecycle && lifecycle !== "active" && lifecycle !== "stale") return false;
  const quality = normalizeText(row.quality_status ?? "");
  if (quality && quality !== "ok") return false;
  return true;
}

function tokenWeight(token: string): number {
  const normalized = normalizeText(token);
  if (!normalized) return 0;
  if (GENERIC_TERMS.has(normalized)) return 0.35;
  if (normalized.split(/\s+/).every((part) => GENERIC_TITLE_TOKENS.has(part))) return 0.5;
  return normalized.includes(" ") ? 1.5 : 1;
}

function buildRoleTerms(input: string | null | undefined): string[] {
  const normalized = normalizeKeyword(input ?? "");
  if (!normalized) return [];
  const phrase = normalized;
  const words = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !WEAK_ALERT_SINGLE_TERMS.has(token));
  return uniq([phrase, ...words]);
}

function splitAlertTerms(terms: string[]): { strong: string[]; weak: string[] } {
  const strong = terms.filter((term) => term.includes(" ") || term.length >= 10);
  const weak = terms.filter((term) => !strong.includes(term));
  return {
    strong: uniq(strong),
    weak: uniq(weak),
  };
}

function isWeakAlertKeyword(input: string): boolean {
  const normalized = normalizeKeyword(input);
  if (!normalized) return true;
  if (WEAK_ALERT_SINGLE_TERMS.has(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  if (tokens.every((token) => token.length < 3)) return true;
  if (
    tokens.every((token) =>
      token.length < 4 || STOP_WORDS.has(token) || GENERIC_TERMS.has(token) || WEAK_ALERT_SINGLE_TERMS.has(token)
    )
  ) {
    return true;
  }

  return false;
}

function computeWeightedCoverage(terms: string[], text: string): { coverage: number; matched: string[] } {
  if (!terms.length || !text) return { coverage: 0, matched: [] };

  let totalWeight = 0;
  let matchedWeight = 0;
  const matched: string[] = [];

  for (const term of terms) {
    const weight = tokenWeight(term);
    totalWeight += weight;
    if (weight <= 0) continue;
    if (text.includes(term)) {
      matchedWeight += weight;
      matched.push(term);
    }
  }

  return {
    coverage: totalWeight > 0 ? matchedWeight / totalWeight : 0,
    matched: uniq(matched),
  };
}

function detectRoleFamily(texts: string[]): { family: string | null; label: string | null; contenders: string[]; score: number } {
  const hay = normalizeText(texts.filter(Boolean).join(" "));
  if (!hay) return { family: null, label: null, contenders: [], score: 0 };

  const scores = new Map<string, number>();

  for (const rule of ROLE_FAMILY_RULES) {
    let score = 0;
    for (const term of rule.terms) {
      const normalized = normalizeText(term);
      if (!normalized) continue;
      if (hay.includes(normalized)) score += normalized.includes(" ") ? 2 : 1;
    }
    if (score > 0) scores.set(rule.id, score);
  }

  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { family: null, label: null, contenders: [], score: 0 };

  const primary = ROLE_FAMILY_RULES.find((rule) => rule.id === sorted[0][0]) ?? null;
  const contenders = sorted
    .filter(([, value]) => value >= Math.max(1, sorted[0][1] - 1))
    .slice(0, 3)
    .map(([id]) => id);

  return {
    family: primary?.id ?? null,
    label: primary?.label ?? null,
    contenders,
    score: sorted[0][1],
  };
}

function relateRoleFamilies(profileFamily: string | null, jobFamily: string | null): RoleRelation {
  if (!profileFamily || !jobFamily) return "unknown";
  if (profileFamily === jobFamily) return "match";
  const rule = ROLE_FAMILY_RULES.find((item) => item.id === profileFamily);
  if (rule?.adjacent.includes(jobFamily)) return "adjacent";
  return "mismatch";
}

function computeDataQuality(job: CandidateJob): number {
  const desc = pickJobDescription(job);
  const descScore = Math.min(1, desc.length / 800);
  const hasSkills =
    (job.job_skills?.length ?? 0) > 0 ||
    (job.required_skills?.length ?? 0) > 0 ||
    (job.optional_skills?.length ?? 0) > 0;
  const hasTitle = Boolean(cleanString(job.title));
  const hasLocation = Boolean(cleanString(job.location) || cleanString(job.country));
  const hasRemote = Boolean(cleanString(job.remote_type));
  const hasFamily = Boolean(cleanString(job.job_family));

  let score = 0;
  score += descScore * 0.4;
  score += hasSkills ? 0.2 : 0;
  score += hasFamily ? 0.15 : 0;
  score += hasLocation ? 0.1 : 0;
  score += hasTitle ? 0.1 : 0;
  score += hasRemote ? 0.05 : 0;

  return Math.min(1, Math.max(0, score));
}

function classifyJobRemoteType(job: CandidateJob): RemotePreference | null {
  const text = normalizeText([job.remote_type, job.location, job.country].filter(Boolean).join(" "));
  if (!text) return null;
  if (REMOTE_TERMS.remote.some((term) => text.includes(normalizeText(term)))) return "remote";
  if (REMOTE_TERMS.hybrid.some((term) => text.includes(normalizeText(term)))) return "hybrid";
  if (REMOTE_TERMS.onsite.some((term) => text.includes(normalizeText(term)))) return "onsite";
  return null;
}

function isSoftGeoCandidate(profile: MatchingProfile, job: CandidateJob): boolean {
  const allowedCountries = uniq([
    ...profile.alert_countries,
    ...profile.country_codes_onboarding,
  ])
    .map((value) => normalizeCountryCode(value))
    .filter(Boolean) as string[];
  const jobCountry = normalizeCountryCode(job.country);
  const jobRemote = classifyJobRemoteType(job);

  if (!allowedCountries.length && profile.remote_preference === "any") return true;
  if (jobCountry && allowedCountries.includes(jobCountry)) return true;
  if (!jobCountry) return true;
  if (profile.remote_preference === "remote" && (jobRemote === "remote" || jobRemote === "hybrid")) return true;
  if (profile.remote_preference === "hybrid" && jobRemote === "hybrid") return true;
  if (profile.remote_preference === "onsite" && jobRemote === "onsite") return true;

  return false;
}

function normalizeCandidateJob(row: CandidateJob): CandidateJob {
  return {
    ...row,
    title: cleanString(row.title) || null,
    company_name: cleanString(row.company_name) || null,
    location: cleanString(row.location) || null,
    country: cleanString(row.country) || null,
    remote_type: cleanString(row.remote_type) || null,
    contract_type: cleanString(row.contract_type) || null,
    seniority: cleanString(row.seniority) || null,
    description_text: cleanString(row.description_text) || null,
    official_desc: cleanString(row.official_desc) || null,
    job_family: cleanString(row.job_family) || null,
    experience_years_min: toIntOrNull(row.experience_years_min),
    experience_years_max: toIntOrNull(row.experience_years_max),
    quality_status: cleanString(row.quality_status) || null,
    job_status: cleanString(row.job_status) || null,
  };
}

function buildCandidateRankHint(candidate: GeneratedCandidate): number {
  const pathScore = candidate.candidate_paths.reduce((sum, path) => {
    if (path === "role_title") return sum + 40;
    if (path === "skills_meta") return sum + 30;
    if (path === "cold_start_onboarding") return sum + 20;
    return sum + 10;
  }, 0);

  const ageMs = Date.now() - getJobTimeMs(candidate.job);
  const ageDays = ageMs > 0 ? ageMs / 1000 / 60 / 60 / 24 : 999;
  const freshnessScore = ageDays <= 7 ? 15 : ageDays <= 30 ? 8 : ageDays <= 90 ? 3 : 0;

  return pathScore + freshnessScore;
}

async function fetchJobsTitleOrFamilyTerms(
  supabase: SupabaseClient,
  terms: string[],
  limitPerTerm: number,
): Promise<CandidateJob[]> {
  if (!terms.length) return [];

  const queries = terms.slice(0, 3).map(async (term) => {
    const safeTerm = normalizeText(term).replace(/[%(),]/g, " ").trim();
    if (!safeTerm) return [] as CandidateJob[];

    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_SELECT_FIELDS)
      .eq("is_active", true)
      .in("job_status", ["active", "stale"])
      .or(`title.ilike.%${safeTerm}%,job_family.ilike.%${safeTerm}%`)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(limitPerTerm);

    if (error) throw error;
    return ((data ?? []) as CandidateJob[]).map(normalizeCandidateJob).filter(isJobEligible);
  });

  return (await Promise.all(queries)).flat();
}

async function fetchJobsByArrayOverlap(
  supabase: SupabaseClient,
  column: "required_skills" | "optional_skills" | "job_skills",
  values: string[],
  limit: number,
): Promise<CandidateJob[]> {
  if (!values.length) return [];

  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_SELECT_FIELDS)
    .eq("is_active", true)
    .in("job_status", ["active", "stale"])
    .overlaps(column, values.slice(0, 12))
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as CandidateJob[]).map(normalizeCandidateJob).filter(isJobEligible);
}

async function fetchRecentJobs(supabase: SupabaseClient, limit: number): Promise<CandidateJob[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_SELECT_FIELDS)
    .eq("is_active", true)
    .in("job_status", ["active", "stale"])
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as CandidateJob[]).map(normalizeCandidateJob).filter(isJobEligible);
}

function filterJobsByMetaSeeds(rows: CandidateJob[], values: string[], limit: number, minMatches = 2): CandidateJob[] {
  if (!values.length) return [];
  const normalizedSeeds = uniqNormalized(values).filter(Boolean);
  if (!normalizedSeeds.length) return [];

  return rows
    .filter((row) => {
      const hay = buildJobHay(row);
      const matches = normalizedSeeds.filter((seed) => hay.includes(seed));
      return matches.length >= Math.min(minMatches, normalizedSeeds.length);
    })
    .slice(0, limit);
}

function mergeCandidateRows(
  target: Map<string, GeneratedCandidate>,
  rows: CandidateJob[],
  path: CandidatePath,
): void {
  for (const row of rows) {
    if (!row?.id) continue;
    const current = target.get(row.id);
    if (current) {
      if (!current.candidate_paths.includes(path)) current.candidate_paths.push(path);
      continue;
    }
    target.set(row.id, { job: row, candidate_paths: [path] });
  }
}

export async function loadUserMatchingContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserMatchingContext> {
  const [
    profileRes,
    alertsRes,
    cvRes,
    applicationsRes,
    feedbackRes,
    previousMatchingProfileRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, headline, experience_years, jobradar_onboarding")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("alerts")
      .select("id, name, keywords, country, countries, is_active, created_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_cvs")
      .select("skills, cv_json, updated_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("job_id, status")
      .eq("user_id", userId)
      .limit(5000),
    supabase
      .from("job_feedback")
      .select("job_id, action")
      .eq("user_id", userId)
      .eq("action", "dismissed")
      .limit(5000),
    supabase
      .from("jobradar_matching_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (alertsRes.error) throw alertsRes.error;
  if (cvRes.error) throw cvRes.error;
  if (applicationsRes.error) throw applicationsRes.error;
  if (feedbackRes.error) throw feedbackRes.error;
  if (previousMatchingProfileRes.error) throw previousMatchingProfileRes.error;

  return {
    profile: (profileRes.data as RawProfileRow | null) ?? null,
    alerts: (alertsRes.data as RawAlertRow[] | null) ?? [],
    cv: (cvRes.data as RawCvRow | null) ?? null,
    applications: (applicationsRes.data as RawApplicationRow[] | null) ?? [],
    feedback: (feedbackRes.data as RawFeedbackRow[] | null) ?? [],
    previous_matching_profile: (previousMatchingProfileRes.data as MatchingProfileRecord | null) ?? null,
  };
}

export async function buildMatchingProfile(params: {
  userId: string;
  profile: RawProfileRow | null;
  alerts: RawAlertRow[];
  cv: RawCvRow | null;
  previousProfile?: MatchingProfileRecord | null;
  now?: string;
}): Promise<MatchingProfile> {
  const now = params.now ?? new Date().toISOString();
  const onboarding = getOnboardingState(params.profile?.jobradar_onboarding);
  const headline = cleanString(params.profile?.headline) || null;

  const desiredRole = cleanString(onboarding.desiredRole) || null;
  const desiredRoleFallback = headline;

  const alertKeywordsRaw = uniq([
    ...params.alerts.flatMap((alert) => normalizeStringArray(alert.keywords)),
    ...params.alerts.flatMap((alert) => extractKeywordsFromAlertName(alert.name ?? "")),
    ...onboarding.alertDrafts.flatMap((draft) => normalizeStringArray(draft.keywords)),
  ]).slice(0, 60);

  const alertKeywordsNorm = uniqNormalized(alertKeywordsRaw)
    .filter((item) => !isWeakAlertKeyword(item))
    .slice(0, 40);

  const alertCountries = uniq([
    ...params.alerts.flatMap((alert) => normalizeCodeArray(alert.countries)),
    ...params.alerts.flatMap((alert) => (cleanString(alert.country) ? [cleanString(alert.country).toUpperCase()] : [])),
  ])
    .filter((code) => normalizeCountryCode(code) != null)
    .slice(0, 20);

  const cvSkills = uniq(normalizeStringArray(params.cv?.skills)).slice(0, 25);
  const profileSkills = parseProfileSkillsFromHeadline(headline).slice(0, 8);

  const cvJson = params.cv?.cv_json ?? {};
  const experienceYearsCvMin = toIntOrNull(cvJson["experience_years_min"]);
  const experienceYearsCvMax = toIntOrNull(cvJson["experience_years_max"]);
  const experienceYearsProfile = toIntOrNull(params.profile?.experience_years);
  const experienceYearsEffective = experienceYearsCvMax ?? experienceYearsCvMin ?? experienceYearsProfile;

  const employmentTypes = uniq(onboarding.employmentTypes).slice(0, 8);
  const countryCodesOnboarding = uniq(onboarding.countryCodes).slice(0, 12);
  const workModesOnboarding = uniq(onboarding.workModes).slice(0, 4);
  const sectorsOnboarding = uniq(onboarding.sectors).slice(0, 8);
  const experienceLevel = onboarding.experienceLevel ?? null;
  const remotePreference = buildRemotePreference(params.alerts, workModesOnboarding);

  const signalFlags: MatchingProfileSignalFlags = {
    has_desired_role: Boolean(desiredRole),
    has_desired_role_fallback: Boolean(desiredRoleFallback),
    has_alerts: params.alerts.length > 0,
    has_geo: alertCountries.length > 0 || countryCodesOnboarding.length > 0 || remotePreference !== "any",
    has_cv_skills: cvSkills.length > 0,
    has_profile_skills: profileSkills.length > 0,
    has_effective_experience: experienceYearsEffective != null,
    is_cold_start: !desiredRole && alertKeywordsNorm.length < 2 && cvSkills.length < 3,
    alert_count: params.alerts.length,
    alert_keyword_count: alertKeywordsNorm.length,
    cv_skill_count: cvSkills.length,
    profile_skill_count: profileSkills.length,
  };

  const sourceSnapshot: JsonObject = {
    profile: {
      headline,
      experience_years: experienceYearsProfile,
    },
    onboarding: {
      desired_role: desiredRole,
      country_codes: countryCodesOnboarding,
      experience_level: experienceLevel,
      employment_types: employmentTypes,
      work_modes: workModesOnboarding,
      sectors: sectorsOnboarding,
      keywords: onboarding.keywords,
      alert_drafts: onboarding.alertDrafts,
    },
    alerts: params.alerts.map((alert) => ({
      name: cleanString(alert.name) || null,
      keywords: normalizeStringArray(alert.keywords),
      country: cleanString(alert.country).toUpperCase() || null,
      countries: normalizeCodeArray(alert.countries),
    })),
    cv: {
      skills: cvSkills,
      experience_years_min: experienceYearsCvMin,
      experience_years_max: experienceYearsCvMax,
      updated_at: cleanString(params.cv?.updated_at) || null,
    },
  };

  const sourceHash = await sha256Hex(stableStringify(sourceSnapshot));
  const previousVersion = params.previousProfile?.profile_version ?? 0;
  const profileVersion =
    params.previousProfile?.source_hash && params.previousProfile.source_hash === sourceHash
      ? Math.max(1, previousVersion)
      : Math.max(1, previousVersion + 1);

  return {
    user_id: params.userId,
    desired_role: desiredRole,
    desired_role_fallback: desiredRoleFallback,
    alert_keywords_raw: alertKeywordsRaw,
    alert_keywords_norm: alertKeywordsNorm,
    alert_countries: alertCountries,
    remote_preference: remotePreference,
    cv_skills: cvSkills,
    profile_skills: profileSkills,
    experience_years_profile: experienceYearsProfile,
    experience_years_cv_min: experienceYearsCvMin,
    experience_years_cv_max: experienceYearsCvMax,
    experience_years_effective: experienceYearsEffective,
    experience_level: experienceLevel,
    employment_types: employmentTypes,
    country_codes_onboarding: countryCodesOnboarding,
    work_modes_onboarding: workModesOnboarding,
    sectors_onboarding: sectorsOnboarding,
    signal_flags: signalFlags,
    source_snapshot: sourceSnapshot,
    source_hash: sourceHash,
    profile_version: profileVersion,
    schema_version: PROFILE_SCHEMA_VERSION,
    generated_at: now,
  };
}

export async function persistMatchingProfile(
  supabase: SupabaseClient,
  profile: MatchingProfile,
): Promise<MatchingProfileRecord> {
  const payload = {
    ...profile,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("jobradar_matching_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as MatchingProfileRecord;
}

export function classifyMatchingProfile(profile: MatchingProfile): ProfileStrategy {
  const onboardingSignalCount = [
    profile.country_codes_onboarding.length > 0,
    profile.work_modes_onboarding.length > 0,
    profile.sectors_onboarding.length > 0,
    profile.employment_types.length > 0,
    Boolean(profile.experience_level),
  ].filter(Boolean).length;

  const strongIntentSignals = [
    profile.signal_flags.has_desired_role,
    profile.signal_flags.has_cv_skills,
    profile.signal_flags.has_alerts,
    profile.signal_flags.has_effective_experience,
    onboardingSignalCount >= 2,
  ].filter(Boolean).length;

  if (profile.signal_flags.has_desired_role && strongIntentSignals >= 2) {
    return {
      profile_mode: "rich",
      primary_surface_strategy: "ranking_primary",
      fallback_reason: null,
    };
  }

  if (profile.signal_flags.has_alerts && !profile.signal_flags.has_desired_role && !profile.signal_flags.has_cv_skills) {
    return {
      profile_mode: "alerts_only",
      primary_surface_strategy: "alerts_guided_discovery",
      fallback_reason: "alert_signals_are_directional_but_not_strong_enough_for_high_confidence_top_match",
    };
  }

  if (profile.signal_flags.has_cv_skills && !profile.signal_flags.has_desired_role) {
    return {
      profile_mode: "cv_only",
      primary_surface_strategy: "skills_family_guided_matching",
      fallback_reason: "cv_skills_help_detect_domain_fit_but_role_intent_is_still_implicit",
    };
  }

  return {
    profile_mode: "cold_start",
    primary_surface_strategy: "recent_quality_discovery",
    fallback_reason: "not_enough_personalization_signals_yet_for_strong_ranking",
  };
}

export async function generateCandidates(params: {
  supabase: SupabaseClient;
  profile: MatchingProfile;
}): Promise<CandidateGenerationResult> {
  const { supabase, profile } = params;
  const alertOnlyProfile =
    profile.signal_flags.has_alerts && !profile.signal_flags.has_desired_role && !profile.signal_flags.has_cv_skills;
  const richProfile =
    profile.signal_flags.has_desired_role || profile.signal_flags.has_cv_skills || profile.signal_flags.has_alerts;
  const alertTermSets = splitAlertTerms(profile.alert_keywords_norm);
  const roleTitleBudget = profile.signal_flags.has_desired_role ? 50 : alertOnlyProfile ? 35 : ROLE_TITLE_BUDGET;
  const skillsMetaBudget = profile.signal_flags.has_cv_skills ? 120 : SKILLS_META_BUDGET;
  const geoRecentBudget = richProfile ? 30 : GEO_RECENT_BUDGET;
  const skillsSeedLimit = profile.signal_flags.has_cv_skills ? 16 : 12;

  const roleTitleTerms = uniq([
    ...buildRoleTerms(profile.desired_role),
    ...(profile.signal_flags.has_desired_role ? [] : alertTermSets.strong.slice(0, 3)),
  ]).slice(0, 5);

  const skillsMetaSeeds = uniq([
    ...profile.cv_skills,
    ...profile.profile_skills,
    ...profile.alert_keywords_norm.filter((item) => !item.includes(" ")).slice(0, 4),
  ])
    .map((item) => normalizeKeyword(item))
    .filter(Boolean)
    .slice(0, skillsSeedLimit);

  const coldStartTerms = uniq([
    ...buildRoleTerms(profile.desired_role_fallback),
    ...profile.country_codes_onboarding,
    ...profile.sectors_onboarding,
    ...profile.alert_keywords_norm.filter((item) => item.includes(" ")).slice(0, 4),
  ])
    .map((item) => normalizeKeyword(item))
    .filter((item) => item.length >= 3)
    .filter((item) => !isWeakAlertKeyword(item))
    .slice(0, 6);

  const pathCounts: Record<CandidatePath, number> = {
    role_title: 0,
    skills_meta: 0,
    geo_recent: 0,
    cold_start_onboarding: 0,
  };

  const merged = new Map<string, GeneratedCandidate>();

  const roleTitleRows = roleTitleTerms.length
    ? await fetchJobsTitleOrFamilyTerms(supabase, roleTitleTerms, roleTitleBudget)
    : [];
  mergeCandidateRows(merged, roleTitleRows, "role_title");
  pathCounts.role_title = roleTitleRows.length;

  const [requiredRows, optionalRows, jobSkillRows] = skillsMetaSeeds.length
    ? await Promise.all([
        fetchJobsByArrayOverlap(supabase, "required_skills", skillsMetaSeeds, Math.ceil(skillsMetaBudget / 2)),
        fetchJobsByArrayOverlap(supabase, "optional_skills", skillsMetaSeeds, Math.ceil(skillsMetaBudget / 2)),
        fetchJobsByArrayOverlap(supabase, "job_skills", skillsMetaSeeds, Math.ceil(skillsMetaBudget / 2)),
      ])
    : [[], [], []];

  const skillsMetaRows = uniq(
    [...requiredRows, ...optionalRows, ...jobSkillRows].map((row) => row.id),
  )
    .map((id) => [...requiredRows, ...optionalRows, ...jobSkillRows].find((row) => row.id === id)!)
    .filter(Boolean);

  mergeCandidateRows(merged, skillsMetaRows, "skills_meta");
  pathCounts.skills_meta = skillsMetaRows.length;

  const geoRecentSource = await fetchRecentJobs(supabase, Math.max(geoRecentBudget * 3, 120));
  const geoRecentRows = geoRecentSource
    .filter((job) => isSoftGeoCandidate(profile, job))
    .sort((a, b) => computeDataQuality(b) - computeDataQuality(a) || getJobTimeMs(b) - getJobTimeMs(a))
    .slice(0, geoRecentBudget);
  mergeCandidateRows(merged, geoRecentRows, "geo_recent");
  pathCounts.geo_recent = geoRecentRows.length;

  if (skillsMetaRows.length < 20) {
    const localMetaSeedValues = alertOnlyProfile
      ? uniq([...alertTermSets.strong.slice(0, 4), ...skillsMetaSeeds])
      : skillsMetaSeeds;
    const localMetaRows = filterJobsByMetaSeeds(
      geoRecentSource,
      localMetaSeedValues,
      Math.max(0, skillsMetaBudget - skillsMetaRows.length),
      alertOnlyProfile ? 1 : 2,
    );
    mergeCandidateRows(merged, localMetaRows, "skills_meta");
    pathCounts.skills_meta += localMetaRows.length;
  }

  const shouldRunColdStart =
    profile.signal_flags.is_cold_start ||
    (!profile.signal_flags.has_desired_role && !profile.signal_flags.has_cv_skills);

  const coldStartRows =
    shouldRunColdStart && coldStartTerms.length
      ? await fetchJobsTitleOrFamilyTerms(supabase, coldStartTerms, COLD_START_BUDGET)
      : [];
  mergeCandidateRows(merged, coldStartRows, "cold_start_onboarding");
  pathCounts.cold_start_onboarding = coldStartRows.length;

  let fallbackApplied = false;
  if (merged.size < 20) {
    const fallbackRows = await fetchRecentJobs(supabase, RECENT_FALLBACK_LIMIT);
    mergeCandidateRows(
      merged,
      fallbackRows
        .sort((a, b) => computeDataQuality(b) - computeDataQuality(a) || getJobTimeMs(b) - getJobTimeMs(a))
        .slice(0, geoRecentBudget),
      "geo_recent",
    );
    fallbackApplied = true;
  }

  const candidates = Array.from(merged.values())
    .sort((a, b) => {
      const aRank = buildCandidateRankHint(a);
      const bRank = buildCandidateRankHint(b);
      if (bRank !== aRank) return bRank - aRank;
      return getJobTimeMs(b.job) - getJobTimeMs(a.job);
    })
    .slice(0, CANDIDATE_POOL_LIMIT);

  return {
    candidates,
    debug: {
      budgets: {
        role_title: roleTitleBudget,
        skills_meta: skillsMetaBudget,
        geo_recent: geoRecentBudget,
        cold_start_onboarding: COLD_START_BUDGET,
      },
      path_counts: pathCounts,
      pooled_count: candidates.length,
      fallback_applied: fallbackApplied,
    },
  };
}

function detectProfileLevel(profile: MatchingProfile): "starter" | "junior" | "intermediate" | "senior" | "executive" | "unknown" {
  const raw = normalizeText(profile.experience_level ?? "");
  if (raw === "starter") return "starter";
  if (raw === "junior") return "junior";
  if (raw === "intermediate") return "intermediate";
  if (raw === "senior") return "senior";
  if (raw === "executive") return "executive";

  const exp = profile.experience_years_effective;
  if (exp == null) return "unknown";
  if (exp <= 1) return "starter";
  if (exp <= 3) return "junior";
  if (exp <= 6) return "intermediate";
  if (exp <= 10) return "senior";
  return "executive";
}

function detectJobLevel(job: CandidateJob): "starter" | "junior" | "intermediate" | "senior" | "executive" | "unknown" {
  const title = normalizeText([job.title, job.seniority].filter(Boolean).join(" "));
  const min = job.experience_years_min ?? null;
  const max = job.experience_years_max ?? null;

  if (
    title.includes("head") ||
    title.includes("director") ||
    title.includes("manager") ||
    title.includes("leadership") ||
    title.includes("chief")
  ) {
    return "executive";
  }

  if (title.includes("senior") || title.includes("lead")) return "senior";
  if (title.includes("junior") || title.includes("assistant") || title.includes("stage") || title.includes("intern")) {
    return "junior";
  }

  if (max != null && max <= 2) return "junior";
  if (min != null && min >= 6) return "senior";
  if (min != null && min >= 3) return "intermediate";
  return "unknown";
}

function computeGeoScore(profile: MatchingProfile, job: CandidateJob): { points: number; penalty?: string; reason?: string } {
  const allowedCountries = uniq([
    ...profile.alert_countries,
    ...profile.country_codes_onboarding,
  ])
    .map((value) => normalizeCountryCode(value))
    .filter(Boolean) as string[];
  const jobCountry = normalizeCountryCode(job.country);
  const jobRemote = classifyJobRemoteType(job);

  if (!allowedCountries.length && profile.remote_preference === "any") {
    return { points: 0 };
  }

  if (jobCountry && allowedCountries.includes(jobCountry)) {
    if (profile.remote_preference === "remote" && jobRemote === "onsite") {
      return { points: 3, reason: "pays cible ok, mode de travail moins ideal" };
    }
    return { points: 8, reason: "pays cible compatible" };
  }

  if (profile.remote_preference === "remote" && (jobRemote === "remote" || jobRemote === "hybrid")) {
    return { points: 6, reason: "mode remote compatible" };
  }

  if (profile.remote_preference === "hybrid" && jobRemote === "hybrid") {
    return { points: 5, reason: "mode hybride compatible" };
  }

  if (profile.remote_preference === "onsite" && jobRemote === "onsite") {
    return { points: 5, reason: "mode sur site compatible" };
  }

  if (isAmbiguousCountry(job.country)) {
    return { points: 0 };
  }

  if (allowedCountries.length && jobCountry && !allowedCountries.includes(jobCountry) && jobRemote !== "remote") {
    return { points: -4, penalty: "geo_mismatch" };
  }

  return { points: 0 };
}

function computeExperienceScore(
  profile: MatchingProfile,
  job: CandidateJob,
): { points: number; strongUnderqualified: boolean; overqualifiedOperational: boolean; reason?: string } {
  const effectiveExp = profile.experience_years_effective;
  const jobMin = job.experience_years_min ?? null;
  const jobMax = job.experience_years_max ?? null;
  const jobLevel = detectJobLevel(job);
  const profileLevel = detectProfileLevel(profile);

  let points = 0;
  let strongUnderqualified = false;
  let overqualifiedOperational = false;
  let reason: string | undefined;

  if (effectiveExp != null && (jobMin != null || jobMax != null)) {
    if (jobMin != null && effectiveExp < jobMin) {
      const gap = jobMin - effectiveExp;
      if (gap >= 3) {
        points -= 8;
        strongUnderqualified = true;
        reason = "experience en dessous du minimum fiable";
      } else if (gap === 2) {
        points -= 4;
        reason = "experience un peu en dessous";
      } else {
        points -= 1;
        reason = "experience legerement en dessous";
      }
    } else if (jobMax != null && effectiveExp > jobMax + 6) {
      if (jobLevel === "starter" || jobLevel === "junior") {
        points -= 6;
        overqualifiedOperational = true;
        reason = "poste tres operationnel pour le niveau detecte";
      }
    } else {
      points += 6;
      reason = "experience compatible";
    }
  }

  if (!strongUnderqualified) {
    if ((profileLevel === "starter" || profileLevel === "junior") && (jobLevel === "senior" || jobLevel === "executive")) {
      points -= 6;
      strongUnderqualified = true;
      reason = reason ?? "niveau du poste ambitieux pour le profil actuel";
    }

    if ((profileLevel === "senior" || profileLevel === "executive") && (jobLevel === "starter" || jobLevel === "junior")) {
      points -= 5;
      overqualifiedOperational = true;
      reason = reason ?? "poste tres junior par rapport au profil";
    }
  }

  return { points, strongUnderqualified, overqualifiedOperational, reason };
}

function computeRoleFamilyScore(profile: MatchingProfile, job: CandidateJob): {
  points: number;
  profileFamily: string | null;
  jobFamily: string | null;
  relation: RoleRelation;
} {
  const profileFamily = detectRoleFamily([
    profile.desired_role ?? "",
    ...profile.alert_keywords_norm,
    ...profile.sectors_onboarding,
    ...profile.cv_skills,
    ...profile.profile_skills,
  ]);
  const jobFamily = detectRoleFamily([
    job.job_family ?? "",
    job.title ?? "",
    ...normalizeTagList(job.tags),
    ...(job.required_skills ?? []),
    ...(job.optional_skills ?? []),
    ...(job.job_skills ?? []),
  ]);

  const relation = relateRoleFamilies(profileFamily.family, jobFamily.family);

  if (relation === "match") {
    return {
      points: 4,
      profileFamily: profileFamily.family,
      jobFamily: jobFamily.family,
      relation,
    };
  }

  if (relation === "adjacent") {
    return {
      points: 1,
      profileFamily: profileFamily.family,
      jobFamily: jobFamily.family,
      relation,
    };
  }

  if (relation === "mismatch" && profileFamily.score >= 2 && jobFamily.score >= 2) {
    return {
      points: -6,
      profileFamily: profileFamily.family,
      jobFamily: jobFamily.family,
      relation,
    };
  }

  return {
    points: 0,
    profileFamily: profileFamily.family,
    jobFamily: jobFamily.family,
    relation,
  };
}

function computeSkillsScore(
  profile: MatchingProfile,
  job: CandidateJob,
  fullText: string,
): { points: number; matchedRequired: string[]; matchedOptional: string[] } {
  const cvSkillSet = new Set(uniqNormalized(profile.cv_skills).filter(Boolean));
  const profileSkillSet = new Set(uniqNormalized(profile.profile_skills).filter(Boolean));

  const required = uniqNormalized(job.required_skills ?? []);
  const optional = uniqNormalized([...(job.optional_skills ?? []), ...(job.job_skills ?? []), ...normalizeTagList(job.tags)]);

  const matchedRequired = required.filter((item) => cvSkillSet.has(item) || profileSkillSet.has(item));
  const matchedOptional = optional.filter(
    (item) => (cvSkillSet.has(item) || profileSkillSet.has(item)) && !matchedRequired.includes(item),
  );

  const matchedRequiredCv = matchedRequired.filter((item) => cvSkillSet.has(item));
  const matchedRequiredHeadline = matchedRequired.filter((item) => !cvSkillSet.has(item) && profileSkillSet.has(item));
  const matchedOptionalCv = matchedOptional.filter((item) => cvSkillSet.has(item));
  const matchedOptionalHeadline = matchedOptional.filter((item) => !cvSkillSet.has(item) && profileSkillSet.has(item));
  const textOnlyCv = Array.from(cvSkillSet).filter(
    (item) =>
      fullText.includes(item) &&
      !matchedRequired.includes(item) &&
      !matchedOptional.includes(item),
  );
  const textOnlyHeadline = Array.from(profileSkillSet).filter(
    (item) =>
      fullText.includes(item) &&
      !matchedRequired.includes(item) &&
      !matchedOptional.includes(item) &&
      !textOnlyCv.includes(item),
  );

  let points = 0;
  points += Math.min(12, matchedRequiredCv.length * 4 + matchedRequiredHeadline.length * 1);
  points += Math.min(5, matchedOptionalCv.length * 1.5 + matchedOptionalHeadline.length * 0.5);
  points += Math.min(4, textOnlyCv.length * 1.5 + textOnlyHeadline.length * 0.5);

  return {
    points,
    matchedRequired,
    matchedOptional: uniq([...matchedOptional, ...textOnlyCv, ...textOnlyHeadline]),
  };
}

function buildReasons(params: {
  profile: MatchingProfile;
  titleMatches: string[];
  alertMatches: string[];
  alertPoints: number;
  skills: { matchedRequired: string[]; matchedOptional: string[] };
  geo: { points: number; reason?: string };
  experience: { points: number; reason?: string };
  roleFamily: { relation: RoleRelation; jobFamily: string | null };
}): { reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const addReason = (value: string | null | undefined) => {
    const cleaned = cleanString(value);
    if (!cleaned || reasons.includes(cleaned) || reasons.length >= 3) return;
    reasons.push(cleaned);
  };

  const addWarning = (value: string | null | undefined) => {
    const cleaned = cleanString(value);
    if (!cleaned || warnings.includes(cleaned) || warnings.length >= 3) return;
    warnings.push(cleaned);
  };

  if (params.profile.desired_role && params.titleMatches.length > 0) {
    addReason(`Titre proche du role cible: ${params.titleMatches[0]}`);
  }

  if (params.skills.matchedRequired.length > 0) {
    addReason(`Competences requises detectees: ${params.skills.matchedRequired.slice(0, 2).join(", ")}`);
  } else if (params.skills.matchedOptional.length > 0) {
    addReason(`Competences proches detectees: ${params.skills.matchedOptional.slice(0, 2).join(", ")}`);
  }

  if (params.alertMatches.length > 0 && params.alertPoints >= 3) {
    addReason(`Mots-cles d alerte retrouves: ${params.alertMatches[0]}`);
  }

  if (params.geo.points > 0) {
    addReason(params.geo.reason ?? "Contexte geo / remote compatible");
  }

  if (params.experience.points > 0) {
    addReason(params.experience.reason ?? "Experience compatible");
  }

  if (params.roleFamily.relation === "match" && params.roleFamily.jobFamily) {
    addReason(`Famille metier alignee: ${params.roleFamily.jobFamily}`);
  } else if (params.roleFamily.relation === "adjacent" && params.roleFamily.jobFamily) {
    addReason(`Opportunite adjacente credible: ${params.roleFamily.jobFamily}`);
  }

  if (!reasons.length) {
    addReason("Offre plausible a explorer selon les signaux disponibles");
  }

  if (params.experience.points < 0) addWarning(params.experience.reason ?? "Compatibilite experience a verifier");
  if (params.geo.points < 0) addWarning("Contexte geographique moins compatible");
  if (params.roleFamily.relation === "mismatch") addWarning("Famille metier differente de la cible principale");

  return { reasons, warnings };
}

export function scoreJob(params: {
  profile: MatchingProfile;
  candidate: GeneratedCandidate;
}): ScoredCandidate {
  const { profile, candidate } = params;
  const job = candidate.job;
  const titleText = normalizeText([job.title, job.company_name].filter(Boolean).join(" "));
  const metaText = normalizeText(
    [
      job.job_family,
      job.remote_type,
      ...normalizeTagList(job.tags),
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
      ...(job.job_skills ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const descText = normalizeText(pickJobDescription(job));
  const fullText = normalizeText([titleText, metaText, descText].filter(Boolean).join(" "));

  const strongRoleTerms = buildRoleTerms(profile.desired_role);
  const weakRoleTerms = buildRoleTerms(profile.desired_role_fallback);
  const alertTerms = profile.alert_keywords_norm.slice(0, 20);
  const alertTermSets = splitAlertTerms(alertTerms);
  const desiredRolePhrase = normalizeKeyword(profile.desired_role ?? "");

  const titleRoleMatch = computeWeightedCoverage(strongRoleTerms, titleText);
  const titleFallbackMatch =
    strongRoleTerms.length === 0 ? computeWeightedCoverage(weakRoleTerms, titleText) : { coverage: 0, matched: [] as string[] };
  const metaRoleMatch = computeWeightedCoverage(strongRoleTerms, metaText);
  const strongAlertMatch = computeWeightedCoverage(alertTermSets.strong, fullText);
  const weakAlertMatch = computeWeightedCoverage(alertTermSets.weak, fullText);
  const exactDesiredRoleInTitle = Boolean(desiredRolePhrase) && titleText.includes(desiredRolePhrase);
  const alertSupportScale = profile.signal_flags.has_desired_role || profile.signal_flags.has_cv_skills ? 1 : 0.35;

  const titleRolePoints = Math.min(
    36,
    Math.round(titleRoleMatch.coverage * 24 + metaRoleMatch.coverage * 6 + (exactDesiredRoleInTitle ? 8 : 0)),
  );
  const titleFallbackPoints = Math.min(
    strongRoleTerms.length === 0 ? 8 : 4,
    Math.round(titleFallbackMatch.coverage * (strongRoleTerms.length === 0 ? 8 : 4)),
  );
  const metaPoints = Math.min(18, Math.round(metaRoleMatch.coverage * 14));
  const alertPoints = Math.min(
    8,
    Math.round(strongAlertMatch.coverage * 6 + weakAlertMatch.coverage * 2 * alertSupportScale),
  );

  const skills = computeSkillsScore(profile, job, fullText);
  const geo = computeGeoScore(profile, job);
  const experience = computeExperienceScore(profile, job);
  const roleFamily = computeRoleFamilyScore(profile, job);
  const cvOnlyConvergenceBonus =
    !profile.signal_flags.has_desired_role &&
      profile.signal_flags.has_cv_skills &&
      candidate.candidate_paths.includes("skills_meta") &&
      skills.points >= 6
      ? roleFamily.relation === "match"
        ? 6
        : roleFamily.relation === "adjacent"
          ? 3
          : 0
      : 0;
  const dataQuality = computeDataQuality(job);
  const freshnessPoints = (() => {
    const ageMs = Date.now() - getJobTimeMs(job);
    const ageDays = ageMs > 0 ? ageMs / 1000 / 60 / 60 / 24 : 999;
    if (ageDays <= 7) return 4;
    if (ageDays <= 30) return 2;
    if (ageDays <= 90) return 1;
    return 0;
  })();

  const seniorityBalance = 0;
  const qualityPoints = dataQuality >= 0.7 ? 4 : dataQuality >= 0.45 ? 2 : 0;
  const jobNonEnriched =
    !cleanString(job.job_family) &&
    (job.required_skills?.length ?? 0) === 0 &&
    (job.optional_skills?.length ?? 0) === 0 &&
    (job.job_skills?.length ?? 0) === 0;

  let total =
    titleRolePoints +
    titleFallbackPoints +
    metaPoints +
    alertPoints +
    skills.points +
    geo.points +
    experience.points +
    roleFamily.points +
    cvOnlyConvergenceBonus +
    seniorityBalance +
    qualityPoints +
    freshnessPoints;

  const penalties: string[] = [];
  const caps: string[] = [];

  if (geo.penalty === "geo_mismatch") penalties.push("geo_mismatch");
  if (experience.strongUnderqualified) penalties.push("strong_underqualified");
  if (experience.overqualifiedOperational) penalties.push("overqualified_operational");
  if (roleFamily.relation === "mismatch") penalties.push("role_family_mismatch");

  const positiveSignals = [
    titleRolePoints >= 12 || titleFallbackPoints >= 4,
    metaPoints >= 8,
    alertPoints >= 5,
    skills.points >= 5,
    geo.points >= 5,
    experience.points > 0,
    roleFamily.points + cvOnlyConvergenceBonus > 0,
  ];
  const evidenceCount = positiveSignals.filter(Boolean).length;

  if (jobNonEnriched && total > 65) {
    total = 65;
    caps.push("non_enriched_top_cap");
  }

  if (evidenceCount < 2 && total > 45) {
    total = 45;
    caps.push("weak_evidence_cap");
  }

  if (
    candidate.candidate_paths.length === 1 &&
    candidate.candidate_paths[0] === "geo_recent" &&
    evidenceCount === 0 &&
    total > 9
  ) {
    total = 9;
    caps.push("geo_recent_only_cap");
  }

  if (experience.overqualifiedOperational && total > 45) {
    total = 45;
    caps.push("overqualified_operational_cap");
  }

  if (experience.strongUnderqualified && total > 55) {
    total = 55;
    caps.push("underqualified_cap");
  }

  total = Math.max(0, Math.min(100, Math.round(total)));

  const breakdown: JobScoreBreakdown = {
    total,
    title_role: titleRolePoints,
    title_fallback: titleFallbackPoints,
    meta: metaPoints,
    alert: alertPoints,
    skills: skills.points,
    geo: geo.points,
    experience: experience.points,
    role_family: roleFamily.points + cvOnlyConvergenceBonus,
    seniority_balance: seniorityBalance,
    quality: qualityPoints,
    freshness: freshnessPoints,
    evidence_count: evidenceCount,
    data_quality: Number(dataQuality.toFixed(3)),
    matched_role_terms: uniq([...titleRoleMatch.matched, ...metaRoleMatch.matched, ...titleFallbackMatch.matched]),
    matched_alert_keywords: uniq([...strongAlertMatch.matched, ...weakAlertMatch.matched]).slice(0, 6),
    matched_required_skills: skills.matchedRequired.slice(0, 6),
    matched_optional_skills: skills.matchedOptional.slice(0, 6),
    candidate_paths: candidate.candidate_paths,
    profile_family: roleFamily.profileFamily,
    job_family_detected: roleFamily.jobFamily,
    role_relation: roleFamily.relation,
    penalties,
    caps,
    flags: {
      job_non_enriched: jobNonEnriched,
      strong_underqualified: experience.strongUnderqualified,
      overqualified_operational: experience.overqualifiedOperational,
      role_family_mismatch: roleFamily.relation === "mismatch",
      explicit_geo_mismatch: geo.penalty === "geo_mismatch",
    },
  };

  const explanationDetails = buildReasons({
    profile,
    titleMatches: breakdown.matched_role_terms,
    alertMatches: breakdown.matched_alert_keywords,
    alertPoints,
    skills: {
      matchedRequired: breakdown.matched_required_skills,
      matchedOptional: breakdown.matched_optional_skills,
    },
    geo,
    experience,
    roleFamily: {
      relation: roleFamily.relation,
      jobFamily: roleFamily.jobFamily,
    },
  });

  const explanation: MatchExplanation = {
    summary: explanationDetails.reasons[0] ?? "Offre plausible",
    reasons: explanationDetails.reasons,
    warnings: explanationDetails.warnings,
    breakdown,
  };

  return {
    job,
    score: total,
    candidate_paths: candidate.candidate_paths,
    explanation,
    breakdown,
  };
}

function takeDiverse(items: ScoredCandidate[], limit: number, maxPerCompany: number, maxPerFamily: number): ScoredCandidate[] {
  const selected: ScoredCandidate[] = [];
  const companyCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();

  for (const item of items) {
    if (selected.length >= limit) break;

    const companyKey = normalizeText(item.job.company_name ?? "");
    const familyKey = normalizeText(item.breakdown.job_family_detected ?? item.job.job_family ?? "");

    const companyCount = companyKey ? companyCounts.get(companyKey) ?? 0 : 0;
    const familyCount = familyKey ? familyCounts.get(familyKey) ?? 0 : 0;

    if (companyKey && companyCount >= maxPerCompany) continue;
    if (familyKey && familyCount >= maxPerFamily) continue;

    selected.push(item);

    if (companyKey) companyCounts.set(companyKey, companyCount + 1);
    if (familyKey) familyCounts.set(familyKey, familyCount + 1);
  }

  return selected;
}

export function selectSurfaceBuckets(params: {
  profile: MatchingProfile;
  scoredJobs: ScoredCandidate[];
  appliedJobIds?: Set<string>;
  dismissedJobIds?: Set<string>;
}): SurfaceBuckets {
  const alertOnlyProfile =
    params.profile.signal_flags.has_alerts &&
    !params.profile.signal_flags.has_desired_role &&
    !params.profile.signal_flags.has_cv_skills;
  const cvOnlyProfile = params.profile.signal_flags.has_cv_skills && !params.profile.signal_flags.has_desired_role;
  const sparseProfile =
    params.profile.signal_flags.is_cold_start ||
    (!params.profile.signal_flags.has_desired_role &&
      !params.profile.signal_flags.has_cv_skills &&
      !params.profile.signal_flags.has_alerts);
  const applied = params.appliedJobIds ?? new Set<string>();
  const dismissed = params.dismissedJobIds ?? new Set<string>();

  const base = params.scoredJobs
    .filter((item) => !applied.has(item.job.id))
    .filter((item) => !dismissed.has(item.job.id))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return getJobTimeMs(b.job) - getJobTimeMs(a.job);
    });

  const topMatchPool = base.filter(
    (item) => {
      const strongTitleTopMatchEligible =
        item.breakdown.title_role >= 28 &&
        item.breakdown.data_quality >= 0.58 &&
        item.candidate_paths.includes("role_title");

      return item.score >= 44 &&
      item.breakdown.evidence_count >= 2 &&
      item.breakdown.data_quality >= 0.4 &&
      (item.breakdown.title_role >= 18 || item.breakdown.skills >= 8 || item.breakdown.role_family >= 6) &&
      (!item.breakdown.flags.job_non_enriched || strongTitleTopMatchEligible) &&
      !item.breakdown.flags.strong_underqualified &&
      !item.breakdown.flags.overqualified_operational &&
      !item.breakdown.flags.role_family_mismatch &&
      !item.breakdown.flags.explicit_geo_mismatch;
    },
  );

  const top_match = takeDiverse(topMatchPool, TOP_MATCH_LIMIT, 1, 2);
  const topIds = new Set(top_match.map((item) => item.job.id));

  const forYouPool = base.filter(
    (item) =>
      !topIds.has(item.job.id) &&
      item.score >= (cvOnlyProfile ? 18 : 20) &&
      (item.breakdown.evidence_count >= 2 ||
        item.breakdown.title_role >= 16 ||
        item.breakdown.skills >= 8 ||
        (params.profile.signal_flags.has_cv_skills &&
          !params.profile.signal_flags.has_desired_role &&
          item.candidate_paths.includes("skills_meta") &&
          item.breakdown.skills >= 5 &&
          item.breakdown.role_family >= 1 &&
          item.breakdown.data_quality >= 0.55 &&
          item.score >= 16) ||
        item.score >= 32) &&
      !item.breakdown.flags.explicit_geo_mismatch,
  );

  const for_you = takeDiverse(forYouPool, FOR_YOU_LIMIT, 2, 3);
  const forYouIds = new Set(for_you.map((item) => item.job.id));

  const explorePool = base.filter(
    (item) =>
      !topIds.has(item.job.id) &&
      !forYouIds.has(item.job.id) &&
      (
        sparseProfile
          ? (
            (
              item.score >= 6 &&
              item.breakdown.data_quality >= 0.5 &&
              item.breakdown.freshness >= 2 &&
              looksReadableJobLabel(item.job.title)
            ) ||
            (
              item.candidate_paths.includes("geo_recent") &&
              item.breakdown.data_quality >= 0.58 &&
              item.breakdown.freshness >= 2 &&
              looksReadableJobLabel(item.job.title)
            )
          )
          : (
            (
              item.score >= 14 &&
              (
                item.breakdown.evidence_count >= 1 ||
                item.candidate_paths.some((path) => path !== "geo_recent")
              )
            ) ||
            (
              alertOnlyProfile &&
              item.score >= 10 &&
              item.breakdown.data_quality >= 0.55 &&
              looksReadableJobLabel(item.job.title) &&
              item.candidate_paths.some((path) => path !== "geo_recent")
            ) ||
            (
              alertOnlyProfile &&
              item.candidate_paths.length > 0 &&
              item.candidate_paths.every((path) => path === "geo_recent") &&
              item.score >= 9 &&
              item.breakdown.data_quality >= 0.55 &&
              looksReadableJobLabel(item.job.title) &&
              item.breakdown.evidence_count >= 1 &&
              !item.breakdown.flags.strong_underqualified &&
              !item.breakdown.flags.explicit_geo_mismatch
            )
          )
      ),
  );

  const exploreInput = sparseProfile
    ? [...explorePool].sort((a, b) =>
      Number(looksReadableJobLabel(b.job.title)) - Number(looksReadableJobLabel(a.job.title)) ||
      b.breakdown.data_quality - a.breakdown.data_quality ||
      b.breakdown.freshness - a.breakdown.freshness ||
      b.score - a.score
    )
    : explorePool;
  const exploreLimit = sparseProfile ? 8 : EXPLORE_LIMIT;
  const explore = takeDiverse(exploreInput, exploreLimit, sparseProfile ? 2 : 3, sparseProfile ? 3 : 4);

  return { top_match, for_you, explore };
}

export function buildDismissedJobIdSet(rows: RawFeedbackRow[]): Set<string> {
  return new Set(
    rows
      .map((row) => cleanString(row.job_id))
      .filter(Boolean),
  );
}

export function buildAppliedJobIdSet(rows: RawApplicationRow[]): Set<string> {
  return new Set(
    rows
      .map((row) => cleanString(row.job_id))
      .filter(Boolean),
  );
}
