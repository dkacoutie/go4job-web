import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { canonicalizeText } from "./lib/taxonomy";
import {
  buildJobRadarShadowUi,
  getJobRadarShadowPillLabel,
  getJobRadarShadowSubline,
  type JobRadarShadowInvokeResponse,
  type JobRadarShadowMeta,
} from "./lib/jobradarShadowFeed";
import {
  adaptJobRadarShadowResponse,
  compareShadowAndLocalBuckets,
  type ShadowFeedComparison,
  type ShadowFeedMatchRow,
  type ShadowFeedUiState,
} from "./lib/jobradarShadowAdapter";
import {
  buildGeoPreferences,
  buildJobHay,
  computeJobMatchScore,
  normalizeSearchText,
  resolveCountrySearchQuery,
  type GeoRemoteBreakdown,
  type DataQualityBreakdown,
  type MatchWhySummary,
  type SkillsQualityBreakdown,
} from "./lib/jobMatching";
import { supabase } from "./lib/supabaseClient";
import {
  trackSearch,
  trackSelectContent,
  trackWidenedResultsAccepted,
  trackWidenedResultsDeclined,
  trackWidenedResultsOffered,
} from "./lib/analytics";
import { useSession } from "./lib/useSession";
import { usePass } from "./lib/usePass";
import { usePaymentMarket } from "./lib/paymentMarket";
import { getStartingPremiumLabel } from "./lib/premiumPricing";
import { EmptyState, NextStepCard } from "./components/GuidedUI";
import OnboardingAlertInviteBanner from "./components/OnboardingAlertInviteBanner";
import JobRadarAdvisor from "./components/JobRadarAdvisor";
import { getJobRadarAdvisorCopy } from "./components/jobRadarAdvisorContent";
import { useToast } from "./components/ToastCenter";
import { CompanyAvatar } from "./components/CompanyAvatar";
import "./JobRadarFeedPage.css";

type AlertRow = {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  country: string | null;
  countries?: string[] | null;
  employment_types?: string[] | null;
  work_modes?: string[] | null;
  frequency: string;
  channels: string[];
  is_active: boolean;
  created_at?: string | null;
};

type ApplicationStatus = "saved" | "queued" | "in_progress" | "submitted" | "failed";

type MatchWhy = MatchWhySummary;

type MatchRow = {
  job: JobRow;
  s: number;
  p: number;
  kwCount: number;
  signalCount: number;
  expOk: boolean;
  geoRemote: GeoRemoteBreakdown;
  skillsQuality: SkillsQualityBreakdown;
  dataQuality: DataQualityBreakdown;
  why: MatchWhy;
};

type FeedDisplayRow = MatchRow | ShadowFeedMatchRow;

type JobRow = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  contract_type?: string | null;
  job_family?: string | null;

  apply_url?: string | null;
  source_url?: string | null;

  sort_at?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;

  description?: string | null;
  tags?: string[] | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
};

type CvSaveResponse = {
  ok: boolean;
  data?: any;
  error?: string;
  message?: string;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return String(err);
}

function trackJobRadarEvent(name: string, payload: Record<string, unknown>) {
  if (import.meta.env?.DEV) {
    console.info("[JobRadar]", name, payload);
  }
}

function toNumberOrNull(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(s: string) {
  return (s ?? "").toLowerCase().trim();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean)));
}

