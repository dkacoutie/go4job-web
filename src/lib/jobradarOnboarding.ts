export const JOBRADAR_ONBOARDING_ROUTE = "/jobradar/onboarding";

export type JobRadarOnboardingStep =
  | "profile"
  | "preferences"
  | "preview"
  | "unlock"
  | "complete-profile"
  | "cv"
  | "alerts"
  | "done";

export type ExperienceLevel =
  | "starter"
  | "junior"
  | "intermediate"
  | "senior"
  | "executive"
  | "";

export type EmploymentType = "cdi" | "contract" | "internship" | "freelance" | "part-time";
export type WorkMode = "remote" | "hybrid" | "onsite";

export type OnboardingAlertDraft = {
  id: string;
  name: string;
  keywords: string[];
  countries?: string[] | null;
  frequency: "instant" | "daily" | "weekly";
  rationale?: string | null;
};

export type JobRadarOnboardingState = {
  version: number;
  currentStep?: JobRadarOnboardingStep | null;
  profile?: {
    desiredRole?: string | null;
    countryCodes?: string[] | null;
    experienceLevel?: ExperienceLevel | null;
    employmentTypes?: EmploymentType[] | null;
    completedAt?: string | null;
  };
  preferences?: {
    keywords?: string[] | null;
    workModes?: WorkMode[] | null;
    sectors?: string[] | null;
    alertDrafts?: OnboardingAlertDraft[] | null;
    suggestionSignature?: string | null;
    skipped?: boolean | null;
    completedAt?: string | null;
  };
  previewSeenAt?: string | null;
  unlockSeenAt?: string | null;
  postPurchase?: {
    profilePromptSeenAt?: string | null;
    cvPromptSeenAt?: string | null;
    alertsPromptSeenAt?: string | null;
  };
  completedAt?: string | null;
};

export type JobRadarProfileRecord = {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  experience_years: number | null;
  cv_file_path: string | null;
  cv_filename?: string | null;
  cv_updated_at?: string | null;
  jobradar_onboarding?: JobRadarOnboardingState | null;
  jobradar_onboarding_completed_at?: string | null;
};

export type JobRadarFlowStep = {
  key: Exclude<JobRadarOnboardingStep, "done">;
  label: string;
  eyebrow: string;
  description: string;
  phase: "before_purchase" | "after_purchase";
};

export const JOBRADAR_FLOW_STEPS: JobRadarFlowStep[] = [
  {
    key: "profile",
    label: "Quel poste recherches-tu ?",
    eyebrow: "Étape 1",
    description:
      "Indique le poste que tu vises. JobRadar s’en servira pour te montrer des offres plus adaptées. Tu pourras modifier ce choix plus tard.",
    phase: "before_purchase",
  },
  {
    key: "preferences",
    label: "Critères",
    eyebrow: "Étape 2",
    description: "Ajoute quelques détails pour construire ton profil de recherche, sans long formulaire.",
    phase: "before_purchase",
  },
  {
    key: "preview",
    label: "Premières offres",
    eyebrow: "Étape 3",
    description: "Découvre immédiatement la valeur de JobRadar avec une sélection guidée.",
    phase: "before_purchase",
  },
  {
    key: "unlock",
    label: "Débloquer",
    eyebrow: "Étape 4",
    description: "Active le pass pour ouvrir l’accès complet aux offres et aux recommandations.",
    phase: "before_purchase",
  },
  {
    key: "complete-profile",
    label: "Profil complet",
    eyebrow: "Étape 5",
    description: "Finalise ton profil pour rendre les recommandations plus fiables.",
    phase: "after_purchase",
  },
  {
    key: "cv",
    label: "Import CV",
    eyebrow: "Étape 6",
    description: "Ajoute ton CV pour enrichir automatiquement ton matching.",
    phase: "after_purchase",
  },
  {
    key: "alerts",
    label: "Alertes",
    eyebrow: "Étape 7",
    description: "Active tes alertes pour recevoir des offres utiles plus régulièrement.",
    phase: "after_purchase",
  },
];

