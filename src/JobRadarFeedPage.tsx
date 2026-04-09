import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  type ShadowFeedUiState,
} from "./lib/jobradarShadowAdapter";
import {
  buildGeoPreferences,
  buildJobHay,
  computeJobMatchScore,
  type GeoRemoteBreakdown,
  type DataQualityBreakdown,
  type MatchWhySummary,
  type SkillsQualityBreakdown,
} from "./lib/jobMatching";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import { usePass } from "./lib/usePass";
import { EmptyState, NextStepCard } from "./components/GuidedUI";
import JobRadarAdvisor from "./components/JobRadarAdvisor";
import { getJobRadarAdvisorCopy } from "./components/jobRadarAdvisorContent";
import { useToast } from "./components/ToastCenter";
import "./JobRadarFeedPage.css";

type AlertRow = {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  country: string | null;
  countries?: string[] | null;
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

type JobRow = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  job_family?: string | null;

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

type JoobleResult = {
  id?: string | null;
  title: string;
  company?: string | null;
  location?: string | null;
  snippet?: string | null;
  url: string;
  salary?: string | null;
  date?: string | null;
  zone?: "africa" | "remote" | null;
  closed?: boolean | null;
};

type JoobleResponse = {
  ok: boolean;
  source: string;
  query?: Record<string, unknown>;
  results?: JoobleResult[];
  filter?: { applied?: boolean; fallback?: boolean; preset?: string | null };
  meta?: { total?: number | null; page?: number | null; size?: number | null };
  cache?: "hit" | "miss";
  error?: string;
  message?: string;
};

type ExternalCheckResponse = {
  ok: boolean;
  closed?: boolean;
  reason?: string;
  error?: string;
};

type AdzunaResult = {
  external_id?: string | null;
  title: string;
  company?: string | null;
  location?: string | null;
  snippet?: string | null;
  url: string;
  created?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  source?: string | null;
};

type AdzunaResponse = {
  ok: boolean;
  source: string;
  query?: Record<string, unknown>;
  results?: AdzunaResult[];
  meta?: { total?: number | null; page?: number | null; size?: number | null; fallback?: boolean };
  cache?: "hit" | "miss";
  error?: string;
  message?: string;
};

type ImportExternalResponse = {
  ok: boolean;
  status?: "imported" | "duplicate" | "quarantined" | "rejected_geo" | string;
  job_id?: string | null;
  message?: string;
  error?: string;
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

function formatExternalDate(raw?: string | null) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function canonicalizeUrl(raw: string) {
  if (!raw) return "";
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    const params = new URLSearchParams(url.search);
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "ref",
      "source",
      "closedjob",
    ];
    for (const key of Array.from(params.keys())) {
      if (drop.includes(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        params.delete(key);
      }
    }
    url.search = params.toString();
    const out = url.toString();
    return out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return raw.trim();
  }
}

function hasClosedJobParam(raw?: string | null) {
  if (!raw) return false;
  try {
    const url = new URL(raw.trim());
    for (const [key, value] of url.searchParams.entries()) {
      if (key.toLowerCase() === "closedjob") {
        const v = value.toLowerCase();
        return v === "true" || v === "1" || v === "yes";
      }
    }
  } catch {
    // fall through
  }
  return /closedjob\s*=\s*true/i.test(raw);
}

function stripClosedJobParam(raw?: string | null) {
  if (!raw) return "";
  try {
    const url = new URL(raw.trim());
    const params = new URLSearchParams(url.search);
    for (const key of Array.from(params.keys())) {
      if (key.toLowerCase() === "closedjob") params.delete(key);
    }
    url.search = params.toString();
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function dedupeJooble(items: JoobleResult[]) {
  const seen = new Set<string>();
  const out: JoobleResult[] = [];
  for (const item of items) {
    const urlKey = canonicalizeUrl(item.url);
    const titleKey = normalizeText(item.title || "");
    const companyKey = normalizeText(item.company || "");
    const key = urlKey || `${titleKey}|${companyKey}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getRelevanceLabel(score: number) {
  if (score >= 70) return "Très pertinent";
  return "Pour toi";
}

const WHY_MAX_LEN = 72;

function collapseSpaces(input: string) {
  return (input ?? "").replace(/\s+/g, " ").trim();
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
    const display = alertDisplay.get(key) ?? alertDisplay.get(norm(canonicalizeText(key)));
    if (display) return humanizeAlertKeyword(display);
  }
  for (const key of why.alert) {
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

  const alertKeyword = pickAlertKeyword(params.why, params.alertDisplay);
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
    .filter((w) => !STOP_WORDS.has(w));

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

export default function JobRadarFeedPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const { hasActivePass, isLoadingPass } = usePass();
  const userId = session?.user?.id ?? null;

  const FEED_PREVIEW_LIMIT = 4;
  const FEED_GATE_MESSAGE = "Débloque l’accès complet aux offres pour voir plus d’opportunités adaptées à ton profil.";
  const OFFER_GATE_MESSAGE =
    "Cette offre correspond à ton profil. Active ton pass pour voir le détail complet et débloquer toutes tes offres.";
  const OFFER_GATE_BENEFITS = [
    "Accès complet à toutes tes offres",
    "Détail complet de chaque opportunité",
    "Sauvegarde et suivi de tes candidatures",
    "Alertes personnalisées",
  ] as const;
  const STANDARD_GATE_MESSAGE = "Un pass actif est requis pour accéder à cette fonctionnalité.";
  const allowPremium = hasActivePass && !isLoadingPass;
  const isPreview = !allowPremium;

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [cvSkills, setCvSkills] = useState<string[]>([]);
  const [cvExp, setCvExp] = useState<{ min: number | null; max: number | null } | null>(null);
  const [profileExp, setProfileExp] = useState<number | null>(null);
  const [profileDesiredRole, setProfileDesiredRole] = useState("");
  const [shadowFeed, setShadowFeed] = useState<ShadowFeedUiState | null>(null);
  const [hasUserSelectedMode, setHasUserSelectedMode] = useState(false);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [q, setQ] = useState("");

  const [matchMode, setMatchMode] = useState<"strict" | "large" | "jooble" | "adzuna">("large");
  const STRICT_MIN_PERCENT = Number(import.meta.env.VITE_TOPMATCH_MIN ?? 55);
  const TOP_MATCH_MIN = 70;
  const TOP_MATCH_DQ_MIN = 0.6;
  const MIN_FOR_YOU = 25;
  const [onlyVeryRelevant, setOnlyVeryRelevant] = useState(false);
  const [showTopMatchHelp, setShowTopMatchHelp] = useState(false);

  const [appStatusByJobId, setAppStatusByJobId] = useState<Map<string, ApplicationStatus>>(new Map());
  const [addingJobId, setAddingJobId] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);
  const [showTip, setShowTip] = useState(true);

  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
  const [dismissingJobId, setDismissingJobId] = useState<string | null>(null);

  const { pushToast } = useToast();

  const PAGE_SIZE = 30;
  const [pageFrom, setPageFrom] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const feedBackendShadowFlag = (import.meta.env.VITE_JOBRADAR_FEED_BACKEND_SHADOW ?? "").trim() === "1";

  const JOOBLE_PAGE_SIZE = 20;
  const JOOBLE_AUTO_MIN = 6;
  const JOOBLE_AUTO_MAX_PAGES = 2;
  const [jooblePreset, setJooblePreset] = useState<"wa_fr" | "central_fr" | "all_africa_fr">("all_africa_fr");
  const [joobleResults, setJoobleResults] = useState<JoobleResult[]>([]);
  const [joobleMeta, setJoobleMeta] = useState<{ total?: number | null; page?: number | null }>({});
  const [jooblePage, setJooblePage] = useState(1);
  const [joobleHasMore, setJoobleHasMore] = useState(true);
  const [joobleLoading, setJoobleLoading] = useState(false);
  const [joobleError, setJoobleError] = useState<string | null>(null);
  const [joobleInfo, setJoobleInfo] = useState<string | null>(null);
  const [joobleAutoPages, setJoobleAutoPages] = useState(0);
  const [joobleClosedNotice, setJoobleClosedNotice] = useState<{
    title?: string | null;
    url: string;
    jobId?: string | null;
  } | null>(null);

  const ADZUNA_PAGE_SIZE = 20;
  const ADZUNA_AUTO_MIN = 6;
  const ADZUNA_AUTO_MAX_PAGES = 2;
  const [adzunaPreset, setAdzunaPreset] = useState<"wa_fr" | "central_fr" | "all_africa_fr">("all_africa_fr");
  const [adzunaResults, setAdzunaResults] = useState<AdzunaResult[]>([]);
  const [adzunaMeta, setAdzunaMeta] = useState<{ total?: number | null; page?: number | null }>({});
  const [adzunaPage, setAdzunaPage] = useState(1);
  const [adzunaHasMore, setAdzunaHasMore] = useState(true);
  const [adzunaLoading, setAdzunaLoading] = useState(false);
  const [adzunaError, setAdzunaError] = useState<string | null>(null);
  const [adzunaAutoPages, setAdzunaAutoPages] = useState(0);
  const [externalImporting, setExternalImporting] = useState<Record<string, boolean>>({});
  const [externalImports, setExternalImports] = useState<Record<string, { status: string; jobId?: string }>>({});
  const [offerUnlockModal, setOfferUnlockModal] = useState<{ title: string } | null>(null);

  function dedupeAdzuna(items: AdzunaResult[]) {
    const seen = new Set<string>();
    const out: AdzunaResult[] = [];
    for (const item of items) {
      const urlKey = canonicalizeUrl(item.url);
      const key = urlKey || `${normalizeText(item.title || "")}|${normalizeText(item.company || "")}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

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

  const KEYWORDS_MAX_UNIQ = 60;
  const KEYWORDS_CAP = 20;
  const CV_SKILLS_CAP = 14;

  const alertKeywords = useMemo(() => {
    const fromKeywords = alerts.flatMap((a) => a.keywords ?? []);
    const fromNames = alerts.flatMap((a) => extractKeywordsFromAlertName(a.name ?? ""));
    return uniq([...fromKeywords, ...fromNames]).slice(0, KEYWORDS_MAX_UNIQ);
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

  function mergeUniqueById(prev: JobRow[], next: JobRow[]) {
    const map = new Map<string, JobRow>();
    for (const j of prev) map.set(j.id, j);
    for (const j of next) map.set(j.id, j);
    return Array.from(map.values());
  }

  const fetchJobsRange = useCallback(async (from: number, to: number) => {
    const { data, error } = await supabase
      .from("jobs")
      .select(
        `
        id,
        title,
        company_name,
        location,
        country,
        remote_type,
        job_family,
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
        experience_years_max,
        description:description_text
      `
      )
      .eq("is_active", true)
      .eq("is_expired", false)
      .or("quality_status.eq.ok,quality_status.is.null")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;
    return (data ?? []) as JobRow[];
  }, []);

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
        setErrorMsg((prev) => prev ?? getErrorMessage(e) ?? "Erreur inconnue");
      }
    },
    []
  );

  const load = useCallback(async () => {
    if (!userId) return;

    setBusy(true);
    setErrorMsg(null);

    try {
      const [{ data: aData, error: aErr }, cvContext, nextProfileContext, fetchedJobs] = await Promise.all([
        supabase
          .from("alerts")
          .select("id, user_id, name, keywords, country, countries, frequency, channels, is_active, created_at")
          .eq("user_id", userId)
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        fetchCvContext(),
        fetchProfileContext(),
        fetchJobsRange(0, PAGE_SIZE - 1),
      ]);

      if (aErr) throw aErr;

      setAlerts((aData ?? []) as AlertRow[]);
      setCvSkills(cvContext.skills);
      setCvExp(cvContext.exp);
      setProfileExp(nextProfileContext.experienceYears);
      setProfileDesiredRole(nextProfileContext.desiredRole);
      setJobs(fetchedJobs);
      setPageFrom(fetchedJobs.length);
      setHasMore(fetchedJobs.length === PAGE_SIZE);
      setBusy(false);

      void fetchShadowFeed()
        .then((nextShadowFeed) => setShadowFeed(nextShadowFeed))
        .catch(() => setShadowFeed(null));

      void loadUserJobState(userId);
    } catch (e: unknown) {
      setErrorMsg(getErrorMessage(e) ?? "Erreur inconnue");
      setBusy(false);
    }
  }, [fetchCvContext, fetchJobsRange, fetchProfileContext, fetchShadowFeed, loadUserJobState, userId]);

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
    } catch (e: unknown) {
      setErrorMsg(getErrorMessage(e) ?? "Erreur inconnue");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!loading && session && userId) load();
  }, [loading, session, userId, load]);

  useEffect(() => {
    if (matchMode !== "strict" || !onlyVeryRelevant) {
      setShowTopMatchHelp(false);
    }
  }, [matchMode, onlyVeryRelevant]);

  useEffect(() => {
    if (matchMode !== "jooble") {
      setJoobleClosedNotice(null);
    }
  }, [matchMode]);

  const fetchJooble = useCallback(
    async (page: number, reset = false) => {
      const keywords = q.trim() || "emploi";
      setJoobleLoading(true);
      setJoobleError(null);

      try {
        const { data, error } = await supabase.functions.invoke<JoobleResponse>("jooble_search", {
          body: {
            keywords,
            preset: jooblePreset,
            page,
            size: JOOBLE_PAGE_SIZE,
          },
        });

        if (error) throw error;
        if (!data?.ok) throw new Error(data?.message || data?.error || "Recherche Jooble indisponible");

        const next = dedupeJooble(
          (data?.results ?? []).map((j) => ({
            ...j,
            url: stripClosedJobParam(j.url),
          }))
        );
        setJoobleInfo(data?.message ?? null);
        setJoobleMeta({ total: data?.meta?.total ?? null, page });
        setJoobleHasMore(
          typeof data?.meta?.total === "number"
            ? page * JOOBLE_PAGE_SIZE < (data.meta.total ?? 0)
            : next.length >= JOOBLE_PAGE_SIZE
        );

        setJoobleResults((prev) => (reset ? next : dedupeJooble([...prev, ...next])));
      } catch (e: unknown) {
        setJoobleError(getErrorMessage(e) ?? "Recherche Jooble indisponible");
      } finally {
        setJoobleLoading(false);
      }
    },
    [JOOBLE_PAGE_SIZE, jooblePreset, q]
  );

  useEffect(() => {
    if (matchMode !== "jooble") return;
    const timer = setTimeout(() => {
      setJooblePage(1);
      setJoobleAutoPages(0);
      fetchJooble(1, true);
    }, 400);
    return () => clearTimeout(timer);
  }, [matchMode, q, jooblePreset, fetchJooble]);

  const fetchAdzuna = useCallback(
    async (page: number, reset = false) => {
      const keywords = q.trim() || "emploi";
      setAdzunaLoading(true);
      setAdzunaError(null);

      try {
        const { data, error } = await supabase.functions.invoke<AdzunaResponse>("adzuna_search", {
          body: {
            keywords,
            preset: adzunaPreset,
            page,
            size: ADZUNA_PAGE_SIZE,
          },
        });

        if (error) throw error;
        if (!data?.ok) throw new Error(data?.message || data?.error || "Recherche Adzuna indisponible");

        const next = dedupeAdzuna(data?.results ?? []);
        setAdzunaMeta({ total: data?.meta?.total ?? null, page });
        setAdzunaHasMore(
          typeof data?.meta?.total === "number"
            ? page * ADZUNA_PAGE_SIZE < (data.meta.total ?? 0)
            : next.length >= ADZUNA_PAGE_SIZE
        );

        setAdzunaResults((prev) => (reset ? next : dedupeAdzuna([...prev, ...next])));
      } catch (e: unknown) {
        setAdzunaError(getErrorMessage(e) ?? "Recherche Adzuna indisponible");
      } finally {
        setAdzunaLoading(false);
      }
    },
    [ADZUNA_PAGE_SIZE, adzunaPreset, q]
  );

  useEffect(() => {
    if (matchMode !== "adzuna") return;
    const timer = setTimeout(() => {
      setAdzunaPage(1);
      setAdzunaAutoPages(0);
      fetchAdzuna(1, true);
    }, 400);
    return () => clearTimeout(timer);
  }, [matchMode, q, adzunaPreset, fetchAdzuna]);

  useEffect(() => {
    if (matchMode !== "jooble") return;
    if (joobleLoading) return;
    if (!joobleHasMore) return;
    if (joobleResults.length >= JOOBLE_AUTO_MIN) return;
    if (joobleAutoPages >= JOOBLE_AUTO_MAX_PAGES) return;

    setJoobleAutoPages((prev) => prev + 1);
    loadMoreJooble();
  }, [
    matchMode,
    joobleLoading,
    joobleHasMore,
    joobleResults.length,
    joobleAutoPages,
    JOOBLE_AUTO_MIN,
    JOOBLE_AUTO_MAX_PAGES,
  ]);

  useEffect(() => {
    if (matchMode !== "adzuna") return;
    if (adzunaLoading) return;
    if (!adzunaHasMore) return;
    if (adzunaResults.length >= ADZUNA_AUTO_MIN) return;
    if (adzunaAutoPages >= ADZUNA_AUTO_MAX_PAGES) return;

    setAdzunaAutoPages((prev) => prev + 1);
    loadMoreAdzuna();
  }, [
    matchMode,
    adzunaLoading,
    adzunaHasMore,
    adzunaResults.length,
    adzunaAutoPages,
    ADZUNA_AUTO_MIN,
    ADZUNA_AUTO_MAX_PAGES,
  ]);

  async function loadMoreAdzuna() {
    if (adzunaLoading || !adzunaHasMore) return;
    const nextPage = adzunaPage + 1;
    setAdzunaPage(nextPage);
    await fetchAdzuna(nextPage, false);
  }

  async function loadMoreJooble() {
    if (joobleLoading || !joobleHasMore) return;
    const nextPage = jooblePage + 1;
    setJooblePage(nextPage);
    await fetchJooble(nextPage, false);
  }

  async function addToApplications(jobId: string) {
    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }
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
      const msg = getErrorMessage(e) ?? "Erreur inconnue";
      setErrorMsg(msg);
      pushToast({ kind: "error", title: "Impossible de sauvegarder l’offre", message: msg });
    } finally {
      setAddingJobId(null);
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
      setErrorMsg(error.message);
      return;
    }

    setDismissedJobIds((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
  }

  const matches = useMemo(() => {
    const kwAlerts = uniq(cappedAlertKeywords.map((k) => canonicalizeText(k)).map(norm)).filter(Boolean);
    const kwCv = uniq(cvKeywords.map((k) => String(k ?? "").trim()).filter(Boolean));
    const kwCount = kwAlerts.length + kwCv.length;
    const effectiveExp = cvExp ?? (profileExp != null ? { min: profileExp, max: profileExp } : null);

    const qCanon = norm(canonicalizeText(q));

    const baseRows = jobs
      .map((job): MatchRow | null => {
        const hay = buildJobHay(job);
        if (qCanon && !hay.includes(qCanon)) return null;

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

    return { topMatches, exploreMatches: explorerRows, forYouRows, kwCount };
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
    STRICT_MIN_PERCENT,
    TOP_MATCH_MIN,
    TOP_MATCH_DQ_MIN,
    MIN_FOR_YOU,
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

  const visibleFeedBuckets =
    shouldUseShadowVisibleFeed && shadowFeed?.buckets
      ? shadowFeed.buckets
      : localFeedBuckets;

  const forYouRows = visibleFeedBuckets.for_you.filter((row) => {
    if (!onlyVeryRelevant) return true;
    return row.p >= TOP_MATCH_MIN;
  });

  const topCount = visibleFeedBuckets.top_match.length;
  const forYouCount = visibleFeedBuckets.for_you.length;
  const exploreCount = visibleFeedBuckets.explore.length;
  const shadowUi = useMemo(() => buildJobRadarShadowUi(shadowMeta, topCount), [shadowMeta, topCount]);
  const joobleCount = joobleResults.length;
  const adzunaCount = adzunaResults.length;
  const displayed = matchMode === "strict" ? forYouRows : visibleFeedBuckets.explore;
  const joobleDisplayed = joobleResults;
  const displayedLimited = isPreview ? displayed.slice(0, FEED_PREVIEW_LIMIT) : displayed;
  const joobleLimited = isPreview ? joobleDisplayed.slice(0, FEED_PREVIEW_LIMIT) : joobleDisplayed;
  const adzunaLimited = isPreview ? adzunaResults.slice(0, FEED_PREVIEW_LIMIT) : adzunaResults;
  const showGateOnDisplayed = isPreview && displayed.length > FEED_PREVIEW_LIMIT;
  const showGateOnJooble = isPreview && joobleDisplayed.length > FEED_PREVIEW_LIMIT;
  const showGateOnAdzuna = isPreview && adzunaResults.length > FEED_PREVIEW_LIMIT;
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
    if (shadowUi.showStrictTab) return;
    if (matchMode === "strict") setOnlyVeryRelevant(false);
  }, [shadowUi.showStrictTab, matchMode]);

  useEffect(() => {
    if (shadowUi.showOnlyVeryRelevantToggle) return;
    if (onlyVeryRelevant) setOnlyVeryRelevant(false);
  }, [shadowUi.showOnlyVeryRelevantToggle, onlyVeryRelevant]);

  useEffect(() => {
    if (hasUserSelectedMode) return;
    if (matchMode === "jooble" || matchMode === "adzuna") return;
    const nextMode =
      shadowUi.showStrictTab && shadowUi.preferredMode === "strict" && forYouCount > 0
        ? "strict"
        : "large";
    setMatchMode((prev) => (prev === nextMode ? prev : nextMode));
  }, [shadowUi.showStrictTab, shadowUi.preferredMode, hasUserSelectedMode, matchMode, forYouCount]);

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

  const getExternalKey = (url: string) => canonicalizeUrl(url) || url;
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
    navigate(`/jobradar/jobs/${jobId}`);
  };

  const isJoobleClosed = useCallback(
    (job: JoobleResult) => Boolean(job.closed) || hasClosedJobParam(job.url),
    []
  );

  const archiveImportedApplication = useCallback(
    async (jobId?: string | null) => {
      if (!userId || !jobId) return;
      const archivedAt = new Date().toISOString();
      const { error } = await supabase
        .from("applications")
        .update({
          status: "expired",
          archived_at: archivedAt,
          error_message: "Offre expirée ou indisponible",
        })
        .eq("user_id", userId)
        .eq("job_id", jobId);

      if (error) {
        if (import.meta.env?.DEV) {
          console.warn("[JobRadar] archive application failed", error);
        }
        return;
      }

      setAppStatusByJobId((prev) => {
        const next = new Map(prev);
        next.set(jobId, "failed");
        return next;
      });
    },
    [userId]
  );

  const dismissJoobleJob = useCallback((url: string) => {
    const target = stripClosedJobParam(url);
    setJoobleResults((prev) => prev.filter((j) => stripClosedJobParam(j.url) !== target));
  }, []);

  const handleJoobleOpen = useCallback(
    async (job: JoobleResult, jobId?: string | null) => {
      if (isJoobleClosed(job)) {
        const closedUrl = stripClosedJobParam(job.url);
        setJoobleClosedNotice({ title: job.title, url: closedUrl, jobId });
        dismissJoobleJob(closedUrl);
        await archiveImportedApplication(jobId);
        return;
      }

      const safeUrl = stripClosedJobParam(job.url);
      if (!safeUrl) return;

      let didOpen = false;
      const openNow = () => {
        if (didOpen) return;
        didOpen = true;
        trackJobRadarEvent("jooble_open", { url: safeUrl });
        window.open(safeUrl, "_blank", "noopener,noreferrer");
      };

      const timeoutId = window.setTimeout(() => {
        openNow();
      }, 1200);

      let closed = false;
      try {
        const { data, error } = await supabase.functions.invoke<ExternalCheckResponse>("check_external_job", {
          body: { url: safeUrl, source: "jooble" },
        });
        if (!error && data?.ok && data?.closed) {
          closed = true;
        }
      } catch {
        // ignore check failures
      }

      window.clearTimeout(timeoutId);

      if (closed) {
        setJoobleClosedNotice({ title: job.title, url: safeUrl, jobId });
        dismissJoobleJob(safeUrl);
        await archiveImportedApplication(jobId);
        return;
      }

      openNow();
    },
    [archiveImportedApplication, dismissJoobleJob, isJoobleClosed]
  );

  const handleJooblePrimaryClick = useCallback(
    async (job: JoobleResult, jobId?: string | null) => {
      const safeUrl = stripClosedJobParam(job.url) || job.url;
      if (openOfferUnlockGate(job.title, { action: "external_open", source: "jooble", url: safeUrl, job_id: jobId ?? null })) {
        return;
      }

      await handleJoobleOpen(job, jobId);
    },
    [handleJoobleOpen, openOfferUnlockGate]
  );

  const handleAdzunaPrimaryClick = useCallback(
    (job: AdzunaResult, jobId?: string | null) => {
      if (openOfferUnlockGate(job.title, { action: "external_open", source: "adzuna", url: job.url, job_id: jobId ?? null })) {
        return;
      }

      trackJobRadarEvent("adzuna_open", { url: job.url });
      window.open(job.url, "_blank", "noopener,noreferrer");
    },
    [openOfferUnlockGate]
  );

  const importExternalJob = useCallback(
    async (source: "jooble" | "adzuna", job: JoobleResult | AdzunaResult) => {
      if (source === "jooble" && isJoobleClosed(job as JoobleResult)) {
        const j = job as JoobleResult;
        setJoobleClosedNotice({ title: j.title, url: j.url });
        return;
      }

      const key = getExternalKey(job.url);
      if (!key) return;

      if (externalImporting[key]) return;
      setExternalImporting((prev) => ({ ...prev, [key]: true }));

      try {
        const externalId =
          source === "jooble"
            ? (job as JoobleResult).id?.toString()
            : (job as AdzunaResult).external_id ?? undefined;

        const payload = {
          source,
          external_id: externalId ?? undefined,
          url: stripClosedJobParam(job.url) || job.url,
          title: job.title,
          company: job.company ?? null,
          location: job.location ?? null,
          snippet: job.snippet ?? null,
          raw: job,
        };

        const { data, error } = await supabase.functions.invoke<ImportExternalResponse>("import_external_job", {
          body: payload,
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.message || data?.error || "Import impossible");

        const status = data?.status ?? "imported";
        const jobId = data?.job_id ?? undefined;

        if (status === "imported" || status === "duplicate" || status === "quarantined") {
          setExternalImports((prev) => ({
            ...prev,
            [key]: { status, jobId: jobId ?? undefined },
          }));
        }

        if (status === "imported") {
          pushToast({
            kind: "success",
            title: "Importée",
            message: "Elle apparaîtra dans “Pour toi” après analyse.",
          });
        } else if (status === "duplicate") {
          pushToast({ kind: "info", title: "Déjà dans JobRadar" });
        } else if (status === "quarantined") {
          pushToast({
            kind: "info",
            title: "Importée mais non exploitable",
            message: "Lien ou candidature manquant.",
          });
        } else if (status === "rejected_geo") {
          pushToast({
            kind: "info",
            title: "Import limité à certaines offres compatibles",
            message: data?.message ?? "Import limité pour préserver la qualité des résultats JobRadar.",
          });
        } else {
          pushToast({ kind: "info", title: "Import traité" });
        }

        trackJobRadarEvent("external_import", { source, status, url: job.url, job_id: jobId ?? null });
      } catch (e) {
        const msg = getErrorMessage(e) || "Import impossible";
        pushToast({ kind: "error", title: "Import impossible", message: msg });
      } finally {
        setExternalImporting((prev) => ({ ...prev, [key]: false }));
      }
    },
    [externalImporting, pushToast, isJoobleClosed]
  );

  const buildMatchEventPayload = useCallback(
    (row: MatchRow) => {
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
    <div className="jr-gateCard" role="group" aria-label="Accès premium JobRadar">
      <div className="jr-gateTitle">Accède à toutes les opportunités</div>
      <div className="jr-gateText">{FEED_GATE_MESSAGE}</div>
      <button className="jrBtn jrBtnPrimary" type="button" onClick={launchPassActivation}>
        Choisir mon pass
      </button>
    </div>
  );

  return (
    <div className="jr-shell">
      <main className="jr-main">
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
                {(matchMode === "jooble"
                  ? joobleCount
                  : matchMode === "adzuna"
                  ? adzunaCount
                  : displayed.length)}{" "}
                offre
                {(matchMode === "jooble"
                  ? joobleCount
                  : matchMode === "adzuna"
                  ? adzunaCount
                  : displayed.length) > 1
                  ? "s"
                  : ""}
              </span>
              <span className="jr-pillHero jr-pillStrong">
                {getJobRadarShadowPillLabel(shadowMeta, forYouCount)}
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

            <div className="jr-modeToggle" role="tablist" aria-label="Mode de tri des offres">
              {shadowUi.showStrictTab && (
                <button
                  className={matchMode === "strict" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => {
                    setHasUserSelectedMode(true);
                    setMatchMode("strict");
                    trackJobRadarEvent("match_mode_select", { mode: "strict", forYouCount, exploreCount });
                  }}
                  disabled={busy || forYouCount === 0}
                  title={forYouCount === 0 ? "Aucune offre pour l’instant" : "Offres les plus pertinentes pour toi"}
                  aria-pressed={matchMode === "strict"}
                >
                  Pour toi ({forYouCount})
                </button>
              )}

              <button
                className={matchMode === "large" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => {
                  setHasUserSelectedMode(true);
                  setMatchMode("large");
                  trackJobRadarEvent("match_mode_select", { mode: "large", forYouCount, exploreCount });
                }}
                disabled={busy}
                title="Explorer les offres du moment"
                aria-pressed={matchMode === "large"}
              >
                {shadowUi.largeTabLabel} ({exploreCount})
              </button>

              <button
                className={matchMode === "jooble" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => {
                  setHasUserSelectedMode(true);
                  setMatchMode("jooble");
                  trackJobRadarEvent("match_mode_select", { mode: "jooble" });
                }}
                disabled={busy}
                title="Explorer via Jooble"
                aria-pressed={matchMode === "jooble"}
              >
                Explorer (Jooble)
              </button>

              <button
                className={matchMode === "adzuna" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => {
                  setHasUserSelectedMode(true);
                  setMatchMode("adzuna");
                  trackJobRadarEvent("match_mode_select", { mode: "adzuna" });
                }}
                disabled={busy}
                title="Explorer via Adzuna"
                aria-pressed={matchMode === "adzuna"}
              >
                Explorer (Adzuna)
              </button>
            </div>

            <button className="jrBtn jrBtnOutline" onClick={load} disabled={busy} type="button">
              {busy ? "Chargement…" : "Rafraîchir"}
            </button>
          </div>

          <div className="jr-subline">
            {getJobRadarShadowSubline(shadowMeta, matchMode)}
          </div>

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

          {matchMode === "jooble" && (
            <div className="jr-joobleBar">
              <div className="jr-jooblePresets" role="tablist" aria-label="Zone Jooble">
                <button
                  className={jooblePreset === "wa_fr" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => setJooblePreset("wa_fr")}
                >
                  Afrique de l’Ouest
                </button>
                <button
                  className={jooblePreset === "central_fr" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => setJooblePreset("central_fr")}
                >
                  Afrique centrale
                </button>
                <button
                  className={jooblePreset === "all_africa_fr" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => setJooblePreset("all_africa_fr")}
                >
                  Afrique
                </button>
              </div>
              <div className="jr-joobleMeta">
                {joobleLoading
                  ? "Recherche en cours…"
                  : joobleMeta.total
                  ? `${joobleResults.length} affichées · environ ${joobleMeta.total} résultats`
                  : joobleResults.length
                  ? `${joobleResults.length} affichées`
                  : ""}
                {joobleInfo ? ` · ${joobleInfo}` : ""}
              </div>
            </div>
          )}

          {matchMode === "adzuna" && (
            <div className="jr-joobleBar">
              <div className="jr-jooblePresets" role="tablist" aria-label="Zone Adzuna">
                <button
                  className={adzunaPreset === "wa_fr" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => setAdzunaPreset("wa_fr")}
                >
                  Afrique de l’Ouest
                </button>
                <button
                  className={adzunaPreset === "central_fr" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => setAdzunaPreset("central_fr")}
                >
                  Afrique centrale
                </button>
                <button
                  className={adzunaPreset === "all_africa_fr" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                  type="button"
                  onClick={() => setAdzunaPreset("all_africa_fr")}
                >
                  Afrique
                </button>
              </div>
              <div className="jr-joobleMeta">
                {adzunaLoading
                  ? "Recherche en cours…"
                  : adzunaMeta.total
                  ? `${adzunaResults.length} affichées · environ ${adzunaMeta.total} résultats`
                  : adzunaResults.length
                  ? `${adzunaResults.length} affichées`
                  : ""}
              </div>
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

        {matchMode === "jooble" && joobleError && joobleResults.length === 0 && (
          <div className="jr-error">
            <div className="jr-errorText">Erreur Jooble : {joobleError}</div>
            <button className="jrBtn jrBtnGhost" onClick={() => fetchJooble(1, true)} type="button">
              Réessayer
            </button>
          </div>
        )}

        {matchMode === "adzuna" && adzunaError && adzunaResults.length === 0 && (
          <div className="jr-error">
            <div className="jr-errorText">Erreur Adzuna : {adzunaError}</div>
            <button className="jrBtn jrBtnGhost" onClick={() => fetchAdzuna(1, true)} type="button">
              Réessayer
            </button>
          </div>
        )}

        {showTip && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title="Astuce JobRadar"
              message="Sauvegarde les offres intéressantes dans “À postuler” pour les retrouver plus tard."
              primaryAction={{ label: "Compris", onClick: () => setShowTip(false) }}
              tone="info"
            />
          </div>
        )}

        {matchMode === "jooble" && joobleClosedNotice && (
          <div style={{ marginTop: 12 }}>
            <NextStepCard
              title="Offre indisponible"
              message="Cette offre n’est plus disponible sur Jooble."
              primaryAction={{
                label: "Voir des offres similaires",
                onClick: async () => {
                  setJoobleClosedNotice(null);
                  await fetchJooble(1, true);
                  scrollToResults();
                },
              }}
              secondaryAction={{
                label: "Retirer de ma liste",
                onClick: async () => {
                  dismissJoobleJob(joobleClosedNotice.url);
                  await archiveImportedApplication(joobleClosedNotice.jobId ?? null);
                  setJoobleClosedNotice(null);
                },
              }}
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
                <div className="jr-topMatchPanelTitle">Offres les plus adaptées = niveau strict</div>
                <div className="jr-topMatchPanelText">
                  Seuils actuels : score ≥ {TOP_MATCH_MIN} et dataQuality ≥ {TOP_MATCH_DQ_MIN}. Tu peux élargir pour voir
                  plus d’offres.
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
          <div className="jr-skeletonWrap" aria-live="polite">
            <div className="jr-skeletonRow">
              {Array.from({ length: 6 }).map((_, i) => (
                <div className="jr-skeletonCard" key={`sk_${i}`}>
                  <div className="sk-title" />
                  <div className="sk-line" />
                  <div className="sk-line short" />
                  <div className="sk-chipRow">
                    <span />
                    <span />
                  </div>
                  <div className="sk-btn" />
                </div>
              ))}
            </div>
            <div className="sr-only">Chargement des offres…</div>
          </div>
        ) : alerts.length === 0 &&
          !shadowUi.suppressNoAlertsEmptyState &&
          matchMode !== "jooble" &&
          matchMode !== "adzuna" ? (
          <EmptyState
            title="Tu n’as pas encore d’alerte"
            description="Crée une alerte pour recevoir des offres mieux ciblées."
            primaryAction={{ label: "Créer une alerte", to: "/jobradar/alerts" }}
            secondaryAction={{ label: "Améliorer mon profil", to: "/jobradar/profile" }}
            tone="info"
          />
        ) : matchMode !== "jooble" && displayed.length === 0 ? (
          shadowUi.profileMode === "alerts_only" ? (
            <EmptyState
              title="Tes alertes ne suffisent pas encore pour construire de vrais matchs"
              description="On n’a rien trouvé de suffisamment propre à afficher pour l’instant. Définis un rôle cible pour améliorer la précision."
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
        ) : matchMode === "jooble" && joobleDisplayed.length === 0 && !joobleLoading ? (
          <EmptyState
            title="Aucun résultat Jooble pour l’instant"
            description="Essaie un mot-clé plus large ou élargis ta zone de recherche."
            primaryAction={{ label: "Relancer la recherche", onClick: () => fetchJooble(1, true) }}
            secondaryAction={{ label: "Revenir aux offres", onClick: () => setMatchMode("large") }}
            tone="neutral"
          />
        ) : matchMode === "adzuna" && adzunaResults.length === 0 && !adzunaLoading ? (
          <EmptyState
            title="Aucun résultat Adzuna pour l’instant"
            description="Essaie un mot-clé plus large ou élargis ta zone de recherche."
            primaryAction={{ label: "Relancer la recherche", onClick: () => fetchAdzuna(1, true) }}
            secondaryAction={{ label: "Revenir aux offres", onClick: () => setMatchMode("large") }}
            tone="neutral"
          />
        ) : (
          <>
            <div className="jr-grid" id="jr-results">
              {matchMode === "jooble" ? (
                <>
                  {joobleLimited.map((job) => {
                    const importKey = getExternalKey(job.url);
                    const importState = importKey ? externalImports[importKey] : undefined;
                    const importBusy = importKey ? externalImporting[importKey] : false;
                    const importStatus = importState?.status;
                    const isClosed = isJoobleClosed(job);
                    const importDisabled =
                      importBusy || importStatus === "imported" || importStatus === "duplicate" || importStatus === "quarantined";
                    const finalImportDisabled = importDisabled || isClosed;
                    const dateLabel = formatExternalDate(job.date);
                    const importLabel = importBusy
                      ? "Import…"
                      : importStatus === "duplicate"
                      ? "Déjà importée"
                      : importStatus === "quarantined"
                      ? "Importée (non exploitable)"
                      : importStatus === "imported"
                      ? "Importée"
                      : isClosed
                      ? "Indisponible"
                      : "Importer";
                    return (
                      <div className="jr-card" key={job.url} role="group">
                        <div className="jr-cardTop">
                          <div className="jr-title">{job.title ?? "—"}</div>
                          <span className="jr-score jr-scoreSoft">Source : Jooble</span>
                        </div>
                        <div className="jr-meta">
                          <span className="jr-company">{job.company ?? "—"}</span>
                          <span className="jr-metaSep">•</span>
                          <span className="jr-location">{job.location ?? "—"}</span>
                        </div>

                        {job.snippet && <div className="jr-snippet">{job.snippet}</div>}

                        <div className="jr-chips">
                          {job.zone === "africa" && <span className="chip chipStrong">Zone géographique validée</span>}
                          {job.zone === "remote" && <span className="chip chipSoft">Télétravail</span>}
                          {job.salary && <span className="chip chipSoft">{job.salary}</span>}
                          {dateLabel && <span className="chip chipSoft">Publié le {dateLabel}</span>}
                        </div>

                        <div className="jr-cardActions">
                          <button
                            className="jr-ctaSm"
                            type="button"
                            onClick={() => handleJooblePrimaryClick(job, importState?.jobId ?? null)}
                          >
                            Voir l’offre
                          </button>
                          <button
                            className="jr-ctaGhost"
                            onClick={() => importExternalJob("jooble", job)}
                            disabled={finalImportDisabled}
                            type="button"
                          >
                            {importLabel}
                          </button>
                          {importState?.jobId && (
                            <button
                              className="jr-ctaGhost"
                              onClick={() =>
                                openJob(importState.jobId!, job.title, { action: "external_view", source: "jooble" })
                              }
                              type="button"
                            >
                              Voir dans JobRadar
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {showGateOnJooble && gateCard}
                </>
              ) : matchMode === "adzuna" ? (
                <>
                  {adzunaLimited.map((job) => {
                    const importKey = getExternalKey(job.url);
                    const importState = importKey ? externalImports[importKey] : undefined;
                    const importBusy = importKey ? externalImporting[importKey] : false;
                    const importStatus = importState?.status;
                    const importDisabled =
                      importBusy || importStatus === "imported" || importStatus === "duplicate" || importStatus === "quarantined";
                    const createdLabel = formatExternalDate(job.created);
                    const importLabel = importBusy
                      ? "Import…"
                      : importStatus === "duplicate"
                      ? "Déjà importée"
                      : importStatus === "quarantined"
                      ? "Importée (non exploitable)"
                      : importStatus === "imported"
                      ? "Importée"
                      : "Importer";
                    return (
                      <div className="jr-card" key={job.url} role="group">
                        <div className="jr-cardTop">
                          <div className="jr-title">{job.title ?? "—"}</div>
                          <span className="jr-score jr-scoreSoft">Source : Adzuna</span>
                        </div>
                        <div className="jr-meta">
                          <span className="jr-company">{job.company ?? "—"}</span>
                          <span className="jr-metaSep">•</span>
                          <span className="jr-location">{job.location ?? "—"}</span>
                        </div>

                        {job.snippet && <div className="jr-snippet">{job.snippet}</div>}

                        <div className="jr-chips">
                          {(job.salary_min != null || job.salary_max != null) && (
                            <span className="chip chipSoft">
                              {job.salary_min ?? "—"} - {job.salary_max ?? "—"}
                            </span>
                          )}
                          {createdLabel && <span className="chip chipSoft">Publié le {createdLabel}</span>}
                        </div>

                        <div className="jr-cardActions">
                          <button
                            className="jr-ctaSm"
                            onClick={() => handleAdzunaPrimaryClick(job, importState?.jobId ?? null)}
                            type="button"
                          >
                            Voir l’offre
                          </button>
                          <button
                            className="jr-ctaGhost"
                            onClick={() => importExternalJob("adzuna", job)}
                            disabled={importDisabled}
                            type="button"
                          >
                            {importLabel}
                          </button>
                          {importState?.jobId && (
                            <button
                              className="jr-ctaGhost"
                              onClick={() =>
                                openJob(importState.jobId!, job.title, { action: "external_view", source: "adzuna" })
                              }
                              type="button"
                            >
                              Voir dans JobRadar
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {showGateOnAdzuna && gateCard}
                </>
              ) : (
                <>
                  {displayedLimited.map((row) => {
                  const { job, p, why, dataQuality } = row;
                  const eventPayload = buildMatchEventPayload(row);
                  const isAdding = addingJobId === job.id;
                  const isDismissing = dismissingJobId === job.id;
                const isTopMatch = p >= TOP_MATCH_MIN && (dataQuality?.score ?? 0) >= TOP_MATCH_DQ_MIN;
                const relevanceLabel = isTopMatch ? "Très adaptée" : getRelevanceLabel(p);
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
                });
                const locationLabel = [job.location ?? job.country, job.remote_type].filter(Boolean).join(" · ");

                  return (
                    <div
                      className="jr-card"
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
                      <div className="jr-title">{job.title ?? "—"}</div>
                      <span className={scoreClass}>{relevanceLabel}</span>
                    </div>
                    <div className="jr-meta">
                      <span className="jr-company">{job.company_name ?? "—"}</span>
                      <span className="jr-metaSep">•</span>
                      <span className="jr-location">{locationLabel || "—"}</span>
                    </div>

                    <div className="jr-whyBox">
                      <div className="jr-whyTitle">Pourquoi pour toi</div>
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
                        title="Ajouter dans Mes candidatures (À postuler)"
                        type="button"
                      >
                        {isAdding ? "Ajout…" : "Ajouter"}
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
                          Détail →
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
                          {isDismissing ? "…" : "Décliner"}
                        </button>
                      </div>
                    </div>
                    </div>
                  );
                  })}
                  {showGateOnDisplayed && gateCard}
                </>
              )}
            </div>

            {allowPremium && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                {matchMode === "jooble" ? (
                  joobleHasMore ? (
                    <button className="jrBtn jrBtnGhost" onClick={loadMoreJooble} disabled={joobleLoading} type="button">
                      {joobleLoading ? "Chargement…" : "Charger plus"}
                    </button>
                  ) : (
                    <span style={{ opacity: 0.7, fontSize: 13 }}>Fin de la liste</span>
                  )
                ) : matchMode === "adzuna" ? (
                  adzunaHasMore ? (
                    <button className="jrBtn jrBtnGhost" onClick={loadMoreAdzuna} disabled={adzunaLoading} type="button">
                      {adzunaLoading ? "Chargement…" : "Charger plus"}
                    </button>
                  ) : (
                    <span style={{ opacity: 0.7, fontSize: 13 }}>Fin de la liste</span>
                  )
                ) : hasMore ? (
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
              <div className="jr-offerPaywallModal__eyebrow">Opportunité détectée</div>
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

            <div className="jr-offerPaywallModal__actions">
              <button type="button" className="btn btnPrimary btnWide" onClick={launchPassActivation}>
                Débloquer mes offres
              </button>
              <a
                className="jr-offerPaywallModal__back"
                href="#jr-results"
                onClick={(event) => {
                  event.preventDefault();
                  closeOfferUnlockModal();
                }}
              >
                Revenir aux offres
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
