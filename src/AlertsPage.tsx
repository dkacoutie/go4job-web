import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { trackAlertCreated } from "./lib/analytics";
import { resolveCountrySearchQuery } from "./lib/jobMatching";
import { useSession } from "./lib/useSession";
import { usePass } from "./lib/usePass";
import { EmptyState, NextStepCard } from "./components/GuidedUI";
import PwaInstallCard from "./components/PwaInstallCard";
import { useToast } from "./components/ToastCenter";
import "./AlertsPage.css";

type AlertRow = {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];

  // legacy + nouveau
  country: string | null;
  countries?: string[] | null;
  search_query?: string | null;
  employment_types?: string[] | null;
  work_modes?: string[] | null;
  skills_keywords?: string[] | null;
  excluded_keywords?: string[] | null;

  frequency: "instant" | "daily" | "weekly" | string;
  channels: string[];
  is_active: boolean;
  created_at: string;
};

function uniqClean(arr: string[]) {
  const out = arr
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\s+/g, " "));
  return Array.from(new Set(out));
}

function normalizeAlertCountry(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const parenthesizedCode = raw.match(/\(([A-Za-z]{2})\)/)?.[1];
  if (parenthesizedCode) return parenthesizedCode.toUpperCase();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return resolveCountrySearchQuery(raw) ?? "";
}

function buildAlertFeedUrl(alert?: AlertRow | null) {
  const params = new URLSearchParams();
  const keywords = uniqClean(alert?.keywords ?? []);
  const query =
    alert?.search_query?.trim() ||
    alert?.name?.trim() ||
    keywords[0] ||
    "";
  const countries = uniqClean([...(alert?.countries ?? []), alert?.country ?? ""])
    .map(normalizeAlertCountry)
    .filter(Boolean);
  const employmentTypes = uniqClean(alert?.employment_types ?? []);
  const workModes = uniqClean(alert?.work_modes ?? []);

  if (query) params.set("q", query);
  for (const country of countries) params.append("country", country);
  if (countries.length > 1) params.set("countries", countries.join(","));
  for (const employmentType of employmentTypes) params.append("employment_type", employmentType);
  for (const workMode of workModes) params.append("work_mode", workMode);

  const qs = params.toString();
  return qs ? `/jobradar/feed?${qs}` : "/jobradar/feed";
}

/* =========================
   Keyword Suggestion Engine (FR + EN)
========================= */
type KeywordPreset = { id: string; match: RegExp; keywords: string[] };