function getJobTimeMs(job: JobRow): number {
  const candidates = [
    job.sort_at,
    job.published_at,
    job.posted_at,
    job.scraped_at,
    job.created_at,
    job.updated_at,
  ].filter(Boolean) as string[];

  for (const d of candidates) {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function normalizeText(input: string) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getRelevanceLabel(score: number) {
  if (score >= 70) return "Très pertinent";
  if (score >= 50) return "Pour toi";
  return "À explorer";
}

// Avatar par défaut (initiales/globe) déplacé dans lib/companyAvatar.ts,
// utilisé par le composant partagé <CompanyAvatar> (avec tentative de logo
// réel pour les employeurs en liste blanche, voir lib/companyLogo.ts).

// Les offres "shadow feed" (comparaison backend, ShadowFeedJobRow) ne
// portent pas apply_url/source_url — on retombe alors simplement sur
// l'avatar par défaut (aucun logo tenté), sans forcer ces champs sur ce
// type distinct.
function getJobApplyUrls(job: JobRow | ShadowFeedMatchRow["job"]): {
  applyUrl?: string | null;
  sourceUrl?: string | null;
} {
  if ("apply_url" in job || "source_url" in job) {
    const withUrls = job as JobRow;
    return { applyUrl: withUrls.apply_url, sourceUrl: withUrls.source_url };
  }
  return {};
}

const WHY_MAX_LEN = 72;

function collapseSpaces(input: string) {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function buildAlertSearchFallback(alert: AlertRow) {
  return collapseSpaces([alert.name, ...(alert.keywords ?? [])].filter(Boolean).join(" "));
}

function keyify(input: string) {
  return normalizeText(canonicalizeText(input)).replace(/[^a-z0-9]+/g, " ").trim();
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

function shortenValue(value: string, maxLen: number) {
  const cleaned = collapseSpaces(value);
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
  if (lastSpace >= Math.max(10, maxLen - 12)) return cut.slice(0, lastSpace).trim() + "…";
  return cleaned.slice(0, maxLen).trim() + "…";
}

function fitReason(prefix: string, value?: string | null, suffix = "") {
  if (!value) return null;
  const base = collapseSpaces(value);
  if (!base) return null;
  const budget = Math.max(12, WHY_MAX_LEN - prefix.length - suffix.length - 2);
  const trimmed = shortenValue(base, budget);
  const out = `${prefix} ${trimmed}${suffix}`.trim();
  return out.length <= WHY_MAX_LEN ? out : null;
}

function cleanCvLabel(label: string) {
  const cleaned = collapseSpaces(label.replace(/\s*\((titre|desc|titre\+desc)\)\s*$/i, ""));
  return humanizeSkillLabel(cleaned);
}

function labelRemoteType(raw?: string | null) {
  const rt = (raw ?? "").toLowerCase();
  if (!rt) return null;
  if (rt.includes("remote")) return "Télétravail";
  if (rt.includes("hybrid") || rt.includes("hybride")) return "Hybride";
  if (rt.includes("site") || rt.includes("office") || rt.includes("présentiel") || rt.includes("presentiel")) return "Sur site";
  return rt.trim();
}

type FilterOption = {
  value: string;
  label: string;
};

// Aligne sur COUNTRY_ALIAS_MAP (src/lib/jobMatching.ts) : la resolution de
// pays (resolveCountrySearchQuery) comprend deja ces 24 codes, ce menu se
// contentait d'en exposer 6. Audit du 20/07/2026 : cf. migration
// 20260720070000_jobradar_country_codes_hygiene.sql pour le contexte.
const COUNTRY_FILTER_OPTIONS: FilterOption[] = [
  { value: "", label: "Tous les pays" },
  { value: "CI", label: "Côte d’Ivoire" },
  { value: "SN", label: "Sénégal" },
  { value: "BF", label: "Burkina Faso" },
  { value: "ML", label: "Mali" },
  { value: "BJ", label: "Bénin" },
  { value: "TG", label: "Togo" },
  { value: "NE", label: "Niger" },
  { value: "GN", label: "Guinée" },
  { value: "GH", label: "Ghana" },
  { value: "NG", label: "Nigeria" },
  { value: "CM", label: "Cameroun" },
  { value: "KE", label: "Kenya" },
  { value: "RW", label: "Rwanda" },
  { value: "ZA", label: "Afrique du Sud" },
  { value: "MA", label: "Maroc" },
  { value: "TN", label: "Tunisie" },
  { value: "DZ", label: "Algérie" },
  { value: "FR", label: "France" },
  { value: "BE", label: "Belgique" },
  { value: "CH", label: "Suisse" },
  { value: "DE", label: "Allemagne" },
  { value: "CA", label: "Canada" },
  { value: "US", label: "États-Unis" },
  { value: "GB", label: "Royaume-Uni" },
  { value: "REMOTE", label: "Remote / international" },
];

const CONTRACT_FILTER_OPTIONS: FilterOption[] = [
  { value: "", label: "Tous les contrats" },
  { value: "cdi", label: "CDI" },
  { value: "cdd", label: "CDD" },
  { value: "internship", label: "Stage" },
  { value: "alternance", label: "Alternance" },
  { value: "freelance", label: "Freelance / mission" },
];

const WORK_MODE_FILTER_OPTIONS: FilterOption[] = [
  { value: "", label: "Tous les modes" },
  { value: "onsite", label: "Sur site" },
  { value: "hybrid", label: "Hybride" },
  { value: "remote", label: "Remote" },
];

function supportedOptionValue(options: FilterOption[], value: string) {
  return options.some((option) => option.value === value) ? value : "";
}

function normalizeCountryFilterParam(value: string) {
  const raw = collapseSpaces(value).toUpperCase();
  if (!raw) return "";
  if (raw === "REMOTE") return "REMOTE";
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return resolveCountrySearchQuery(value) ?? "";
}

function readMultiParams(params: URLSearchParams, names: string[]) {
  return names.flatMap((name) =>
    params
      .getAll(name)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function readFeedFiltersFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const q = collapseSpaces(params.get("q") ?? "");
  const countries = uniq(readMultiParams(params, ["country", "countries"]).map(normalizeCountryFilterParam).filter(Boolean));
  const country = countries.length === 1 ? supportedOptionValue(COUNTRY_FILTER_OPTIONS, countries[0]) || countries[0] : "";
  const contract = supportedOptionValue(
    CONTRACT_FILTER_OPTIONS,
    (params.get("employment_type") ?? params.get("employment_types") ?? params.get("contract") ?? "").trim().toLowerCase()
  );
  const workMode = supportedOptionValue(
    WORK_MODE_FILTER_OPTIONS,
    (params.get("work_mode") ?? params.get("work_modes") ?? "").trim().toLowerCase()
  );

  return { q, country, countries, contract, workMode };
}

function hasFeedSearchCriteria(params: { q: string; countries: string[]; contract: string; workMode: string }) {
  return Boolean(normalizeSearchText(params.q) || params.countries.length || params.contract || params.workMode);
}

function buildFeedCriteriaKey(params: { q: string; countries: string[]; contract: string; workMode: string }) {
  return JSON.stringify({
    q: normalizeSearchText(params.q),
    countries: params.countries,
    contract: params.contract,
    workMode: params.workMode,
  });
}

const AMBIGUOUS_ALERT_KEYWORDS = new Set(["chef"]);

function keepActionableAlertKeyword(keyword: string) {
  const normalized = norm(canonicalizeText(keyword));
  if (!normalized) return false;
  return !AMBIGUOUS_ALERT_KEYWORDS.has(normalized);
}

const CONTRACT_ALIASES: Record<string, string[]> = {
  cdi: ["cdi", "permanent", "long terme", "full time", "full-time"],
  cdd: ["cdd", "contract", "contrat", "temporary", "fixed term", "mission"],
  internship: ["stage", "intern", "internship", "stagiaire"],
  alternance: ["alternance", "apprenticeship", "apprenti", "apprentie"],
  freelance: ["freelance", "consultant", "contractor", "mission"],
};

function pickLocationLabel(job: JobRow) {
  const remote = labelRemoteType(job.remote_type);
  if (remote) return remote;
  const loc = collapseSpaces(job.location ?? "");
  if (loc && loc.length > 2) return loc;
  const country = collapseSpaces(job.country ?? "");
  if (country && country.length > 2) return country;
  return null;
}

function pickAlertKeyword(why: MatchWhy, alertDisplay: Map<string, string>) {
  const matched = why.details?.breakdown?.alert?.matched_keywords ?? [];
  for (const key of matched) {
    if (!keepActionableAlertKeyword(key)) continue;
    const display = alertDisplay.get(key) ?? alertDisplay.get(norm(canonicalizeText(key)));
    if (display) return humanizeAlertKeyword(display);
  }
  for (const key of why.alert) {
    if (!keepActionableAlertKeyword(key)) continue;
    const display = alertDisplay.get(key) ?? alertDisplay.get(norm(canonicalizeText(key)));
    if (display) return humanizeAlertKeyword(display);
  }
  return null;
}

function buildWhyReasons(params: {
  job: JobRow;
  why: MatchWhy;
  expOk: boolean;
  geoRemote: GeoRemoteBreakdown;
  alertDisplay: Map<string, string>;
  allowAlertReason?: boolean;
}) {
  const reasons: string[] = [];
  const used = new Set<string>();
  const add = (text: string | null) => {
    if (!text || reasons.length >= 2) return;
    const t = collapseSpaces(text);
    if (!t || used.has(t)) return;
    used.add(t);
    reasons.push(t);
  };

  const alertKeyword = params.allowAlertReason === false
    ? null
    : pickAlertKeyword(params.why, params.alertDisplay);
  add(fitReason("Correspond à ton alerte", alertKeyword));

  if (reasons.length < 2 && params.geoRemote.considered && params.geoRemote.points_awarded > 0) {
    const loc = pickLocationLabel(params.job);
    add(fitReason("Compatible avec ta recherche de postes en", loc));
  }

  if (reasons.length < 2) {
    const cvLabel = params.why.cv.map(cleanCvLabel).find(Boolean) ?? null;
    add(fitReason("Compétences en", cvLabel, " proches du besoin"));
  }

  if (reasons.length < 2 && params.expOk) {
    const func = collapseSpaces(params.job.title ?? "");
    add(fitReason("Missions cohérentes avec ton expérience", func || null));
  }

  const roleFamily = params.why.details?.breakdown?.role_family;
  if (reasons.length < 2 && roleFamily?.relation === "match") {
    add("Même famille métier que ta cible");
  }

  const domain = params.why.details?.breakdown?.domain;
  if (reasons.length < 2 && domain?.job_domain && domain.profile_domains?.includes(domain.job_domain)) {
    add("Secteur aligné avec ton profil");
  }

  if (!reasons.length) {
    add("Profil compatible avec cette offre");
  }

  return reasons.slice(0, 2);
}

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
  "à",
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
  "remote",
  "remotely",
  "hybrid",
  "freelance",
  "intern",
  "internship",
  "stage",
  "alternance",
  "junior",
  "senior",
]);

const AFRICA_COUNTRIES = new Set([
  "DZ",
  "AO",
  "BJ",
  "BW",
  "BF",
  "BI",
  "CM",
  "CV",
  "CF",
  "TD",
  "KM",
  "CG",
  "CD",
  "CI",
  "DJ",
  "EG",
  "GQ",
  "ER",
  "SZ",
  "ET",
  "GA",
  "GM",
  "GH",
  "GN",
  "GW",
  "KE",
  "LS",
  "LR",
  "LY",
  "MG",
  "MW",
  "ML",
  "MR",
  "MU",
  "MA",
  "MZ",
  "NA",
  "NE",
  "NG",
  "RW",
  "ST",
  "SN",
  "SC",
  "SL",
  "SO",
  "ZA",
  "SS",
  "SD",
  "TZ",
  "TG",
  "TN",
  "UG",
  "EH",
  "ZM",
  "ZW",
]);

function extractKeywordsFromAlertName(name: string): string[] {
  const t = normalizeText(name);
  if (!t) return [];

  const phrase = t.replace(/\s+/g, " ").trim();

  const tokens = t
    .replace(/[^a-z0-9\s+.#-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 3)
    .filter((w) => !STOP_WORDS.has(w))
    .filter(keepActionableAlertKeyword);

  return uniq([phrase, ...tokens]).slice(0, 5);
}

function isRemoteLike(value: string) {
  const v = normalizeText(value);
  return (
    v.includes("remote") ||
    v.includes("teletravail") ||
    v.includes("hybrid") ||
    v.includes("hybride") ||
    v.includes("full remote") ||
    v.includes("100% remote") ||
    v.includes("global") ||
    v.includes("worldwide")
  );
}

const JOB_SELECT_FIELDS = `
  id,
  title,
  company_name,
  location,
  country,
  remote_type,
  contract_type,
  job_family,
  apply_url,
  source_url,
  published_at,
  posted_at,
  scraped_at,
  created_at,
  updated_at,
  tags,
  job_skills,
  required_skills,
  optional_skills,
  experience_years_min,
  experience_years_max
`;

const JOB_DESCRIPTION_SELECT_FIELDS = `
  id,
  description:description_text
`;

const ALERT_SELECT_FIELDS = "id, user_id, name, keywords, country, countries, employment_types, work_modes, frequency, channels, is_active, created_at";

const TEXT_SEARCH_MIN_LENGTH = 2;

function sanitizeJobSearchTerm(value: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[%(),"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const JOB_SEARCH_STOPWORDS = new Set([
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
  "the",
  "and",
  "for",
  "with",
  "in",
  "on",
  "at",
]);

const JOB_SEARCH_BROAD_TOKENS = new Set([
  "dakar",
  "international",
  "manager",
  "assistant",
  "agent",
  "responsable",
  "commercial",
  "senegal",
]);

function buildJobSearchTokens(rawQuery: string) {
  const normalized = normalizeSearchText(canonicalizeText(rawQuery));
  if (!normalized) return [];
  return uniq(normalized.split(" ").filter((token) => token.length >= 2 && !JOB_SEARCH_STOPWORDS.has(token))).slice(0, 6);
}

// Historique : la construction manuelle du filtre .or() (un groupe
// or=(...) imbriqué pour éviter deux appels .or() chaînés, cause d'une 500
// systématique trouvée le 24/07/2026) a été remplacée le 05/08/2026 par la
// fonction RPC search_active_jobs (voir buildServerSearchTerms plus bas et
// la migration 20260805153000) : le filtre .or() côté client rendait le
// plan Postgres dépendant de la fréquence du terme recherché, ce qui
// provoquait des timeouts intermittents non reproductibles de façon fiable
// depuis le client.

function buildServerSearchTerms(rawQuery: string) {
  const safeTerm = sanitizeJobSearchTerm(rawQuery);
  const tokens = buildJobSearchTokens(rawQuery);
  const importantTokens = tokens.filter((token) => !JOB_SEARCH_BROAD_TOKENS.has(token));
  const fallbackTokens = tokens.filter((token) => JOB_SEARCH_BROAD_TOKENS.has(token));
  return uniq([safeTerm, ...importantTokens, ...fallbackTokens]).filter((term) => term.length >= TEXT_SEARCH_MIN_LENGTH).slice(0, 6);
}

function selectedOptionLabel(options: FilterOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function normalizeFilterValue(value: string | null | undefined) {
  return normalizeText(canonicalizeText(value ?? ""));
}

function jobMatchesCountryFilter(job: JobRow, countryFilter: string) {
  if (!countryFilter) return true;
  if (countryFilter === "REMOTE") {
    return isRemoteLike(`${job.remote_type ?? ""} ${job.location ?? ""} ${job.country ?? ""}`);
  }
  const country = (job.country ?? "").trim().toUpperCase();
  if (country === countryFilter) return true;
  return resolveCountrySearchQuery(`${job.country ?? ""} ${job.location ?? ""}`) === countryFilter;
}

function jobMatchesCountryFilters(job: JobRow, countryFilters: string[]) {
  if (!countryFilters.length) return true;
  return countryFilters.some((countryFilter) => jobMatchesCountryFilter(job, countryFilter));
}

function jobMatchesContractFilter(job: JobRow, contractFilter: string) {
  if (!contractFilter) return true;
  const text = normalizeFilterValue([job.contract_type, job.title].filter(Boolean).join(" "));
  const aliases = CONTRACT_ALIASES[contractFilter] ?? [contractFilter];
  return aliases.some((alias) => text.includes(normalizeFilterValue(alias)));
}

function jobMatchesWorkModeFilter(job: JobRow, workModeFilter: string) {
  if (!workModeFilter) return true;
  const text = normalizeFilterValue([job.remote_type, job.location].filter(Boolean).join(" "));
  if (workModeFilter === "remote") return isRemoteLike(`${job.remote_type ?? ""} ${job.location ?? ""}`);
  if (workModeFilter === "hybrid") return text.includes("hybrid") || text.includes("hybride");
  if (workModeFilter === "onsite") {
    return text.includes("sur site") ||
      text.includes("onsite") ||
      text.includes("on site") ||
      text.includes("office") ||
      text.includes("presentiel");
  }
  return true;
}

function buildSearchAlertKeywords(query: string) {
  return buildJobSearchTokens(query).slice(0, 8);
}

function arraysEqualIgnoreOrder(left: string[], right: string[]) {
  const a = [...left].map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
  const b = [...right].map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function buildNormalizedJobSearchHay(job: JobRow) {
  return normalizeSearchText(canonicalizeText(buildJobHay(job)));
}

function jobMatchesSearchQuery(job: JobRow, rawQuery: string) {
  const qCanon = normalizeSearchText(canonicalizeText(rawQuery));
  if (!qCanon) return true;

  const hay = buildNormalizedJobSearchHay(job);
  if (hay.includes(qCanon)) return true;

  const tokens = buildJobSearchTokens(rawQuery);
  if (tokens.length <= 1) return false;

  return tokens.every((token) => hay.includes(token));
}

function JobCardSkeleton({ index = 0 }: { index?: number }) {
  const style = { ["--sk-delay" as any]: `${Math.min(index, 7) * 60}ms` };
  return (
    <div className="jr-card jr-cardSkeleton" style={style} aria-hidden="true">
      <div className="jr-cardTop">
        <div className="sk sk-title" />
        <div className="sk sk-badge" />
      </div>
      <div className="jr-meta">
        <div className="sk sk-meta" />
      </div>
      <div className="jr-whyBox jr-whyBoxSkeleton">
        <div className="sk sk-whyTitle" />
        <div className="sk sk-whyLine" />
        <div className="sk sk-whyLine sk-whyLineShort" />
      </div>
      <div className="jr-cardActions">
        <div className="sk sk-cta" />
        <div className="jr-footerActions">
          <div className="sk sk-link" />
          <div className="sk sk-dismiss" />
        </div>
      </div>
    </div>
  );
}

export default function JobRadarFeedPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, loading } = useSession();
  const { hasActivePass, isLoadingPass } = usePass();
  const userId = session?.user?.id ?? null;
  const paymentMarket = usePaymentMarket(userId);
  const initialFeedFilters = readFeedFiltersFromSearch(location.search);
  const feedPerfDebug = import.meta.env.DEV || new URLSearchParams(location.search).get("perf") === "1";
  const feedMountedAtRef = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const firstCardsLoggedRef = useRef(false);
  const startingPremiumLabel = getStartingPremiumLabel(paymentMarket.resolution.market);
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";

  const FEED_PREVIEW_LIMIT = 4;
  const FEED_GATE_MESSAGE =
    "Active un pass pour voir plus d’offres adaptées, ouvrir les opportunités complètes et sauvegarder tes annonces.";
  const FEED_GATE_REASSURANCE = ["Paiement unique", "Sans renouvellement automatique", "Carte ou Mobile Money"] as const;
  const OFFER_GATE_MESSAGE =
    "Cette offre a été sélectionnée pour ton profil. Pour voir les détails complets et accéder au lien de candidature, débloque ton pass JobRadar.";
  const OFFER_GATE_BENEFITS = [
    "Offre complète + lien pour postuler",
    "Autres offres adaptées à ton profil",
    "Sauvegarde de tes annonces favorites",
    `Accès complet à partir de ${startingPremiumLabel}`,
  ] as const;
  const OFFER_GATE_REASSURANCE = "Carte ou Mobile Money · Accès immédiat après paiement";
  const STANDARD_GATE_MESSAGE = "Un pass actif est requis pour accéder à cette fonctionnalité.";
  const FREE_ACTIVE_ALERT_LIMIT = 1;
  const FREE_ALERT_LIMIT_MESSAGE =
    "Ton alerte gratuite est déjà active. Active un pass JobRadar pour créer plusieurs alertes.";
  const allowPremium = hasActivePass && !isLoadingPass;
  const isPreview = !allowPremium;

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  // Ajustement 5 (24/07/2026) : élargissement de recherche opt-in et non
  // permanent. Quand une recherche texte ne remonte aucun résultat strict,
  // on garde en mémoire les résultats plus larges déjà récupérés côté
  // serveur (mêmes requêtes, sans le filtre AND-de-tous-les-mots côté
  // client) pour les proposer explicitement. Rien de tout cela ne modifie
  // les critères de l'alerte de l'utilisateur : c'est un affichage
  // temporaire, réinitialisé à chaque nouvelle recherche.
  const [widenedCandidates, setWidenedCandidates] = useState<JobRow[]>([]);
  const [widenedAccepted, setWidenedAccepted] = useState(false);
  const [widenedDismissed, setWidenedDismissed] = useState(false);
  const widenedOfferedTrackedKeyRef = useRef<string | null>(null);
  const [cvSkills, setCvSkills] = useState<string[]>([]);
  const [cvExp, setCvExp] = useState<{ min: number | null; max: number | null } | null>(null);
  const [profileExp, setProfileExp] = useState<number | null>(null);
  const [profileDesiredRole, setProfileDesiredRole] = useState("");
  const [shadowFeed, setShadowFeed] = useState<ShadowFeedUiState | null>(null);
  const [hasUserSelectedMode, setHasUserSelectedMode] = useState(false);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [q, setQ] = useState(initialFeedFilters.q);
  const [countryFilter, setCountryFilter] = useState(initialFeedFilters.country);
  const [countryFilters, setCountryFilters] = useState<string[]>(initialFeedFilters.countries);
  const [contractFilter, setContractFilter] = useState(initialFeedFilters.contract);
  const [workModeFilter, setWorkModeFilter] = useState(initialFeedFilters.workMode);
  const [alertSaveBusy, setAlertSaveBusy] = useState(false);
  const [alertNotice, setAlertNotice] = useState<{
    kind: "success" | "info" | "error";
    title: string;
    message: string;
  } | null>(null);

  const [matchMode, setMatchMode] = useState<"strict" | "large">("large");
  const STRICT_MIN_PERCENT = Number(import.meta.env.VITE_TOPMATCH_MIN ?? 55);
  const TOP_MATCH_MIN = 70;
  const TOP_MATCH_DQ_MIN = 0.6;
  const MIN_FOR_YOU = 25;
  const FOR_YOU_TAB_MIN_COUNT = 3;
  const [onlyVeryRelevant, setOnlyVeryRelevant] = useState(false);
  const [showTopMatchHelp, setShowTopMatchHelp] = useState(false);

  const [appStatusByJobId, setAppStatusByJobId] = useState<Map<string, ApplicationStatus>>(new Map());
  const [addingJobId, setAddingJobId] = useState<string | null>(null);
  const savingJobIdsRef = useRef<Set<string>>(new Set());
  const [savedHint, setSavedHint] = useState(false);
  const [showTip, setShowTip] = useState(true);

  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
  const [dismissingJobId, setDismissingJobId] = useState<string | null>(null);

  const { pushToast } = useToast();

  const PAGE_SIZE = 30;
  const SEARCH_LIMIT = 80;
  // Finalisation activation/paiement (24/07/2026) : la distinction
  // gratuit/payant n'est aujourd'hui assurée QUE côté client (la RLS sur
  // "jobs" autorise tout utilisateur authentifié, sans distinction
  // d'abonnement — signalé séparément, correctif complet = RPC serveur
  // dédiée, hors portée d'un changement le jour même sur un feed qui vient
  // d'être stabilisé). En attendant, on réduit concrètement ce qu'un compte
  // gratuit reçoit réellement du serveur (au lieu de tout récupérer puis de
  // ne montrer que FEED_PREVIEW_LIMIT côté affichage) : ça réduit la fenêtre
  // d'exposition (onglet réseau du navigateur) sans changer la logique de
  // tri/score ni ajouter de requête.
  const PREVIEW_FETCH_CAP = 16;
  const [pageFrom, setPageFrom] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const lastServerSearchQueryRef = useRef("");
  const loadRunIdRef = useRef(0);
  const deferredFeedTimersRef = useRef<number[]>([]);
  const currentFeedCriteriaRef = useRef({
    q: initialFeedFilters.q,
    countries: initialFeedFilters.countries,
    contract: initialFeedFilters.contract,
    workMode: initialFeedFilters.workMode,
  });
  const feedBackendShadowFlag = (import.meta.env.VITE_JOBRADAR_FEED_BACKEND_SHADOW ?? "").trim() === "1";

  const [offerUnlockModal, setOfferUnlockModal] = useState<{ title: string } | null>(null);

  const logFeedPerf = useCallback(
    (label: string, payload: Record<string, unknown> = {}) => {
      if (!feedPerfDebug) return;
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      console.info("[JobRadar feed perf]", label, {
        at_ms: Math.round(now - feedMountedAtRef.current),
        ...payload,
      });
    },
    [feedPerfDebug]
  );

  const clearDeferredFeedTasks = useCallback(() => {
    for (const timerId of deferredFeedTimersRef.current) {
      window.clearTimeout(timerId);
    }
    deferredFeedTimersRef.current = [];
  }, []);

  const scheduleDeferredFeedTask = useCallback((task: () => void, delayMs: number) => {
    const timerId = window.setTimeout(() => {
      deferredFeedTimersRef.current = deferredFeedTimersRef.current.filter((id) => id !== timerId);
      task();
    }, delayMs);
    deferredFeedTimersRef.current.push(timerId);
  }, []);

  useEffect(() => {
    return () => {
      loadRunIdRef.current += 1;
      clearDeferredFeedTasks();
    };
  }, [clearDeferredFeedTasks]);

  function scrollToResults() {
    const el = document.getElementById("jr-results");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function invokeCvSave(action: "get_active", payload?: any) {
    const { data, error } = await supabase.functions.invoke("cv_save", {
      body: { action, payload },
    });

    if (error) {
      let msg = error.message ?? "Erreur Edge Function";
      const anyErr = error as any;
      if (anyErr?.context instanceof Response) {
        const t = await anyErr.context.text();
        if (t) {
          try {
            const j = JSON.parse(t);
            msg = j?.error || j?.message || t;
          } catch {
            msg = t;
          }
        }
      }
      throw new Error(msg);
    }

    return data as CvSaveResponse;
  }

  const fetchShadowFeed = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke<JobRadarShadowInvokeResponse>("jobradar_match_feed", {
      body: {},
    });

    if (error) throw error;
    return adaptJobRadarShadowResponse(data ?? {});
  }, []);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    setHasUserSelectedMode(false);
    setShadowFeed(null);
  }, [userId]);

  useEffect(() => {
    const next = readFeedFiltersFromSearch(location.search);
    setQ(next.q);
    setCountryFilter(next.country);
    setCountryFilters(next.countries);
    setContractFilter(next.contract);
    setWorkModeFilter(next.workMode);
  }, [location.search]);

  useEffect(() => {
    currentFeedCriteriaRef.current = {
      q,
      countries: countryFilters,
      contract: contractFilter,
      workMode: workModeFilter,
    };
  }, [q, countryFilters, contractFilter, workModeFilter]);

  const KEYWORDS_MAX_UNIQ = 60;
  const KEYWORDS_CAP = 20;
  const CV_SKILLS_CAP = 14;

  const alertKeywords = useMemo(() => {
    const fromKeywords = alerts.flatMap((a) => a.keywords ?? []);
    const fromNames = alerts.flatMap((a) => extractKeywordsFromAlertName(a.name ?? ""));
    return uniq([...fromKeywords, ...fromNames].filter(keepActionableAlertKeyword)).slice(0, KEYWORDS_MAX_UNIQ);
  }, [alerts]);

  const alertDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    const rawList = [
      ...alerts.flatMap((a) => a.keywords ?? []),
      ...alerts.flatMap((a) => (a.name ? [a.name] : [])),
      ...alerts.flatMap((a) => extractKeywordsFromAlertName(a.name ?? "")),
    ];
    for (const raw of rawList) {
      const cleaned = collapseSpaces(String(raw ?? ""));
      if (!cleaned) continue;
      const key = norm(canonicalizeText(cleaned));
      if (!key || map.has(key)) continue;
      map.set(key, humanizeAlertKeyword(cleaned));
    }
    return map;
  }, [alerts]);

  const cappedAlertKeywords = useMemo(() => alertKeywords.slice(0, KEYWORDS_CAP), [alertKeywords]);
  const cvKeywords = useMemo(() => uniq(cvSkills).slice(0, CV_SKILLS_CAP), [cvSkills]);

  const geoPrefs = useMemo(() => buildGeoPreferences(alerts), [alerts]);
  const hasActiveSearchCriteria = useMemo(
    () => hasFeedSearchCriteria({ q, countries: countryFilters, contract: contractFilter, workMode: workModeFilter }),
    [q, countryFilters, contractFilter, workModeFilter]
  );

  function mergeUniqueById(prev: JobRow[], next: JobRow[]) {
    const map = new Map<string, JobRow>();
    for (const j of prev) map.set(j.id, j);
    for (const j of next) map.set(j.id, j);
    return Array.from(map.values());
  }

  const jobMatchesVisibleFilters = useCallback(
    (job: JobRow) =>
      jobMatchesCountryFilters(job, countryFilters) &&
      jobMatchesContractFilter(job, contractFilter) &&
      jobMatchesWorkModeFilter(job, workModeFilter),
    [countryFilters, contractFilter, workModeFilter]
  );

  const jobMatchesAlertCountryScope = useCallback(
    (job: JobRow) => {
      if (countryFilters.length || geoPrefs.allowAllCountries) return true;
      const country = (job.country ?? "").trim().toUpperCase();
      if (!country || country.length !== 2) return true;
      return geoPrefs.allowedCountries.has(country);
    },
    [countryFilters, geoPrefs]
  );

  const fetchJobsRange = useCallback(async (from: number, to: number) => {
    const effectiveTo = isPreview ? Math.min(to, from + PREVIEW_FETCH_CAP - 1) : to;
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_SELECT_FIELDS)
      .eq("is_active", true)
      .eq("is_expired", false)
      .in("job_status", ["active", "stale"])
      .or("quality_status.eq.ok,quality_status.is.null")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .range(from, effectiveTo);

    if (error) throw error;
    return (data ?? []) as JobRow[];
  }, [isPreview]);

  const fetchJobsSearch = useCallback(async (rawQuery: string) => {
    const effectiveSearchLimit = isPreview ? PREVIEW_FETCH_CAP : SEARCH_LIMIT;
    const countryCodes = countryFilters.filter((country) => country !== "REMOTE");
    const countryCode = countryCodes.length === 1 ? countryCodes[0] : resolveCountrySearchQuery(rawQuery);
    let query = supabase
      .from("jobs")
      .select(JOB_SELECT_FIELDS)
      .eq("is_active", true)
      .eq("is_expired", false)
      .in("job_status", ["active", "stale"])
      .or("quality_status.eq.ok,quality_status.is.null");

    if (countryCodes.length > 1) {
      query = query.in("country", countryCodes);
    } else if (countryCode) {
      query = query.eq("country", countryCode);
    }

    if (!countryCodes.length && !countryCode && normalizeSearchText(rawQuery).length >= TEXT_SEARCH_MIN_LENGTH) {
      const safeTerm = sanitizeJobSearchTerm(rawQuery);
      if (safeTerm.length < TEXT_SEARCH_MIN_LENGTH) {
        setWidenedCandidates([]);
        return [] as JobRow[];
      }
      const serverTerms = buildServerSearchTerms(rawQuery);

      // Run all term queries in parallel instead of sequentially: with a trigram
      // index in place each query is fast on its own, but awaiting them one by one
      // in a loop still sums their latencies (was the main cause of the multi-second
      // feed freeze diagnosed 2026-07-12, see migration 20260712140000).
      //
      // Passe par la fonction RPC search_active_jobs (migration
      // 20260805153000) plutôt que par .or(buildJobSearchTextAndQualityFilter)
      // directement : pour certains termes fréquents (ex. "manager"), le
      // planificateur Postgres ignorait les index trigram dédiés et
      // choisissait un plan bien plus lent, dépendant de la fréquence du
      // terme — cause du timeout confirmée en prod le 05/08/2026. La RPC
      // utilise une CTE MATERIALIZED comme barrière d'optimisation pour
      // forcer un plan stable quel que soit le terme recherché.
      const perTermResults = await Promise.all(
        serverTerms.map(async (term) => {
          const { data, error } = await supabase.rpc("search_active_jobs", {
            search_term: term,
            result_limit: effectiveSearchLimit,
          });
          if (error) throw error;
          return (data ?? []) as JobRow[];
        })
      );
      const results = perTermResults.flat();
      const merged = mergeUniqueById([], results).filter(jobMatchesVisibleFilters);
      const strict = merged.filter((job) => jobMatchesSearchQuery(job, rawQuery)).slice(0, effectiveSearchLimit);

      // Ajustement 5 : on ne propose l'élargissement que quand la recherche
      // stricte (AND de tous les mots) ne remonte rien, mais que des offres
      // partiellement pertinentes existent (au moins un mot / un champ en
      // commun, déjà filtrées sur l'activité et la qualité). Jamais montré
      // silencieusement mélangé aux résultats stricts.
      const strictIds = new Set(strict.map((job) => job.id));
      const widenedExtra = strict.length === 0 ? merged.filter((job) => !strictIds.has(job.id)).slice(0, 6) : [];
      setWidenedCandidates(widenedExtra);

      return strict;
    }

    setWidenedCandidates([]);
    const { data, error } = await query
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(effectiveSearchLimit);
    if (error) throw error;
    return ((data ?? []) as JobRow[]).filter((job) => jobMatchesSearchQuery(job, rawQuery)).filter(jobMatchesVisibleFilters);
  }, [countryFilters, jobMatchesVisibleFilters, isPreview]);
  const fetchJobsSearchRef = useRef(fetchJobsSearch);

  useEffect(() => {
    fetchJobsSearchRef.current = fetchJobsSearch;
  }, [fetchJobsSearch]);

  const hydrateJobDescriptions = useCallback(
    async (jobIds: string[], loadRunId: number, source: string) => {
      const ids = uniq(jobIds).slice(0, 30);
      if (!ids.length) return;

      const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        const { data, error } = await supabase
          .from("jobs")
          .select(JOB_DESCRIPTION_SELECT_FIELDS)
          .in("id", ids);

        if (error) throw error;
        if (loadRunIdRef.current !== loadRunId) return;

        const descriptions = new Map<string, string | null>();
        let descriptionChars = 0;
        for (const row of (data ?? []) as Array<{ id?: string; description?: string | null }>) {
          if (!row.id) continue;
          const description = row.description ?? null;
          descriptions.set(row.id, description);
          descriptionChars += description?.length ?? 0;
        }

        setJobs((prev) =>
          prev.map((job) =>
            descriptions.has(job.id)
              ? { ...job, description: descriptions.get(job.id) ?? null }
              : job
          )
        );

        logFeedPerf("hydrate descriptions", {
          source,
          jobs: descriptions.size,
          description_chars: descriptionChars,
          duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - startedAt),
        });
      } catch (e: unknown) {
        if (loadRunIdRef.current !== loadRunId) return;
        logFeedPerf("hydrate descriptions failed", {
          source,
          error: getErrorMessage(e),
          duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - startedAt),
        });
      }
    },
    [logFeedPerf]
  );

  const fetchProfileContext = useCallback(async () => {
    try {
      const { data: pData, error: pErr } = await supabase
        .from("profiles")
        .select("experience_years, headline, jobradar_onboarding")
        .eq("user_id", userId)
        .maybeSingle();

      if (pErr) return { experienceYears: null, desiredRole: "" };

      const profile = (pData as {
        experience_years?: unknown;
        headline?: unknown;
        jobradar_onboarding?: { profile?: { desiredRole?: unknown } | null } | null;
      } | null) ?? null;

      const desiredRole =
        collapseSpaces(String(profile?.jobradar_onboarding?.profile?.desiredRole ?? "")) ||
        collapseSpaces(String(profile?.headline ?? ""));

      return {
        experienceYears: toNumberOrNull(profile?.experience_years),
        desiredRole,
      };
    } catch {
      return { experienceYears: null, desiredRole: "" };
    }
  }, [userId]);

  const fetchCvContext = useCallback(async () => {
    try {
      const res = await invokeCvSave("get_active");
      if (res?.ok && res?.data) {
        const cvData = res.data;
        const cvJson = cvData?.cv_json ?? {};
        const expMin = toNumberOrNull(cvJson?.experience_years_min);
        const expMax = toNumberOrNull(cvJson?.experience_years_max);
        return {
          skills: Array.isArray(cvData?.skills) ? cvData.skills : [],
          exp: expMin != null || expMax != null ? { min: expMin, max: expMax } : null,
        };
      }
    } catch {
      // ignore optional CV context failures
    }

    return { skills: [] as string[], exp: null as { min: number | null; max: number | null } | null };
  }, []);

  const loadUserJobState = useCallback(
    async (targetUserId: string) => {
      try {
        const [{ data: appData, error: appErr }, { data: dData, error: dErr }] = await Promise.all([
          supabase.from("applications").select("job_id, status").eq("user_id", targetUserId).limit(5000),
          supabase
            .from("job_feedback")
            .select("job_id")
            .eq("user_id", targetUserId)
            .eq("action", "dismissed")
            .limit(5000),
        ]);

        if (appErr) throw appErr;
        if (dErr) throw dErr;

        const map = new Map<string, ApplicationStatus>();
        (appData ?? []).forEach((row: { job_id?: string; status?: ApplicationStatus }) => {
          if (row?.job_id && row?.status) map.set(row.job_id, row.status);
        });
        setAppStatusByJobId(map);

        const dismissedIds = (dData ?? [])
          .map((x: { job_id?: string }) => x.job_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        setDismissedJobIds(new Set(dismissedIds));
      } catch (e: unknown) {
        setErrorMsg((prev) => prev ?? GENERIC_SERVER_ERROR);
      }
    },
    []
  );

  const load = useCallback(async () => {
    if (!userId) return;

    clearDeferredFeedTasks();
    const loadRunId = loadRunIdRef.current + 1;
    loadRunIdRef.current = loadRunId;
    const isCurrentLoad = () => loadRunIdRef.current === loadRunId;
    const loadStartedAt = typeof performance !== "undefined" ? performance.now() : 0;

    setBusy(true);
    setErrorMsg(null);
    setWidenedAccepted(false);
    setWidenedDismissed(false);
    firstCardsLoggedRef.current = false;
    logFeedPerf("load start");

    try {
      const initialCriteria = currentFeedCriteriaRef.current;
      const [{ data: aData, error: aErr }, nextProfileContext] = await Promise.all([
        supabase
          .from("alerts")
          .select(ALERT_SELECT_FIELDS)
          .eq("user_id", userId)
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        fetchProfileContext(),
      ]);

      if (aErr) throw aErr;

      // Audit du 23/07/2026 : le rôle cible du profil (texte libre saisi à
      // l'onboarding, ex. "08041889" ou "For 5 ut tu" trouvés en base) ne doit
      // JAMAIS remplacer silencieusement une simple consultation par une
      // recherche texte bloquante. Mesuré sur un échantillon réel de profils :
      // 41% des rôles cibles ne correspondent littéralement à aucune offre
      // active, ce qui produisait un feed à zéro offre sans aucune erreur ni
      // explication. Le rôle cible reste utilisé plus bas comme signal de
      // pertinence (computeJobMatchScore / profileDesiredRole), jamais comme
      // filtre de récupération. Seule une recherche ou un filtre choisis
      // explicitement par l'utilisateur déclenchent le chemin "search".
      const shouldSearchInitial = hasFeedSearchCriteria(initialCriteria);
      const jobsFetchStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
      logFeedPerf("jobs fetch start", {
        since_load_start_ms: Math.round(jobsFetchStartedAt - loadStartedAt),
        mode: shouldSearchInitial ? "search" : "range",
        q: initialCriteria.q ? "yes" : "no",
        countries: initialCriteria.countries.length,
        contract: Boolean(initialCriteria.contract),
        work_mode: Boolean(initialCriteria.workMode),
      });
      const fetchedJobs = shouldSearchInitial
        ? await fetchJobsSearchRef.current(initialCriteria.q)
        : await fetchJobsRange(0, PAGE_SIZE - 1);
      const jobsFetchDuration = (typeof performance !== "undefined" ? performance.now() : 0) - jobsFetchStartedAt;

      if (!isCurrentLoad()) return;

      const initialDescriptionChars = fetchedJobs.reduce((sum, job) => sum + (job.description?.length ?? 0), 0);
      logFeedPerf("jobs fetch done", {
        duration_ms: Math.round(jobsFetchDuration),
        jobs: fetchedJobs.length,
        description_chars: initialDescriptionChars,
        query_payload: initialDescriptionChars > 0 ? "with_description" : "light",
      });

      setAlerts((aData ?? []) as AlertRow[]);
      setProfileExp(nextProfileContext.experienceYears);
      setProfileDesiredRole(nextProfileContext.desiredRole);
      setJobs(fetchedJobs);
      setPageFrom(fetchedJobs.length);
      setHasMore(shouldSearchInitial ? false : fetchedJobs.length === PAGE_SIZE);
      lastServerSearchQueryRef.current = shouldSearchInitial ? buildFeedCriteriaKey(initialCriteria) : "";
      setBusy(false);

      scheduleDeferredFeedTask(() => {
        if (!isCurrentLoad()) return;
        const cvStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
        void fetchCvContext().then((cvContext) => {
          if (!isCurrentLoad()) return;
          setCvSkills(cvContext.skills);
          setCvExp(cvContext.exp);
          logFeedPerf("cv_save done", {
            duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - cvStartedAt),
            skills: cvContext.skills.length,
            has_exp: Boolean(cvContext.exp),
          });
        });
      }, 50);

      scheduleDeferredFeedTask(() => {
        if (!isCurrentLoad()) return;
        void hydrateJobDescriptions(fetchedJobs.map((job) => job.id), loadRunId, shouldSearchInitial ? "initial_search" : "initial_range");
      }, 80);

      scheduleDeferredFeedTask(() => {
        if (!isCurrentLoad()) return;
        const userStateStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
        void loadUserJobState(userId).then(() => {
          if (!isCurrentLoad()) return;
          logFeedPerf("applications feedback done", {
            duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - userStateStartedAt),
          });
        });
      }, 150);

      scheduleDeferredFeedTask(() => {
        if (!isCurrentLoad()) return;
        if (!feedBackendShadowFlag) {
          logFeedPerf("jobradar_match_feed skipped", { reason: "shadow_flag_disabled" });
          return;
        }
        const shadowStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
        void fetchShadowFeed()
          .then((nextShadowFeed) => {
            if (!isCurrentLoad()) return;
            setShadowFeed(nextShadowFeed);
            logFeedPerf("jobradar_match_feed done", {
              duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - shadowStartedAt),
              top_match: nextShadowFeed.buckets.top_match.length,
              for_you: nextShadowFeed.buckets.for_you.length,
              explore: nextShadowFeed.buckets.explore.length,
            });
          })
          .catch(() => {
            if (!isCurrentLoad()) return;
            setShadowFeed(null);
            logFeedPerf("jobradar_match_feed failed", {
              duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - shadowStartedAt),
            });
          });
      }, 800);
    } catch (e: unknown) {
      if (!isCurrentLoad()) return;
      // Audit du 23/07/2026 : ce catch capte indifféremment une panne réseau,
      // un timeout Postgres (statement_timeout, cf. cause racine identifiée
      // côté cron de santé) ou un vrai bug, sans aucune trace exploitable.
      // On garde le message rassurant pour l'utilisateur, mais on ajoute une
      // référence courte, loguée en détail côté navigateur (et visible dans
      // les futurs outils d'observabilité), pour pouvoir retrouver l'incident
      // précis si quelqu'un le signale.
      const errorRef = Math.random().toString(36).slice(2, 8);
      console.error("[JobRadar feed] load failed", {
        ref: errorRef,
        message: getErrorMessage(e),
        at_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - loadStartedAt),
      });
      setErrorMsg(`${GENERIC_SERVER_ERROR} (réf. ${errorRef})`);
      setBusy(false);
    }
  }, [
    clearDeferredFeedTasks,
    fetchCvContext,
    fetchJobsRange,
    fetchProfileContext,
    fetchShadowFeed,
    feedBackendShadowFlag,
    hydrateJobDescriptions,
    loadUserJobState,
    logFeedPerf,
    scheduleDeferredFeedTask,
    userId,
  ]);

  async function loadMore() {
    if (!userId) return;
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    setErrorMsg(null);

    try {
      const from = pageFrom;
      const to = from + PAGE_SIZE - 1;

      const nextJobs = await fetchJobsRange(from, to);
      setJobs((prev) => mergeUniqueById(prev, nextJobs));

      setPageFrom(from + nextJobs.length);
      setHasMore(nextJobs.length === PAGE_SIZE);
      const loadMoreRunId = loadRunIdRef.current;
      scheduleDeferredFeedTask(() => {
        if (loadRunIdRef.current !== loadMoreRunId) return;
        void hydrateJobDescriptions(nextJobs.map((job) => job.id), loadMoreRunId, "load_more");
      }, 80);
    } catch (e: unknown) {
      setErrorMsg(GENERIC_SERVER_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!loading && session && userId) load();
  }, [loading, session, userId, load]);

  useEffect(() => {
    if (!userId || loading || busy) return;

    const rawQuery = q;
    const normalizedQuery = normalizeSearchText(rawQuery);
    const criteriaKey = buildFeedCriteriaKey({
      q: rawQuery,
      countries: countryFilters,
      contract: contractFilter,
      workMode: workModeFilter,
    });
    if (!normalizedQuery && !hasActiveSearchCriteria && !lastServerSearchQueryRef.current) return;
    if (criteriaKey === lastServerSearchQueryRef.current) return;

    let cancelled = false;
    clearDeferredFeedTasks();
    const timer = window.setTimeout(async () => {
      const searchRunId = loadRunIdRef.current + 1;
      loadRunIdRef.current = searchRunId;
      setErrorMsg(null);
      setSearchBusy(Boolean(normalizedQuery || countryFilters.length || contractFilter || workModeFilter));
      // Ajustement 5 : chaque nouvelle recherche repart sans élargissement —
      // on ne garde jamais un élargissement accepté d'une recherche précédente.
      setWidenedAccepted(false);
      setWidenedDismissed(false);

      try {
        const searchStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
        logFeedPerf("search jobs fetch start", {
          q: normalizedQuery ? "yes" : "no",
          countries: countryFilters.length,
          contract: Boolean(contractFilter),
          work_mode: Boolean(workModeFilter),
        });
        const nextJobs = normalizedQuery || countryFilters.length || contractFilter || workModeFilter
          ? await fetchJobsSearch(rawQuery)
          : await fetchJobsRange(0, PAGE_SIZE - 1);

        if (cancelled) return;

        const initialDescriptionChars = nextJobs.reduce((sum, job) => sum + (job.description?.length ?? 0), 0);
        logFeedPerf("search jobs fetch done", {
          duration_ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - searchStartedAt),
          jobs: nextJobs.length,
          description_chars: initialDescriptionChars,
          query_payload: initialDescriptionChars > 0 ? "with_description" : "light",
        });

        setJobs(nextJobs);
        setPageFrom(nextJobs.length);
        setHasMore(normalizedQuery || countryFilters.length || contractFilter || workModeFilter ? false : nextJobs.length === PAGE_SIZE);
        lastServerSearchQueryRef.current = criteriaKey;

        // Uniquement quand une vraie recherche/filtre a été appliqué (pas le
        // chargement par défaut du feed sans critère).
        if (normalizedQuery || countryFilters.length || contractFilter || workModeFilter) {
          trackSearch({
            searchTerm: rawQuery,
            country: countryFilters[0] ?? null,
            contractType: contractFilter || null,
            workMode: workModeFilter || null,
            resultsCount: nextJobs.length,
          });
        }
        scheduleDeferredFeedTask(() => {
          if (loadRunIdRef.current !== searchRunId) return;
          void hydrateJobDescriptions(nextJobs.map((job) => job.id), searchRunId, "search");
        }, 80);
      } catch (e: unknown) {
        if (cancelled) return;
        setErrorMsg(GENERIC_SERVER_ERROR);
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setSearchBusy(false);
    };
  }, [
    q,
    userId,
    loading,
    busy,
    countryFilter,
    countryFilters,
    contractFilter,
    workModeFilter,
    hasActiveSearchCriteria,
    clearDeferredFeedTasks,
    fetchJobsRange,
    fetchJobsSearch,
    hydrateJobDescriptions,
    logFeedPerf,
    scheduleDeferredFeedTask,
  ]);

  useEffect(() => {
    if (matchMode !== "strict" || !onlyVeryRelevant) {
      setShowTopMatchHelp(false);
    }
  }, [matchMode, onlyVeryRelevant]);

  async function addToApplications(jobId: string) {
    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }
    // Verrou synchrone (ref, pas state) contre le double-clic : un state
    // (addingJobId) ne se répercute qu'au prochain rendu, donc deux clics
    // rapprochés peuvent tous les deux passer avant que le bouton ne soit
    // désactivé, et déclencher chacun leur propre toast (ex: "Accès requis"
    // en double pour un compte gratuit). Le ref, lui, est à jour
    // immédiatement, dès le premier appel.
    if (savingJobIdsRef.current.has(jobId)) return;
    savingJobIdsRef.current.add(jobId);

    try {
      if (!allowPremium) {
        pushToast({ kind: "error", title: "Accès requis", message: STANDARD_GATE_MESSAGE });
        return;
      }
      if (appStatusByJobId.has(jobId)) return;

      setAddingJobId(jobId);
      setErrorMsg(null);

      try {
        const { data, error } = await supabase.rpc("save_job", { p_job_id: jobId });
        if (error) throw error;

        const returnedStatus =
          (data?.status as ApplicationStatus | undefined) ?? ("saved" as ApplicationStatus);

        setAppStatusByJobId((prev) => {
          const next = new Map(prev);
          next.set(jobId, returnedStatus);
          return next;
        });
        pushToast({
          kind: "success",
          title: "Offre sauvegardée",
          message: "Retrouve-la dans ta liste “À postuler”.",
        });
        setSavedHint(true);
      } catch (e: unknown) {
        const msg = GENERIC_SERVER_ERROR;
        setErrorMsg(msg);
        pushToast({ kind: "error", title: "Impossible de sauvegarder l’offre", message: msg });
      } finally {
        setAddingJobId(null);
      }
    } finally {
      savingJobIdsRef.current.delete(jobId);
    }
  }

  async function dismissJob(jobId: string) {
    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }
    if (dismissedJobIds.has(jobId)) return;

    setDismissingJobId(jobId);
    setErrorMsg(null);

    const { error } = await supabase
      .from("job_feedback")
      .upsert({ user_id: userId, job_id: jobId, action: "dismissed" }, { onConflict: "user_id,job_id" });

    setDismissingJobId(null);

    if (error) {
      setErrorMsg(GENERIC_SERVER_ERROR);
      return;
    }

    setDismissedJobIds((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
  }

  function buildCurrentAlertCriteria() {
    const searchQuery = collapseSpaces(q);
    const countries = countryFilters;
    const employmentTypes = contractFilter ? [contractFilter] : [];
    const workModes = workModeFilter ? [workModeFilter] : [];

    return {
      searchQuery,
      keywords: buildSearchAlertKeywords(searchQuery),
      countries,
      employmentTypes,
      workModes,
    };
  }

  function buildSearchAlertName() {
    const parts = [
      collapseSpaces(q),
      selectedOptionLabel(COUNTRY_FILTER_OPTIONS, countryFilter),
      selectedOptionLabel(CONTRACT_FILTER_OPTIONS, contractFilter),
      selectedOptionLabel(WORK_MODE_FILTER_OPTIONS, workModeFilter),
    ].filter(Boolean);
    return `Alerte ${parts.join(" · ")}`.slice(0, 110);
  }

  function isSameSearchAlert(alert: AlertRow, criteria: ReturnType<typeof buildCurrentAlertCriteria>) {
    const alertCountries = (alert.countries && alert.countries.length ? alert.countries : alert.country ? [alert.country] : []) as string[];
    const normalizedSearch = normalizeSearchText(criteria.searchQuery);
    const alertSearchFallback = normalizeSearchText(buildAlertSearchFallback(alert));
    const searchMatches = !normalizedSearch ||
      arraysEqualIgnoreOrder(alert.keywords ?? [], criteria.keywords) ||
      alertSearchFallback === normalizedSearch ||
      alertSearchFallback.includes(normalizedSearch);

    return searchMatches &&
      arraysEqualIgnoreOrder(alertCountries, criteria.countries) &&
      arraysEqualIgnoreOrder(alert.employment_types ?? [], criteria.employmentTypes) &&
      arraysEqualIgnoreOrder(alert.work_modes ?? [], criteria.workModes);
  }

  async function saveCurrentSearchAsAlert() {
    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }
    if (isLoadingPass) {
      pushToast({ kind: "info", title: "Chargement de ton accès", message: "Réessaie dans un instant." });
      return;
    }
    if (!hasActiveSearchCriteria || alertSaveBusy) {
      const message = "Ajoute une recherche, un pays, un contrat ou un mode de travail avant de créer une alerte.";
      setAlertNotice({ kind: "error", title: "Aucun critère défini", message });
      pushToast({ kind: "error", title: "Aucun critère défini", message });
      return;
    }

    setAlertSaveBusy(true);
    setAlertNotice(null);
    setErrorMsg(null);

    try {
      const criteria = buildCurrentAlertCriteria();
      const { data: activeAlerts, error: activeErr } = await supabase
        .from("alerts")
        .select(ALERT_SELECT_FIELDS)
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .returns<AlertRow[]>();

      if (activeErr) throw activeErr;

      const activeRows = activeAlerts ?? [];
      if (activeRows.some((alert) => isSameSearchAlert(alert, criteria))) {
        const message = "Cette alerte existe déjà.";
        setAlertNotice({ kind: "info", title: "Alerte déjà active", message });
        pushToast({ kind: "info", title: "Alerte déjà active", message });
        return;
      }

      if (!allowPremium && activeRows.length >= FREE_ACTIVE_ALERT_LIMIT) {
        setAlertNotice({ kind: "info", title: "Limite gratuite atteinte", message: FREE_ALERT_LIMIT_MESSAGE });
        pushToast({ kind: "info", title: "Limite gratuite atteinte", message: FREE_ALERT_LIMIT_MESSAGE });
        return;
      }

      if (allowPremium && activeRows.length >= 3) {
        const existing = activeRows.slice(0, 3).map((alert) => alert.name).filter(Boolean).join(", ");
        const message = `Tu as déjà 3 alertes actives. Pour ajouter celle-ci, désactive une alerte existante.${existing ? ` Alertes actives : ${existing}.` : ""}`;
        setAlertNotice({ kind: "info", title: "Limite atteinte", message });
        pushToast({ kind: "info", title: "Limite atteinte", message: "Désactive une alerte existante pour ajouter celle-ci." });
        return;
      }

      const countriesToSave = criteria.countries.length ? criteria.countries : null;
      const legacyCountry = countriesToSave?.[0] ?? null;
      const { data: created, error: insertErr } = await supabase
        .from("alerts")
        .insert({
          user_id: userId,
          name: buildSearchAlertName(),
          keywords: criteria.keywords,
          country: legacyCountry,
          countries: countriesToSave,
          employment_types: criteria.employmentTypes,
          work_modes: criteria.workModes,
          frequency: "daily",
          channels: ["email"],
          is_active: true,
        })
        .select(ALERT_SELECT_FIELDS)
        .single<AlertRow>();

      if (insertErr) throw insertErr;

      if (created) {
        setAlerts((prev) => [created, ...prev.filter((alert) => alert.id !== created.id)]);
      }

      const message = "Tu recevras les nouvelles offres correspondant à cette recherche par email.";
      setAlertNotice({ kind: "success", title: "Alerte créée", message });
      pushToast({ kind: "success", title: "Alerte créée", message });
    } catch (e: unknown) {
      const message = GENERIC_SERVER_ERROR;
      setErrorMsg(message);
      setAlertNotice({ kind: "error", title: "Création impossible", message });
      pushToast({ kind: "error", title: "Création impossible", message });
    } finally {
      setAlertSaveBusy(false);
    }
  }

  const matches = useMemo(() => {
    const scoringStartedAt = feedPerfDebug && typeof performance !== "undefined" ? performance.now() : 0;
    const kwAlerts = uniq(cappedAlertKeywords.map((k) => canonicalizeText(k)).map(norm)).filter(Boolean);
    const kwCv = uniq(cvKeywords.map((k) => String(k ?? "").trim()).filter(Boolean));
    const kwCount = kwAlerts.length + kwCv.length;
    const effectiveExp = cvExp ?? (profileExp != null ? { min: profileExp, max: profileExp } : null);

    const baseRows = jobs
      .map((job): MatchRow | null => {
        const hay = buildJobHay(job);
        if (!jobMatchesSearchQuery(job, q)) return null;
        if (!jobMatchesVisibleFilters(job)) return null;

        const scored = computeJobMatchScore({
          job,
          alertKeywords: kwAlerts,
          cvKeywords: kwCv,
          cvExp: effectiveExp,
          geoPrefs,
          desiredRole: profileDesiredRole,
          hay,
          maxShown: 5,
          topMatchThreshold: STRICT_MIN_PERCENT,
        });

        return {
          job,
          s: scored.s,
          p: scored.score,
          kwCount,
          signalCount: scored.signalCount,
          expOk: scored.expOk,
          geoRemote: scored.geoRemote,
          skillsQuality: scored.skillsQuality,
          dataQuality: scored.dataQuality,
          why: scored.why,
        };
      })
      .filter((x): x is MatchRow => Boolean(x));

    const forYouRows = baseRows
      .filter((x) =>
        x.signalCount
          ? x.s >= 1 || x.expOk || x.geoRemote.points_awarded > 0 || x.skillsQuality.points_awarded > 0
          : true
      )
      .filter((x) => {
        if (geoPrefs.allowAllCountries) return true;

        const jc = (x.job.country ?? "").trim().toUpperCase();
        if (!jc) return true;
        if (jc.length !== 2) return true;

        return geoPrefs.allowedCountries.has(jc);
      })
      .filter((x) => x.p >= MIN_FOR_YOU)
      .filter((x) => !appStatusByJobId.has(x.job.id))
      .filter((x) => !dismissedJobIds.has(x.job.id))
      .sort((a, b) => {
        if (b.p !== a.p) return b.p - a.p;
        if (b.s !== a.s) return b.s - a.s;
        return getJobTimeMs(b.job) - getJobTimeMs(a.job);
      });

    const isExplorerRelevant = (job: JobRow) => {
      const country = (job.country ?? "").trim().toUpperCase();
      const inAfrica = AFRICA_COUNTRIES.has(country);
      const geoHit = !geoPrefs.allowAllCountries && geoPrefs.allowedCountries.has(country);
      const remoteHit = isRemoteLike(`${job.remote_type ?? ""} ${job.location ?? ""}`);
      return remoteHit || inAfrica || geoHit;
    };

    const explorerRows = baseRows
      .filter((x) => !appStatusByJobId.has(x.job.id))
      .filter((x) => !dismissedJobIds.has(x.job.id))
      .sort((a, b) => {
        const aRel = isExplorerRelevant(a.job) ? 1 : 0;
        const bRel = isExplorerRelevant(b.job) ? 1 : 0;
        if (bRel !== aRel) return bRel - aRel;
        if (b.p !== a.p) return b.p - a.p;
        return getJobTimeMs(b.job) - getJobTimeMs(a.job);
      });

    const topMatches = forYouRows.filter(
      (x) => x.p >= TOP_MATCH_MIN && (x.dataQuality?.score ?? 0) >= TOP_MATCH_DQ_MIN
    );

    const result = { topMatches, exploreMatches: explorerRows, forYouRows, kwCount };
    if (feedPerfDebug && jobs.length > 0) {
      const scoringDuration = Math.round((typeof performance !== "undefined" ? performance.now() : 0) - scoringStartedAt);
      queueMicrotask(() =>
        logFeedPerf("client scoring done", {
          duration_ms: scoringDuration,
          jobs: jobs.length,
          with_description: jobs.filter((job) => Boolean(job.description)).length,
          top_match: result.topMatches.length,
          for_you: result.forYouRows.length,
          explore: result.exploreMatches.length,
        })
      );
    }
    return result;
  }, [
    jobs,
    cappedAlertKeywords,
    cvKeywords,
    cvExp,
    profileExp,
    profileDesiredRole,
    q,
    geoPrefs,
    appStatusByJobId,
    dismissedJobIds,
    jobMatchesVisibleFilters,
    STRICT_MIN_PERCENT,
    TOP_MATCH_MIN,
    TOP_MATCH_DQ_MIN,
    MIN_FOR_YOU,
    feedPerfDebug,
    logFeedPerf,
  ]);

  const shadowMeta: JobRadarShadowMeta | null = shadowFeed?.meta ?? null;

  const localFeedBuckets = useMemo(
    () => ({
      top_match: matches.topMatches,
      for_you: matches.forYouRows,
      explore: matches.exploreMatches,
    }),
    [matches.topMatches, matches.forYouRows, matches.exploreMatches]
  );

  const shadowComparison: ShadowFeedComparison | null = useMemo(() => {
    if (!shadowFeed) return null;
    return compareShadowAndLocalBuckets(localFeedBuckets, shadowFeed.buckets);
  }, [localFeedBuckets, shadowFeed]);

  useEffect(() => {
    if (!import.meta.env?.DEV || !shadowComparison) return;
    console.info("[JobRadar] shadow feed comparison", shadowComparison);
  }, [shadowComparison]);

  const normalizedDesiredRole = useMemo(() => keyify(profileDesiredRole), [profileDesiredRole]);
  const hasValidShadowBuckets = Boolean(
    shadowFeed?.buckets &&
      Array.isArray(shadowFeed.buckets.top_match) &&
      Array.isArray(shadowFeed.buckets.for_you) &&
      Array.isArray(shadowFeed.buckets.explore)
  );
  const shouldUseShadowVisibleFeed =
    feedBackendShadowFlag &&
    shadowMeta?.profile_mode === "rich" &&
    normalizedDesiredRole === "data analyst" &&
    hasValidShadowBuckets;

  const rawVisibleFeedBuckets =
    shouldUseShadowVisibleFeed && shadowFeed?.buckets
      ? shadowFeed.buckets
      : localFeedBuckets;
  const visibleFeedBuckets = useMemo(
    () => ({
      top_match: rawVisibleFeedBuckets.top_match.filter((row: FeedDisplayRow) =>
        jobMatchesVisibleFilters(row.job) && jobMatchesAlertCountryScope(row.job)
      ),
      for_you: rawVisibleFeedBuckets.for_you.filter((row: FeedDisplayRow) =>
        jobMatchesVisibleFilters(row.job) && jobMatchesAlertCountryScope(row.job)
      ),
      explore: rawVisibleFeedBuckets.explore.filter((row: FeedDisplayRow) => jobMatchesVisibleFilters(row.job)),
    }),
    [rawVisibleFeedBuckets, jobMatchesVisibleFilters, jobMatchesAlertCountryScope]
  );

  const forYouRows = visibleFeedBuckets.for_you.filter((row: FeedDisplayRow) => {
    if (!onlyVeryRelevant) return true;
    return row.p >= TOP_MATCH_MIN;
  });

  const topCount = visibleFeedBuckets.top_match.length;
  const forYouCount = visibleFeedBuckets.for_you.length;
  const exploreCount = visibleFeedBuckets.explore.length;
  const shadowUi = useMemo(() => buildJobRadarShadowUi(shadowMeta, topCount), [shadowMeta, topCount]);
  const hasSearchQuery = normalizeSearchText(q).length > 0;
  const showForYouTab = forYouCount >= FOR_YOU_TAB_MIN_COUNT;
  const showModeTabs = showForYouTab || exploreCount > 0;
  const exploreTabLabel = hasSearchQuery ? "Résultats disponibles" : shadowUi.largeTabLabel;
  const effectiveMatchMode = showForYouTab && matchMode === "strict" ? "strict" : "large";
  const displayed = effectiveMatchMode === "strict" ? forYouRows : visibleFeedBuckets.explore;
  const displayedLimited = isPreview ? displayed.slice(0, FEED_PREVIEW_LIMIT) : displayed;
  const showGateOnDisplayed = isPreview && displayed.length > FEED_PREVIEW_LIMIT;
  const showNoSearchResultsState = hasSearchQuery && exploreCount === 0 && forYouCount === 0;
  const showNoPreciseMatchState = effectiveMatchMode === "strict" && forYouCount === 0 && exploreCount > 0;
  const forYouPillLabel =
    exploreCount > 0 && forYouCount < FOR_YOU_TAB_MIN_COUNT
      ? "Résultats disponibles"
      : getJobRadarShadowPillLabel(shadowMeta, forYouCount);
  const hasCvContext = cvKeywords.length > 0 || cvExp != null;
  const feedAdvisorMode = useMemo(() => {
    if (busy || matchMode !== "strict" || alerts.length === 0 || forYouCount === 0) return null;
    const lowSignal = topCount === 0 || forYouCount <= 3;
    if (!lowSignal) return null;
    if (!hasCvContext) return "needs_cv" as const;
    if (alerts.length < 2 || alertKeywords.length < 4) return "needs_alerts" as const;
    return "needs_profile" as const;
  }, [busy, matchMode, alerts.length, forYouCount, topCount, hasCvContext, alertKeywords.length]);
  const feedAdvisor = useMemo(
    () => (feedAdvisorMode ? getJobRadarAdvisorCopy({ key: "feed", mode: feedAdvisorMode }) : null),
    [feedAdvisorMode]
  );

  useEffect(() => {
    if (!feedPerfDebug || firstCardsLoggedRef.current || busy || displayedLimited.length === 0) return;
    const rafId = window.requestAnimationFrame(() => {
      firstCardsLoggedRef.current = true;
      logFeedPerf("first cards visible", {
        displayed: displayedLimited.length,
        total_displayed: displayed.length,
        with_description: displayedLimited.filter((row) => Boolean(row.job.description)).length,
      });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [feedPerfDebug, busy, displayedLimited, displayed.length, logFeedPerf]);

  useEffect(() => {
    if (shadowUi.showStrictTab) return;
    if (matchMode === "strict") setOnlyVeryRelevant(false);
  }, [shadowUi.showStrictTab, matchMode]);

  useEffect(() => {
    if (shadowUi.showOnlyVeryRelevantToggle) return;
    if (onlyVeryRelevant) setOnlyVeryRelevant(false);
  }, [shadowUi.showOnlyVeryRelevantToggle, onlyVeryRelevant]);

  useEffect(() => {
    if (hasUserSelectedMode) return;
    const nextMode =
      showForYouTab && shadowUi.showStrictTab && shadowUi.preferredMode === "strict"
        ? "strict"
        : "large";
    setMatchMode((prev) => (prev === nextMode ? prev : nextMode));
  }, [shadowUi.showStrictTab, shadowUi.preferredMode, hasUserSelectedMode, matchMode, showForYouTab]);

  const closeOfferUnlockModal = useCallback(() => {
    setOfferUnlockModal(null);
  }, []);

  useEffect(() => {
    if (!offerUnlockModal) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOfferUnlockModal();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [offerUnlockModal, closeOfferUnlockModal]);

  const launchPassActivation = useCallback(() => {
    closeOfferUnlockModal();
    navigate("/pricing");
  }, [closeOfferUnlockModal, navigate]);

  const openOfferUnlockGate = useCallback(
    (title?: string | null, payload?: Record<string, unknown>) => {
      if (isLoadingPass) return true;
      if (allowPremium) return false;
      if (payload) trackJobRadarEvent("offer_gate_open", payload);
      setOfferUnlockModal({ title: title?.trim() || "Offre sans titre" });
      return true;
    },
    [allowPremium, isLoadingPass]
  );

  const openJob = (jobId: string, jobTitle?: string | null, payload?: Record<string, unknown>) => {
    if (openOfferUnlockGate(jobTitle, payload)) return;
    if (payload) trackJobRadarEvent("job_open", payload);
    trackSelectContent({ itemId: jobId });
    navigate(`/jobradar/jobs/${jobId}`);
  };

  // Ajustement 5 : on notifie une seule fois par recherche distincte qu'un
  // élargissement est disponible (déduplication via lastServerSearchQueryRef,
  // qui change à chaque nouvelle recherche/filtre appliqué).
  useEffect(() => {
    if (!widenedCandidates.length) return;
    const key = lastServerSearchQueryRef.current;
    if (!key || widenedOfferedTrackedKeyRef.current === key) return;
    widenedOfferedTrackedKeyRef.current = key;
    trackWidenedResultsOffered({ resultsOffered: widenedCandidates.length });
  }, [widenedCandidates]);

  const acceptWidenedResults = () => {
    setWidenedAccepted(true);
    trackWidenedResultsAccepted();
  };

  const declineWidenedResults = () => {
    setWidenedDismissed(true);
    trackWidenedResultsDeclined();
  };

  const buildMatchEventPayload = useCallback(
    (row: FeedDisplayRow) => {
      const details = row.why.details;
      return {
        job_id: row.job.id,
        score: row.p,
        is_top_match: row.p >= TOP_MATCH_MIN && (row.dataQuality?.score ?? 0) >= TOP_MATCH_DQ_MIN,
        matched_alert_count: details?.breakdown.alert.matched_count ?? 0,
        matched_cv_count: details?.breakdown.cv.matched_count ?? 0,
        exp_ok: details?.breakdown.experience.ok ?? false,
        geo_remote_level: details?.breakdown.geo_remote.level ?? "unknown",
        required_bonus_applied: (details?.breakdown.skills_quality.points_awarded ?? 0) > 0,
      };
    },
    [TOP_MATCH_MIN, TOP_MATCH_DQ_MIN]
  );
  const gateCard = (
    <div className="jr-gateCard" role="group" aria-label="Accès complet JobRadar">
      <div className="jr-gateTitle">Débloque plus d’offres adaptées à ton profil</div>
      <div className="jr-gateText">{FEED_GATE_MESSAGE}</div>
      <div className="jr-gateReassurance" aria-label="Réassurance paiement">
        {FEED_GATE_REASSURANCE.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <button className="jrBtn jrBtnPrimary" type="button" onClick={launchPassActivation}>
        Choisir mon pass
      </button>
    </div>
  );
  const hasServerSearchQuery = normalizeSearchText(q).length > 0;

  return (
    <div className="jr-shell">
      <main className="jr-main">
        <OnboardingAlertInviteBanner />

        <section className="jr-hero">
          <div className="jr-heroTop">
            <div>
              <div className="jr-kicker">JobRadar</div>
              <h1>{shadowUi.heroTitle}</h1>
              <p>{shadowUi.heroDescription}</p>
            </div>

            <div className="jr-pillRow" aria-label="Statistiques">
              <span className="jr-pillHero">
                {alerts.length} alerte{alerts.length > 1 ? "s" : ""} active{alerts.length > 1 ? "s" : ""}
              </span>
              <span className="jr-pillHero">
                {displayed.length}{" "}
                offre
                {displayed.length > 1 ? "s" : ""}
              </span>
              <span className="jr-pillHero jr-pillStrong">
                {forYouPillLabel}
              </span>
            </div>
          </div>

          <div className="jr-searchRow">
            <div className="jr-searchInput">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M10.5 3a7.5 7.5 0 015.95 12.1l3.23 3.23a1 1 0 01-1.42 1.42l-3.23-3.23A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"
                  fill="currentColor"
                />
              </svg>
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filtrer (ex. data analyst, react, project manager…)"
                aria-label="Filtrer les offres"
              />
              {q ? (
                <button className="jr-clearBtn" type="button" onClick={() => setQ("")} aria-label="Effacer le filtre">
                  ×
                </button>
              ) : null}
            </div>

            {showModeTabs && (
            <div className="jr-modeToggle" role="tablist" aria-label="Mode de tri des offres">
              {shadowUi.showStrictTab && showForYouTab && (
                <button
                  className={effectiveMatchMode === "strict" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => {
                    setHasUserSelectedMode(true);
                    setMatchMode("strict");
                    trackJobRadarEvent("match_mode_select", { mode: "strict", forYouCount, exploreCount });
                  }}
                  disabled={busy || forYouCount === 0}
                  title="Offres les plus pertinentes pour toi"
                  aria-pressed={effectiveMatchMode === "strict"}
                >
                  Pour toi ({forYouCount})
                </button>
              )}

              <button
                className={effectiveMatchMode === "large" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => {
                  setHasUserSelectedMode(true);
                  setMatchMode("large");
                  trackJobRadarEvent("match_mode_select", { mode: "large", forYouCount, exploreCount });
                }}
                disabled={busy}
                title="Explorer les offres du moment"
                aria-pressed={effectiveMatchMode === "large"}
              >
                {exploreTabLabel} ({exploreCount})
              </button>
            </div>
            )}

            <button className="jrBtn jrBtnOutline" onClick={load} disabled={busy} type="button">
              {busy ? "Chargement…" : "Rafraîchir"}
            </button>
          </div>

          <div className="jr-filters" aria-label="Filtres de recherche">
            <label className="jr-filterSelect">
              <span>Pays</span>
              <select
                value={countryFilter}
                onChange={(e) => {
                  const nextCountry = e.target.value;
                  setCountryFilter(nextCountry);
                  setCountryFilters(nextCountry ? [nextCountry] : []);
                }}
              >
                {COUNTRY_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="jr-filterSelect">
              <span>Contrat</span>
              <select value={contractFilter} onChange={(e) => setContractFilter(e.target.value)}>
                {CONTRACT_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="jr-filterSelect">
              <span>Mode</span>
              <select value={workModeFilter} onChange={(e) => setWorkModeFilter(e.target.value)}>
                {WORK_MODE_FILTER_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {hasActiveSearchCriteria && (
            <div className="jr-alertActionRow">
              <button
                className="jrBtn jrBtnPrimary"
                type="button"
                onClick={saveCurrentSearchAsAlert}
                disabled={alertSaveBusy || busy}
              >
                {alertSaveBusy ? "Création…" : "Recevoir ces offres par email"}
              </button>
              <button
                className="jrBtn jrBtnGhost"
                type="button"
                onClick={() => {
                  setQ("");
                  setCountryFilter("");
                  setContractFilter("");
                  setWorkModeFilter("");
                  setAlertNotice(null);
                }}
                disabled={alertSaveBusy || busy}
              >
                Effacer les critères
              </button>
            </div>
          )}

          <div className="jr-subline">
            {getJobRadarShadowSubline(shadowMeta, matchMode)}
          </div>

          {hasServerSearchQuery && searchBusy && (
            <div className="jr-subline" aria-live="polite">
              Recherche en cours…
            </div>
          )}

          {matchMode === "strict" && shadowUi.showOnlyVeryRelevantToggle && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className={onlyVeryRelevant ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => setOnlyVeryRelevant((v) => !v)}
                disabled={busy}
              >
                Uniquement très pertinent
              </button>
            </div>
          )}

        </section>

        {shadowUi.guidanceCard && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title={shadowUi.guidanceCard.title}
              message={shadowUi.guidanceCard.message}
              primaryAction={{
                label: shadowUi.guidanceCard.primaryActionLabel,
                to: shadowUi.guidanceCard.primaryActionTo,
              }}
              secondaryAction={
                shadowUi.profileMode === "alerts_only" || shadowUi.profileMode === "cold_start"
                  ? {
                      label: shadowUi.profileMode === "alerts_only" ? "Explorer les offres" : "Voir les offres récentes",
                      onClick: () => {
                        setHasUserSelectedMode(true);
                        setMatchMode("large");
                        scrollToResults();
                      },
                    }
                  : undefined
              }
              tone="info"
            />
          </div>
        )}

        {!shadowUi.guidanceCard && feedAdvisor && (
          <JobRadarAdvisor
            {...feedAdvisor}
            variant="compact"
            dismissible
            dismissKey={`feed-${feedAdvisorMode}`}
            className="jr-advisorSlot"
            cta={
              feedAdvisorMode === "needs_cv"
                ? { label: feedAdvisor.ctaLabel ?? "Ajouter mon CV", to: "/me/cv" }
                : feedAdvisorMode === "needs_alerts"
                ? { label: feedAdvisor.ctaLabel ?? "Ajuster mes alertes", to: "/jobradar/alerts" }
                : { label: feedAdvisor.ctaLabel ?? "Ajuster mon profil", to: "/profile" }
            }
          />
        )}

        {errorMsg && (
          <div className="jr-error">
            <div className="jr-errorText">Erreur : {errorMsg}</div>
            <button className="jrBtn jrBtnGhost" onClick={load} type="button">
              Recharger les offres
            </button>
          </div>
        )}

        {alertNotice && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title={alertNotice.title}
              message={alertNotice.message}
              primaryAction={
                alertNotice.title === "Limite atteinte"
                  ? { label: "Gérer mes alertes", to: "/jobradar/alerts" }
                  : { label: "OK", onClick: () => setAlertNotice(null) }
              }
              secondaryAction={
                alertNotice.title === "Limite atteinte"
                  ? { label: "Continuer la recherche", onClick: () => setAlertNotice(null) }
                  : undefined
              }
              tone={alertNotice.kind === "success" ? "success" : alertNotice.kind === "error" ? "neutral" : "info"}
            />
          </div>
        )}

        {showTip && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title="Astuce JobRadar"
              message="Sauvegarde les offres intéressantes pour les retrouver plus tard."
              primaryAction={{ label: "Compris", onClick: () => setShowTip(false) }}
              tone="info"
            />
          </div>
        )}

        {shadowUi.showStrictTab && matchMode === "strict" && onlyVeryRelevant && forYouCount > 0 && topCount === 0 && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title="Aucune offre très adaptée aujourd’hui"
              message="On a trouvé des offres “Pour toi”, mais aucune ne ressort encore parmi les offres les plus adaptées en mode strict."
              primaryAction={{
                label: "Voir Pour toi",
                onClick: () => {
                  setOnlyVeryRelevant(false);
                  setShowTopMatchHelp(false);
                  scrollToResults();
                },
              }}
              secondaryAction={{
                label: "Voir plus d’offres",
                onClick: () => setShowTopMatchHelp((prev) => !prev),
              }}
              tone="info"
            />
            {showTopMatchHelp && (
              <div className="jr-topMatchPanel" role="note" aria-live="polite">
                <div className="jr-topMatchPanelTitle">Comment cette sélection est-elle construite ?</div>
                <div className="jr-topMatchPanelText">
                  JobRadar met en avant les offres les plus proches de ton profil et de tes critères. Tu peux élargir
                  la sélection pour découvrir plus d’opportunités.
                </div>
                <div className="jr-topMatchPanelActions">
                  <button
                    className="jrBtn jrBtnOutline"
                    type="button"
                    onClick={() => {
                      setOnlyVeryRelevant(false);
                      setShowTopMatchHelp(false);
                      scrollToResults();
                    }}
                  >
                    Voir plus d’offres
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {shadowUi.showStrictTab && matchMode === "strict" && onlyVeryRelevant && forYouCount > 0 && forYouRows.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title="Aucune offre très pertinente"
              message="Désactive le filtre pour voir plus d’offres adaptées."
              primaryAction={{
                label: "Désactiver le filtre",
                onClick: () => setOnlyVeryRelevant(false),
              }}
              tone="info"
            />
          </div>
        )}

        {savedHint && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title="Offre sauvegardée dans À postuler"
              message="Retrouve cette offre dans ta liste pour organiser tes candidatures."
              primaryAction={{ label: "Voir ma liste", to: "/jobradar/applications" }}
              secondaryAction={{ label: "Continuer à explorer", onClick: () => setSavedHint(false) }}
              tone="success"
            />
          </div>
        )}

        {busy ? (
          <div className="jr-grid" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <JobCardSkeleton key={`sk_${i}`} index={i} />
            ))}
            <div className="sr-only">Chargement des offres…</div>
          </div>
        ) : alerts.length === 0 && !shadowUi.suppressNoAlertsEmptyState ? (
          <EmptyState
            title="Tu n’as pas encore d’alerte"
            description="Crée une alerte pour recevoir des offres mieux ciblées."
            primaryAction={{ label: "Créer une alerte", to: "/jobradar/alerts" }}
            secondaryAction={{ label: "Améliorer mon profil", to: "/jobradar/profile" }}
            tone="info"
          />
        ) : displayed.length === 0 ? (
          showNoSearchResultsState ? (
            <>
              <EmptyState
                title="Aucune offre trouvée pour cette recherche"
                description="Essaie un autre mot-clé, un autre pays, ou efface les critères pour revenir à toutes les offres."
                primaryAction={{
                  label: "Effacer les critères",
                  onClick: () => {
                    setQ("");
                    setCountryFilter("");
                    setContractFilter("");
                    setWorkModeFilter("");
                  },
                }}
                secondaryAction={{ label: "Recharger les offres", onClick: () => load() }}
                tone="info"
              />

              {/* Ajustement 5 : élargissement opt-in, non permanent — ne
                  touche jamais aux critères enregistrés de l'alerte. */}
              {widenedCandidates.length > 0 && !widenedAccepted && !widenedDismissed && (
                <div className="jr-widenOffer" role="group" aria-label="Élargir la recherche">
                  <div className="jr-widenOfferText">
                    {widenedCandidates.length} offre{widenedCandidates.length > 1 ? "s" : ""} correspondent
                    partiellement à ta recherche. Les voir quand même&nbsp;?
                  </div>
                  <div className="jr-widenOfferActions">
                    <button type="button" className="jrBtn jrBtnPrimary" onClick={acceptWidenedResults}>
                      Voir ces résultats élargis
                    </button>
                    <button type="button" className="jrBtn jrBtnGhost" onClick={declineWidenedResults}>
                      Non merci
                    </button>
                  </div>
                </div>
              )}

              {widenedAccepted && widenedCandidates.length > 0 && (
                <div className="jr-widenResults" aria-label="Résultats élargis">
                  <div className="jr-widenResultsLabel">
                    Résultats élargis — en dehors de tes critères stricts, non enregistrés dans ton alerte
                  </div>
                  <div className="jr-grid">
                    {widenedCandidates.map((job, index) => {
                      const locationLabel = [job.location ?? job.country, job.remote_type].filter(Boolean).join(" · ");
                      return (
                        <div
                          className="jr-card jr-card--enter jr-card--widened"
                          style={{ ["--sk-delay" as any]: `${Math.min(index, 7) * 25}ms` }}
                          key={job.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openJob(job.id, job.title, { job_id: job.id, source: "widened_search" })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openJob(job.id, job.title, { job_id: job.id, source: "widened_search" });
                            }
                          }}
                        >
                          <div className="jr-cardTop">
                            <div className="jr-cardHeadLeft">
                              <CompanyAvatar
                                companyName={job.company_name}
                                applyUrl={job.apply_url}
                                sourceUrl={job.source_url}
                                avatarClassName="jr-avatar"
                                imgClassName="jr-avatarImg"
                              />
                              <div className="jr-title">{job.title ?? "—"}</div>
                            </div>
                            <span className="jr-score jr-scoreWidened">Résultat élargi</span>
                          </div>
                          <div className="jr-meta">
                            <span className="jr-company">{job.company_name ?? "—"}</span>
                            <span className="jr-metaSep">•</span>
                            <span className="jr-location">{locationLabel || "—"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : showNoPreciseMatchState ? (
            <EmptyState
              title="Aucune offre très proche de tes critères pour l’instant"
              description="Essaie d’élargir tes critères ou consulte toutes les offres."
              primaryAction={{
                label: "Consulter toutes les offres",
                onClick: () => {
                  setHasUserSelectedMode(true);
                  setMatchMode("large");
                  scrollToResults();
                },
              }}
              secondaryAction={{ label: "Élargir mes critères", to: "/jobradar/profile" }}
              tone="info"
            />
          ) : shadowUi.profileMode === "alerts_only" ? (
            <EmptyState
              title="Tes alertes ne suffisent pas encore pour personnaliser les offres"
              description="Définis un rôle cible pour aider JobRadar à mieux recommander les offres selon ton projet."
              primaryAction={{ label: "Définir mon rôle cible", to: "/jobradar/profile" }}
              secondaryAction={{
                label: "Rafraîchir",
                onClick: () => load(),
              }}
              tone="neutral"
            />
          ) : shadowUi.profileMode === "cv_only" ? (
            <EmptyState
              title="Peu d’offres ressortent encore de ton CV"
              description="Tes compétences donnent déjà une bonne base, mais ajouter un rôle cible aidera à mieux prioriser les offres."
              primaryAction={{ label: "Ajouter un rôle cible", to: "/jobradar/profile" }}
              secondaryAction={{
                label: "Explorer les offres",
                onClick: () => {
                  setHasUserSelectedMode(true);
                  setMatchMode("large");
                  scrollToResults();
                },
              }}
              tone="neutral"
            />
          ) : shadowUi.profileMode === "cold_start" ? (
            <EmptyState
              title="Complète ton profil pour débloquer de meilleures recommandations"
              description="Pour l’instant, on préfère ne montrer que les opportunités les plus lisibles. Ajoute quelques informations pour aller plus loin."
              primaryAction={{ label: "Compléter le profil", to: "/jobradar/profile" }}
              secondaryAction={{
                label: "Rafraîchir",
                onClick: () => load(),
              }}
              tone="neutral"
            />
          ) : (
            <EmptyState
              title="Aucune offre pour tes alertes aujourd’hui"
              description="On n’a rien trouvé pour tes alertes aujourd’hui. Tu peux élargir tes critères ou explorer les offres du moment."
              primaryAction={{ label: "Recharger les offres", onClick: () => load() }}
              secondaryAction={{
                label: "Explorer plus d’opportunités",
                onClick: () => {
                  setHasUserSelectedMode(true);
                  setMatchMode("large");
                  scrollToResults();
                },
              }}
              tone="neutral"
            />
          )
        ) : (
          <>
            <div className="jr-grid" id="jr-results">
              <>
                {displayedLimited.map((row: FeedDisplayRow, index: number) => {
                  const { job, p, why, dataQuality } = row;
                  const eventPayload = buildMatchEventPayload(row);
                  const isAdding = addingJobId === job.id;
                  const isDismissing = dismissingJobId === job.id;
                const isTopMatch = p >= TOP_MATCH_MIN && (dataQuality?.score ?? 0) >= TOP_MATCH_DQ_MIN;
                const matchesAlertCountry = jobMatchesAlertCountryScope(job);
                const analysisPending = !job.description;
                const relevanceLabel = analysisPending
                  ? "Analyse en cours"
                  : !matchesAlertCountry && !countryFilters.length
                  ? "À explorer"
                  : isTopMatch
                  ? "Très adaptée"
                  : getRelevanceLabel(p);
                const scoreClass = isTopMatch
                  ? "jr-score jr-scoreStrong"
                  : p >= 70
                  ? "jr-score jr-scoreMid"
                  : "jr-score";
                const whyReasons = buildWhyReasons({
                  job,
                  why,
                  expOk: row.expOk,
                  geoRemote: row.geoRemote,
                  alertDisplay: alertDisplayMap,
                  allowAlertReason: matchesAlertCountry,
                });
                const locationLabel = [job.location ?? job.country, job.remote_type].filter(Boolean).join(" · ");
                const jobUrls = getJobApplyUrls(job);

                  return (
                    <div
                      className="jr-card jr-card--enter"
                      style={{ ["--sk-delay" as any]: `${Math.min(index, 7) * 25}ms` }}
                      key={job.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openJob(job.id, job.title, eventPayload)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openJob(job.id, job.title, eventPayload);
                        }
                      }}
                    >
                    <div className="jr-cardTop">
                      <div className="jr-cardHeadLeft">
                        <CompanyAvatar
                          companyName={job.company_name}
                          applyUrl={jobUrls.applyUrl}
                          sourceUrl={jobUrls.sourceUrl}
                          avatarClassName="jr-avatar"
                          imgClassName="jr-avatarImg"
                        />
                        <div className="jr-title">{job.title ?? "—"}</div>
                      </div>
                      <span className={scoreClass}>{relevanceLabel}</span>
                    </div>
                    <div className="jr-meta">
                      <span className="jr-company">{job.company_name ?? "—"}</span>
                      <span className="jr-metaSep">•</span>
                      <span className="jr-location">{locationLabel || "—"}</span>
                    </div>

                    <div className="jr-whyBox">
                      <div className="jr-whyTitle">Pourquoi cette offre ?</div>
                      <ul className="jr-whyList">
                        {whyReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="jr-cardActions">
                      <button
                        className="jr-ctaSm"
                        onClick={(e) => {
                          e.stopPropagation();
                          trackJobRadarEvent("job_save_click", eventPayload);
                          addToApplications(job.id);
                        }}
                        disabled={isAdding}
                        title="Sauvegarder dans Mes candidatures (À postuler)"
                        type="button"
                      >
                        {isAdding ? "Sauvegarde…" : "Sauvegarder"}
                      </button>

                      <div className="jr-footerActions">
                        <button
                          className="jr-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            openJob(job.id, job.title, { ...eventPayload, action: "detail" });
                          }}
                          type="button"
                        >
                          Voir l’offre →
                        </button>

                        <button
                          className="jr-dangerOutline"
                          onClick={(e) => {
                            e.stopPropagation();
                            trackJobRadarEvent("job_dismiss", eventPayload);
                            dismissJob(job.id);
                          }}
                          disabled={isDismissing}
                          title="Masquer cette offre"
                          type="button"
                        >
                          {isDismissing ? "…" : "Pas intéressé"}
                        </button>
                      </div>
                    </div>
                    </div>
                  );
                })}
                {showGateOnDisplayed && gateCard}
              </>
            </div>

            {allowPremium && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                {hasMore ? (
                  <button className="jrBtn jrBtnGhost" onClick={loadMore} disabled={loadingMore} type="button">
                    {loadingMore ? "Chargement…" : "Charger plus"}
                  </button>
                ) : (
                  <span style={{ opacity: 0.7, fontSize: 13 }}>Fin de la liste</span>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {offerUnlockModal && (
        <div className="modalOverlay" role="presentation" onClick={closeOfferUnlockModal}>
          <div
            className="modal jr-offerPaywallModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="jr-offer-paywall-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="jr-offerPaywallModal__top">
              <div className="jr-offerPaywallModal__eyebrow">Offre adaptée à ton profil</div>
              <button
                type="button"
                className="jr-offerPaywallModal__close"
                aria-label="Fermer"
                onClick={closeOfferUnlockModal}
              >
                ×
              </button>
            </div>

            <div className="modalTitle" id="jr-offer-paywall-title">
              {offerUnlockModal.title}
            </div>
            <div className="modalText">{OFFER_GATE_MESSAGE}</div>

            <ul className="jr-offerPaywallModal__benefits" aria-label="Bénéfices du pass JobRadar">
              {OFFER_GATE_BENEFITS.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>

            <div className="jr-offerPaywallModal__reassurance">{OFFER_GATE_REASSURANCE}</div>

            <div className="jr-offerPaywallModal__actions">
              <button type="button" className="btn btnPrimary btnWide" onClick={launchPassActivation}>
                Voir l’offre complète
              </button>
              <a
                className="jr-offerPaywallModal__back"
                href="#jr-results"
                onClick={(event) => {
                  event.preventDefault();
                  closeOfferUnlockModal();
                }}
              >
                Continuer sans pass
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
