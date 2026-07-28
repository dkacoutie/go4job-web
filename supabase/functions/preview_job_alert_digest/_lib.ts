export type PreviewJobAlertBody = {
  user_id?: string | null;
  dry_run?: boolean | null;
  limit?: number | null;
  min_jobs_preview?: number | null;
  min_jobs_to_send?: number | null;
  min_score_preview?: number | null;
  min_score_to_send?: number | null;
  max_blocks?: number | null;
};

export type ProfileRow = {
  user_id: string;
  full_name?: string | null;
  headline?: string | null;
  location?: string | null;
  experience_years?: number | null;
  jobradar_onboarding?: Record<string, unknown> | null;
};

export type AlertRow = {
  id?: string;
  name?: string | null;
  keywords?: string[] | null;
  country?: string | null;
  countries?: string[] | null;
  search_query?: string | null;
  employment_types?: string[] | null;
  work_modes?: string[] | null;
  skills_keywords?: string[] | null;
  excluded_keywords?: string[] | null;
  frequency?: string | null;
  channels?: string[] | null;
  is_active?: boolean | null;
};

export type JobRow = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  contract_type?: string | null;
  seniority?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
  description_text?: string | null;
  official_desc?: string | null;
  tags?: string[] | string | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  job_family?: string | null;
  source_url?: string | null;
  apply_url?: string | null;
  external_id?: string | null;
  is_active?: boolean | null;
  is_expired?: boolean | null;
  job_status?: string | null;
};

export type Diagnostics = {
  candidates_checked: number;
  excluded_inactive: number;
  excluded_without_url: number;
  excluded_saved_or_applied: number;
  excluded_dismissed: number;
  excluded_old: number;
  excluded_poor_data: number;
  excluded_low_score: number;
  excluded_weak_match_signal: number;
  excluded_keyword_match: number;
  excluded_over_limit: number;
  excluded_below_preview_threshold: number;
  excluded_incomplete_profile: boolean;
  selected_relevant_jobs: number;
  total_accounted_jobs: number;
  diagnostic_unaccounted_jobs: number;
  diagnostic_accounting_ok: boolean;
  top_rejected_jobs: TopRejectedJob[];
  notification_prefs_checked: boolean;
  notification_prefs_digest_enabled: boolean | null;
  notification_prefs_unsubscribed_at: string | null;
  suppression_checked: boolean;
  suppression_found: boolean | null;
  deduplication_status: "table_not_yet_created";
  recommended_rate_limit: "max_1_email_per_user_per_week";
  notes: string[];
};

type RejectionReason =
  | "low_score"
  | "weak_job_signal"
  | "excluded_keyword"
  | "no_url"
  | "inactive"
  | "saved_or_applied"
  | "dismissed"
  | "old"
  | "poor_data"
  | "below_preview_threshold";

type TopRejectedJob = {
  id: string;
  title: string | null;
  company_name: string | null;
  score: number;
  score_reasons: string[];
  rejection_reason: RejectionReason;
};

export type Criteria = {
  desiredRole: string | null;
  keywords: string[];
  countries: string[];
  employmentTypes: string[];
  workModes: string[];
  sectors: string[];
  experienceLevel: string | null;
  activeAlerts: AlertRow[];
};

export type SelectedJob = {
  id: string;
  title: string | null;
  company_name: string | null;
  country: string | null;
  location: string | null;
  remote_type: string | null;
  contract_type: string | null;
  job_family: string | null;
  score: number;
  score_reasons: string[];
  url_available: boolean;
  freshness_ms: number;
  relevant_at: string | null;
};

export type DigestBlock = {
  key: string;
  title: string;
  subtitle: string;
  count: number;
  sample_jobs: Array<{
    id: string;
    title: string | null;
    company_name: string | null;
    country: string | null;
    location: string | null;
    score: number;
    url_available: boolean;
  }>;
  cta_label: "Voir ces offres";
  cta_url: string;
};

const MAX_CANDIDATE_AGE_DAYS = 45;
const DEFAULT_LIMIT = 30;
const DEFAULT_MIN_JOBS_PREVIEW = 3;
const DEFAULT_MIN_JOBS_TO_SEND = 5;
const DEFAULT_MIN_SCORE_PREVIEW = 30;
const DEFAULT_MIN_SCORE_TO_SEND = 35;
const DEFAULT_MAX_BLOCKS = 5;

