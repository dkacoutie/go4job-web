import { canonicalizeText } from "./taxonomy";

export type AlertLike = {
  name?: string | null;
  keywords?: string[] | null;
  country?: string | null;
  countries?: string[] | null;
};

export type JobLike = {
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;
  description?: string | null;
  tags?: string[] | null;
  job_skills?: string[] | null;
  required_skills?: string[] | null;
  optional_skills?: string[] | null;
  experience_years_min?: number | null;
  experience_years_max?: number | null;
};

export type CvExperience = { min: number | null; max: number | null } | null;

export type RemotePreference = "any" | "remote" | "hybrid" | "onsite";
export type GeoRemoteLevel = "strong" | "medium" | "none" | "unknown";

export type GeoPreferences = {
  allowAllCountries: boolean;
  allowedCountries: Set<string>;
  remotePreference: RemotePreference;
};

export type GeoRemoteBreakdown = {
  considered: boolean;
  country_match: boolean | null;
  remote_match: boolean | null;
  level: GeoRemoteLevel;
  points_awarded: number;
};

export type SkillsQualityBreakdown = {
  considered: boolean;
  matched_required_skills: string[];
  matched_optional_skills: string[];
  points_awarded: number;
};

export type MatchWhyDetails = {
  score: number;
  breakdown: {
    alert: {
      total_keywords: number;
      matched_keywords: string[];
      matched_count: number;
      effective_weight_sum: number;
      generic_keywords: string[];
    };
    cv: {
      total_keywords: number;
      matched_keywords: string[];
      matched_count: number;
      effective_weight_sum: number;
      generic_keywords: string[];
    };
    experience: {
      considered: boolean;
      cv_exp_value?: number | null;
      job_min?: number | null;
      job_max?: number | null;
      ok?: boolean;
      points_awarded?: number;
    };
    geo_remote: GeoRemoteBreakdown;
    skills_quality: SkillsQualityBreakdown;
    generic_keyword_adjustment: {
      applied: boolean;
      matched_generic_keywords: string[];
      impact_note?: string;
    };
  };
  debug?: {
    denom: number;
    weighted: number;
    thresholds?: { topMatch: number };
  };
};

export type MatchWhySummary = {
  alert: string[];
  cv: string[];
  restAlert: number;
  restCv: number;
  tags: string[];
  details: MatchWhyDetails;
};

export type MatchScoreResult = {
  score: number;
  s: number;
  kwCount: number;
  signalCount: number;
  expOk: boolean;
  expConsidered: boolean;
  geoRemote: GeoRemoteBreakdown;
  skillsQuality: SkillsQualityBreakdown;
  why: MatchWhySummary;
};

const WEIGHT_ALERT = 2;
const WEIGHT_ALERT_GENERIC = 1.25;
const WEIGHT_CV = 1;
const WEIGHT_CV_GENERIC = 0.5;
const WEIGHT_EXP = 2;
const WEIGHT_GEO_MAX = 2;
const WEIGHT_SKILLS_MAX = 2;

const GENERIC_KEYWORDS = new Set([
  "manager",
  "assistant",
  "charge",
  "chargee",
  "agent",
  "responsable",
  "projet",
  "project",
  "support",
  "administratif",
  "administration",
  "officer",
  "specialist",
  "coordinator",
  "analyst",
  "executive",
  "associate",
  "administrator",
  "consultant",
  "generalist",
]);

const REMOTE_TERMS = {
  remote: ["remote", "remotely", "teletravail", "telework", "work from home", "wfh", "distance"],
  hybrid: ["hybrid", "hybride", "flex"],
  onsite: ["on-site", "onsite", "on site", "office", "presentiel", "presential", "in office"],
};

function norm(s: string) {
  return (s ?? "").toLowerCase().trim();
}

function normalizeText(input: string) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeKeyword(input: string) {
  return norm(canonicalizeText(input ?? ""));
}

