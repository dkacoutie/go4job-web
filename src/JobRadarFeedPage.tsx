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
  type ShadowFeedMatchRow,
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

type FeedDisplayRow = MatchRow | ShadowFeedMatchRow;

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
    "Cette offre correspond à ton profil. Active ton pass pour voir l’offre complète et débloquer toutes tes offres.";
  const OFFER_GATE_BENEFITS = [
    "Accès complet à toutes tes offres",
    "Offre complète pour chaque opportunité",
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

  const [matchMode, setMatchMode] = useState<"strict" | "large">("large");
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

  const [offerUnlockModal, setOfferUnlockModal] = useState<{ title: string } | null>(null);

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
      .in("job_status", ["active", "stale"])
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

  const forYouRows = visibleFeedBuckets.for_you.filter((row: FeedDisplayRow) => {
    if (!onlyVeryRelevant) return true;
    return row.p >= TOP_MATCH_MIN;
  });

  const topCount = visibleFeedBuckets.top_match.length;
  const forYouCount = visibleFeedBuckets.for_you.length;
  const exploreCount = visibleFeedBuckets.explore.length;
  const shadowUi = useMemo(() => buildJobRadarShadowUi(shadowMeta, topCount), [shadowMeta, topCount]);
  const displayed = matchMode === "strict" ? forYouRows : visibleFeedBuckets.explore;
  const displayedLimited = isPreview ? displayed.slice(0, FEED_PREVIEW_LIMIT) : displayed;
  const showGateOnDisplayed = isPreview && displayed.length > FEED_PREVIEW_LIMIT;
  const showNoPreciseMatchState = matchMode === "strict" && forYouCount === 0 && exploreCount > 0;
  const forYouPillLabel =
    forYouCount === 0 && exploreCount > 0
      ? "Personnalisation en cours"
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
                  title={
                    forYouCount === 0
                      ? "Aucun match précis pour l’instant"
                      : "Offres les plus pertinentes pour toi"
                  }
                  aria-pressed={matchMode === "strict"}
                >
                  {forYouCount === 0 ? "Pour toi" : `Pour toi (${forYouCount})`}
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
        ) : alerts.length === 0 && !shadowUi.suppressNoAlertsEmptyState ? (
          <EmptyState
            title="Tu n’as pas encore d’alerte"
            description="Crée une alerte pour recevoir des offres mieux ciblées."
            primaryAction={{ label: "Créer une alerte", to: "/jobradar/alerts" }}
            secondaryAction={{ label: "Améliorer mon profil", to: "/jobradar/profile" }}
            tone="info"
          />
        ) : displayed.length === 0 ? (
          showNoPreciseMatchState ? (
            <EmptyState
              title="Aucun match précis pour l’instant"
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
        ) : (
          <>
            <div className="jr-grid" id="jr-results">
              <>
                {displayedLimited.map((row: FeedDisplayRow) => {
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