export const ONBOARDING_COUNTRY_OPTIONS = [
  { code: "ALL", label: "Tous pays / toutes zones" },
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "SN", label: "Sénégal" },
  { code: "BF", label: "Burkina Faso" },
  { code: "ML", label: "Mali" },
  { code: "BJ", label: "Bénin" },
  { code: "TG", label: "Togo" },
  { code: "GH", label: "Ghana" },
  { code: "NG", label: "Nigeria" },
  { code: "CM", label: "Cameroun" },
  { code: "FR", label: "France" },
  { code: "BE", label: "Belgique" },
  { code: "CA", label: "Canada" },
  { code: "US", label: "États-Unis" },
  { code: "GB", label: "Royaume-Uni" },
  { code: "REMOTE", label: "Télétravail international" },
] as const;

export const EXPERIENCE_LEVEL_OPTIONS: Array<{ value: ExperienceLevel; label: string; hint: string }> = [
  { value: "starter", label: "Débutant", hint: "0 à 1 an, premier poste ou reconversion." },
  { value: "junior", label: "Junior", hint: "1 à 3 ans d'expérience." },
  { value: "intermediate", label: "Intermédiaire", hint: "3 à 6 ans, déjà autonome." },
  { value: "senior", label: "Senior", hint: "6 ans et plus, expertise confirmée." },
  { value: "executive", label: "Lead / Manager", hint: "Management, coordination d’équipe ou responsabilité de projet." },
];

export const EMPLOYMENT_TYPE_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: "cdi", label: "CDI / long terme" },
  { value: "contract", label: "CDD / mission" },
  { value: "internship", label: "Stage / alternance" },
  { value: "freelance", label: "Freelance" },
  { value: "part-time", label: "Temps partiel" },
];

export const WORK_MODE_OPTIONS: Array<{ value: WorkMode; label: string }> = [
  { value: "remote", label: "Télétravail" },
  { value: "hybrid", label: "Hybride" },
  { value: "onsite", label: "Sur site" },
];

export const SECTOR_OPTIONS = [
  "Tech & Produit",
  "Data & IA",
  "Marketing & Growth",
  "Sales & BizDev",
  "Finance & Ops",
  "RH & Administration",
  "ONG & Développement",
  "Santé",
  "Education",
  "Industrie & Supply",
] as const;

export const EMPTY_JOBRADAR_ONBOARDING: JobRadarOnboardingState = {
  version: 1,
  currentStep: "profile",
  profile: {
    desiredRole: "",
    countryCodes: [],
    experienceLevel: "",
    employmentTypes: [],
    completedAt: null,
  },
  preferences: {
    keywords: [],
    workModes: [],
    sectors: [],
    alertDrafts: [],
    suggestionSignature: null,
    skipped: false,
    completedAt: null,
  },
  previewSeenAt: null,
  unlockSeenAt: null,
  postPurchase: {
    profilePromptSeenAt: null,
    cvPromptSeenAt: null,
    alertsPromptSeenAt: null,
  },
  completedAt: null,
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((entry) => cleanString(entry))
        .filter(Boolean)
    )
  );
}

function cleanEmploymentTypes(value: unknown) {
  return cleanStringArray(value).filter((item): item is EmploymentType =>
    ["cdi", "contract", "internship", "freelance", "part-time"].includes(item)
  );
}

function cleanWorkModes(value: unknown) {
  return cleanStringArray(value).filter((item): item is WorkMode =>
    ["remote", "hybrid", "onsite"].includes(item)
  );
}

function cleanAlertDrafts(value: unknown) {
  if (!Array.isArray(value)) return [] as OnboardingAlertDraft[];
  return value
    .map((entry, index) => {
      const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const frequencyRaw = cleanString(raw.frequency);
      const frequency = ["instant", "daily", "weekly"].includes(frequencyRaw)
        ? (frequencyRaw as "instant" | "daily" | "weekly")
        : "daily";
      return {
        id: cleanString(raw.id) || `draft-${index + 1}`,
        name: cleanString(raw.name) || "Alerte JobRadar",
        keywords: cleanStringArray(raw.keywords).slice(0, 8),
        countries: raw.countries == null ? null : cleanStringArray(raw.countries),
        frequency,
        rationale: cleanString(raw.rationale) || null,
      } satisfies OnboardingAlertDraft;
    })
    .filter((draft) => draft.keywords.length > 0);
}