const WEAK_MATCH_TERMS = new Set([
  "chef",
  "responsable",
  "manager",
  "directeur",
  "directrice",
  "coordinateur",
  "coordinatrice",
  "superviseur",
  "assistant",
  "assistante",
  "charge",
  "chargee",
  "agent",
  "technicien",
  "technicienne",
  "conseiller",
  "conseillere",
  "projet",
  "equipe",
  "service",
  "poste",
  "profil",
  "candidat",
  "candidate",
  "gestion",
  "suivi",
  "support",
  "pilotage",
  "conducteur",
  "conductrice",
]);

const STRONG_EXACT_ALERT_PHRASES = new Set([
  "chef de projet",
  "assistant administratif",
  "assistant de direction",
  "charge de communication",
  "chargee de communication",
  "charge de recrutement",
  "chargee de recrutement",
  "responsable rh",
  "responsable ressources humaines",
  "responsable commercial",
  "chef comptable",
  "directeur financier",
  "directrice financiere",
]);

const DOMAIN_TERMS: Record<string, string[]> = {
  data: ["data", "analytics", "bi", "sql", "power bi", "tableau"],
  engineering: ["developer", "developpeur", "software", "frontend", "backend", "fullstack", "devops"],
  finance: ["finance", "accounting", "comptable", "audit", "budget", "treasury"],
  operations: ["operations", "logistique", "procurement", "supply", "achats"],
  marketing: ["marketing", "communication", "growth", "seo", "brand"],
  sales: ["sales", "commercial", "business development", "vente"],
  hr: ["rh", "human resources", "recruitment", "talent", "administration"],
  ngo: ["ong", "ngo", "development", "programme", "humanitarian", "suivi evaluation"],
};

export function parsePositiveInt(value: number | null | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.min(Math.max(Math.trunc(value as number), 1), max);
}

export function parseScore(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.min(Math.max(Math.trunc(value as number), 0), 100);
}

export function normalizeOptions(body: PreviewJobAlertBody) {
  const minScorePreview = parseScore(body.min_score_preview, DEFAULT_MIN_SCORE_PREVIEW);
  return {
    limit: parsePositiveInt(body.limit, DEFAULT_LIMIT, 100),
    minJobsPreview: parsePositiveInt(body.min_jobs_preview, DEFAULT_MIN_JOBS_PREVIEW, 20),
    minJobsToSend: parsePositiveInt(body.min_jobs_to_send, DEFAULT_MIN_JOBS_TO_SEND, 50),
    minScorePreview,
    minScoreToSend: Math.max(
      minScorePreview,
      parseScore(body.min_score_to_send, DEFAULT_MIN_SCORE_TO_SEND),
    ),
    maxBlocks: parsePositiveInt(body.max_blocks, DEFAULT_MAX_BLOCKS, 5),
  };
}

export function baseDiagnostics(): Diagnostics {
  return {
    candidates_checked: 0,
    excluded_inactive: 0,
    excluded_without_url: 0,
    excluded_saved_or_applied: 0,
    excluded_dismissed: 0,
    excluded_old: 0,
    excluded_poor_data: 0,
    excluded_low_score: 0,
    excluded_weak_match_signal: 0,
    excluded_keyword_match: 0,
    excluded_over_limit: 0,
    excluded_below_preview_threshold: 0,
    excluded_incomplete_profile: false,
    selected_relevant_jobs: 0,
    total_accounted_jobs: 0,
    diagnostic_unaccounted_jobs: 0,
    diagnostic_accounting_ok: true,
    top_rejected_jobs: [],
    notification_prefs_checked: false,
    notification_prefs_digest_enabled: null,
    notification_prefs_unsubscribed_at: null,
    suppression_checked: false,
    suppression_found: null,
    deduplication_status: "table_not_yet_created",
    recommended_rate_limit: "max_1_email_per_user_per_week",
    notes: [
      "Future real sends require job_alert_sent_jobs before enqueue or Resend.",
    ],
  };
}

export function finalizeDiagnostics(diagnostics: Diagnostics, selectedRelevantJobs: number): Diagnostics {
  diagnostics.selected_relevant_jobs = selectedRelevantJobs;
  diagnostics.total_accounted_jobs =
    diagnostics.excluded_inactive +
    diagnostics.excluded_without_url +
    diagnostics.excluded_saved_or_applied +
    diagnostics.excluded_dismissed +
    diagnostics.excluded_old +
    diagnostics.excluded_poor_data +
    diagnostics.excluded_low_score +
    diagnostics.excluded_weak_match_signal +
    diagnostics.excluded_keyword_match +
    diagnostics.excluded_over_limit +
    diagnostics.excluded_below_preview_threshold +
    selectedRelevantJobs;
  diagnostics.diagnostic_unaccounted_jobs = diagnostics.candidates_checked - diagnostics.total_accounted_jobs;
  diagnostics.diagnostic_accounting_ok = diagnostics.diagnostic_unaccounted_jobs === 0;
  return diagnostics;
}

