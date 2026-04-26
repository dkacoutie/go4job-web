import type { JobFamilyConfidence } from "./jobFamilyClassifier.ts";

export const JOB_FAMILY_CONTROLLED_WRITE_VERSION =
  "job_family_controlled_write_v2";

export const JOB_FAMILY_SOURCE_POLICY_VERSION = "job_family_source_policy_v2";

export const JOB_FAMILY_SOURCE_POLICY = "allow_by_default_unless_blocked";

export const JOB_FAMILY_WRITE_SAFE_CONFIDENCE: JobFamilyConfidence[] = [
  "high",
  "medium",
];

const DUPLICATE_SOURCE_SUFFIX = /(?:__dup_rss__[a-z0-9]+)+$/i;

export const JOB_FAMILY_BLOCKED_SOURCES = [
  "(unknown)",
] as const;

export const JOB_FAMILY_ALLOWED_SOURCES_FOR_CONTROLLED_WRITE = [
  "rss_remoteyeah_all",
  "jobicy_rss",
  "weworkremotely_all",
  "france_travail_api",
  "adzuna_api",
  "rss_nofluffjobs",
  "emploi_territorial_rss",
  "rss_vuejobs",
  "empllo_rss",
] as const;

export type JobFamilyBlockedSource =
  (typeof JOB_FAMILY_BLOCKED_SOURCES)[number];

export const JOB_FAMILY_BLOCKED_SOURCE_SET = new Set<string>(
  JOB_FAMILY_BLOCKED_SOURCES,
);

export function isWriteSafeConfidence(
  confidence: JobFamilyConfidence,
): boolean {
  return JOB_FAMILY_WRITE_SAFE_CONFIDENCE.includes(confidence);
}

export function normalizeJobFamilySourceCode(
  sourceCode: string | null,
): string {
  const trimmed = String(sourceCode ?? "").trim().toLowerCase();
  if (!trimmed) return "(unknown)";

  const normalized = trimmed.replace(DUPLICATE_SOURCE_SUFFIX, "").trim();
  return normalized || "(unknown)";
}

export function isBlockedJobFamilySource(sourceCode: string | null): boolean {
  return JOB_FAMILY_BLOCKED_SOURCE_SET.has(
    normalizeJobFamilySourceCode(sourceCode),
  );
}

export function getJobFamilySourcePolicy(sourceCode: string | null) {
  const rawSourceCode = String(sourceCode ?? "").trim() || null;
  const normalizedSourceCode = normalizeJobFamilySourceCode(sourceCode);

  return {
    raw_source_code: rawSourceCode,
    normalized_source_code: normalizedSourceCode,
    blocked_by_blocklist: JOB_FAMILY_BLOCKED_SOURCE_SET.has(
      normalizedSourceCode,
    ),
  };
}