function normalizeLoose(input: string) {
  return normalizeText(canonicalizeText(input ?? ""));
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function sum(nums: number[]) {
  return nums.reduce((acc, v) => acc + v, 0);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((t) => text.includes(t));
}

function pickRemotePreference(scores: { remote: number; hybrid: number; onsite: number }): RemotePreference {
  const max = Math.max(scores.remote, scores.hybrid, scores.onsite);
  if (!max) return "any";
  const picks = Object.entries(scores)
    .filter(([, v]) => v === max)
    .map(([k]) => k as RemotePreference);
  if (picks.length !== 1) return "any";
  return picks[0];
}

export function buildGeoPreferences(alerts: AlertLike[]): GeoPreferences {
  if (!alerts?.length) {
    return { allowAllCountries: true, allowedCountries: new Set<string>(), remotePreference: "any" };
  }

  let allowAll = false;
  const set = new Set<string>();
  const remoteScores = { remote: 0, hybrid: 0, onsite: 0 };

  for (const a of alerts) {
    const list = (a.countries && a.countries.length ? a.countries : a.country ? [a.country] : [])
      .map((x) => (x ?? "").trim().toUpperCase())
      .filter(Boolean);

    if (!list.length) {
      allowAll = true;
    } else {
      for (const c of list) set.add(c);
    }

    const text = normalizeLoose([a.name, ...(a.keywords ?? [])].filter(Boolean).join(" "));
    if (text) {
      if (hasAny(text, REMOTE_TERMS.remote)) remoteScores.remote += 1;
      if (hasAny(text, REMOTE_TERMS.hybrid)) remoteScores.hybrid += 1;
      if (hasAny(text, REMOTE_TERMS.onsite)) remoteScores.onsite += 1;
    }
  }

  if (set.size === 0) allowAll = true;

  return {
    allowAllCountries: allowAll,
    allowedCountries: set,
    remotePreference: pickRemotePreference(remoteScores),
  };
}

function classifyJobRemoteType(job: JobLike): RemotePreference | null {
  const text = normalizeLoose([job.remote_type, job.location].filter(Boolean).join(" "));
  if (!text) return null;
  if (hasAny(text, REMOTE_TERMS.remote)) return "remote";
  if (hasAny(text, REMOTE_TERMS.hybrid)) return "hybrid";
  if (hasAny(text, REMOTE_TERMS.onsite)) return "onsite";
  return null;
}

export function buildJobHay(job: JobLike): string {
  return canonicalizeText(
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
}

function isGenericKeyword(input: string) {
  const base = normalizeLoose(input);
  if (!base) return false;
  if (GENERIC_KEYWORDS.has(base)) return true;
  const parts = base.split(/\s+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => GENERIC_KEYWORDS.has(p));
}

function computeGeoRemote(job: JobLike, geoPrefs: GeoPreferences): GeoRemoteBreakdown {
  const jobCountry = (job.country ?? "").trim().toUpperCase();
  let countryMatch: boolean | null = null;

  if (jobCountry && jobCountry.length === 2) {
    countryMatch = geoPrefs.allowAllCountries ? true : geoPrefs.allowedCountries.has(jobCountry);
  }

  const jobRemote = classifyJobRemoteType(job);
  let remoteMatch: boolean | null = null;
  if (geoPrefs.remotePreference !== "any" && jobRemote) {
    if (geoPrefs.remotePreference === "remote") {
      remoteMatch = jobRemote === "remote" || jobRemote === "hybrid";
    } else if (geoPrefs.remotePreference === "hybrid") {
      remoteMatch = jobRemote === "hybrid";
    } else {
      remoteMatch = jobRemote === "onsite";
    }
  }

  const considered = countryMatch !== null || remoteMatch !== null;
  if (!considered) {
    return {
      considered: false,
      country_match: null,
      remote_match: null,
      level: "unknown",
      points_awarded: 0,
    };
  }

  let points = 0;
  let level: GeoRemoteLevel = "none";

  if (countryMatch === true && remoteMatch !== false) {
    points = 2;
    level = "strong";
  } else if (remoteMatch === true || countryMatch === true) {
    points = 1;
    level = "medium";
  } else {
    points = 0;
    level = "none";
  }

  return {
    considered: true,
    country_match: countryMatch,
    remote_match: remoteMatch,
    level,
    points_awarded: points,
  };
}

function computeSkillsQuality(job: JobLike, matchedKeywords: string[]): SkillsQualityBreakdown {
  const requiredSet = new Set((job.required_skills ?? []).map(normalizeKeyword).filter(Boolean));
  const optionalSet = new Set(
    [...(job.optional_skills ?? []), ...(job.job_skills ?? []), ...(job.tags ?? [])]
      .map(normalizeKeyword)
      .filter(Boolean)
  );

  const considered = requiredSet.size > 0 || optionalSet.size > 0;
  if (!considered) {
    return {
      considered: false,
      matched_required_skills: [],
      matched_optional_skills: [],
      points_awarded: 0,
    };
  }

  const matchedRequired: string[] = [];
  const matchedOptional: string[] = [];

  for (const kw of matchedKeywords) {
    if (requiredSet.has(kw)) matchedRequired.push(kw);
    else if (optionalSet.has(kw)) matchedOptional.push(kw);
  }

  const requiredUniq = uniq(matchedRequired);
  const optionalUniq = uniq(matchedOptional);

  let points = 0;
  if (requiredUniq.length >= 3) points = 2;
  else if (requiredUniq.length >= 1) points = 1;
  else if (optionalUniq.length >= 1) points = 0.5;

  return {
    considered: true,
    matched_required_skills: requiredUniq,
    matched_optional_skills: optionalUniq,
    points_awarded: points,
  };
}

export function computeJobMatchScore(params: {
  job: JobLike;
  alertKeywords: string[];
  cvKeywords: string[];
  cvExp: CvExperience;
  geoPrefs: GeoPreferences;
  hay?: string;
  maxShown?: number;
  topMatchThreshold?: number;
}): MatchScoreResult {
  const {
    job,
    alertKeywords,
    cvKeywords,
    cvExp,
    geoPrefs,
    hay = buildJobHay(job),
    maxShown = 2,
    topMatchThreshold = 70,
  } = params;

  const matchedAlert: string[] = [];
  const matchedCvRaw: string[] = [];
  const matchedAlertGeneric: string[] = [];
  const matchedCvGeneric: string[] = [];
  let weightedAlert = 0;
  let weightedCv = 0;

  for (const k of alertKeywords) {
    if (k && hay.includes(k)) {
      matchedAlert.push(k);
      const generic = isGenericKeyword(k);
      if (generic) matchedAlertGeneric.push(k);
      weightedAlert += generic ? WEIGHT_ALERT_GENERIC : WEIGHT_ALERT;
    }
  }

  for (const k of cvKeywords) {
    if (k && hay.includes(k)) {
      matchedCvRaw.push(k);
      const generic = isGenericKeyword(k);
      if (generic) matchedCvGeneric.push(k);
      weightedCv += generic ? WEIGHT_CV_GENERIC : WEIGHT_CV;
    }
  }

  const matchedCvDisplay = matchedCvRaw.filter((k) => !matchedAlert.includes(k));
  const shownAlert = matchedAlert.slice(0, maxShown);
  const shownCv = matchedCvDisplay.slice(0, maxShown);

  const restAlert = Math.max(0, matchedAlert.length - shownAlert.length);
  const restCv = Math.max(0, matchedCvDisplay.length - shownCv.length);

  const matchedAll = uniq([...matchedAlert, ...matchedCvRaw]);
  const skillsQuality = computeSkillsQuality(job, matchedAll);
  const geoRemote = computeGeoRemote(job, geoPrefs);

  const cvExpValue = cvExp?.max ?? cvExp?.min ?? null;
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
      if (jobMin != null) expReason = `Exp >= ${jobMin} ans`;
      else if (jobMax != null) expReason = `Exp <= ${jobMax} ans`;
      else expReason = `Exp ${cvExpValue} ans`;
    }
  }

  const alertDenom = sum(alertKeywords.map((k) => (isGenericKeyword(k) ? WEIGHT_ALERT_GENERIC : WEIGHT_ALERT)));
  const cvDenom = sum(cvKeywords.map((k) => (isGenericKeyword(k) ? WEIGHT_CV_GENERIC : WEIGHT_CV)));
  const denom =
    alertDenom +
    cvDenom +
    (expConsidered ? WEIGHT_EXP : 0) +
    (geoRemote.considered ? WEIGHT_GEO_MAX : 0) +
    (skillsQuality.considered ? WEIGHT_SKILLS_MAX : 0);

  const weighted =
    weightedAlert +
    weightedCv +
    (expOk ? WEIGHT_EXP : 0) +
    geoRemote.points_awarded +
    skillsQuality.points_awarded;

  const score = denom ? Math.round((weighted / denom) * 100) : 0;
  const kwCount = alertKeywords.length + cvKeywords.length;
  const signalCount =
    kwCount + (expConsidered ? 1 : 0) + (geoRemote.considered ? 1 : 0) + (skillsQuality.considered ? 1 : 0);
  const s = matchedAlert.length + matchedCvRaw.length;

  const genericMatched = uniq([...matchedAlertGeneric, ...matchedCvGeneric]);
  const tags: string[] = [];
  if (expOk && expReason) tags.push(expReason);
  if (geoRemote.considered && geoRemote.points_awarded > 0) tags.push("Geo/remote ok");
  if (skillsQuality.points_awarded > 0) {
    tags.push(skillsQuality.matched_required_skills.length ? "Competences requises detectees" : "Competences detectees");
  }
  if (genericMatched.length > 0) tags.push("Mots-cles generiques ponderees");

  const whyDetails: MatchWhyDetails = {
    score,
    breakdown: {
      alert: {
        total_keywords: alertKeywords.length,
        matched_keywords: matchedAlert,
        matched_count: matchedAlert.length,
        effective_weight_sum: weightedAlert,
        generic_keywords: matchedAlertGeneric,
      },
      cv: {
        total_keywords: cvKeywords.length,
        matched_keywords: matchedCvRaw,
        matched_count: matchedCvRaw.length,
        effective_weight_sum: weightedCv,
        generic_keywords: matchedCvGeneric,
      },
      experience: {
        considered: expConsidered,
        cv_exp_value: cvExpValue,
        job_min: jobMin,
        job_max: jobMax,
        ok: expOk,
        points_awarded: expOk ? WEIGHT_EXP : 0,
      },
      geo_remote: geoRemote,
      skills_quality: skillsQuality,
      generic_keyword_adjustment: {
        applied: genericMatched.length > 0,
        matched_generic_keywords: genericMatched,
        impact_note: genericMatched.length
          ? `Generic weights: alert ${WEIGHT_ALERT}=>${WEIGHT_ALERT_GENERIC}, cv ${WEIGHT_CV}=>${WEIGHT_CV_GENERIC}`
          : undefined,
      },
    },
    debug: {
      denom,
      weighted,
      thresholds: { topMatch: topMatchThreshold },
    },
  };

  const why: MatchWhySummary = {
    alert: shownAlert,
    cv: shownCv,
    restAlert,
    restCv,
    tags,
    details: whyDetails,
  };

  return {
    score,
    s,
    kwCount,
    signalCount,
    expOk,
    expConsidered,
    geoRemote,
    skillsQuality,
    why,
  };
}

export function formatMatchWhyTooltip(details: MatchWhyDetails): string {
  const parts = [`Score ${details.score}%`];
  const exp = details.breakdown.experience;
  if (exp.considered) parts.push(exp.ok ? "Exp ok" : "Exp off");
  const geo = details.breakdown.geo_remote;
  if (geo.considered) parts.push(`Geo ${geo.level}`);
  const skills = details.breakdown.skills_quality;
  if (skills.considered) parts.push(`Skills +${skills.points_awarded ?? 0}`);
  if (details.breakdown.generic_keyword_adjustment.applied) parts.push("Generic downweight");
  return parts.join(" | ");
}