export function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniq(value.map(cleanString).filter(Boolean));
}

// Alert refinements preserve storage meaning: null = not configured; [] = configured
// but empty. Both yield no active terms while invalid runtime values safely become [].
function refinedKeywordArray(value: unknown): string[] {
  return cleanArray(value);
}

function normalizedRefinedKeywordArray(value: unknown): string[] {
  return refinedKeywordArray(value).map(normalizeText).filter(Boolean);
}

function uniq(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+.#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readOnboarding(profile: ProfileRow | null) {
  const raw = profile?.jobradar_onboarding;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const profileStep = source.profile && typeof source.profile === "object" && !Array.isArray(source.profile)
    ? source.profile as Record<string, unknown>
    : {};
  const preferences = source.preferences && typeof source.preferences === "object" && !Array.isArray(source.preferences)
    ? source.preferences as Record<string, unknown>
    : {};

  return {
    desiredRole: cleanString(profileStep.desiredRole) || null,
    countryCodes: cleanArray(profileStep.countryCodes),
    employmentTypes: cleanArray(profileStep.employmentTypes),
    experienceLevel: cleanString(profileStep.experienceLevel) || null,
    workModes: cleanArray(preferences.workModes),
    sectors: cleanArray(preferences.sectors),
    keywords: cleanArray(preferences.keywords),
  };
}

/**
 * Construit un filtre PostgREST `or` à partir des termes discriminants des
 * critères, pour aller chercher des offres pertinentes directement en base.
 *
 * Pourquoi : le vivier de candidats était constitué des ~240 offres les plus
 * récentes du catalogue entier, puis filtré en mémoire. À 19 000 offres
 * ingérées par jour, cela représente une vingtaine de minutes de collecte,
 * donc un échantillon quasi aléatoire au regard du métier recherché.
 *
 * Constaté le 28/07/2026 sur une alerte « Chef de projet finance » : sur les
 * 240 offres du vivier, 3 seulement franchissaient le seuil de qualité, alors
 * que le minimum requis pour envoyer est de 5. Le digest était donc retenu
 * faute de quantité, alors que le catalogue contenait 767 postes de chef de
 * projet publiés dans les sept derniers jours.
 *
 * Ce filtre ne remplace pas le vivier récent, il le complète : on ne retire
 * aucun candidat, on en ajoute des pertinents. Le barème, les seuils et la
 * déduplication restent inchangés en aval.
 *
 * Retourne null si aucun terme n'est assez discriminant pour valoir une
 * requête (auquel cas on s'en tient au comportement historique).
 */
