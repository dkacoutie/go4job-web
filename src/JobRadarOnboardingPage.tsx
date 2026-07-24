import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import JobRadarAdvisor from "./components/JobRadarAdvisor";
import OnboardingStepper from "./components/OnboardingStepper";
import { useToast } from "./components/ToastCenter";
import { getJobRadarAdvisorCopy } from "./components/jobRadarAdvisorContent";
import { canonicalizeText } from "./lib/taxonomy";
import { buildGeoPreferences, computeJobMatchScore, type MatchScoreResult } from "./lib/jobMatching";
import { supabase } from "./lib/supabaseClient";
import { trackTutorialBegin, trackTutorialComplete, trackAlertCreated } from "./lib/analytics";
import { useJobRadarOnboarding } from "./lib/useJobRadarOnboarding";
import { activateOnboardingAlert } from "./lib/onboardingAlert";
import {
  ALL_COUNTRIES_CODE,
  buildCountrySelectionLabel,
  buildOnboardingSuggestions,
  getWorkModeLabel,
  isAllCountriesSelection,
} from "./lib/jobradarPersonalization";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  JOBRADAR_FLOW_STEPS,
  ONBOARDING_COUNTRY_OPTIONS,
  SECTOR_OPTIONS,
  WORK_MODE_OPTIONS,
  buildJobRadarOnboardingHref,
  getCountryLabel,
  isAfterPurchaseStep,
  splitKeywords,
  type ExperienceLevel,
  type EmploymentType,
  type JobRadarOnboardingStep,
  type OnboardingAlertDraft,
  type WorkMode,
} from "./lib/jobradarOnboarding";
import "./JobRadarOnboardingPage.css";

type PreviewJob = {
  id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  country: string | null;
  remote_type: string | null;
  job_family?: string | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
  published_at: string | null;
  posted_at: string | null;
  scraped_at: string | null;
  updated_at: string | null;
  quality_status?: string | null;
  description: string | null;
  tags: string[] | string | null;
  job_skills: string[] | null;
  required_skills: string[] | null;
  optional_skills: string[] | null;
  created_at: string | null;
};

type PreviewCardKind = "match" | "nearby";
type PreviewCard = { job: PreviewJob; score: number; reasons: string[]; kind: PreviewCardKind };
type PreviewAnalyzedCard = {
  job: PreviewJob;
  scored: MatchScoreResult;
  freshness: number;
  gated: boolean;
};
type CvSaveResponse = { ok: boolean; data?: any; error?: string; message?: string };

const PREVIEW_MIN_CARDS = 2;
const PREVIEW_MAX_CARDS = 4;
const PREVIEW_FETCH_LIMIT = 48;
const PREVIEW_TRUE_MATCH_MIN_SCORE = 36;
const PREVIEW_TRUE_MATCH_HIGH_CONFIDENCE_SCORE = 48;
const PREVIEW_NEARBY_MIN_SCORE = 18;

const BEFORE_PURCHASE_STEPS: Array<Exclude<JobRadarOnboardingStep, "done" | "complete-profile" | "cv" | "alerts">> = [
  "profile",
  "preferences",
  "preview",
  "unlock",
];

const STEP_HELPER_TEXT: Record<Exclude<JobRadarOnboardingStep, "done">, string> = {
  profile: "Réponse rapide, modifiable plus tard.",
  preferences: "JobRadar prépare ton profil de recherche, que tu peux ajuster librement.",
  preview: "Un premier aperçu concret avant de passer à l’accès complet.",
  unlock: "Activation simple, sans perte de progression.",
  "complete-profile": "Derniers réglages avant des offres plus précises.",
  cv: "Un import maintenant rend les offres plus précises ensuite.",
  alerts: "Tes alertes complètent ta recherche.",
};

function normalizeText(input: string) {
  return (input ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function buildOnboardingFeedHref(desiredRole: string | null | undefined) {
  const role = String(desiredRole ?? "").replace(/\s+/g, " ").trim();
  if (!role) return "/jobradar/feed";
  const params = new URLSearchParams({ q: role, source: "onboarding" });
  return `/jobradar/feed?${params.toString()}`;
}

function normKeyword(input: string) {
  return canonicalizeText(input ?? "").toLowerCase().trim();
}

function normalizeTagList(value: PreviewJob["tags"]) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];

  return value
    .replace(/^\{|\}$/g, "")
    .split(/[,;|\n]/)
    .map((item) => item.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);
}