const KEYWORD_PRESETS: KeywordPreset[] = [
  {
    id: "data-bi",
    match: /\b(data|analyst|analyse|analytics|bi|power\s?bi|tableau|sql|reporting|dashboard|etl|dataviz|visualisation)\b/i,
    keywords: [
      "data analyst",
      "analyste data",
      "business intelligence",
      "BI",
      "power bi",
      "tableau",
      "sql",
      "reporting",
      "dashboard",
      "etl",
      "datawarehouse",
      "data quality",
      "kpi",
      "excel",
    ],
  },
  {
    id: "data-science-ml",
    match: /\b(data\s?scientist|machine\s?learning|ml\b|ai\b|ia\b|deep\s?learning|nlp|model)\b/i,
    keywords: [
      "data scientist",
      "machine learning",
      "ML",
      "AI",
      "IA",
      "python",
      "pandas",
      "scikit-learn",
      "tensorflow",
      "pytorch",
      "nlp",
      "feature engineering",
      "modeling",
    ],
  },
  {
    id: "frontend",
    match: /\b(front[- ]?end|frontend|react|vue|angular|next\.?js|ui|web\s?designer|intégrateur|integration)\b/i,
    keywords: [
      "frontend",
      "front-end",
      "react",
      "nextjs",
      "vue",
      "angular",
      "typescript",
      "javascript",
      "html",
      "css",
      "tailwind",
      "ui",
      "integration",
      "web",
    ],
  },
  {
    id: "backend",
    match: /\b(back[- ]?end|backend|api|node|express|django|flask|laravel|spring|java|php|c#|dotnet|\.net)\b/i,
    keywords: [
      "backend",
      "api",
      "rest",
      "graphql",
      "node",
      "express",
      "django",
      "flask",
      "laravel",
      "spring",
      "java",
      "php",
      ".net",
      "postgres",
      "mysql",
      "authentication",
    ],
  },
  {
    id: "fullstack",
    match: /\b(full[- ]?stack|fullstack)\b/i,
    keywords: ["fullstack", "react", "node", "typescript", "api", "postgres", "supabase", "auth", "ui", "deployment"],
  },
  {
    id: "mobile",
    match: /\b(mobile|android|ios|react\s?native|flutter|kotlin|swift)\b/i,
    keywords: ["mobile", "android", "ios", "react native", "flutter", "kotlin", "swift", "firebase", "api"],
  },
  {
    id: "devops-cloud",
    match: /\b(devops|cloud|aws|azure|gcp|docker|kubernetes|k8s|ci\/cd|terraform)\b/i,
    keywords: ["devops", "cloud", "aws", "azure", "gcp", "docker", "kubernetes", "ci/cd", "terraform", "linux", "monitoring", "deployment"],
  },
  {
    id: "security",
    match: /\b(security|cyber|cybersécurité|secops|soc|pentest|vulnerability|iso\s?27001)\b/i,
    keywords: ["cybersecurity", "cybersécurité", "soc", "secops", "pentest", "vulnerability", "iso 27001", "audit", "siem"],
  },
  {
    id: "project-management",
    match: /\b(chef\s?de\s?projet|project\s?manager|pmo|product\s?owner|scrum|agile|kanban)\b/i,
    keywords: ["chef de projet", "project manager", "PMO", "product owner", "scrum", "agile", "kanban", "planning", "budget", "stakeholders"],
  },
  {
    id: "m-e-ngo",
    match: /\b(m&e|suivi[- ]?évaluation|monitoring|evaluation|ong|ngo|humanitarian|relief|programme|program)\b/i,
    keywords: ["suivi-évaluation", "monitoring", "evaluation", "M&E", "ngo", "ong", "programme", "program", "baseline", "indicator", "reporting"],
  },
  {
    id: "sales-bd",
    match: /\b(business\s?developer|business\s?development|bd\b|sales|commercial|vente|account\s?manager)\b/i,
    keywords: ["business developer", "business development", "sales", "commercial", "prospection", "account manager", "crm", "pipeline", "closing"],
  },
  {
    id: "marketing-com",
    match: /\b(marketing|communication|community\s?manager|social\s?media|content|seo|sea|copywriter|brand)\b/i,
    keywords: ["marketing", "communication", "community manager", "social media", "content", "seo", "sea", "copywriting", "brand", "campaign"],
  },
  {
    id: "health-pharma",
    match: /\b(santé|health|pharmacie|pharmacien|pharmacist|infirmier|nurse|medical|clinique|hôpital)\b/i,
    keywords: ["santé", "health", "pharmacie", "pharmacist", "medical", "hospital", "clinic", "patient", "protocol", "stock médicament"],
  },
];

const STOP_WORDS = new Set([
  "de","des","du","la","le","les","un","une","et","en","a","à","au","aux","pour","avec","sans","sur","dans","chez","ou",
  "cdi","cdd","stage","alternance","junior","senior","confirme","confirmé","freelance","remote","hybride","temps","plein","partiel",
  "of","the","an","and","or","for","with","without","in","on","at","to","from","full","time","part","intern","internship","contract","permanent",
  "abidjan","san","pedro","dakar","bamako","ouagadougou","cote","ivoire","ivory","coast","senegal","mali","ghana","benin","togo","niger",
]);

function normalizeText(input: string) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function unique(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

function fallbackKeywords(title: string) {
  const t = normalizeText(title);
  const tokens = t
    .replace(/[^a-z0-9\s+.#-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 3)
    .filter((w) => !STOP_WORDS.has(w));

  const picked = unique(tokens).slice(0, 6);
  const generic = ["job", "emploi", "opportunity", "offre"];
  return unique([...picked, ...generic]).slice(0, 10);
}

function suggestKeywordsFromTitle(title: string) {
  const raw = title.trim();
  if (!raw) return [];
  const matches: string[] = [];
  for (const p of KEYWORD_PRESETS) if (p.match.test(raw)) matches.push(...p.keywords);
  const extra = fallbackKeywords(raw).slice(0, 4);
  return unique([...matches, ...extra]).slice(0, 18);
}

/* =========================
   Countries + labels
========================= */
type CountryOption = { code: string; label: string };

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "CI", label: "Côte d’Ivoire (CI)" },
  { code: "SN", label: "Sénégal (SN)" },
  { code: "BF", label: "Burkina Faso (BF)" },
  { code: "ML", label: "Mali (ML)" },
  { code: "NE", label: "Niger (NE)" },
  { code: "BJ", label: "Bénin (BJ)" },
  { code: "TG", label: "Togo (TG)" },
  { code: "GN", label: "Guinée (GN)" },
  { code: "GH", label: "Ghana (GH)" },
  { code: "NG", label: "Nigeria (NG)" },
  { code: "CM", label: "Cameroun (CM)" },
  { code: "FR", label: "France (FR)" },
  { code: "BE", label: "Belgique (BE)" },
  { code: "CH", label: "Suisse (CH)" },
  { code: "CA", label: "Canada (CA)" },
  { code: "US", label: "États-Unis (US)" },
  { code: "GB", label: "Royaume-Uni (GB)" },
];

const COUNTRY_OPTIONS_SORTED: CountryOption[] = [...COUNTRY_OPTIONS].sort((a, b) =>
  a.label.localeCompare(b.label, "fr", { sensitivity: "base" })
);

function freqLabel(freq: string) {
  if (freq === "instant") return "Instant";
  if (freq === "daily") return "Quotidien";
  if (freq === "weekly") return "Hebdo";
  return freq;
}
function channelLabel(ch: string) {
  if (ch === "email") return "Email";
  if (ch === "whatsapp") return "WhatsApp";
  if (ch === "telegram") return "Telegram";
  return ch;
}
function countryLabel(code: string | null) {
  if (!code) return "—";
  const found = COUNTRY_OPTIONS.find((c) => c.code === code);
  return found ? found.label.replace(/\s*\(.+\)$/, "") : code;
}
function countriesLabel(codes: string[] | null | undefined, legacyCountry: string | null) {
  const list = (codes && codes.length ? codes : legacyCountry ? [legacyCountry] : []).filter(Boolean) as string[];
  if (!list.length) return "Tous pays";
  if (list.length === 1) return countryLabel(list[0]);
  return `${list.length} pays`;
}

/* =========================
   Icons
========================= */
function IconDots() {

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8"></circle>
      <circle cx="12" cy="12" r="1.8"></circle>
      <circle cx="19" cy="12" r="1.8"></circle>
    </svg>
  );
}
function IconPause() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.5"></rect>
      <rect x="14" y="5" width="4" height="14" rx="1.5"></rect>
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7.5v9l8-4.5-8-4.5z"></path>
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9z"></path>
    </svg>
  );
}

