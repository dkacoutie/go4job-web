import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { canonicalizeText } from "./lib/taxonomy";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./JobRadarFeedPage.css";

type AlertRow = {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  country: string | null;
  countries?: string[] | null; // ✅ nouveau
  frequency: string;
  channels: string[];
  is_active: boolean;
  created_at?: string | null;
};

type ApplicationStatus = "saved" | "queued" | "in_progress" | "submitted" | "failed";

type MatchWhy = {
  alert: string[];
  cv: string[];
  restAlert: number;
  restCv: number;
};

type MatchRow = {
  job: JobRow;
  s: number;
  p: number;
  kwCount: number;
  signalCount: number;
  expOk: boolean;
  why: MatchWhy;
};

type JobRow = {
  id: string; // UUID
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;

  sort_at?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;

  description?: string | null; // alias description_text -> description
  tags?: string[] | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return String(err);
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

// ✅ Normalisation simple (pour extraire des tokens depuis le nom d’alerte)
function normalizeText(input: string) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ✅ stop-words de base (FR+EN) pour éviter de polluer le scoring
const STOP_WORDS = new Set([
  "de","des","du","la","le","les","un","une","et","en","a","à","au","aux","pour","avec","sans","sur","dans","chez","ou",
  "the","a","an","and","or","for","with","without","in","on","at","to","from",
  "remote","remotely","hybrid","freelance","intern","internship","stage","alternance","junior","senior",
]);

// ✅ Le nom d’alerte compte : on en extrait quelques mots + on garde la phrase entière
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

  // limiter pour ne pas diluer le %
  return uniq([phrase, ...tokens]).slice(0, 5);
}

// "Pourquoi ça match ?" : top 3 mots-clés détectés (+X)
function topMatchesForJob(
  job: JobRow,
  alertKw: string[],
  cvKw: string[],
  extraCv: string[] = [],
  maxShown = 2
) {
  const skillBits = [
    ...(job.required_skills ?? []),
    ...(job.optional_skills ?? []),
    ...(job.job_skills ?? []),
    ...(job.tags ?? []),
  ];

  const rawHay = [
    job.title,
    job.company_name,
    job.location,
    job.country,
    job.remote_type,
    job.description,
    ...skillBits,
  ]
    .filter(Boolean)
    .join(" ");

  const hay = canonicalizeText(rawHay);
  const hitsAlert = alertKw.filter((k) => k && hay.includes(k));
  const hitsCvRaw = cvKw.filter((k) => k && hay.includes(k) && !hitsAlert.includes(k));
  const hitsCv = uniq([...extraCv, ...hitsCvRaw]);

  const shownAlert = hitsAlert.slice(0, maxShown);
  const shownCv = hitsCv.slice(0, maxShown);

  return {
    alert: shownAlert,
    cv: shownCv,
    restAlert: Math.max(0, hitsAlert.length - shownAlert.length),
    restCv: Math.max(0, hitsCv.length - shownCv.length),
  };
}

