import type {
  DataQualityBreakdown,
  GeoRemoteBreakdown,
  MatchWhySummary,
  SkillsQualityBreakdown,
} from "./jobMatching";
import type {
  JobRadarShadowBreakdown,
  JobRadarShadowBucketName,
  JobRadarShadowInvokeResponse,
  JobRadarShadowJob,
  JobRadarShadowMeta,
  JobRadarShadowScoredCandidate,
} from "./jobradarShadowFeed";

export type ShadowFeedJobRow = {
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

export type ShadowFeedMatchRow = {
  job: ShadowFeedJobRow;
  s: number;
  p: number;
  kwCount: number;
  signalCount: number;
  expOk: boolean;
  geoRemote: GeoRemoteBreakdown;
  skillsQuality: SkillsQualityBreakdown;
  dataQuality: DataQualityBreakdown;
  why: MatchWhySummary;
  shadow: {
    bucket: JobRadarShadowBucketName;
    summary: string | null;
    warnings: string[];
    candidate_paths: string[];
    breakdown: JobRadarShadowBreakdown;
  };
};

export type ShadowFeedUiBuckets = Record<JobRadarShadowBucketName, ShadowFeedMatchRow[]>;

export type ShadowFeedUiState = {
  meta: JobRadarShadowMeta;
  buckets: ShadowFeedUiBuckets;
  raw: JobRadarShadowInvokeResponse;
};

export type ShadowFeedBucketComparison = {
  local_count: number;
  shadow_count: number;
  overlap_count: number;
  local_only_count: number;
  shadow_only_count: number;
  overlap_ids: string[];
  local_top_ids: string[];
  shadow_top_ids: string[];
};

export type ShadowFeedComparison = {
  local_source: "local";
  shadow_source: "shadow_backend";
  buckets: Record<JobRadarShadowBucketName, ShadowFeedBucketComparison>;
  totals: {
    unique_local_ids: number;
    unique_shadow_ids: number;
    overlap_ids: number;
  };
};

type MinimalMatchRow = {
  job: { id: string };
};

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toJobRow(job: JobRadarShadowJob): ShadowFeedJobRow {
  return {
    id: job.id,
    title: job.title ?? null,
    company_name: job.company_name ?? null,
    location: job.location ?? null,
    country: job.country ?? null,
    remote_type: job.remote_type ?? null,
    job_family: job.job_family ?? null,
    sort_at: job.published_at ?? job.posted_at ?? job.scraped_at ?? job.updated_at ?? job.created_at ?? null,
    published_at: job.published_at ?? null,
    posted_at: job.posted_at ?? null,
    scraped_at: job.scraped_at ?? null,
    created_at: job.created_at ?? null,
    updated_at: job.updated_at ?? null,
    description: job.official_desc ?? job.description_text ?? null,
    tags: Array.isArray(job.tags) ? job.tags : null,
    job_skills: job.job_skills ?? null,
    required_skills: job.required_skills ?? null,
    optional_skills: job.optional_skills ?? null,
    experience_years_min: job.experience_years_min ?? null,
    experience_years_max: job.experience_years_max ?? null,
  };
}

function buildGeoRemote(breakdown: JobRadarShadowBreakdown): GeoRemoteBreakdown {
  const geoPoints = breakdown.geo ?? 0;
  const explicitMismatch = breakdown.flags?.explicit_geo_mismatch === true;

  let level: GeoRemoteBreakdown["level"] = "unknown";
  if (geoPoints >= 6) level = "strong";
  else if (geoPoints > 0) level = "medium";
  else if (explicitMismatch) level = "none";

  return {
    considered: geoPoints !== 0 || explicitMismatch,
    country_match: geoPoints > 0 ? true : explicitMismatch ? false : null,
    remote_match: null,
    level,
    points_awarded: Math.max(0, geoPoints),
  };
}

function buildSkillsQuality(breakdown: JobRadarShadowBreakdown): SkillsQualityBreakdown {
  const matchedRequired = breakdown.matched_required_skills ?? [];
  const matchedOptional = breakdown.matched_optional_skills ?? [];
  const skillsPoints = breakdown.skills ?? 0;

  return {
    considered: matchedRequired.length > 0 || matchedOptional.length > 0 || skillsPoints !== 0,
    matched_required_skills: matchedRequired,
    matched_optional_skills: matchedOptional,
    points_awarded: Math.max(0, skillsPoints),
  };
}

function buildDataQuality(job: JobRadarShadowJob, breakdown: JobRadarShadowBreakdown): DataQualityBreakdown {
  const score = Number(breakdown.data_quality ?? 0);
  const description = (job.official_desc ?? job.description_text ?? "").trim();
  const hasSkills =
    (job.job_skills?.length ?? 0) > 0 ||
    (job.required_skills?.length ?? 0) > 0 ||
    (job.optional_skills?.length ?? 0) > 0;

  return {
    score,
    level: score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low",
    desc_len: description.length,
    job_is_sparse: breakdown.flags?.job_non_enriched === true || score < 0.45,
    has_tags: Array.isArray(job.tags) ? job.tags.length > 0 : Boolean(job.tags),
    has_skills: hasSkills,
    has_location: Boolean((job.location ?? "").trim() || (job.country ?? "").trim()),
    has_title: Boolean((job.title ?? "").trim()),
    has_remote: Boolean((job.remote_type ?? "").trim()),
  };
}

function buildWhy(
  candidate: JobRadarShadowScoredCandidate,
  bucket: JobRadarShadowBucketName,
  geoRemote: GeoRemoteBreakdown,
  skillsQuality: SkillsQualityBreakdown,
  dataQuality: DataQualityBreakdown,
): MatchWhySummary {
  const explanation = candidate.explanation;
  const breakdown = candidate.breakdown ?? explanation?.breakdown ?? {};
  const matchedAlert = breakdown.matched_alert_keywords ?? [];
  const matchedCv = uniq([
    ...(breakdown.matched_required_skills ?? []),
    ...(breakdown.matched_optional_skills ?? []),
  ]);
  const expOk = (breakdown.experience ?? 0) > 0;
  const roleRelation = breakdown.role_relation ?? "unknown";
  const profileFamily = breakdown.profile_family ?? null;
  const jobFamily = breakdown.job_family_detected ?? candidate.job.job_family ?? null;
  const titlePoints = (breakdown.title_role ?? 0) + (breakdown.title_fallback ?? 0);

  return {
    alert: matchedAlert.slice(0, 5),
    cv: matchedCv.slice(0, 5),
    restAlert: Math.max(0, matchedAlert.length - 5),
    restCv: Math.max(0, matchedCv.length - 5),
    tags: uniq([
      roleRelation === "match" && jobFamily ? `Famille metier: ${jobFamily}` : "",
      skillsQuality.points_awarded > 0 ? "Competences detectees" : "",
      geoRemote.points_awarded > 0 ? "Geo/remote ok" : "",
      bucket === "top_match" ? "Top match shadow" : "",
    ]).slice(0, 5),
    reasons: (explanation?.reasons ?? []).slice(0, 6),
    missing: (explanation?.warnings ?? []).slice(0, 4),
    details: {
      score: candidate.score,
      breakdown: {
        alert: {
          total_keywords: matchedAlert.length,
          matched_keywords: matchedAlert,
          matched_count: matchedAlert.length,
          effective_weight_sum: Math.max(0, breakdown.alert ?? 0),
          generic_keywords: [],
        },
        cv: {
          total_keywords: matchedCv.length,
          matched_keywords: matchedCv,
          matched_count: matchedCv.length,
          effective_weight_sum: Math.max(0, breakdown.skills ?? 0),
          generic_keywords: [],
        },
        experience: {
          considered: (breakdown.experience ?? 0) !== 0,
          ok: expOk,
          points_awarded: Math.max(0, breakdown.experience ?? 0),
        },
        geo_remote: geoRemote,
        skills_quality: skillsQuality,
        generic_keyword_adjustment: {
          applied: false,
          matched_generic_keywords: [],
        },
        role_family: {
          profile_family: profileFamily,
          profile_label: profileFamily,
          profile_confidence: profileFamily ? "weak" : "none",
          profile_contenders: [],
          profile_scores: {},
          profile_evidence: [],
          job_family: jobFamily,
          job_label: jobFamily,
          job_confidence: jobFamily ? "weak" : "none",
          job_contenders: [],
          job_scores: {},
          job_evidence: [],
          relation: roleRelation === "adjacent" ? "unknown" : roleRelation,
          gated: false,
          cap_applied: null,
        },
        data_quality: dataQuality,
        domain: {
          profile_domains: [],
          job_domain: null,
          profile_scores: {},
          job_scores: {},
          strong_mismatch: false,
          evidence_count: breakdown.evidence_count ?? 0,
          passes_evidence: (breakdown.evidence_count ?? 0) >= 2,
        },
        score_layers: {
          title: Math.max(0, titlePoints),
          meta: Math.max(0, (breakdown.meta ?? 0) + (breakdown.alert ?? 0)),
          desc: 0,
          combined: breakdown.total ?? candidate.score,
          cap_applied: (breakdown.caps ?? []).join("|") || null,
        },
      },
      debug: {
        denom: 0,
        weighted: 0,
        score_title: Math.max(0, titlePoints),
        score_meta: Math.max(0, (breakdown.meta ?? 0) + (breakdown.alert ?? 0)),
        score_desc: 0,
        data_quality: Math.round(dataQuality.score * 100),
        score_simple: candidate.score,
        score_advanced: candidate.score,
      },
    },
  };
}

function adaptCandidate(candidate: JobRadarShadowScoredCandidate, bucket: JobRadarShadowBucketName): ShadowFeedMatchRow {
  const breakdown = candidate.breakdown ?? candidate.explanation?.breakdown ?? {};
  const job = toJobRow(candidate.job);
  const geoRemote = buildGeoRemote(breakdown);
  const skillsQuality = buildSkillsQuality(breakdown);
  const dataQuality = buildDataQuality(candidate.job, breakdown);
  const why = buildWhy(candidate, bucket, geoRemote, skillsQuality, dataQuality);

  return {
    job,
    s: breakdown.evidence_count ?? 0,
    p: candidate.score,
    kwCount: (breakdown.matched_alert_keywords?.length ?? 0) +
      (breakdown.matched_required_skills?.length ?? 0) +
      (breakdown.matched_optional_skills?.length ?? 0),
    signalCount: breakdown.evidence_count ?? 0,
    expOk: (breakdown.experience ?? 0) > 0,
    geoRemote,
    skillsQuality,
    dataQuality,
    why,
    shadow: {
      bucket,
      summary: candidate.explanation?.summary ?? null,
      warnings: candidate.explanation?.warnings ?? [],
      candidate_paths: candidate.candidate_paths ?? breakdown.candidate_paths ?? [],
      breakdown,
    },
  };
}

export function adaptJobRadarShadowResponse(response: JobRadarShadowInvokeResponse): ShadowFeedUiState {
  if (!response.ok || !response.profile_mode || !response.primary_surface_strategy) {
    throw new Error("Reponse shadow incomplete");
  }

  return {
    meta: {
      profile_mode: response.profile_mode,
      primary_surface_strategy: response.primary_surface_strategy,
      fallback_reason: response.fallback_reason ?? null,
    },
    buckets: {
      top_match: (response.top_match ?? []).map((item) => adaptCandidate(item, "top_match")),
      for_you: (response.for_you ?? []).map((item) => adaptCandidate(item, "for_you")),
      explore: (response.explore ?? []).map((item) => adaptCandidate(item, "explore")),
    },
    raw: response,
  };
}

function compareBucket(localRows: MinimalMatchRow[], shadowRows: MinimalMatchRow[]): ShadowFeedBucketComparison {
  const localIds = uniq(localRows.map((row) => row.job.id));
  const shadowIds = uniq(shadowRows.map((row) => row.job.id));
  const shadowSet = new Set(shadowIds);
  const localSet = new Set(localIds);
  const overlapIds = localIds.filter((id) => shadowSet.has(id));

  return {
    local_count: localIds.length,
    shadow_count: shadowIds.length,
    overlap_count: overlapIds.length,
    local_only_count: localIds.filter((id) => !shadowSet.has(id)).length,
    shadow_only_count: shadowIds.filter((id) => !localSet.has(id)).length,
    overlap_ids: overlapIds.slice(0, 12),
    local_top_ids: localIds.slice(0, 12),
    shadow_top_ids: shadowIds.slice(0, 12),
  };
}

export function compareShadowAndLocalBuckets(
  localBuckets: Record<JobRadarShadowBucketName, MinimalMatchRow[]>,
  shadowBuckets: Record<JobRadarShadowBucketName, MinimalMatchRow[]>,
): ShadowFeedComparison {
  const localAllIds = uniq([
    ...localBuckets.top_match.map((row) => row.job.id),
    ...localBuckets.for_you.map((row) => row.job.id),
    ...localBuckets.explore.map((row) => row.job.id),
  ]);
  const shadowAllIds = uniq([
    ...shadowBuckets.top_match.map((row) => row.job.id),
    ...shadowBuckets.for_you.map((row) => row.job.id),
    ...shadowBuckets.explore.map((row) => row.job.id),
  ]);
  const shadowAllSet = new Set(shadowAllIds);

  return {
    local_source: "local",
    shadow_source: "shadow_backend",
    buckets: {
      top_match: compareBucket(localBuckets.top_match, shadowBuckets.top_match),
      for_you: compareBucket(localBuckets.for_you, shadowBuckets.for_you),
      explore: compareBucket(localBuckets.explore, shadowBuckets.explore),
    },
    totals: {
      unique_local_ids: localAllIds.length,
      unique_shadow_ids: shadowAllIds.length,
      overlap_ids: localAllIds.filter((id) => shadowAllSet.has(id)).length,
    },
  };
}