export function normalizeJobRadarOnboardingState(raw: unknown): JobRadarOnboardingState {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profile = source.profile && typeof source.profile === "object" ? (source.profile as Record<string, unknown>) : {};
  const preferences =
    source.preferences && typeof source.preferences === "object"
      ? (source.preferences as Record<string, unknown>)
      : {};
  const postPurchase =
    source.postPurchase && typeof source.postPurchase === "object"
      ? (source.postPurchase as Record<string, unknown>)
      : {};

  return {
    version: 1,
    currentStep: (cleanString(source.currentStep) as JobRadarOnboardingStep) || "profile",
    profile: {
      desiredRole: cleanString(profile.desiredRole),
      countryCodes: cleanStringArray(profile.countryCodes),
      experienceLevel: (cleanString(profile.experienceLevel) as ExperienceLevel) || "",
      employmentTypes: cleanEmploymentTypes(profile.employmentTypes),
      completedAt: cleanString(profile.completedAt) || null,
    },
    preferences: {
      keywords: cleanStringArray(preferences.keywords),
      workModes: cleanWorkModes(preferences.workModes),
      sectors: cleanStringArray(preferences.sectors),
      alertDrafts: cleanAlertDrafts(preferences.alertDrafts),
      suggestionSignature: cleanString(preferences.suggestionSignature) || null,
      skipped: Boolean(preferences.skipped),
      completedAt: cleanString(preferences.completedAt) || null,
    },
    previewSeenAt: cleanString(source.previewSeenAt) || null,
    unlockSeenAt: cleanString(source.unlockSeenAt) || null,
    postPurchase: {
      profilePromptSeenAt: cleanString(postPurchase.profilePromptSeenAt) || null,
      cvPromptSeenAt: cleanString(postPurchase.cvPromptSeenAt) || null,
      alertsPromptSeenAt: cleanString(postPurchase.alertsPromptSeenAt) || null,
    },
    completedAt: cleanString(source.completedAt) || null,
  };
}

export function mergeJobRadarOnboardingState(
  current: JobRadarOnboardingState | null | undefined,
  patch: Partial<JobRadarOnboardingState>
) {
  const base = normalizeJobRadarOnboardingState(current ?? EMPTY_JOBRADAR_ONBOARDING);
  return normalizeJobRadarOnboardingState({
    ...base,
    ...patch,
    profile: {
      ...base.profile,
      ...(patch.profile ?? {}),
    },
    preferences: {
      ...base.preferences,
      ...(patch.preferences ?? {}),
    },
    postPurchase: {
      ...base.postPurchase,
      ...(patch.postPurchase ?? {}),
    },
  });
}

export function hasPrePurchaseProfileCompleted(state: JobRadarOnboardingState) {
  const profile = state.profile ?? {};
  return Boolean(
    cleanString(profile.desiredRole) &&
      (profile.countryCodes?.length ?? 0) > 0 &&
      cleanString(profile.experienceLevel) &&
      (profile.employmentTypes?.length ?? 0) > 0
  );
}

export function hasPreferencesCompleted(state: JobRadarOnboardingState) {
  const preferences = state.preferences ?? {};
  if (preferences.skipped) return true;
  return Boolean(
    (preferences.keywords?.length ?? 0) > 0 ||
      (preferences.workModes?.length ?? 0) > 0 ||
      (preferences.sectors?.length ?? 0) > 0 ||
      (preferences.alertDrafts?.length ?? 0) > 0
  );
}

export function hasPostPurchaseProfileCompleted(profile: JobRadarProfileRecord | null | undefined) {
  if (!profile) return false;
  const hasExperience = typeof profile.experience_years === "number" && profile.experience_years >= 0;
  return Boolean(
    cleanString(profile.full_name) &&
      cleanString(profile.location) &&
      cleanString(profile.headline) &&
      (hasExperience || cleanString(profile.cv_file_path))
  );
}

export function buildJobRadarOnboardingHref(step?: JobRadarOnboardingStep | null) {
  if (!step || step === "done") return "/jobradar/feed";
  return `${JOBRADAR_ONBOARDING_ROUTE}?step=${encodeURIComponent(step)}`;
}

export function getFlowStepIndex(step: Exclude<JobRadarOnboardingStep, "done">) {
  return JOBRADAR_FLOW_STEPS.findIndex((item) => item.key === step);
}

export function isAfterPurchaseStep(step: JobRadarOnboardingStep) {
  return step === "complete-profile" || step === "cv" || step === "alerts";
}

export function getCountryLabel(code: string) {
  if (code === "ALL") return "Tous pays / toutes zones";
  return ONBOARDING_COUNTRY_OPTIONS.find((item) => item.code === code)?.label ?? code;
}

export function splitKeywords(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}