export function buildRelevanceOrFilter(criteria: Criteria): string | null {
  const MAX_TERMS = 12;

  // PostgREST interprète la virgule, les parenthèses et les guillemets dans la
  // syntaxe `or`. On les retire plutôt que de tenter de les échapper.
  const sanitize = (value: string) =>
    normalizeText(value)
      .replace(/[,().*%"']/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const candidates = [criteria.desiredRole ?? "", ...criteria.keywords]
    .map(sanitize)
    .filter((term) => {
      if (!term) return false;
      // Un terme isolé trop court ou trop générique ramènerait la moitié du
      // catalogue : « job », « chef », « projet » ne discriminent rien seuls.
      if (WEAK_MATCH_TERMS.has(term)) return false;
      const isPhrase = term.includes(" ");
      return isPhrase || term.length >= 5;
    });

  // Les expressions de plusieurs mots d'abord : ce sont les plus sélectives.
  const ordered = uniq(candidates).sort((a, b) => {
    const aPhrase = a.includes(" ") ? 0 : 1;
    const bPhrase = b.includes(" ") ? 0 : 1;
    if (aPhrase !== bPhrase) return aPhrase - bPhrase;
    return b.length - a.length;
  }).slice(0, MAX_TERMS);

  if (ordered.length === 0) return null;

  return ordered.map((term) => `title.ilike.*${term}*`).join(",");
}

export function buildCriteria(profile: ProfileRow | null, alerts: AlertRow[]): Criteria {
  const onboarding = readOnboarding(profile);
  const activeAlerts = alerts.filter((alert) => alert.is_active !== false);
  const alertKeywords = activeAlerts.flatMap((alert) => [
    ...cleanArray(alert.keywords),
    ...extractKeywordsFromName(alert.search_query ?? ""),
    ...extractKeywordsFromName(alert.name ?? ""),
  ]);
  const alertCountries = activeAlerts.flatMap((alert) => [
    ...cleanArray(alert.countries),
    cleanString(alert.country),
  ]);
  const alertEmploymentTypes = activeAlerts.flatMap((alert) => cleanArray(alert.employment_types));
  const alertWorkModes = activeAlerts.flatMap((alert) => cleanArray(alert.work_modes));

  return {
    desiredRole: onboarding.desiredRole,
    keywords: uniq([...onboarding.keywords, ...alertKeywords]).slice(0, 40),
    countries: uniq([...onboarding.countryCodes, ...alertCountries].filter(Boolean)).slice(0, 20),
    employmentTypes: uniq([...onboarding.employmentTypes, ...alertEmploymentTypes]).slice(0, 20),
    workModes: uniq([...onboarding.workModes, ...alertWorkModes]).slice(0, 10),
    sectors: onboarding.sectors,
    experienceLevel: onboarding.experienceLevel,
    activeAlerts,
  };
}

export function isIncompleteProfile(criteria: Criteria): boolean {
  return !criteria.desiredRole &&
    criteria.keywords.length === 0 &&
    criteria.countries.length === 0 &&
    criteria.activeAlerts.length === 0;
}

function extractKeywordsFromName(name: string): string[] {
  const normalized = normalizeText(name);
  if (!normalized) return [];
  const words = normalized
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .filter((word) => !["alerte", "job", "emploi", "poste", "mission"].includes(word));
  return uniq([normalized, ...words]).slice(0, 5);
}

function jobUrlAvailable(job: JobRow): boolean {
  return Boolean(cleanString(job.apply_url) || cleanString(job.source_url));
}

function getJobTimeMs(job: JobRow): number {
  const raw = [
    job.published_at,
    job.posted_at,
    job.scraped_at,
    job.created_at,
    job.last_seen_at,
    job.updated_at,
  ].find((value) => cleanString(value));
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isOld(job: JobRow): boolean {
  const ms = getJobTimeMs(job);
  if (!ms) return true;
  return Date.now() - ms > MAX_CANDIDATE_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function hasPoorData(job: JobRow): boolean {
  const title = cleanString(job.title);
  const company = cleanString(job.company_name);
  const location = cleanString(job.location) || cleanString(job.country);
  const desc = cleanString(job.official_desc) || cleanString(job.description_text);
  const skills = [
    ...(job.required_skills ?? []),
    ...(job.optional_skills ?? []),
    ...(job.job_skills ?? []),
    ...normalizeTags(job.tags),
  ];
  return !title || (!company && !location && !job.job_family && skills.length === 0 && desc.length < 80);
}

function normalizeTags(tags: JobRow["tags"]): string[] {
  if (Array.isArray(tags)) return tags.map(cleanString).filter(Boolean);
  if (typeof tags === "string") {
    return tags.split(/[,;|\n]/).map(cleanString).filter(Boolean);
  }
  return [];
}

function haystack(job: JobRow): string {
  return normalizeText([
    job.title,
    job.company_name,
    job.location,
    job.country,
    job.remote_type,
    job.contract_type,
    job.job_family,
    job.official_desc,
    job.description_text,
    ...normalizeTags(job.tags),
    ...(job.required_skills ?? []),
    ...(job.optional_skills ?? []),
    ...(job.job_skills ?? []),
  ].filter(Boolean).join(" "));
}

function exclusionHaystack(job: JobRow): string {
  return normalizeText([job.title, job.description_text].filter(Boolean).join(" "));
}

function skillsHaystack(job: JobRow): string {
  return normalizeText([
    job.title,
    job.description_text,
    ...normalizeTags(job.tags),
    ...(job.required_skills ?? []),
    ...(job.optional_skills ?? []),
    ...(job.job_skills ?? []),
  ].filter(Boolean).join(" "));
}

function countryMatches(criteria: Criteria, job: JobRow): boolean {
  if (criteria.countries.length === 0) return false;
  const jobCountry = normalizeText(cleanString(job.country));
  const jobLocation = normalizeText(cleanString(job.location));
  return criteria.countries.some((country) => {
    const normalized = normalizeText(country);
    if (!normalized || normalized === "all") return true;
    if (normalized === "remote") return normalizeText(job.remote_type ?? "").includes("remote");
    return jobCountry.includes(normalized) || jobLocation.includes(normalized);
  });
}

function remoteMatches(criteria: Criteria, job: JobRow): boolean {
  if (criteria.workModes.length === 0) return false;
  const remote = normalizeText(job.remote_type ?? "");
  const text = haystack(job);
  return criteria.workModes.some((mode) => {
    const normalized = normalizeText(mode);
    if (normalized === "remote") return remote.includes("remote") || text.includes("teletravail");
    if (normalized === "hybrid") return remote.includes("hybrid") || remote.includes("hybride");
    if (normalized === "onsite") return remote.includes("onsite") || remote.includes("site");
    return remote.includes(normalized);
  });
}

function contractMatches(criteria: Criteria, job: JobRow): boolean {
  if (criteria.employmentTypes.length === 0) return false;
  const contract = normalizeText(job.contract_type ?? "");
  return criteria.employmentTypes.some((type) => contract.includes(normalizeText(type)));
}

function scoreJob(job: JobRow, criteria: Criteria): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = haystack(job);
  const titleText = normalizeText(job.title ?? "");

  const role = normalizeText(criteria.desiredRole ?? "");
  if (role && (titleText.includes(role) || text.includes(role))) {
    score += titleText.includes(role) ? 30 : 18;
    reasons.push("desired_role_match");
  }

  const normalizedKeywords = criteria.keywords
    .map((keyword) => normalizeText(keyword))
    .filter((keyword) => keyword.length >= 3);
  const keywordMatches = normalizedKeywords.filter((keyword) => text.includes(keyword));
  const exactAlertPhraseMatches = Array.from(STRONG_EXACT_ALERT_PHRASES)
    .filter((phrase) => text.includes(phrase) && normalizedKeywords.some((keyword) => keyword.includes(phrase)));
  const strongKeywordMatches = keywordMatches.filter((keyword) =>
    !WEAK_MATCH_TERMS.has(keyword) && !STRONG_EXACT_ALERT_PHRASES.has(keyword)
  );
  const scoredKeywordCount = exactAlertPhraseMatches.length + strongKeywordMatches.length;
  if (scoredKeywordCount > 0) {
    score += Math.min(24, scoredKeywordCount * 6);
  }
  if (exactAlertPhraseMatches.length > 0) {
    reasons.push("exact_alert_phrase_match");
  }
  if (strongKeywordMatches.length > 0) {
    reasons.push("strong_alert_keyword_match");
  }

  if (countryMatches(criteria, job)) {
    score += 12;
    reasons.push("country_match");
  }

  if (contractMatches(criteria, job)) {
    score += 8;
    reasons.push("contract_match");
  }

  if (remoteMatches(criteria, job)) {
    score += 10;
    reasons.push("remote_match");
  }

  const ageDays = (Date.now() - getJobTimeMs(job)) / 24 / 60 / 60 / 1000;
  if (ageDays <= 7) {
    score += 12;
    reasons.push("fresh_job");
  } else if (ageDays <= 21) {
    score += 6;
    reasons.push("recent_job");
  } else {
    score -= 8;
    reasons.push("older_job");
  }

  if (jobUrlAvailable(job)) score += 8;
  if (!cleanString(job.company_name)) score -= 4;
  if (!cleanString(job.location) && !cleanString(job.country)) score -= 4;
  if (!role && scoredKeywordCount === 0 && !countryMatches(criteria, job)) {
    score -= 10;
    reasons.push("weak_match_signal");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons: uniq(reasons) };
}

function recordRejectedJob(
  diagnostics: Diagnostics,
  job: JobRow,
  rejectionReason: RejectionReason,
  scored?: { score: number; reasons: string[] },
) {
  diagnostics.top_rejected_jobs.push({
    id: job.id,
    title: cleanString(job.title) || null,
    company_name: cleanString(job.company_name) || null,
    score: scored?.score ?? 0,
    score_reasons: scored?.reasons ?? [],
    rejection_reason: rejectionReason,
  });
  diagnostics.top_rejected_jobs.sort((a, b) => b.score - a.score);
  diagnostics.top_rejected_jobs = diagnostics.top_rejected_jobs.slice(0, 5);
}

export function recordBelowPreviewThresholdJobs(diagnostics: Diagnostics, jobs: SelectedJob[]): void {
  diagnostics.excluded_below_preview_threshold += jobs.length;
  for (const job of jobs) {
    recordRejectedJob(diagnostics, {
      id: job.id,
      title: job.title,
      company_name: job.company_name,
    }, "below_preview_threshold", {
      score: job.score,
      reasons: job.score_reasons,
    });
  }
}

function hasSpecificIntent(criteria: Criteria): boolean {
  return Boolean(criteria.desiredRole) || criteria.keywords.length > 0;
}

function hasUsefulMatchSignal(criteria: Criteria, reasons: string[]): boolean {
  if (
    reasons.includes("desired_role_match") ||
    reasons.includes("profile_role_match") ||
    reasons.includes("exact_alert_phrase_match") ||
    reasons.includes("strong_alert_keyword_match") ||
    reasons.includes("skills_keywords_match")
  ) {
    return true;
  }

  if (hasSpecificIntent(criteria)) {
    return false;
  }

  const supportingSignals = [
    reasons.includes("country_match"),
    reasons.includes("contract_match"),
    reasons.includes("remote_match"),
  ].filter(Boolean).length;

  return supportingSignals >= 2;
}

function alertAppliesHistorically(job: JobRow, alert: AlertRow): boolean {
  const alertCriteria = buildCriteria(null, [alert]);
  const scored = scoreJob(job, alertCriteria);
  return hasUsefulMatchSignal(alertCriteria, scored.reasons);
}

function applyAlertRefinements(job: JobRow, criteria: Criteria): { excluded: boolean; skillsBoost: number } {
  const singleActiveAlert = criteria.activeAlerts.length === 1 ? criteria.activeAlerts[0] : null;
  const singleAlertHasExclusions = Boolean(
    singleActiveAlert && normalizedRefinedKeywordArray(singleActiveAlert.excluded_keywords).length > 0,
  );
  const skillText = skillsHaystack(job);
  const skillsBoostForAlert = (alert: AlertRow) => {
    const matchedSkillsKeywords = normalizedRefinedKeywordArray(alert.skills_keywords)
      .filter((keyword) => skillText.includes(keyword));
    return Math.min(10, matchedSkillsKeywords.length * 3);
  };
  // With one active refined alert there is no competing alert path: its exclusions
  // must also cover jobs admitted by profile/onboarding criteria.
  const applicableAlerts: AlertRow[] = singleActiveAlert && singleAlertHasExclusions
    ? [singleActiveAlert]
    : criteria.activeAlerts.filter((alert) => alertAppliesHistorically(job, alert) || skillsBoostForAlert(alert) > 0);
  if (applicableAlerts.length === 0) return { excluded: false, skillsBoost: 0 };

  const excludedText = exclusionHaystack(job);
  const receivableAlerts = applicableAlerts.filter((alert) => {
    const excludedKeywords = normalizedRefinedKeywordArray(alert.excluded_keywords);
    return !excludedKeywords.some((keyword) => excludedText.includes(keyword));
  });

  if (receivableAlerts.length === 0) return { excluded: true, skillsBoost: 0 };

  const skillsBoost = receivableAlerts.reduce((bestBoost, alert) => {
    return Math.max(bestBoost, skillsBoostForAlert(alert));
  }, 0);

  return { excluded: false, skillsBoost };
}

export function selectRelevantJobs(params: {
  jobs: JobRow[];
  criteria: Criteria;
  savedOrAppliedIds: Set<string>;
  dismissedIds: Set<string>;
  limit: number;
  minScorePreview: number;
  diagnostics: Diagnostics;
}): SelectedJob[] {
  const selected: SelectedJob[] = [];

  for (const job of params.jobs) {
    params.diagnostics.candidates_checked += 1;

    if (job.is_active === false || job.is_expired === true || ["expired", "tombstoned", "pending"].includes(cleanString(job.job_status))) {
      params.diagnostics.excluded_inactive += 1;
      recordRejectedJob(params.diagnostics, job, "inactive");
      continue;
    }
    if (!jobUrlAvailable(job)) {
      params.diagnostics.excluded_without_url += 1;
      recordRejectedJob(params.diagnostics, job, "no_url");
      continue;
    }
    if (params.savedOrAppliedIds.has(job.id)) {
      params.diagnostics.excluded_saved_or_applied += 1;
      recordRejectedJob(params.diagnostics, job, "saved_or_applied");
      continue;
    }
    if (params.dismissedIds.has(job.id)) {
      params.diagnostics.excluded_dismissed += 1;
      recordRejectedJob(params.diagnostics, job, "dismissed");
      continue;
    }
    if (isOld(job)) {
      params.diagnostics.excluded_old += 1;
      recordRejectedJob(params.diagnostics, job, "old");
      continue;
    }
    if (hasPoorData(job)) {
      params.diagnostics.excluded_poor_data += 1;
      recordRejectedJob(params.diagnostics, job, "poor_data");
      continue;
    }

    const scored = scoreJob(job, params.criteria);
    const refinement = applyAlertRefinements(job, params.criteria);
    if (refinement.excluded) {
      params.diagnostics.excluded_keyword_match += 1;
      recordRejectedJob(params.diagnostics, job, "excluded_keyword", scored);
      continue;
    }

    const refinedScore = Math.min(100, scored.score + refinement.skillsBoost);
    const refinedReasons = refinement.skillsBoost > 0
      ? uniq([...scored.reasons, "skills_keywords_match"])
      : scored.reasons;
    const refinedScored = { score: refinedScore, reasons: refinedReasons };
    if (refinedScore < params.minScorePreview) {
      params.diagnostics.excluded_low_score += 1;
      recordRejectedJob(params.diagnostics, job, "low_score", refinedScored);
      continue;
    }
    if (!hasUsefulMatchSignal(params.criteria, refinedReasons)) {
      params.diagnostics.excluded_weak_match_signal += 1;
      recordRejectedJob(params.diagnostics, job, "weak_job_signal", refinedScored);
      continue;
    }

    const relevantMs = getJobTimeMs(job);
    selected.push({
      id: job.id,
      title: cleanString(job.title) || null,
      company_name: cleanString(job.company_name) || null,
      country: cleanString(job.country) || null,
      location: cleanString(job.location) || null,
      remote_type: cleanString(job.remote_type) || null,
      contract_type: cleanString(job.contract_type) || null,
      job_family: cleanString(job.job_family) || null,
      score: refinedScore,
      score_reasons: refinedReasons,
      url_available: true,
      freshness_ms: relevantMs,
      relevant_at: relevantMs ? new Date(relevantMs).toISOString() : null,
    });
  }

  const sorted = selected.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.freshness_ms - a.freshness_ms;
    });
  const limited = sorted.slice(0, params.limit);
  params.diagnostics.excluded_over_limit += Math.max(0, sorted.length - limited.length);
  for (const job of sorted.slice(params.limit)) {
    recordRejectedJob(params.diagnostics, {
      id: job.id,
      title: job.title,
      company_name: job.company_name,
    }, "below_preview_threshold", {
      score: job.score,
      reasons: job.score_reasons,
    });
  }
  return limited;
}

export function pickHeroJob(jobs: SelectedJob[]): SelectedJob | null {
  const top = jobs.slice(0, 3);
  if (!top.length) return null;
  return [...top].sort((a, b) => {
    const aReadable = Number(Boolean(a.title && a.title.length >= 6));
    const bReadable = Number(Boolean(b.title && b.title.length >= 6));
    const aCompany = Number(Boolean(a.company_name));
    const bCompany = Number(Boolean(b.company_name));
    return (bReadable - aReadable) ||
      (bCompany - aCompany) ||
      ((b.score + freshnessBonus(b)) - (a.score + freshnessBonus(a)));
  })[0] ?? null;
}

function freshnessBonus(job: SelectedJob): number {
  if (!job.freshness_ms) return 0;
  const ageDays = (Date.now() - job.freshness_ms) / 24 / 60 / 60 / 1000;
  if (ageDays <= 7) return 8;
  if (ageDays <= 21) return 3;
  return 0;
}

export function buildSubject(hero: SelectedJob | null, count: number): string {
  if (hero?.company_name && hero.title) {
    return `${hero.company_name} recrute ${hero.title} + ${count} offres pour toi`;
  }
  return `${count} offres sélectionnées pour toi sur JobRadar`;
}

export function buildPreheader(count: number, _minJobsToSend: number): string {
  const offerLabel = count === 1 ? "offre proche" : "offres proches";
  return `${count} ${offerLabel} de ton profil, selon tes critères JobRadar.`;
}

export function reasonForCount(params: {
  previewCount: number;
  sendEligibleCount: number;
  minPreview: number;
  minSend: number;
}) {
  if (params.previewCount < params.minPreview) return "not_enough_relevant_jobs";
  if (params.sendEligibleCount < params.minSend) return "below_real_send_threshold_preview_only";
  return "preview_only";
}

export function buildBlocks(jobs: SelectedJob[], criteria: Criteria, maxBlocks: number): DigestBlock[] {
  const candidates = [
    blockByRole(jobs, criteria),
    blockByCountry(jobs),
    blockByRemote(jobs),
    blockByContract(jobs),
    blockByDomain(jobs),
  ].filter((block): block is DigestBlock => Boolean(block));

  const seen = new Set<string>();
  return candidates
    .filter((block) => {
      if (seen.has(block.key) || block.count === 0) return false;
      seen.add(block.key);
      return true;
    })
    .slice(0, maxBlocks);
}

function blockSamples(jobs: SelectedJob[]) {
  return jobs.slice(0, 3).map((job) => ({
    id: job.id,
    title: job.title,
    company_name: job.company_name,
    country: job.country,
    location: job.location,
    score: job.score,
    url_available: job.url_available,
  }));
}

function ctaUrl(params: Record<string, string>) {
  const search = new URLSearchParams({ source: "email_digest", ...params });
  return `/jobradar/feed?${search.toString()}`;
}

function blockByRole(jobs: SelectedJob[], criteria: Criteria): DigestBlock | null {
  const role = criteria.desiredRole;
  const items = role
    ? jobs.filter((job) => normalizeText([job.title, job.job_family].filter(Boolean).join(" ")).includes(normalizeText(role)))
    : jobs.filter((job) => Boolean(job.job_family));
  if (!items.length) return null;
  const label = role || items[0].job_family || "Postes proches";
  return {
    key: "role",
    title: `Postes ${label}`,
    subtitle: "Offres regroupées par poste ou famille métier.",
    count: items.length,
    sample_jobs: blockSamples(items),
    cta_label: "Voir ces offres",
    cta_url: ctaUrl({ group: "role", q: label }),
  };
}

function blockByCountry(jobs: SelectedJob[]): DigestBlock | null {
  const counts = countBy(jobs, (job) => job.country || job.location || "");
  const [country] = topEntry(counts);
  if (!country) return null;
  const items = jobs.filter((job) => job.country === country || job.location === country);
  return {
    key: "country",
    title: `Offres en ${country}`,
    subtitle: "Sélection géographique issue des critères disponibles.",
    count: items.length,
    sample_jobs: blockSamples(items),
    cta_label: "Voir ces offres",
    cta_url: ctaUrl({ group: "country", country }),
  };
}

function blockByRemote(jobs: SelectedJob[]): DigestBlock | null {
  const items = jobs.filter((job) => normalizeText(job.remote_type ?? "").includes("remote"));
  if (!items.length) return null;
  return {
    key: "remote",
    title: "Remote et télétravail",
    subtitle: "Offres avec signal remote exploitable.",
    count: items.length,
    sample_jobs: blockSamples(items),
    cta_label: "Voir ces offres",
    cta_url: ctaUrl({ group: "remote", remote: "true" }),
  };
}

function blockByContract(jobs: SelectedJob[]): DigestBlock | null {
  const counts = countBy(jobs, (job) => job.contract_type || "");
  const [contract] = topEntry(counts);
  if (!contract) return null;
  const items = jobs.filter((job) => job.contract_type === contract);
  return {
    key: "contract",
    title: `Contrats ${contract}`,
    subtitle: "Offres regroupées par type de contrat.",
    count: items.length,
    sample_jobs: blockSamples(items),
    cta_label: "Voir ces offres",
    cta_url: ctaUrl({ group: "contract", contract }),
  };
}

function blockByDomain(jobs: SelectedJob[]): DigestBlock | null {
  const scored = jobs
    .map((job) => ({ job, domain: detectDomain(job) }))
    .filter((entry) => entry.domain);
  const counts = countBy(scored, (entry) => entry.domain ?? "");
  const [domain] = topEntry(counts);
  if (!domain) return null;
  const items = scored.filter((entry) => entry.domain === domain).map((entry) => entry.job);
  return {
    key: "domain",
    title: `Domaine ${domain}`,
    subtitle: "Regroupement approximatif par signaux métier.",
    count: items.length,
    sample_jobs: blockSamples(items),
    cta_label: "Voir ces offres",
    cta_url: ctaUrl({ group: "domain", domain }),
  };
}

function detectDomain(job: SelectedJob): string | null {
  const text = normalizeText([job.title, job.job_family, job.contract_type].filter(Boolean).join(" "));
  for (const [domain, terms] of Object.entries(DOMAIN_TERMS)) {
    if (terms.some((term) => text.includes(normalizeText(term)))) return domain;
  }
  return null;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = cleanString(keyFn(item));
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topEntry(counts: Map<string, number>): [string | null, number] {
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return sorted[0] ?? [null, 0];
}