export default function AlertsPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const { hasActivePass, isLoadingPass } = usePass();
  const FREE_ACTIVE_ALERT_LIMIT = 1;
  const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";
  const FREE_ALERT_LIMIT_MESSAGE =
    "Ton alerte gratuite est déjà active. Active un pass JobRadar pour créer plusieurs alertes.";
  const allowPremium = hasActivePass && !isLoadingPass;
  const userId = session?.user?.id ?? null;
  const MENU_WIDTH = 220;
  const MENU_HEIGHT = 120;
  const MENU_GAP = 8;
  const MENU_PAD = 12;

  const [rows, setRows] = useState<AlertRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [createdHint, setCreatedHint] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AlertRow | null>(null);

  const [name, setName] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [keywordsDirty, setKeywordsDirty] = useState(false);
  const [skillsKeywordsText, setSkillsKeywordsText] = useState("");
  const [skillsKeywordsConfigured, setSkillsKeywordsConfigured] = useState(false);
  const [excludedKeywordsText, setExcludedKeywordsText] = useState("");
  const [excludedKeywordsConfigured, setExcludedKeywordsConfigured] = useState(false);
  const [lastSuggestedFor, setLastSuggestedFor] = useState("");
  const [lastSuggestedText, setLastSuggestedText] = useState("");

  // OK nouveau: Tous pays + multi-pays
  const [allCountries, setAllCountries] = useState(false);
  const [countries, setCountries] = useState<string[]>(["CI"]);

  const [frequency, setFrequency] = useState<"instant" | "daily" | "weekly">("daily");
  const [chEmail, setChEmail] = useState(true);

  const [busy, setBusy] = useState(false);
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [deleteBusy, setDeleteBusy] = useState(false);

  const countActive = useMemo(() => rows.filter((r) => r.is_active).length, [rows]);
  const freeAlertLimitReached = !allowPremium && countActive >= FREE_ACTIVE_ALERT_LIMIT;
  const activeAlert = useMemo(() => rows.find((r) => r.is_active) ?? null, [rows]);
  const activeAlertFeedUrl = useMemo(() => buildAlertFeedUrl(activeAlert), [activeAlert]);

  const { pushToast } = useToast();

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (menuAnchorRef.current && menuAnchorRef.current.contains(target)) return;
      setOpenCardMenuId(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenCardMenuId(null);
        if (!deleteBusy) {
          setConfirmOpen(false);
          setToDelete(null);
        }
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteBusy]);

  useEffect(() => {
    if (!openCardMenuId) return;
    const onScroll = () => setOpenCardMenuId(null);
    const onResize = () => setOpenCardMenuId(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [openCardMenuId]);

  useEffect(() => {
    if (!openCardMenuId) {
      menuAnchorRef.current = null;
    }
  }, [openCardMenuId]);

  async function fetchAlerts() {
    if (!userId) return;

    setErrorMsg(null);
    setListLoading(true);

    const { data, error } = await supabase
      .from("alerts")
      .select("id, user_id, name, keywords, country, countries, search_query, employment_types, work_modes, skills_keywords, excluded_keywords, frequency, channels, is_active, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(GENERIC_SERVER_ERROR);
      pushToast({ kind: "error", title: "Impossible de charger les alertes", message: GENERIC_SERVER_ERROR });
      setRows([]);
      setListLoading(false);
      return;
    }

    setRows((data ?? []) as AlertRow[]);
    setListLoading(false);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!loading && session && userId && !isLoadingPass) {
        await fetchAlerts();
        if (!alive) return;
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, userId, allowPremium, isLoadingPass]);

  useEffect(() => {
    const n = name.trim();

    if (!n) {
      if (!keywordsDirty) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setKeywordsText("");
        setLastSuggestedFor("");
        setLastSuggestedText("");
      }
      return;
    }

    const suggested = suggestKeywordsFromTitle(n).join(", ");

    const keywordsIsStillAuto =
      !keywordsDirty ||
      keywordsText.trim() === "" ||
      (lastSuggestedFor &&
        normalizeText(lastSuggestedFor) === normalizeText(name) &&
        normalizeText(lastSuggestedText) === normalizeText(keywordsText)) ||
      (lastSuggestedText && normalizeText(lastSuggestedText) === normalizeText(keywordsText));

    if (keywordsIsStillAuto) {
      setKeywordsText(suggested);
      setLastSuggestedFor(name);
      setLastSuggestedText(suggested);
      setKeywordsDirty(false);
    }
  }, [name, keywordsDirty, keywordsText, lastSuggestedFor, lastSuggestedText]);

  async function createAlert() {
    if (!userId || busy) return;

    const n = name.trim();
    const kw = uniqClean(keywordsText.split(",").map((s) => s.trim()).filter(Boolean));
    const skillsKeywords = uniqClean(skillsKeywordsText.split(",").map((s) => s.trim()).filter(Boolean));
    const excludedKeywords = uniqClean(excludedKeywordsText.split(",").map((s) => s.trim()).filter(Boolean));
    const channels = uniqClean([chEmail ? "email" : ""]).filter(Boolean);

    // OK countries: null = Tous pays, sinon array
    const selectedCountries = uniqClean((countries ?? []).map((c) => c.trim()).filter(Boolean));
    const countriesToSave = allCountries ? null : selectedCountries;

    // OK legacy country (pour compat)
    const legacyCountry = countriesToSave && countriesToSave.length ? countriesToSave[0] : null;

    if (!n) {
      const msg = "Donne un nom à ton alerte (ex: Data Analyst).";
      setErrorMsg(msg);
      pushToast({ kind: "error", title: "Nom d’alerte requis", message: msg });
      return;
    }
    if (kw.length === 0) {
      const msg = "Ajoute au moins 1 mot-clé (séparés par des virgules).";
      setErrorMsg(msg);
      pushToast({ kind: "error", title: "Mots-clés manquants", message: msg });
      return;
    }
    if (!allCountries && selectedCountries.length === 0) {
      const msg = "Choisis au moins 1 pays, ou active “Tous pays”.";
      setErrorMsg(msg);
      pushToast({ kind: "error", title: "Pays requis", message: msg });
      return;
    }
    if (channels.length === 0) {
      const msg = "Choisis au moins un canal (Email).";
      setErrorMsg(msg);
      pushToast({ kind: "error", title: "Canal requis", message: msg });
      return;
    }

    setBusy(true);
    setErrorMsg(null);

    if (!allowPremium) {
      const { count, error: countErr } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);

      if (countErr) {
        setBusy(false);
        setErrorMsg(GENERIC_SERVER_ERROR);
        pushToast({ kind: "error", title: "Création impossible", message: GENERIC_SERVER_ERROR });
        return;
      }

      if ((count ?? countActive) >= FREE_ACTIVE_ALERT_LIMIT) {
        setBusy(false);
        pushToast({ kind: "info", title: "Limite gratuite atteinte", message: FREE_ALERT_LIMIT_MESSAGE });
        return;
      }
    }

    const { error } = await supabase.from("alerts").insert({
      user_id: userId,
      name: n,
      keywords: kw,
      skills_keywords: skillsKeywordsConfigured ? skillsKeywords : null,
      excluded_keywords: excludedKeywordsConfigured ? excludedKeywords : null,

      // OK nouveau champ
      countries: countriesToSave,

      // OK legacy (compat)
      country: legacyCountry,

      frequency,
      channels,
      is_active: true,
    });

    setBusy(false);

    if (error) {
      setErrorMsg(GENERIC_SERVER_ERROR);
      pushToast({ kind: "error", title: "Création impossible", message: GENERIC_SERVER_ERROR });
      return;
    }

    pushToast({
      kind: "success",
      title: "Alerte créée",
      message: "Tu recevras des offres plus ciblées selon cette alerte.",
    });
    setCreatedHint(true);
    trackAlertCreated({
      hasCountryFilter: !allCountries,
      frequency,
      channel: channels[0],
    });

    setName("");
    setKeywordsText("");
    setKeywordsDirty(false);
    setSkillsKeywordsText("");
    setSkillsKeywordsConfigured(false);
    setExcludedKeywordsText("");
    setExcludedKeywordsConfigured(false);
    setLastSuggestedFor("");
    setLastSuggestedText("");

    setAllCountries(false);
    setCountries(["CI"]);

    setFrequency("daily");
    setChEmail(true);

    fetchAlerts();
  }

  async function toggleActive(a: AlertRow) {
    if (!userId) return;
    if (!allowPremium && !a.is_active && countActive >= FREE_ACTIVE_ALERT_LIMIT) {
      pushToast({ kind: "info", title: "Limite gratuite atteinte", message: FREE_ALERT_LIMIT_MESSAGE });
      return;
    }

    if (!allowPremium && !a.is_active) {
      const { count, error: countErr } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);

      if (countErr) {
        setErrorMsg(GENERIC_SERVER_ERROR);
        pushToast({ kind: "error", title: "Mise à jour impossible", message: GENERIC_SERVER_ERROR });
        return;
      }

      if ((count ?? countActive) >= FREE_ACTIVE_ALERT_LIMIT) {
        pushToast({ kind: "info", title: "Limite gratuite atteinte", message: FREE_ALERT_LIMIT_MESSAGE });
        return;
      }
    }

    const { error } = await supabase
      .from("alerts")
      .update({ is_active: !a.is_active })
      .eq("id", a.id)
      .eq("user_id", userId);

    if (error) {
      setErrorMsg(GENERIC_SERVER_ERROR);
      pushToast({ kind: "error", title: "Mise à jour impossible", message: GENERIC_SERVER_ERROR });
      return;
    }

    setRows((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)));
    pushToast({
      kind: "success",
      title: a.is_active ? "Alerte mise en pause" : "Alerte réactivée",
      message: a.is_active ? "Tu peux la réactiver quand tu veux." : "La diffusion reprend maintenant.",
    });
  }

  function removeAlert(a: AlertRow) {
    setToDelete(a);
    setConfirmOpen(true);
  }

  function openMenu(e: ReactMouseEvent<HTMLButtonElement>, alert: AlertRow) {
    e.preventDefault();
    e.stopPropagation();

    if (openCardMenuId === alert.id) {
      setOpenCardMenuId(null);
      return;
    }

    const target = e.currentTarget as HTMLElement;
    menuAnchorRef.current = target;
    const rect = target.getBoundingClientRect();
    const preferRight = rect.right + MENU_GAP + MENU_WIDTH <= window.innerWidth - MENU_PAD;
    let left = preferRight ? rect.right + MENU_GAP : rect.left - MENU_GAP - MENU_WIDTH;
    left = Math.max(MENU_PAD, Math.min(left, window.innerWidth - MENU_WIDTH - MENU_PAD));

    let top = rect.top;
    const maxTop = window.innerHeight - MENU_HEIGHT - MENU_PAD;
    if (top > maxTop) top = Math.max(MENU_PAD, maxTop);

    setMenuPos({ top, left });
    setOpenCardMenuId(alert.id);
  }

  async function confirmDelete() {
    if (!toDelete || !userId || deleteBusy) return;

    setDeleteBusy(true);
    setOpenCardMenuId(null);

    let deleted = false;
    let lastError: string | null = null;

    try {
      const { error: directErr } = await supabase
        .from("alerts")
        .delete()
        .eq("id", toDelete.id)
        .eq("user_id", userId);

      if (directErr) {
        lastError = directErr.message;
      } else {
        deleted = true;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    if (!deleted) {
      const msg = "La suppression n’a pas été confirmée. Réessaie dans quelques instants.";
      setErrorMsg(msg);
      pushToast({ kind: "error", title: "Suppression impossible", message: msg });
      console.error("[alerts] delete failed", lastError);
      setDeleteBusy(false);
      return;
    }

    setRows((prev) => prev.filter((x) => x.id !== toDelete.id));
    pushToast({
      kind: "success",
      title: "Alerte supprimée",
      message: "Tu peux en créer une nouvelle quand tu veux.",
    });
    setConfirmOpen(false);
    setToDelete(null);
    setDeleteBusy(false);
  }

  const openAlert = openCardMenuId ? rows.find((r) => r.id === openCardMenuId) ?? null : null;

  return (
    <div className="alerts-shell">
      <section className="alerts-hero">
        <div className="alerts-heroTop">
          <div>
            <h1>Alertes</h1>
            <p>
              Configure tes alertes (mots-clés, pays, fréquence) et reçois les opportunités.
              <span className="pill">
                {countActive} active{countActive > 1 ? "s" : ""}
              </span>
            </p>
          </div>

          <button className="btn btnGhost" type="button" onClick={() => navigate("/jobradar/feed")}>
            Voir les offres →
          </button>
        </div>
      </section>

      {errorMsg && <div className="alerts-error">Erreur : {errorMsg}</div>}

      <PwaInstallCard />

      <>
        {freeAlertLimitReached ? (
          <section className="alerts-freeActiveCard">
            <div className="alerts-freeActiveIcon" aria-hidden="true">
              ✓
            </div>
            <div className="alerts-freeActiveBody">
              <div className="alerts-freeActiveTitle">Ton alerte gratuite est active</div>
              <p>
                JobRadar surveille maintenant les nouvelles offres selon tes critères. Tu recevras un digest par email
                dès qu’il y a des opportunités pour toi.
              </p>
              <p className="alerts-freeActiveSecondary">
                Pour créer plusieurs alertes et accéder aux détails complets des offres, active un pass JobRadar.
              </p>
              <div className="alerts-freeActiveActions">
                <button className="btn btnPrimary" type="button" onClick={() => navigate(activeAlertFeedUrl)}>
                  Voir les offres proches de mon alerte
                </button>
                <button className="btn alerts-freeActivePassBtn" type="button" onClick={() => navigate("/pricing")}>
                  Activer un pass
                </button>
              </div>
              <div className="alerts-freeActiveNote">
                Tu veux chercher dans un autre secteur ? Modifie ou supprime ton alerte existante pour en créer une
                nouvelle.
              </div>
            </div>
          </section>
        ) : (
          <section className="alerts-card">
        <div className="alerts-cardHeader">
          <div>
            <div className="mutedTitle">CRÉER UNE ALERTE</div>
            <div className="title">Nouvelle alerte</div>
            <div className="sub">Ex: “Data Analyst, Power BI, Remote”.</div>
          </div>
        </div>

        <div className="alerts-form">
          <label className="label">
            Nom de l’alerte
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Data Analyst" />
          </label>

          <label className="label">
            Mots-clés (séparés par des virgules)
            <input
              className="input"
              value={keywordsText}
              onChange={(e) => {
                setKeywordsDirty(true);
                setKeywordsText(e.target.value);
              }}
              placeholder="ex: data analyst, power bi, sql"
            />
          </label>

          <div className="row2 advancedFields">
            <label className="label">
              Compétences ou outils recherchés
              <input
                className="input"
                value={skillsKeywordsText}
                onChange={(e) => {
                  setSkillsKeywordsConfigured(true);
                  setSkillsKeywordsText(e.target.value);
                }}
                placeholder="Agile, SAP, ERP, Salesforce, Excel, Paie"
              />
              <span className="fieldHint">Exemple : Agile, SAP, ERP, Salesforce, Excel, Paie</span>
            </label>

            <label className="label">
              Mots à exclure
              <input
                className="input"
                value={excludedKeywordsText}
                onChange={(e) => {
                  setExcludedKeywordsConfigured(true);
                  setExcludedKeywordsText(e.target.value);
                }}
                placeholder="BTP, chantier, restauration, formation"
              />
              <span className="fieldHint">Exemple : BTP, chantier, restauration, formation</span>
            </label>
          </div>

          <div className="row2">
            <label className="label">
              Pays (optionnel)
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label className="check" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={allCountries}
                    onChange={(e) => setAllCountries(e.target.checked)}
                  />{" "}
                  Tous pays
                </label>

                <select
                  className="input"
                  multiple
                  disabled={allCountries}
                  value={countries}
                  onChange={(e) => {
                    const values = Array.from(e.currentTarget.selectedOptions).map((o) => o.value);
                    setCountries(values);
                  }}
                  style={{ minHeight: 90 }}
                  title="Maintiens Ctrl (Windows) / Cmd (Mac) pour sélectionner plusieurs pays"
                >
                  {COUNTRY_OPTIONS_SORTED.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Astuce : Ctrl/Cmd + clic pour multi-sélection.
                </div>
              </div>
            </label>

            <label className="label">
              Fréquence
              <select
                className="input"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as "instant" | "daily" | "weekly")}
              >
                <option value="instant">Instant</option>
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdo</option>
              </select>
            </label>
          </div>

          <div className="channels">
            <div className="channelsTitle">Canaux</div>

            <label className="check">
              <input type="checkbox" checked={chEmail} onChange={(e) => setChEmail(e.target.checked)} /> Email
            </label>
          </div>

          <button className="btn btnPrimary btnAlertCta" type="button" disabled={busy} onClick={createAlert}>
            {busy ? (
              <span className="btnInline">
                <span className="spinner" aria-hidden="true" />
                Création…
              </span>
            ) : (
              "Créer l’alerte"
            )}
          </button>
        </div>
      </section>
        )}

      {createdHint && (
        <div style={{ margin: "18px 0" }}>
          <NextStepCard
            title="Prochaine étape recommandée"
            message="Découvre les offres correspondant à cette alerte ou améliore ton ciblage."
            primaryAction={{ label: "Voir les offres proches de mon alerte", to: activeAlertFeedUrl }}
            secondaryAction={
              freeAlertLimitReached ? undefined : { label: "Ajouter un autre pays", to: "/jobradar/alerts" }
            }
            tone="info"
          />
        </div>
      )}

      <section className="alerts-list">
        <div className="mutedTitle">MES ALERTES</div>

        {listLoading ? (
          <div className="skeletonGrid">
            {Array.from({ length: 3 }).map((_, i) => (
              <div className="skeletonCard" key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Tu n’as pas encore d’alerte"
            description="Crée une alerte pour recevoir des offres plus ciblées."
            primaryAction={{ label: "Créer ma première alerte", to: "/jobradar/alerts" }}
            tone="info"
          />
        ) : (
          <div className="listGrid">
            {rows.map((a) => {
              const visibleChannels = (a.channels ?? []).filter((ch) => ch === "email");
              const line = [
                countriesLabel(a.countries, a.country),
                freqLabel(a.frequency),
                visibleChannels.map(channelLabel).join(", "),
              ]
                .filter(Boolean)
                .join(" · ");

              const codes =
                (a.countries && a.countries.length ? a.countries : a.country ? [a.country] : []) as string[];

              return (
                <div className="item itemPremium" key={a.id}>
                  <div className="itemTop">
                    <div className="itemName">{a.name}</div>

                    <div className="itemRight">
                      <div className={a.is_active ? "status on" : "status off"}>{a.is_active ? "Active" : "Pause"}</div>
                      <button className="iconBtn" aria-label="Actions" type="button" onClick={(e) => openMenu(e, a)}>
                        <IconDots />
                      </button>
                    </div>
                  </div>

                  <div className="metaLine">{line}</div>

                  <div className="itemMeta">
                    <div className="keywordsLine">
                      <span className="k">Mots-clés</span>
                      <span className="kw">{(a.keywords ?? []).join(", ")}</span>
                    </div>
                    {a.skills_keywords !== null && a.skills_keywords !== undefined ? (
                      <div className="keywordsLine">
                        <span className="k">Compétences ou outils recherchés</span>
                        <span className="kw">{a.skills_keywords.length ? a.skills_keywords.join(", ") : "Aucun mot renseigné"}</span>
                      </div>
                    ) : null}
                    {a.excluded_keywords !== null && a.excluded_keywords !== undefined ? (
                      <div className="keywordsLine">
                        <span className="k">Mots à exclure</span>
                        <span className="kw">{a.excluded_keywords.length ? a.excluded_keywords.join(", ") : "Aucun mot renseigné"}</span>
                      </div>
                    ) : null}

                    <div className="metaRow">
                      {codes.length ? (
                        codes.map((c) => (
                          <span className="chip" key={`${a.id}-${c}`}>
                            {c}
                          </span>
                        ))
                      ) : (
                        <span className="chip">Tous pays</span>
                      )}
                      <span className="chip">{a.frequency}</span>
                        {visibleChannels.length ? <span className="chip">{visibleChannels.map(channelLabel).join(" / ")}</span> : null}
                    </div>
                  </div>

                  {a.is_active ? (
                    <div className="alertCardActions">
                      <button
                        className="btn btnGhost alertCardFeedBtn"
                        type="button"
                        onClick={() => navigate(buildAlertFeedUrl(a))}
                      >
                        Voir les offres proches →
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {openAlert && typeof document !== "undefined"
        ? createPortal(
            <div
              className="alerts-menu-popover"
              role="menu"
              ref={menuRef}
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                type="button"
                className="alerts-menuItem"
                onClick={() => {
                  setOpenCardMenuId(null);
                  toggleActive(openAlert);
                }}
              >
                <span className="menuIcon">{openAlert.is_active ? <IconPause /> : <IconPlay />}</span>
                {openAlert.is_active ? "Mettre en pause" : "Réactiver"}
              </button>
              <button
                type="button"
                className="alerts-menuItem danger"
                onClick={() => {
                  setOpenCardMenuId(null);
                  removeAlert(openAlert);
                }}
              >
                <span className="menuIcon">
                  <IconTrash />
                </span>
                Supprimer
              </button>
            </div>,
            document.body,
          )
        : null}

      {confirmOpen && (
        <div
          className="modalOverlay"
          onClick={() => {
            if (deleteBusy) return;
            setConfirmOpen(false);
            setToDelete(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Supprimer cette alerte ?</div>
            <div className="modalText">Cette action est définitive.</div>

            <div className="modalActions">
              <button
                className="btn btnGhost"
                disabled={deleteBusy}
                onClick={() => {
                  setConfirmOpen(false);
                  setToDelete(null);
                }}
              >
                Annuler
              </button>
              <button className="btn btnDanger" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    </div>
  );
}




