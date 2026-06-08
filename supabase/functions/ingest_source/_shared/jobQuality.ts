export const QUALITY_VERSION = "job_quality_v1";

export type JobQualityStatus = "active" | "needs_review" | "rejected";

export type JobQualityFlag =
  | "missing_title"
  | "missing_source_url"
  | "expired_at_birth"
  | "country_ambiguous"
  | "company_equals_title"
  | "company_missing"
  | "missing_description"
  | "description_too_short"
  | "missing_expires_at";

export type JobQualityInput = {
  title: string | null;
  company_name: string | null;
  company_name_source: string | null;
  description_text: string | null;
  source_url: string | null;
  expires_at: string | null;
  is_expired: boolean | null;
  country_classification: string | null;
};

export type JobQualityResult = {
  score: number;
  flags: JobQualityFlag[];
  status: JobQualityStatus;
  quality_version: typeof QUALITY_VERSION;
  checked_at: string;
  company_name_source: string | null;
};

function normalizedText(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hasText(value: string | null) {
  return normalizedText(value).length > 0;
}

export function computeJobQuality(input: JobQualityInput): JobQualityResult {
  const flags: JobQualityFlag[] = [];
  let score = 100;
  let status: JobQualityStatus = "active";

  if (!hasText(input.title)) flags.push("missing_title");
  if (!hasText(input.source_url)) flags.push("missing_source_url");
  if (input.is_expired === true) flags.push("expired_at_birth");

  const hasCriticalFlag = flags.some((flag) =>
    flag === "missing_title" ||
    flag === "missing_source_url" ||
    flag === "expired_at_birth"
  );

  if (hasCriticalFlag) {
    score = 0;
    status = "rejected";
  } else {
    if (
      input.country_classification !== "probable_ci" &&
      input.country_classification !== "CI"
    ) {
      flags.push("country_ambiguous");
      score = Math.min(score, 40);
    }

    if (
      hasText(input.title) &&
      hasText(input.company_name) &&
      normalizedText(input.title) === normalizedText(input.company_name)
    ) {
      flags.push("company_equals_title");
      score = Math.min(score, 50);
    }

    if (!hasText(input.company_name)) {
      flags.push("company_missing");
      score -= 15;
    }
    if (!hasText(input.description_text)) {
      flags.push("missing_description");
      score -= 20;
    } else if ((input.description_text ?? "").trim().length < 80) {
      flags.push("description_too_short");
      score -= 10;
    }
    if (!hasText(input.expires_at)) {
      flags.push("missing_expires_at");
      score -= 5;
    }

    score = Math.max(0, Math.min(100, score));

    if (
      flags.includes("country_ambiguous") ||
      flags.includes("company_equals_title") ||
      score < 60
    ) {
      status = "needs_review";
    }
  }

  return {
    score,
    flags,
    status,
    quality_version: QUALITY_VERSION,
    checked_at: new Date().toISOString(),
    company_name_source: input.company_name_source,
  };
}