function getPreviewFreshness(job: PreviewJob) {
  const raw = job.published_at ?? job.posted_at ?? job.scraped_at ?? job.updated_at ?? job.created_at ?? "";
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function fetchPreviewCandidates() {
  const selectFields = `
    id,
    title,
    company_name,
    location,
    country,
    remote_type,
    job_family,
    experience_years_min,
    experience_years_max,
    published_at,
    posted_at,
    scraped_at,
    created_at,
    updated_at,
    quality_status,
    tags,
    job_skills,
    required_skills,
    optional_skills,
    description:description_text
  `;

  const { data: primaryData, error: primaryError } = await supabase
    .from("jobs")
    .select(selectFields)
    .eq("is_active", true)
    .eq("is_expired", false)
    .in("job_status", ["active", "stale"])
    .or("quality_status.eq.ok,quality_status.is.null")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(PREVIEW_FETCH_LIMIT);

  if (primaryError) throw primaryError;

  const primaryRows = ((primaryData ?? []) as PreviewJob[]).filter((job) => Boolean(job.id && job.title));
  if (primaryRows.length >= PREVIEW_MIN_CARDS) return primaryRows;

  const { data: reserveData, error: reserveError } = await supabase
    .from("jobs")
    .select(selectFields)
    .eq("is_active", true)
    .eq("is_expired", false)
    .in("job_status", ["active", "stale"])
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(PREVIEW_FETCH_LIMIT);

  if (reserveError) {
    if (primaryRows.length > 0) return primaryRows;
    throw reserveError;
  }

  const deduped = new Map<string, PreviewJob>();
  for (const job of [...primaryRows, ...((reserveData ?? []) as PreviewJob[])]) {
    if (!job.id || !job.title || deduped.has(job.id)) continue;
    deduped.set(job.id, job);
  }
  return Array.from(deduped.values());
}

function buildPreviewInfo(job: PreviewJob, params: { role: string; keywords: string[]; sectors: string[]; workModes: string[]; countries: string[] }) {
  const hay = normalizeText(
    [
      job.title,
      job.company_name,
      job.location,
      job.country,
      job.remote_type,
      job.description,
      ...normalizeTagList(job.tags),
      ...(job.job_skills ?? []),
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  let score = 0;
  const reasons: string[] = [];
  if (params.role && hay.includes(normalizeText(params.role))) {
    score += 5;
    reasons.push(`Le rôle ressemble à « ${params.role} ».`);
  }
  const keyword = params.keywords.find((item) => hay.includes(normalizeText(item)));
  if (keyword) {
    score += 2;
    reasons.push(`Le mot-clé « ${keyword} » ressort dans l'offre.`);
  }
  const mode = params.workModes.find((item) => hay.includes(normalizeText(item === "onsite" ? "site" : item)));
  if (mode) {
    score += 1;
    reasons.push(`Le mode ${mode === "remote" ? "télétravail" : mode === "onsite" ? "sur site" : "hybride"} correspond à ta préférence.`);
  }
  if (!isAllCountriesSelection(params.countries)) {
    const country = params.countries.find((code) => hay.includes(normalizeText(getCountryLabel(code))));
    if (country) {
      score += 1;
      reasons.push(`La zone ${getCountryLabel(country)} est alignée.`);
    }
  }
  const sector = params.sectors.find((item) => hay.includes(normalizeText(item.split("&")[0] ?? item)));
  if (sector) {
    score += 1;
    reasons.push(`Le secteur ${sector} renforce la pertinence de cette offre.`);
  }
  if (!reasons.length) reasons.push("Cette offre ressemble aux postes que tu cherches.");
  return { score, reasons: reasons.slice(0, 2) };
}
void buildPreviewInfo;

async function fetchPreviewCvContext() {
  try {
    const { data, error } = await supabase.functions.invoke<CvSaveResponse>("cv_save", {
      body: { action: "get_active" },
    });

    if (error) throw error;
    if (!data?.ok) return { skills: [] as string[] };

    return {
      skills: Array.isArray(data?.data?.skills)
        ? data.data.skills.map((skill: unknown) => String(skill ?? "").trim()).filter((skill: string) => Boolean(skill))
        : ([] as string[]),
    };
  } catch {
    return { skills: [] as string[] };
  }
}

function buildPreviewGeoPrefs(params: { desiredRole: string; keywords: string[]; workModes: string[]; countries: string[] }) {
  return buildGeoPreferences([
    {
      name: [params.desiredRole, ...params.workModes].filter(Boolean).join(" "),
      keywords: params.keywords,
      countries: isAllCountriesSelection(params.countries) ? [] : params.countries,
    },
  ]);
}

function previewTitleHasAny(job: PreviewJob, terms: string[]) {
  const title = normalizeText(job.title ?? "");
  return terms.some((term) => title.includes(normalizeText(term)));
}

function collapsePreviewText(input: string | null | undefined) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function cleanPreviewSignal(value: string) {
  return collapsePreviewText(value.replace(/\s*\((titre|desc|title|description)\)\s*$/i, ""));
}

function buildPreviewHay(job: PreviewJob) {
  return normalizeText(
    [
      job.title,
      job.company_name,
      job.location,
      job.country,
      job.remote_type,
      job.description,
      ...normalizeTagList(job.tags),
      ...(job.job_skills ?? []),
      ...(job.required_skills ?? []),
      ...(job.optional_skills ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function buildPreviewLocationReason(job: PreviewJob, kind: PreviewCardKind) {
  const remote = normalizeText(job.remote_type ?? "");
  const location = collapsePreviewText(job.location ?? job.country);

  if (remote.includes("remote")) {
    return kind === "match"
      ? "Le mode teletravail correspond a ce que tu recherches."
      : "Le teletravail rend cette piste plus simple a explorer.";
  }

  if (remote.includes("hybrid") || remote.includes("hybride")) {
    return kind === "match"
      ? "Le mode de travail correspond a ce que tu recherches."
      : "Le mode de travail reste compatible avec tes critères.";
  }

  if (location) {
    return kind === "match"
      ? "La localisation correspond a la zone que tu vises."
      : "Cette offre correspond a l'ouverture geographique que tu as indiquee.";
  }

  return null;
}

function buildPreviewEmploymentReason(job: PreviewJob, employmentTypes: EmploymentType[]) {
  if (!employmentTypes.length) return null;

  const hay = buildPreviewHay(job);
  const matchers: Array<{ type: EmploymentType; tests: string[]; reason: string }> = [
    {
      type: "cdi",
      tests: [" cdi ", "permanent", "long term", "full time"],
      reason: "Le format du poste va dans le sens de ce que tu recherches.",
    },
    {
      type: "contract",
      tests: [" cdd ", "contract", "mission", "fixed term", "consultant"],
      reason: "Le format mission reste compatible avec tes critères.",
    },
    {
      type: "internship",
      tests: ["stage", "internship", "intern ", "alternance", "trainee"],
      reason: "Le format correspond au type d’opportunités que tu peux viser.",
    },
    {
      type: "freelance",
      tests: ["freelance", "contractor", "consultant independant"],
      reason: "Le format freelance correspond a ton cap actuel.",
    },
    {
      type: "part-time",
      tests: ["part time", "part-time", "temps partiel"],
      reason: "Le rythme du poste semble compatible avec tes critères.",
    },
  ];

  for (const matcher of matchers) {
    if (!employmentTypes.includes(matcher.type)) continue;
    if (matcher.tests.some((test) => hay.includes(normalizeText(test)))) return matcher.reason;
  }

  return null;
}

function buildPreviewQualityLabel(kind: PreviewCardKind, score: number) {
  if (kind === "match") {
    return score >= PREVIEW_TRUE_MATCH_HIGH_CONFIDENCE_SCORE ? "Bien ciblee" : "A regarder";
  }

  return score >= PREVIEW_NEARBY_MIN_SCORE + 8 ? "A explorer" : "Piste possible";
}

function buildPreviewExperienceReason(job: PreviewJob, experienceLevel: ExperienceLevel, kind: PreviewCardKind) {
  const min = job.experience_years_min ?? null;
  const max = job.experience_years_max ?? null;

  if (experienceLevel === "senior" || experienceLevel === "executive") {
    if ((min != null && min >= 5) || previewTitleHasAny(job, ["senior", "lead", "head", "director", "principal"])) {
      return "Le niveau du poste parait coherent avec ton experience.";
    }
  }

  if (experienceLevel === "intermediate") {
    if ((min != null && min <= 5 && (max == null || max >= 3)) || !previewTitleHasAny(job, ["intern", "junior", "head", "director"])) {
      return kind === "match"
        ? "Cette offre semble bien correspondre a un profil de ton niveau."
        : "Le niveau de responsabilite parait assez proche de ton profil.";
    }
  }

  if (experienceLevel === "junior" || experienceLevel === "starter") {
    if ((max != null && max <= 3) || previewTitleHasAny(job, ["junior", "intern", "stage", "trainee", "assistant"])) {
      return "Le niveau du poste reste compatible avec ton experience actuelle.";
    }
  }

  return null;
}

function buildPreviewReasons(
  scored: MatchScoreResult,
  params: {
    desiredRole: string;
    experienceLevel: ExperienceLevel;
    employmentTypes: EmploymentType[];
    kind: PreviewCardKind;
    job: PreviewJob;
    hasCv: boolean;
  }
) {
  const reasons: string[] = [];
  const add = (reason: string | null) => {
    if (!reason || reasons.includes(reason) || reasons.length >= 2) return;
    reasons.push(reason);
  };

  const roleFamily = scored.why.details.breakdown.role_family;
  const matchedAlertKeyword = scored.why.details.breakdown.alert.matched_keywords
    .map((keyword) => cleanPreviewSignal(keyword))
    .find(Boolean);
  const matchedCvSignal = [
    ...(scored.skillsQuality.matched_required_skills ?? []),
    ...(scored.skillsQuality.matched_optional_skills ?? []),
    ...(scored.why.cv ?? []),
  ]
    .map((signal) => cleanPreviewSignal(signal))
    .find(Boolean);

  if (roleFamily.relation === "match") {
    add(
      params.desiredRole
        ? params.kind === "match"
          ? "Le poste reste proche du type de role que tu recherches."
          : "Cette offre se rapproche de la fonction que tu sembles viser."
        : params.kind === "match"
        ? "Le role propose reste proche du cap que tu as defini."
        : "Cette piste reste dans une logique proche de ton objectif."
    );
  }

  if (matchedAlertKeyword) {
    add(
      params.kind === "match"
        ? "L'intitule et le contenu restent proches de ce que tu recherches."
        : "Cette piste reste proche des themes que tu sembles viser."
    );
  }

  if (scored.geoRemote.considered && scored.geoRemote.points_awarded > 0) {
    add(buildPreviewLocationReason(params.job, params.kind));
  }

  add(buildPreviewExperienceReason(params.job, params.experienceLevel, params.kind));
  add(buildPreviewEmploymentReason(params.job, params.employmentTypes));

  if (matchedCvSignal && params.hasCv) {
    add(
      params.kind === "match"
        ? "Ton profil rend cette offre plus interessante pour toi."
        : "Ton profil donne déjà un peu plus de poids à cette piste."
    );
  }

  if (!params.hasCv && (scored.why.cv.length > 0 || scored.skillsQuality.points_awarded > 0)) {
    add(
      params.kind === "match"
        ? "Ton profil peut encore etre affine pour confirmer ce type d'offre."
        : "Cette piste est proche, mais ton profil peut encore etre affine."
    );
  }

  if (params.kind === "match" && params.desiredRole && reasons.length < 2) {
    add("Le role propose reste dans une logique proche de ton objectif.");
  }

  if (!reasons.length) {
    add(
      params.kind === "match"
        ? "Cette offre parait globalement proche de ton objectif."
        : "Cette piste peut valoir le détour pendant que ta recherche se précise."
    );
  }

  return reasons.slice(0, 2);
}

function pickPreviewCards(cards: PreviewAnalyzedCard[]) {
  const ungated = cards.filter((card) => !card.gated);

  const trueMatches = ungated.filter((card) => {
    const relation = card.scored.roleFamily.relation;
    return (
      card.scored.score >= PREVIEW_TRUE_MATCH_MIN_SCORE &&
      (relation === "match" || card.scored.score >= PREVIEW_TRUE_MATCH_HIGH_CONFIDENCE_SCORE)
    );
  });

  if (trueMatches.length >= PREVIEW_MIN_CARDS) {
    return {
      mode: "match" as const,
      cards: trueMatches
        .sort((a, b) => b.scored.score - a.scored.score || b.freshness - a.freshness)
        .slice(0, PREVIEW_MAX_CARDS),
    };
  }

  const nearbyBase = ungated.filter((card) => card.scored.score >= PREVIEW_NEARBY_MIN_SCORE);
  const nearbyPool =
    nearbyBase.length >= PREVIEW_MIN_CARDS
      ? nearbyBase
      : ungated.sort((a, b) => b.scored.score - a.scored.score || b.freshness - a.freshness).slice(0, PREVIEW_MAX_CARDS);

  return {
    mode: "nearby" as const,
    cards: nearbyPool
      .sort((a, b) => b.scored.score - a.scored.score || b.freshness - a.freshness)
      .slice(0, PREVIEW_MAX_CARDS),
  };
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="jrOnbPanel">{children}</div>;
}

export default function JobRadarOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pushToast } = useToast();
  const onboarding = useJobRadarOnboarding();
  const stepParam = (searchParams.get("step") || "") as JobRadarOnboardingStep;
  const currentStep = useMemo<Exclude<JobRadarOnboardingStep, "done">>(() => {
    const keys = JOBRADAR_FLOW_STEPS.map((item) => item.key);
    if (keys.includes(stepParam as Exclude<JobRadarOnboardingStep, "done">)) {
      return stepParam as Exclude<JobRadarOnboardingStep, "done">;
    }
    return onboarding.nextStep === "done" ? "alerts" : (onboarding.nextStep as Exclude<JobRadarOnboardingStep, "done">);
  }, [stepParam, onboarding.nextStep]);

  useEffect(() => {
    // Ne compte comme un vrai "début" que si l'utilisateur arrive sur la
    // toute première étape — pas à chaque fois qu'il revient sur un
    // onboarding déjà en cours, pour ne pas gonfler artificiellement le
    // nombre de tutorial_begin.
    if (currentStep === "profile") trackTutorialBegin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [desiredRole, setDesiredRole] = useState("");
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("");
  const [employmentTypes, setEmploymentTypes] = useState<EmploymentType[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [workModes, setWorkModes] = useState<WorkMode[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [alertDrafts, setAlertDrafts] = useState<OnboardingAlertDraft[]>([]);
  const [previewCards, setPreviewCards] = useState<PreviewCard[]>([]);
  const [previewMode, setPreviewMode] = useState<PreviewCardKind>("nearby");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [showAllSectors, setShowAllSectors] = useState(false);
  const deferredKeywords = useDeferredValue(keywords);

  const suggestionBundle = useMemo(
    () =>
      desiredRole.trim() && countryCodes.length && experienceLevel && employmentTypes.length
        ? buildOnboardingSuggestions({
            desiredRole,
            experienceLevel,
            countryCodes,
            employmentTypes,
            workModes,
            existingKeywords: keywords,
            existingSectors: sectors,
          })
        : null,
    [desiredRole, countryCodes, experienceLevel, employmentTypes, workModes, keywords, sectors]
  );

  const suggestedSectors = useMemo(() => suggestionBundle?.sectors ?? [], [suggestionBundle]);
  const additionalSectors = useMemo(
    () => SECTOR_OPTIONS.filter((sector) => !suggestedSectors.includes(sector)),
    [suggestedSectors]
  );
  const experienceLabel =
    EXPERIENCE_LEVEL_OPTIONS.find((option) => option.value === experienceLevel)?.label ?? "Niveau à préciser";
  const geographyLabel = buildCountrySelectionLabel(countryCodes);

  useEffect(() => {
    queueMicrotask(() => {
      const profile = onboarding.onboarding.profile ?? {};
      const preferences = onboarding.onboarding.preferences ?? {};
      setDesiredRole(profile.desiredRole ?? "");
      setCountryCodes(profile.countryCodes ?? []);
      setExperienceLevel(profile.experienceLevel ?? "");
      setEmploymentTypes((profile.employmentTypes ?? []) as EmploymentType[]);
      setKeywords(preferences.keywords ?? []);
      setWorkModes((preferences.workModes ?? []) as WorkMode[]);
      setSectors(preferences.sectors ?? []);
      setAlertDrafts(preferences.alertDrafts ?? []);
    });
  }, [onboarding.onboarding]);

  useEffect(() => {
    if (onboarding.loading) return;
    if (onboarding.isOnboarded) {
      navigate(buildOnboardingFeedHref(desiredRole || onboarding.onboarding.profile?.desiredRole), { replace: true });
      return;
    }
    if (!onboarding.isOnboarded) {
      if (!onboarding.hasActivePass && isAfterPurchaseStep(currentStep)) {
        navigate(buildJobRadarOnboardingHref(onboarding.nextStep), { replace: true });
      }
      if (onboarding.hasActivePass && BEFORE_PURCHASE_STEPS.includes(currentStep as (typeof BEFORE_PURCHASE_STEPS)[number])) {
        return;
      }
    }
  }, [
    onboarding.loading,
    onboarding.isOnboarded,
    onboarding.hasActivePass,
    onboarding.nextStep,
    onboarding.onboarding.profile?.desiredRole,
    desiredRole,
    currentStep,
    navigate,
  ]);

  useEffect(() => {
    if (currentStep !== "preview") return;
    let active = true;
    const loadPreview = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const [rows, cvContext] = await Promise.all([fetchPreviewCandidates(), fetchPreviewCvContext()]);
        if (!active) return;

        const alertKeywords: string[] = Array.from(
          new Set([desiredRole, ...deferredKeywords].map(normKeyword).filter((keyword): keyword is string => Boolean(keyword)))
        );
        const cvKeywords: string[] = Array.from(
          new Set(
            (cvContext.skills ?? [])
              .map((skill: string) => skill.trim())
              .filter((skill: string): skill is string => Boolean(skill))
          )
        );
        const geoPrefs = buildPreviewGeoPrefs({
          desiredRole,
          keywords: deferredKeywords,
          workModes,
          countries: countryCodes,
        });

        const analyzedCards: PreviewAnalyzedCard[] = rows
          .map((job) => {
            const scored = computeJobMatchScore({
              job: {
                ...job,
                tags: normalizeTagList(job.tags),
              },
              alertKeywords,
              cvKeywords,
              cvExp: null,
              geoPrefs,
              desiredRole,
            });
            return {
              job,
              scored,
              freshness: getPreviewFreshness(job),
              gated: scored.roleFamily.gated,
            } satisfies PreviewAnalyzedCard;
          });

        const picked = pickPreviewCards(analyzedCards);
        const ranked = picked.cards.map((card) => ({
          job: card.job,
          score: card.scored.score,
          reasons: buildPreviewReasons(card.scored, {
            desiredRole,
            experienceLevel,
            employmentTypes,
            kind: picked.mode,
            job: card.job,
            hasCv: cvContext.skills.length > 0,
          }),
          kind: picked.mode,
        }));

        setPreviewMode(picked.mode);
        setPreviewCards(ranked);
      } catch (error) {
        if (!active) return;
        console.error("Failed to load JobRadar preview teasers", error);
        setPreviewMode("nearby");
        setPreviewCards([]);
        setPreviewError("Impossible de charger tes premières offres pour le moment. Réessaie dans un instant.");
      } finally {
        if (active) setPreviewLoading(false);
      }
    };
    void loadPreview();
    return () => {
      active = false;
    };
  }, [currentStep, desiredRole, deferredKeywords, workModes, countryCodes, experienceLevel, employmentTypes, previewReloadKey]);

  const previewContent = useMemo(() => {
    if (previewMode === "match") {
      return {
        eyebrow: "Premières recommandations",
        title: "Ces offres semblent déjà bien alignées avec ton projet.",
        body:
          "On voit déjà une bonne correspondance entre le métier visé, tes informations et les opportunités proposées. En continuant, JobRadar pourra élargir et rendre cette sélection plus utile.",
        chips: ["Metier cible pris en compte", "Informations prises en compte", "Plus d'offres apres activation"],
        emptyTitle: "JobRadar affine encore la première sélection.",
        emptyBody:
          "Ton cap est clair, mais il n'y a pas encore assez d'offres solides a montrer maintenant. Enrichis ton profil pour debloquer des resultats plus convaincants.",
      };
    }

    return {
      eyebrow: "Opportunites proches",
      title: "Voici quelques opportunités proches pour démarrer.",
      body:
        "Ton profil donne déjà une direction, mais il manque encore quelques informations pour afficher des offres vraiment ciblées. Ajoute ton CV, active tes alertes et ajuste tes critères pour obtenir des recommandations plus précises.",
      chips: ["Ajoute ton CV", "Active tes alertes", "Ajuste tes critères"],
      emptyTitle: "Le ciblage demarre, mais reste encore leger.",
      emptyBody:
        "Complète ton profil, ajoute ton CV et précise tes critères pour faire remonter des offres plus utiles dès la prochaine étape.",
    };
  }, [previewMode]);
  const preferencesAdvisor = useMemo(() => getJobRadarAdvisorCopy({ key: "onboarding-preferences" }), []);
  const previewAdvisor = useMemo(
    () => getJobRadarAdvisorCopy({ key: "onboarding-preview", mode: previewMode, hasCv: onboarding.hasCv }),
    [previewMode, onboarding.hasCv]
  );

  const completedSteps = useMemo(() => {
    const done: Array<Exclude<JobRadarOnboardingStep, "done">> = [];
    if (desiredRole && countryCodes.length && experienceLevel && employmentTypes.length) done.push("profile");
    if ((keywords.length || workModes.length || sectors.length || alertDrafts.length) || onboarding.onboarding.preferences?.skipped) done.push("preferences");
    if (onboarding.onboarding.previewSeenAt) done.push("preview");
    if (onboarding.hasActivePass) done.push("unlock");
    if (onboarding.profileCompletionReady) done.push("complete-profile");
    if (onboarding.hasCv) done.push("cv");
    if (onboarding.alertsCount > 0) done.push("alerts");
    return done;
  }, [
    desiredRole,
    countryCodes.length,
    experienceLevel,
    employmentTypes.length,
    keywords.length,
    workModes.length,
    sectors.length,
    alertDrafts.length,
    onboarding.onboarding.preferences?.skipped,
    onboarding.onboarding.previewSeenAt,
    onboarding.hasActivePass,
    onboarding.profileCompletionReady,
    onboarding.hasCv,
    onboarding.alertsCount,
  ]);

  function removeAlertDraft(id: string) {
    setAlertDrafts((prev) => prev.filter((draft) => draft.id !== id));
  }

  function updateAlertDraft(id: string, patch: Partial<OnboardingAlertDraft>) {
    setAlertDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  async function saveProfile() {
    if (!desiredRole.trim() || !countryCodes.length || !experienceLevel || !employmentTypes.length) {
      pushToast({ kind: "error", title: "Profil incomplet", message: "Renseigne les 4 champs avant de continuer." });
      return;
    }

    const existingPreferences = onboarding.onboarding.preferences ?? {};
    const shouldSeedPreferences = !existingPreferences.completedAt;
    const generated = buildOnboardingSuggestions({
      desiredRole: desiredRole.trim(),
      experienceLevel,
      countryCodes,
      employmentTypes,
      workModes: existingPreferences.workModes ?? [],
      existingKeywords: shouldSeedPreferences ? [] : existingPreferences.keywords ?? [],
      existingSectors: shouldSeedPreferences ? [] : existingPreferences.sectors ?? [],
    });

    await onboarding.saveOnboarding({
      currentStep: "preferences",
      profile: {
        desiredRole: desiredRole.trim(),
        countryCodes,
        experienceLevel,
        employmentTypes,
        completedAt: new Date().toISOString(),
      },
      preferences: shouldSeedPreferences
        ? {
            keywords: generated.keywords,
            workModes: existingPreferences.workModes ?? [],
            sectors: generated.sectors,
            alertDrafts: generated.alertDrafts,
            suggestionSignature: generated.suggestionSignature,
            skipped: false,
            completedAt: null,
          }
        : {
            ...existingPreferences,
            suggestionSignature: generated.suggestionSignature,
          },
    });
    setSearchParams({ step: "preferences" });
  }

  async function savePreferences(skipped = false) {
    await onboarding.saveOnboarding({
      currentStep: "preview",
      preferences: {
        keywords,
        workModes,
        sectors,
        alertDrafts,
        suggestionSignature: suggestionBundle?.suggestionSignature ?? onboarding.onboarding.preferences?.suggestionSignature ?? null,
        skipped,
        completedAt: new Date().toISOString(),
      },
    });

    // Ajustement 1 (consentement explicite) : le clic sur le bouton qui
    // amene ici — quel que soit le libelle exact — a ete accompagne du
    // texte disclosant qu'une premiere alerte gratuite serait activee.
    // La creation elle-meme est idempotente cote base (voir migration
    // 20260724100000 et jobradar_upsert_onboarding_alert) : ce n'est donc
    // jamais cet appel qui pourrait dupliquer une alerte, meme rappele
    // plusieurs fois (double clic, retour en arriere puis renvoi).
    const created = await activateOnboardingAlert({
      desiredRole,
      countryCodes,
      alertDrafts,
    });
    if (created) {
      trackAlertCreated({
        hasCountryFilter: Boolean(created.countries && created.countries.length > 0),
        frequency: created.frequency,
        channel: "email",
        source: "onboarding",
      });
      await onboarding.refresh();
    }

    setSearchParams({ step: "preview" });
  }

  async function savePreviewSeen() {
    await onboarding.saveOnboarding({ currentStep: "unlock", previewSeenAt: new Date().toISOString() });
    setSearchParams({ step: "unlock" });
  }

  function openPreviewJob(jobId: string) {
    if (onboarding.hasActivePass) {
      navigate(`/jobradar/jobs/${jobId}`);
      return;
    }

    pushToast({
      kind: "info",
      title: "Active ton pass pour voir cette offre et postuler.",
      message: "Tu debloqueras ensuite le detail complet de l'offre et l'acces complet aux offres.",
    });
    void savePreviewSeen();
  }

  const stepMeta = JOBRADAR_FLOW_STEPS.find((item) => item.key === currentStep)!;
  const currentStepNumber = JOBRADAR_FLOW_STEPS.findIndex((item) => item.key === currentStep) + 1;
  const phaseLabel = stepMeta.phase === "before_purchase" ? "Personnalisation de tes offres" : "Finalisation";
  const profileStep = (
    <Panel>
      <div className="jrOnbFormGrid">
        <label className="jrOnbField">
          Poste recherché
          <input className="jrOnbInput" value={desiredRole} onChange={(e) => setDesiredRole(e.target.value)} placeholder="Ex. assistant comptable, commercial, développeur, chauffeur…" />
          <small className="jrOnbFieldHint">Écris simplement le métier ou le poste que tu veux trouver.</small>
        </label>
        <label className="jrOnbField">
          Dans quel pays ou quelle zone veux-tu chercher ?
          <select className="jrOnbInput" value={countryCodes[0] ?? ""} onChange={(e) => setCountryCodes(e.target.value ? [e.target.value] : [])}>
            <option value="">Choisir une zone</option>
            {ONBOARDING_COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
          <small className="jrOnbFieldHint">Tu peux choisir ton pays, l’Europe, l’Afrique ou les offres à distance selon ton objectif.</small>
        </label>
        <div className="jrOnbField">
          Quel est ton niveau d’expérience ?
          <small className="jrOnbFieldHint">Cela aide JobRadar à éviter les offres trop juniors ou trop avancées.</small>
          <div className="jrOnbChoices">
            {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
              <button key={option.value} type="button" className={`jrOnbChoice ${experienceLevel === option.value ? "is-active" : ""}`} onClick={() => setExperienceLevel(option.value)}>
                <span>{option.label}</span>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="jrOnbField">
          Quel type de poste veux-tu ?
          <small className="jrOnbFieldHint">CDI, CDD, stage, freelance, remote… choisis ce qui correspond à ta recherche.</small>
          <div className="jrOnbPills">
            {EMPLOYMENT_TYPE_OPTIONS.map((option) => {
              const active = employmentTypes.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`jrOnbPill ${active ? "is-active" : ""}`}
                  onClick={() =>
                    setEmploymentTypes((prev) =>
                      prev.includes(option.value) ? prev.filter((item) => item !== option.value) : [...prev, option.value]
                    )
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="jrOnbActions">
        <button className="btn btnPrimary" type="button" onClick={() => void saveProfile()} disabled={onboarding.saving}>
          Continuer
        </button>
      </div>
    </Panel>
  );

  const preferencesStep = (
    <Panel>
      <JobRadarAdvisor
        {...preferencesAdvisor}
        cta={{
          label: "Voir mes offres et activer mon alerte gratuite",
          onClick: () => void savePreferences(false),
        }}
      />

      <div className="jrOnbSignalRow">
        <span className="jrOnbSignalChip">Poste : {desiredRole || "À préciser"}</span>
        <span className="jrOnbSignalChip">Zone : {geographyLabel}</span>
        <span className="jrOnbSignalChip">Niveau : {experienceLabel}</span>
        {workModes.length > 0 ? <span className="jrOnbSignalChip">Mode : {workModes.map(getWorkModeLabel).join(" · ")}</span> : null}
      </div>

      <div className="jrOnbPersonalBlock">
        <div className="jrOnbPersonalBlock__header">
          <div>
            <div className="jrOnbDrafts__eyebrow">Mots-clés suggérés</div>
            <h2>Déjà remplis pour démarrer plus vite</h2>
          </div>
          <p>Tu peux en retirer, en garder, ou en ajouter un si tu veux affiner davantage.</p>
        </div>

        <div className="jrOnbPills">
          {keywords.map((keyword) => (
            <button key={keyword} type="button" className="jrOnbPill is-active" onClick={() => setKeywords((prev) => prev.filter((item) => item !== keyword))}>
              {keyword} ×
            </button>
          ))}
        </div>

        <div className="jrOnbKeywordComposer">
          <label className="jrOnbField jrOnbField--compact">
            Ajouter un mot-clé
            <div className="jrOnbKeywordRow">
              <input
                className="jrOnbInput"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const next = splitKeywords(keywordInput);
                    if (!next.length) return;
                    setKeywords((prev) => Array.from(new Set([...prev, ...next])));
                    setKeywordInput("");
                  }
                }}
                placeholder="Ex : Power BI, ONG, paie"
              />
              <button
                className="btn btnGhost"
                type="button"
                onClick={() => {
                  const next = splitKeywords(keywordInput);
                  if (!next.length) return;
                  setKeywords((prev) => Array.from(new Set([...prev, ...next])));
                  setKeywordInput("");
                }}
              >
                Ajouter
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="jrOnbFormGrid jrOnbFormGrid--balanced">
        <div className="jrOnbField">
          Modes de travail
          <div className="jrOnbPills">
            {WORK_MODE_OPTIONS.map((option) => {
              const active = workModes.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`jrOnbPill ${active ? "is-active" : ""}`}
                  onClick={() =>
                    setWorkModes((prev) => (prev.includes(option.value) ? prev.filter((item) => item !== option.value) : [...prev, option.value]))
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="jrOnbField">
          Secteurs suggérés
          <div className="jrOnbPills jrOnbPills--suggested">
            {suggestedSectors.map((sector) => {
              const active = sectors.includes(sector);
              return (
                <button
                  key={sector}
                  type="button"
                  className={`jrOnbPill jrOnbPill--suggested ${active ? "is-active" : ""}`}
                  onClick={() => setSectors((prev) => (prev.includes(sector) ? prev.filter((item) => item !== sector) : [...prev, sector]))}
                >
                  {sector}
                </button>
              );
            })}
          </div>

          {additionalSectors.length > 0 && (
            <div className="jrOnbSecondaryOptions">
              <button className="btn btnGhost jrOnbSecondaryOptions__toggle" type="button" onClick={() => setShowAllSectors((prev) => !prev)}>
                {showAllSectors ? "Masquer les autres secteurs" : "Voir d'autres secteurs"}
              </button>
              {showAllSectors && (
                <div className="jrOnbPills jrOnbPills--secondary">
                  {additionalSectors.map((sector) => {
                    const active = sectors.includes(sector);
                    return (
                      <button
                        key={sector}
                        type="button"
                        className={`jrOnbPill jrOnbPill--secondary ${active ? "is-active" : ""}`}
                        onClick={() => setSectors((prev) => (prev.includes(sector) ? prev.filter((item) => item !== sector) : [...prev, sector]))}
                      >
                        {sector}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
  const alertDraftsBlock = (
    <div className="jrOnbDrafts">
      <div className="jrOnbDrafts__header">
        <div>
          <div className="jrOnbDrafts__eyebrow">Alertes préparées</div>
          <h2>Deux alertes déjà prêtes pour ta recherche</h2>
        </div>
        <p>Tu peux les garder telles quelles, ajuster leur fréquence, ou en retirer une si elle t'intéresse moins.</p>
      </div>

      <div className="jrOnbAlertGrid">
        {alertDrafts.map((draft) => (
          <article key={draft.id} className="jrOnbAlertCard">
            <div className="jrOnbAlertCard__top">
              <div>
                <div className="jrOnbAlertCard__title">{draft.name}</div>
                {draft.rationale ? <p className="jrOnbAlertCard__why">{draft.rationale}</p> : null}
              </div>
              <button className="btn btnGhost" type="button" onClick={() => removeAlertDraft(draft.id)}>
                Retirer
              </button>
            </div>
            <div className="jrOnbAlertCard__meta">
              <span>Zone : {draft.countries == null || draft.countries.includes(ALL_COUNTRIES_CODE) ? "Tous pays" : buildCountrySelectionLabel(draft.countries)}</span>
              <span>Fréquence : {draft.frequency === "weekly" ? "Chaque semaine" : draft.frequency === "instant" ? "Dès qu’une offre arrive" : "Quotidien"}</span>
            </div>
            <div className="jrOnbPills jrOnbPills--dense">
              {draft.keywords.map((keyword) => (
                <span key={`${draft.id}-${keyword}`} className="jrOnbPill is-active jrOnbPill--static">
                  {keyword}
                </span>
              ))}
            </div>
            <label className="jrOnbField jrOnbField--compact">
              Fréquence
              <select className="jrOnbInput" value={draft.frequency} onChange={(e) => updateAlertDraft(draft.id, { frequency: e.target.value as OnboardingAlertDraft["frequency"] })}>
                <option value="daily">Quotidien</option>
                <option value="weekly">Chaque semaine</option>
                <option value="instant">Dès qu’une offre arrive</option>
              </select>
            </label>
          </article>
        ))}
      </div>
    </div>
  );

  const previewStep = (
    <Panel>
      {previewLoading ? (
        <div className="jrOnbState">Préparation de tes premières offres...</div>
      ) : !previewLoading && previewError ? (
        <div className="jrOnbValuePanel jrOnbValuePanel--soft">
          <h2>L'aperçu n'a pas pu être chargé.</h2>
          <p>{previewError}</p>
          <div className="jrOnbActions">
            <button className="btn btnGhost" type="button" onClick={() => setPreviewReloadKey((prev) => prev + 1)}>
              Réessayer
            </button>
          </div>
        </div>
      ) : (
        <div className="jrOnbPreviewSection">
          {onboarding.alertsCount > 0 && (
            <div className="jrOnbValuePanel jrOnbValuePanel--soft">
              <h2>Ton alerte est active.</h2>
              <p>Tu recevras par email les offres qui correspondent à ces critères, gratuitement, dès maintenant.</p>
            </div>
          )}
          <JobRadarAdvisor
            {...previewAdvisor}
            variant="compact"
            cta={
              previewMode === "match"
                ? {
                    label: previewAdvisor.ctaLabel ?? "Débloquer toutes les offres",
                    onClick: () => void savePreviewSeen(),
                  }
                : onboarding.hasCv
                ? {
                    label: previewAdvisor.ctaLabel ?? "Ajuster mes critères",
                    onClick: () => setSearchParams({ step: "preferences" }),
                  }
                : {
                    label: previewAdvisor.ctaLabel ?? "Ajouter mon CV",
                    to: "/me/cv?flow=onboarding",
                  }
            }
          />
        <div className="jrOnbPreviewGrid">
          {previewCards.map((card) => (
            <article
              key={card.job.id}
              className={`jrOnbJobCard jrOnbJobCard--interactive ${card.kind === "nearby" ? "jrOnbJobCard--nearby" : "jrOnbJobCard--match"}`}
              role="button"
              tabIndex={0}
              onClick={() => openPreviewJob(card.job.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPreviewJob(card.job.id);
                }
              }}
            >
              <div className="jrOnbJobCard__top">
                <div>
                  <h3>{card.job.title ?? "Offre JobRadar"}</h3>
                  <p>{[card.job.company_name, card.job.location ?? card.job.country].filter(Boolean).join(" • ") || "Nouvelle opportunité"}</p>
                </div>
                <div className="jrOnbJobCard__meta">
                  <span className={`jrOnbJobCard__badge ${card.kind === "nearby" ? "is-nearby" : "is-match"}`}>
                    {card.kind === "match" ? "Bien alignée" : "Offre proche"}
                  </span>
                  <span className="jrOnbJobCard__score">{buildPreviewQualityLabel(card.kind, card.score)}</span>
                </div>
              </div>
              <div className="jrOnbJobCard__why">
                <div className="jrOnbJobCard__whyTitle">Pourquoi cette offre t’est proposée</div>
                <ul>{card.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
              <div className="jrOnbJobCard__actions">
                <button
                  className="jrOnbJobCard__cta"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreviewJob(card.job.id);
                  }}
                >
                  {onboarding.hasActivePass ? "Voir l'offre" : "Voir cette offre"}
                </button>
              </div>
            </article>
          ))}
          {!previewCards.length && (
            <div className="jrOnbValuePanel jrOnbValuePanel--soft">
              <h2>{previewContent.emptyTitle}</h2>
              <p>{previewContent.emptyBody}</p>
              <div className="jrOnbValuePanel__chips">
                <span>Offres actives uniquement</span>
                <span>Offres mieux adaptées à ton profil et à tes critères</span>
                <span>Alertes prêtes dès activation</span>
              </div>
            </div>
          )}
        </div>
        </div>
      )}
      <div className="jrOnbActions">
        <button className="btn btnPrimary" type="button" onClick={() => void savePreviewSeen()} disabled={onboarding.saving}>
          Voir les pass JobRadar
        </button>
        <button className="btn btnGhost" type="button" onClick={() => setSearchParams({ step: "preferences" })}>
          Ajuster mes critères
        </button>
      </div>
    </Panel>
  );
  const unlockStep = (
    <Panel>
      {onboarding.alertsCount > 0 && (
        <div className="jrOnbValuePanel jrOnbValuePanel--soft">
          <h2>Ton alerte gratuite est déjà active.</h2>
          <p>Tu reçois déjà par email les offres qui correspondent à tes critères. Ce qui suit est une amélioration, pas une condition pour continuer à en profiter.</p>
        </div>
      )}
      <div className="jrOnbBenefitGrid">
        <div className="jrOnbBenefitCard">
          <strong>Jusqu'à 3 alertes actives</strong>
          <span>Ta première alerte est gratuite. Un pass permet d'en garder jusqu'à 3 en même temps, pour couvrir plusieurs métiers ou villes.</span>
        </div>
        <div className="jrOnbBenefitCard">
          <strong>Détails complets et candidature</strong>
          <span>Ouvre chaque offre en entier et postule directement depuis JobRadar, sans repasser par le site d'origine.</span>
        </div>
        <div className="jrOnbBenefitCard">
          <strong>Plus de résultats dans ton fil</strong>
          <span>Charge davantage d'offres au-delà de la première sélection.</span>
        </div>
      </div>
      <div className="jrOnbValuePanel">
        <h2>Choisis ton pass depuis la page JobRadar.</h2>
        <p>
          Le choix, le renouvellement et l’achat d’un pass se font sur la page des pass
          JobRadar.
        </p>
        <div className="jrOnbActions">
          <button className="btn btnPrimary" type="button" onClick={() => navigate("/pricing")}>
            Choisir mon Pass JobRadar
          </button>
          <button className="btn btnGhost" type="button" onClick={() => navigate(buildOnboardingFeedHref(desiredRole || onboarding.onboarding.profile?.desiredRole))}>
            Continuer avec mon alerte gratuite
          </button>
        </div>
      </div>
    </Panel>
  );

  const completeProfileStep = (
    <Panel>
      <div className="jrOnbChecklist">
        <div className={`jrOnbChecklist__item ${onboarding.profile?.full_name ? "is-done" : ""}`}>Nom complet</div>
        <div className={`jrOnbChecklist__item ${onboarding.profile?.location ? "is-done" : ""}`}>Localisation</div>
        <div className={`jrOnbChecklist__item ${onboarding.profile?.headline ? "is-done" : ""}`}>Compétences / titre</div>
        <div className={`jrOnbChecklist__item ${onboarding.profileCompletionReady ? "is-done" : ""}`}>Expérience ou CV</div>
      </div>
      <div className="jrOnbActions">
        <button className="btn btnPrimary" type="button" onClick={() => navigate("/profile?flow=onboarding")}>
          Compléter mon profil
        </button>
        {onboarding.profileCompletionReady && (
          <button className="btn btnGhost" type="button" onClick={() => setSearchParams({ step: "cv" })}>
            Continuer vers le CV
          </button>
        )}
      </div>
    </Panel>
  );

  const cvStep = (
    <Panel>
      <div className="jrOnbValueCard">
        <strong>{onboarding.hasCv ? "CV déjà présent" : "Pas encore de CV détecté"}</strong>
        <span>
          {onboarding.hasCv
            ? "Ton CV est prêt. On peut passer à l'activation des alertes."
            : "Importe-le maintenant pour obtenir des offres mieux ciblées et accélérer les recommandations."}
        </span>
      </div>
      <div className="jrOnbActions">
        <button className="btn btnPrimary" type="button" onClick={() => navigate("/me/cv?flow=onboarding")}>
          {onboarding.hasCv ? "Vérifier mon CV" : "Importer mon CV"}
        </button>
        {onboarding.hasCv && (
          <button className="btn btnGhost" type="button" onClick={() => setSearchParams({ step: "alerts" })}>
            Continuer vers les alertes
          </button>
        )}
      </div>
    </Panel>
  );

  const alertsStep = (
    <Panel>
      <div className="jrOnbValueCard">
        <strong>
          {onboarding.alertsCount > 0
            ? `${onboarding.alertsCount} alerte${onboarding.alertsCount > 1 ? "s" : ""} active${onboarding.alertsCount > 1 ? "s" : ""}`
            : "Aucune alerte active pour l'instant"}
        </strong>
        <span>
          {onboarding.alertsCount > 0
            ? "Parfait. Tu peux maintenant retrouver tes offres au quotidien."
            : "Tes alertes préparées t'attendent. Active-en une ou crée la tienne, puis ouvre tes offres au quotidien."}
        </span>
      </div>
      <div className="jrOnbActions">
        <button className="btn btnPrimary" type="button" onClick={() => navigate("/jobradar/alerts?flow=onboarding&prefill=onboarding")}>
          {onboarding.alertsCount > 0 ? "Gérer mes alertes" : "Activer mes alertes"}
        </button>
        {onboarding.alertsCount > 0 && (
          <button className="btn btnGhost" type="button" onClick={() => { trackTutorialComplete(); void onboarding.markOnboardingComplete().then(() => navigate(buildOnboardingFeedHref(desiredRole || onboarding.onboarding.profile?.desiredRole))); }}>
            Ouvrir mes offres
          </button>
        )}
      </div>
    </Panel>
  );

  return (
    <div className="jrOnbShell">
      <section className="jrOnbHero">
        <div className="jrOnbHero__meta">
          <span className="jrOnbHero__badge">Étape {currentStepNumber} sur {JOBRADAR_FLOW_STEPS.length}</span>
          <span className="jrOnbHero__phase">{phaseLabel}</span>
        </div>
        <div className="jrOnbHero__copy">
          <h1>{stepMeta.label}</h1>
          <p>{stepMeta.description}</p>
          <div className="jrOnbHero__helper">{STEP_HELPER_TEXT[currentStep]}</div>
        </div>
        <OnboardingStepper currentStep={currentStep} completedSteps={completedSteps} showSummary={false} />
      </section>

      <section className="jrOnbContent">
        {currentStep === "profile" && profileStep}
        {currentStep === "preferences" && (
          <>
            {preferencesStep}
            {alertDraftsBlock}
            <p className="jrOnbConsentNote">
              En continuant, une première alerte gratuite est activée avec ces critères : tu recevras par email
              les offres qui correspondent. Tu pourras la modifier ou la désactiver à tout moment depuis la page
              Alertes.
            </p>
            <div className="jrOnbActions jrOnbActions--standalone">
              <button className="btn btnPrimary" type="button" onClick={() => void savePreferences(false)} disabled={onboarding.saving}>
                Voir mes offres et activer mon alerte gratuite
              </button>
              <button className="btn btnGhost" type="button" onClick={() => void savePreferences(true)} disabled={onboarding.saving}>
                Passer pour l'instant
              </button>
            </div>
          </>
        )}
        {currentStep === "preview" && previewStep}
        {currentStep === "unlock" && unlockStep}
        {currentStep === "complete-profile" && completeProfileStep}
        {currentStep === "cv" && cvStep}
        {currentStep === "alerts" && alertsStep}
      </section>
    </div>
  );
}