export default function JobRadarFeedPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [cvSkills, setCvSkills] = useState<string[]>([]);
  const [cvExp, setCvExp] = useState<{ min: number | null; max: number | null } | null>(null);
  const [busy, setBusy] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [q, setQ] = useState("");

  // Modes
  const [matchMode, setMatchMode] = useState<"strict" | "large">("strict");
  const STRICT_MIN_PERCENT = 70;

  const [appStatusByJobId, setAppStatusByJobId] = useState<Map<string, ApplicationStatus>>(new Map());
  const [addingJobId, setAddingJobId] = useState<string | null>(null);

  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
  const [dismissingJobId, setDismissingJobId] = useState<string | null>(null);

  // Pagination
  const PAGE_SIZE = 30;
  const [pageFrom, setPageFrom] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  // Keywords : on garde 60 uniques mais on score sur un cap (20)
  const KEYWORDS_MAX_UNIQ = 60;
  const KEYWORDS_CAP = 20;

  const CV_SKILLS_CAP = 40;

  // ✅ alertKeywords inclut: keywords[] + tokens extraits du nom d’alerte
  const alertKeywords = useMemo(() => {
    const fromKeywords = alerts.flatMap((a) => a.keywords ?? []);
    const fromNames = alerts.flatMap((a) => extractKeywordsFromAlertName(a.name ?? ""));
    return uniq([...fromKeywords, ...fromNames]).slice(0, KEYWORDS_MAX_UNIQ);
  }, [alerts]);

  const cappedAlertKeywords = useMemo(() => alertKeywords.slice(0, KEYWORDS_CAP), [alertKeywords]);

  // ✅ CV skills (pour matching)
  const cvKeywords = useMemo(() => uniq(cvSkills).slice(0, CV_SKILLS_CAP), [cvSkills]);

  // ✅ Pays autorisés (supporte country + countries, et "Tous pays" => countries = null)
  const { allowAllCountries, allowedCountries } = useMemo(() => {
    if (!alerts?.length) return { allowAllCountries: true, allowedCountries: new Set<string>() };

    let allowAll = false;
    const set = new Set<string>();

    for (const a of alerts) {
      const list = (a.countries && a.countries.length ? a.countries : a.country ? [a.country] : [])
        .map((x) => (x ?? "").trim().toUpperCase())
        .filter(Boolean);

      // countries=null OU pas de pays => pas de filtre pays
      if (!list.length) {
        allowAll = true;
        continue;
      }
      for (const c of list) set.add(c);
    }

    if (set.size === 0) allowAll = true;
    return { allowAllCountries: allowAll, allowedCountries: set };
  }, [alerts]);

  function mergeUniqueById(prev: JobRow[], next: JobRow[]) {
    const map = new Map<string, JobRow>();
    for (const j of prev) map.set(j.id, j);
    for (const j of next) map.set(j.id, j);
    return Array.from(map.values());
  }

  async function fetchJobsRange(from: number, to: number) {
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
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;
    return (data ?? []) as JobRow[];
  }

  async function load() {
    if (!userId) return;

    setBusy(true);
    setErrorMsg(null);

    try {
      // 1) alertes actives
      const { data: aData, error: aErr } = await supabase
        .from("alerts")
        .select("id, user_id, name, keywords, country, countries, frequency, channels, is_active, created_at")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (aErr) throw aErr;
      setAlerts((aData ?? []) as AlertRow[]);

      // 1b) CV actif (skills)
      const { data: cvData, error: cvErr } = await supabase
        .from("user_cvs")
        .select("skills, cv_json")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (cvErr) {
        setCvSkills([]);
        setCvExp(null);
      } else {
        setCvSkills(Array.isArray((cvData as any)?.skills) ? (cvData as any).skills : []);
        const cvJson = (cvData as any)?.cv_json ?? {};
        const expMin = toNumberOrNull(cvJson?.experience_years_min);
        const expMax = toNumberOrNull(cvJson?.experience_years_max);
        if (expMin != null || expMax != null) {
          setCvExp({ min: expMin, max: expMax });
        } else {
          setCvExp(null);
        }
      }

      // 2) jobs (1ère page)
      const fetchedJobs = await fetchJobsRange(0, PAGE_SIZE - 1);
      setJobs(fetchedJobs);

      setPageFrom(fetchedJobs.length);
      setHasMore(fetchedJobs.length === PAGE_SIZE);

      // 3) applications
      const { data: appData, error: appErr } = await supabase
        .from("applications")
        .select("job_id, status")
        .eq("user_id", userId)
        .limit(5000);

      if (appErr) throw appErr;

      const map = new Map<string, ApplicationStatus>();
      (appData ?? []).forEach((row: { job_id?: string; status?: ApplicationStatus }) => {
        if (row?.job_id && row?.status) map.set(row.job_id, row.status);
      });
      setAppStatusByJobId(map);

      // 4) déclinés
      const { data: dData, error: dErr } = await supabase
        .from("job_feedback")
        .select("job_id")
        .eq("user_id", userId)
        .eq("action", "dismissed")
        .limit(5000);

      if (dErr) throw dErr;
      const dismissedIds = (dData ?? [])
        .map((x: { job_id?: string }) => x.job_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      setDismissedJobIds(new Set(dismissedIds));
    } catch (e: unknown) {
      setErrorMsg(getErrorMessage(e) ?? "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, userId]);

  // ✅ Ajouter = Sauvegarder / À postuler => RPC save_job()
  async function addToApplications(jobId: string) {
    if (!userId) {
      navigate("/auth", { replace: true });
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
    } catch (e: unknown) {
      setErrorMsg(getErrorMessage(e) ?? "Erreur inconnue");
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

  // ✅ 2 listes: Top matchs vs Explorer
  const matches = useMemo(() => {
    const kwAlerts = uniq(cappedAlertKeywords.map((k) => canonicalizeText(k)).map(norm)).filter(Boolean);
    const kwCv = uniq(cvKeywords.map((k) => canonicalizeText(k)).map(norm)).filter(Boolean);
    const kwCount = kwAlerts.length + kwCv.length;
    const weightAlert = 2;
    const weightCv = 1;
    const cvExpValue = cvExp?.max ?? cvExp?.min ?? null;
    const expWeight = 2;

    const qCanon = norm(canonicalizeText(q));

    const jobHay = (job: JobRow) =>
      canonicalizeText(
        [
          job.title,
          job.company_name,
          job.location,
          job.country,
          job.remote_type,
          job.description,
          ...(job.required_skills ?? []),
          ...(job.optional_skills ?? []),
          ...(job.job_skills ?? []),
          ...(job.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
      );

    const score = (job: JobRow, hay: string) => {
      let sAlert = 0;
      let sCv = 0;
      for (const k of kwAlerts) if (k && hay.includes(k)) sAlert += 1;
      for (const k of kwCv) if (k && hay.includes(k)) sCv += 1;

      const jobMin = job.experience_years_min ?? null;
      const jobMax = job.experience_years_max ?? null;
      const expConsidered = cvExpValue != null && (jobMin != null || jobMax != null);
      let expOk = false;
      let expReason: string | null = null;

      if (expConsidered && cvExpValue != null) {
        let ok = true;
        if (jobMin != null) ok = ok && cvExpValue >= jobMin;
        if (jobMax != null) ok = ok && cvExpValue <= jobMax + 2;
        expOk = ok;
        if (ok) {
          if (jobMin != null) expReason = `Expérience ≥ ${jobMin} ans`;
          else if (jobMax != null) expReason = `Expérience ≤ ${jobMax} ans`;
          else expReason = `Expérience ${cvExpValue} ans`;
        }
      }

      const denom = kwAlerts.length * weightAlert + kwCv.length * weightCv + (expConsidered ? expWeight : 0);
      const weighted = sAlert * weightAlert + sCv * weightCv + (expOk ? expWeight : 0);
      const p = denom ? Math.round((weighted / denom) * 100) : 0;
      return { p, sAlert, sCv, expOk, expReason };
    };

    // Explorer (base)
    const exploreMatches = jobs
      .map((job): MatchRow | null => {
        const hay = jobHay(job);
        const scored = score(job, hay);

        // filtre recherche
        if (qCanon && !hay.includes(qCanon)) return null;

        const p = scored.p;
        const signalCount = kwCount + (scored.expOk ? 1 : 0);
        const extraCvReasons = scored.expOk && scored.expReason ? [scored.expReason] : [];
        const why = signalCount
          ? topMatchesForJob(job, kwAlerts, kwCv, extraCvReasons, 2)
          : { alert: [], cv: [], restAlert: 0, restCv: 0 };

        return {
          job,
          s: scored.sAlert + scored.sCv,
          p,
          kwCount,
          signalCount,
          expOk: scored.expOk,
          why,
        };
      })
      .filter((x): x is MatchRow => Boolean(x))
      // au moins 1 mot-clé si on en a
      .filter((x) => (x.signalCount ? (x.s >= 1 || x.expOk) : true))
      // filtre pays
      .filter((x) => {
        if (allowAllCountries) return true;

        const jc = (x.job.country ?? "").trim().toUpperCase();
        if (!jc) return true;
        if (jc.length !== 2) return true;

        return allowedCountries.has(jc);
      })
      .filter((x) => !appStatusByJobId.has(x.job.id))
      .filter((x) => !dismissedJobIds.has(x.job.id))
      .sort((a, b) => {
        if (b.p !== a.p) return b.p - a.p;
        if (b.s !== a.s) return b.s - a.s;
        return getJobTimeMs(b.job) - getJobTimeMs(a.job);
      });

    const topMatches = exploreMatches.filter((x) => x.p >= STRICT_MIN_PERCENT);

    return { topMatches, exploreMatches, kwCount };
  }, [
    jobs,
    cappedAlertKeywords,
    cvKeywords,
    cvExp,
    q,
    allowAllCountries,
    allowedCountries,
    appStatusByJobId,
    dismissedJobIds,
    STRICT_MIN_PERCENT,
  ]);

  // ✅ Option A: si Top Match est vide => bascule automatique en Explorer
  useEffect(() => {
    if (matchMode === "strict" && matches.topMatches.length === 0) {
      setMatchMode("large");
    }
  }, [matchMode, matches.topMatches.length]);

  // ✅ Liste affichée selon mode
  const displayed = matchMode === "strict" ? matches.topMatches : matches.exploreMatches;

  const openJob = (jobId: string) => navigate(`/jobradar/jobs/${jobId}`);

  const topCount = matches.topMatches.length;
  const exploreCount = matches.exploreMatches.length;

  return (
    <div className="jr-shell">
      <main className="jr-main">
        <section className="jr-hero">
          <div className="jr-heroTop">
            <div>
              <div className="jr-kicker">JobRadar</div>
              <h1>Priorité aux meilleures opportunités</h1>
              <p>Matching intelligent basé sur tes alertes et ton CV.</p>
            </div>

            <div className="jr-pillRow" aria-label="Statistiques">
              <span className="jr-pillHero">
                {alerts.length} alerte{alerts.length > 1 ? "s" : ""} active{alerts.length > 1 ? "s" : ""}
              </span>
              <span className="jr-pillHero">
                {displayed.length} offre{displayed.length > 1 ? "s" : ""}
              </span>
              <span className="jr-pillHero jr-pillStrong">
                {topCount} top match{topCount > 1 ? "s" : ""}
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
                placeholder="Filtrer (ex: data analyst, react, project manager...)"
                aria-label="Filtrer les offres"
              />
              {q ? (
                <button className="jr-clearBtn" type="button" onClick={() => setQ("")} aria-label="Effacer le filtre">
                  ×
                </button>
              ) : null}
            </div>

            <div className="jr-modeToggle" role="tablist" aria-label="Mode de matching">
              <button
                className={matchMode === "strict" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => setMatchMode("strict")}
                disabled={busy || topCount === 0}
                title={topCount === 0 ? "Aucun Top match pour l’instant" : "Offres les plus pertinentes pour toi"}
                aria-pressed={matchMode === "strict"}
              >
                Top matchs ({topCount})
              </button>

              <button
                className={matchMode === "large" ? "jrBtn jrBtnPrimary" : "jrBtn jrBtnGhost"}
                type="button"
                onClick={() => setMatchMode("large")}
                disabled={busy}
                title="Afficher plus d'opportunités"
                aria-pressed={matchMode === "large"}
              >
                Explorer ({exploreCount})
              </button>
            </div>

            <button className="jrBtn jrBtnOutline" onClick={load} disabled={busy} type="button">
              {busy ? "Chargement..." : "Rafraîchir"}
            </button>
          </div>

          <div className="jr-subline">
            {matchMode === "strict"
              ? `Top matchs : priorité à la pertinence (≥ ${STRICT_MIN_PERCENT}%).`
              : "Explorer : plus d’offres, critères moins stricts."}
          </div>
        </section>

        {errorMsg && <div className="jr-error">Erreur : {errorMsg}</div>}

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
            <div className="sr-only">Chargement des offres...</div>
          </div>
        ) : alerts.length === 0 ? (
          <div className="jr-empty">
            Tu n’as pas encore d’alertes actives. Crée une alerte pour activer le matching.
            <div style={{ marginTop: 10 }}>
              <button className="jrBtn jrBtnPrimary" onClick={() => navigate("/jobradar/alerts")} type="button">
                Créer une alerte
              </button>
            </div>
          </div>
        ) : displayed.length === 0 ? (
          <div className="jr-empty">
            Aucune offre à afficher pour le moment.
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="jrBtn jrBtnGhost" type="button" onClick={() => navigate("/jobradar/alerts")}>
                Ajuster mes alertes
              </button>
              <button className="jrBtn jrBtnGhost" type="button" onClick={() => navigate("/jobradar/applications")}>
                Voir mes candidatures →
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="jr-grid">
              {displayed.map(({ job, p, signalCount, why }) => {
                const isAdding = addingJobId === job.id;
                const isDismissing = dismissingJobId === job.id;

                return (
                  <div
                    className="jr-card"
                    key={job.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openJob(job.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openJob(job.id);
                      }
                    }}
                  >
                    <div className="jr-cardTop">
                      <div className="jr-title">{job.title ?? "—"}</div>
                      <span className="jr-score">{signalCount ? `${p}% pertinent` : "—"}</span>
                    </div>
                    {signalCount && (why.alert.length > 0 || why.cv.length > 0) ? (
                      <div className="jr-why">
                        {why.alert.length > 0 && (
                          <span>
                            Alertes : {why.alert.join(" · ")}
                            {why.restAlert > 0 ? ` (+${why.restAlert})` : ""}
                          </span>
                        )}
                        {why.cv.length > 0 && (
                          <span>
                            {why.alert.length > 0 ? " · " : ""}
                            CV : {why.cv.join(" · ")}
                            {why.restCv > 0 ? ` (+${why.restCv})` : ""}
                          </span>
                        )}
                      </div>
                    ) : null}

                    <div className="jr-meta">
                      {(job.company_name ?? "—") + " · " + (job.location ?? job.country ?? "—")}
                    </div>

                    <div className="jr-chips">
                      {job.remote_type && <span className="chip chipStrong">{job.remote_type}</span>}
                      {job.country && <span className="chip">{job.country}</span>}
                    </div>

                    <div className="jr-cardActions">
                      <button
                        className="jr-ctaSm"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToApplications(job.id);
                        }}
                        disabled={isAdding}
                        title="Ajouter dans Mes candidatures (À postuler)"
                        type="button"
                      >
                        {isAdding ? "Ajout..." : "Ajouter"}
                      </button>

                      <div className="jr-footerActions">
                        <button
                          className="jr-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            openJob(job.id);
                          }}
                          type="button"
                        >
                          Détail →
                        </button>

                        <button
                          className="jr-dangerOutline"
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissJob(job.id);
                          }}
                          disabled={isDismissing}
                          title="Masquer cette offre du feed"
                          type="button"
                        >
                          {isDismissing ? "..." : "Décliner"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              {hasMore ? (
                <button className="jrBtn jrBtnGhost" onClick={loadMore} disabled={loadingMore} type="button">
                  {loadingMore ? "Chargement..." : "Charger plus"}
                </button>
              ) : (
                <span style={{ opacity: 0.7, fontSize: 13 }}>Fin de la liste</span>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
