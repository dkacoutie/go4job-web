import { createClient } from "npm:@supabase/supabase-js@2.88.0";

import {
  type JobFamilyClassification,
  type JobFamilyConfidence,
} from "../shared/jobradar/jobFamilyClassifier.ts";
import {
  classifyJobFamilyForControlledWrite,
  JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
} from "../shared/jobradar/jobFamilyControlledClassifier.ts";
import { getJobFamilySourcePolicy } from "../shared/jobradar/jobFamilyControlledWriteConfig.ts";
import {
  findJobFamilyByAlias,
  getJobFamilyDefinition,
  JOB_FAMILY_TAXONOMY_VERSION,
  type JobFamilyKey,
  normalizeTaxonomyText,
} from "../shared/jobradar/jobFamilyTaxonomy.ts";

type JobRow = {
  id: string;
  job_source_id: string | null;
  source_code?: string | null;
  title: string | null;
  company_name: string | null;
  job_family: string | null;
  required_skills: string[] | null;
  optional_skills: string[] | null;
  job_skills: string[] | null;
  tags: string[] | string | null;
  official_desc: string | null;
  description_text: string | null;
  job_json?: Record<string, unknown> | null;
};

type JobSourceRow = {
  id: string;
  code: string | null;
};

type DryRunRow = {
  job_id: string;
  title: string | null;
  source_code: string | null;
  company_name: string | null;
  legacy_job_family: string | null;
  baseline_status: "blank" | "mapped" | "unmapped";
  classification: JobFamilyClassification;
};

type FamilySummary = {
  family_key: JobFamilyKey;
  family_label: string;
  count: number;
  pct_of_total: number;
  avg_score: number;
  avg_margin: number;
  high: number;
  medium: number;
  low: number;
};

type SourceSummary = {
  source_code: string;
  total_tested: number;
  would_write_count: number;
  classified_high: number;
  classified_medium: number;
  classified_low: number;
  ambiguous: number;
  uncategorized: number;
  distribution_by_proposed_job_family: Record<string, number>;
  distribution_by_rule_id: Record<string, number>;
};

type ConfidenceThreshold = "high" | "medium" | "low";

type DryRunDecisionRow = {
  job_id: string;
  source_code: string | null;
  title: string | null;
  company_name: string | null;
  previous_job_family: string | null;
  proposed_job_family: string;
  decision: string;
  confidence: JobFamilyConfidence;
  rule_id: string;
  rule_source: string;
  matched_value: string;
  score: number;
  margin: number;
  would_write: boolean;
};

type AggregateMetrics = {
  total_tested: number;
  classified_high: number;
  classified_medium: number;
  classified_low: number;
  would_write_count: number;
  uncategorized_count: number;
  ambiguous_count: number;
  distribution_by_proposed_job_family: Record<string, number>;
  distribution_by_rule_id: Record<string, number>;
};

type ReportShape = {
  generated_at: string;
  min_confidence: ConfidenceThreshold;
  cohort: {
    description: string;
    total_jobs: number;
    limit_applied: number | null;
  };
  versions: {
    taxonomy: string;
    classifier: string;
  };
  baseline: {
    blank: number;
    mapped: number;
    unmapped: number;
    raw_uncategorized_rate: number;
  };
  outcomes: {
    classified: number;
    ambiguous: number;
    uncategorized: number;
    classified_rate: number;
    ambiguous_rate: number;
    uncategorized_rate: number;
  };
  metrics: AggregateMetrics;
  metrics_by_source: Record<string, SourceSummary>;
  quality: {
    top_uncategorized_titles: Array<Record<string, unknown>>;
    top_matched_values_by_rule_id: Array<Record<string, unknown>>;
    sample_by_category: Array<Record<string, unknown>>;
    alerts: string[];
  };
  jobs: DryRunDecisionRow[];
  confidence_breakdown: Record<string, number>;
  source_summary: SourceSummary[];
  family_summary: FamilySummary[];
  examples_by_category: Array<Record<string, unknown>>;
  top_ambiguities: Array<Record<string, unknown>>;
  top_uncategorized_titles: Array<Record<string, unknown>>;
  top_uncategorized_jobs: Array<Record<string, unknown>>;
};

function parseArgs() {
  const parsed = new Map<string, string>();
  for (const arg of Deno.args) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=", 2);
    parsed.set(key, value);
  }
  const minConfidence = parsed.get("min-confidence") ?? "medium";
  if (!["high", "medium", "low"].includes(minConfidence)) {
    throw new Error(
      "Invalid --min-confidence. Expected one of: high, medium, low.",
    );
  }
  return {
    limit: parsed.has("limit") ? Number(parsed.get("limit")) : null,
    input_json: parsed.get("input-json") ?? null,
    min_confidence: minConfidence as ConfidenceThreshold,
    output_dir: parsed.get("output-dir") ??
      ".codex-artifacts/job-family-dry-run",
    top: parsed.has("top") ? Number(parsed.get("top")) : 25,
  };
}

async function readDotEnvValue(key: string): Promise<string | null> {
  try {
    const content = await Deno.readTextFile(".env");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [left, ...rest] = trimmed.split("=");
      if (left.trim() !== key) continue;
      return rest.join("=").trim();
    }
  } catch {
    // ignore
  }
  return null;
}

async function getEnvValue(key: string): Promise<string> {
  const fromEnv = Deno.env.get(key)?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = await readDotEnvValue(key);
  if (fromFile) return fromFile;
  throw new Error(`Missing environment variable ${key}`);
}

function toPct(part: number, total: number): number {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function confidenceRank(confidence: JobFamilyConfidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  if (confidence === "low") return 1;
  return 0;
}

function meetsMinConfidence(
  confidence: JobFamilyConfidence,
  minConfidence: ConfidenceThreshold,
): boolean {
  return confidenceRank(confidence) >= confidenceRank(minConfidence);
}

async function fetchVisibleFeedJobs(
  supabaseUrl: string,
  serviceRoleKey: string,
  limit: number | null,
): Promise<JobRow[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const pageSize = 500;
  const rows: JobRow[] = [];
  let from = 0;

  while (true) {
    const to = limit == null
      ? from + pageSize - 1
      : Math.min(from + pageSize - 1, limit - 1);
    if (limit != null && from >= limit) break;

    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, job_source_id, title, company_name, job_family, required_skills, optional_skills, job_skills, tags, official_desc, description_text, job_json",
      )
      .eq("is_active", true)
      .eq("is_expired", false)
      .or("quality_status.eq.ok,quality_status.is.null")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;
    const batch = (data ?? []) as JobRow[];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows.slice(0, limit ?? rows.length);
}

async function readLocalJobs(
  inputJson: string,
  limit: number | null,
): Promise<JobRow[]> {
  const parsed = JSON.parse(await Deno.readTextFile(inputJson)) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { rows?: unknown }).rows)
    ? (parsed as { rows: unknown[] }).rows
    : Array.isArray((parsed as { jobs?: unknown }).jobs)
    ? (parsed as { jobs: unknown[] }).jobs
    : null;

  if (!rows) {
    throw new Error(
      "Invalid --input-json: expected an array, or an object with rows/jobs array.",
    );
  }

  return (rows as JobRow[]).slice(0, limit ?? rows.length);
}

async function fetchSourceCodes(
  supabaseUrl: string,
  serviceRoleKey: string,
  sourceIds: string[],
): Promise<Map<string, JobSourceRow>> {
  const uniqueSourceIds = Array.from(new Set(sourceIds.filter(Boolean)));
  const map = new Map<string, JobSourceRow>();
  if (uniqueSourceIds.length === 0) return map;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.from("job_sources").select("id, code")
    .in("id", uniqueSourceIds);
  if (error) throw error;

  for (const row of (data ?? []) as JobSourceRow[]) {
    map.set(row.id, row);
  }

  return map;
}

function buildDryRunRows(
  jobs: JobRow[],
  sourceMap: Map<string, JobSourceRow>,
): DryRunRow[] {
  return jobs.map((job) => {
    const source_code = job.source_code ??
      (job.job_source_id
        ? sourceMap.get(job.job_source_id)?.code ?? null
        : null);
    const sourcePolicy = getJobFamilySourcePolicy(source_code);
    const mappedLegacy = findJobFamilyByAlias(job.job_family);
    const baseline_status: DryRunRow["baseline_status"] =
      !job.job_family?.trim() ? "blank" : mappedLegacy ? "mapped" : "unmapped";

    return {
      job_id: job.id,
      title: job.title,
      source_code,
      company_name: job.company_name,
      legacy_job_family: job.job_family,
      baseline_status,
      classification: classifyJobFamilyForControlledWrite({
        title: job.title,
        job_family: job.job_family,
        required_skills: job.required_skills,
        optional_skills: job.optional_skills,
        job_skills: job.job_skills,
        tags: job.tags,
        official_desc: job.official_desc,
        description: job.description_text,
        company_name: job.company_name,
        source_code: sourcePolicy.normalized_source_code,
        job_json: job.job_json ?? null,
      }),
    };
  });
}

function buildFamilySummary(rows: DryRunRow[]): FamilySummary[] {
  const total = rows.length;
  const grouped = new Map<JobFamilyKey, DryRunRow[]>();

  for (const row of rows) {
    if (row.classification.decision !== "classified") continue;
    const bucket = grouped.get(row.classification.family_key) ?? [];
    bucket.push(row);
    grouped.set(row.classification.family_key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([family_key, familyRows]) => {
      const avg_score = Number(
        (familyRows.reduce((sum, row) => sum + row.classification.score, 0) /
          familyRows.length).toFixed(2),
      );
      const avg_margin = Number(
        (familyRows.reduce((sum, row) => sum + row.classification.margin, 0) /
          familyRows.length).toFixed(2),
      );
      return {
        family_key,
        family_label: getJobFamilyDefinition(family_key).label,
        count: familyRows.length,
        pct_of_total: toPct(familyRows.length, total),
        avg_score,
        avg_margin,
        high: familyRows.filter((row) =>
          row.classification.confidence === "high"
        ).length,
        medium: familyRows.filter((row) =>
          row.classification.confidence === "medium"
        ).length,
        low: familyRows.filter((row) =>
          row.classification.confidence === "low"
        ).length,
      } satisfies FamilySummary;
    })
    .sort((left, right) =>
      right.count - left.count || right.avg_score - left.avg_score
    );
}

function buildConfidenceBreakdown(rows: DryRunRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification.confidence] =
      (acc[row.classification.confidence] ?? 0) + 1;
    return acc;
  }, {});
}

function incrementCount(map: Record<string, number>, key: string | null) {
  const normalized = key?.trim() || "(none)";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function buildDecisionRows(
  rows: DryRunRow[],
  minConfidence: ConfidenceThreshold,
): DryRunDecisionRow[] {
  return rows.map((row) => {
    const trace = row.classification.rule_trace;
    const wouldWrite = row.classification.decision === "classified" &&
      row.classification.family_key !== "other_uncategorized" &&
      meetsMinConfidence(row.classification.confidence, minConfidence);

    return {
      job_id: row.job_id,
      source_code: row.source_code,
      title: row.title,
      company_name: row.company_name,
      previous_job_family: row.legacy_job_family,
      proposed_job_family: row.classification.family_key,
      decision: row.classification.decision,
      confidence: row.classification.confidence,
      rule_id: trace.rule_id,
      rule_source: trace.rule_source,
      matched_value: trace.matched_value,
      score: row.classification.score,
      margin: row.classification.margin,
      would_write: wouldWrite,
    };
  });
}

function buildAggregateMetrics(
  decisionRows: DryRunDecisionRow[],
): AggregateMetrics {
  const distributionByFamily: Record<string, number> = {};
  const distributionByRuleId: Record<string, number> = {};

  for (const row of decisionRows) {
    if (row.decision === "classified") {
      incrementCount(distributionByFamily, row.proposed_job_family);
      incrementCount(distributionByRuleId, row.rule_id);
    }
  }

  return {
    total_tested: decisionRows.length,
    classified_high:
      decisionRows.filter((row) =>
        row.decision === "classified" && row.confidence === "high"
      ).length,
    classified_medium:
      decisionRows.filter((row) =>
        row.decision === "classified" && row.confidence === "medium"
      ).length,
    classified_low:
      decisionRows.filter((row) =>
        row.decision === "classified" && row.confidence === "low"
      ).length,
    would_write_count: decisionRows.filter((row) => row.would_write).length,
    uncategorized_count:
      decisionRows.filter((row) => row.decision === "uncategorized").length,
    ambiguous_count:
      decisionRows.filter((row) => row.decision === "ambiguous").length,
    distribution_by_proposed_job_family: distributionByFamily,
    distribution_by_rule_id: distributionByRuleId,
  };
}

function buildSourceSummary(
  decisionRows: DryRunDecisionRow[],
): SourceSummary[] {
  const grouped = new Map<string, DryRunDecisionRow[]>();
  for (const row of decisionRows) {
    const key = row.source_code ?? "(unknown)";
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([source_code, sourceRows]) => {
      const metrics = buildAggregateMetrics(sourceRows);
      return {
        source_code,
        total_tested: sourceRows.length,
        would_write_count: metrics.would_write_count,
        classified_high: metrics.classified_high,
        classified_medium: metrics.classified_medium,
        classified_low: metrics.classified_low,
        ambiguous: metrics.ambiguous_count,
        uncategorized: metrics.uncategorized_count,
        distribution_by_proposed_job_family:
          metrics.distribution_by_proposed_job_family,
        distribution_by_rule_id: metrics.distribution_by_rule_id,
      };
    })
    .sort((left, right) =>
      right.total_tested - left.total_tested ||
      right.would_write_count - left.would_write_count ||
      left.source_code.localeCompare(right.source_code)
    );
}

function buildExamplesByCategory(rows: DryRunRow[], perCategory = 3) {
  const grouped = new Map<JobFamilyKey, DryRunRow[]>();
  for (const row of rows) {
    if (row.classification.decision !== "classified") continue;
    const bucket = grouped.get(row.classification.family_key) ?? [];
    bucket.push(row);
    grouped.set(row.classification.family_key, bucket);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .map(([family_key, familyRows]) => ({
      family_key,
      family_label: getJobFamilyDefinition(family_key).label,
      count: familyRows.length,
      examples: familyRows
        .sort((left, right) =>
          right.classification.score - left.classification.score
        )
        .slice(0, perCategory)
        .map((row) => ({
          job_id: row.job_id,
          title: row.title,
          source_code: row.source_code,
          company_name: row.company_name,
          confidence: row.classification.confidence,
          score: row.classification.score,
          evidence: row.classification.evidence.map((item) =>
            `${item.source}:${item.term}`
          ).slice(0, 5),
        })),
    }));
}

function buildTopAmbiguities(rows: DryRunRow[], top: number) {
  return rows
    .filter((row) => row.classification.decision === "ambiguous")
    .sort((left, right) =>
      right.classification.score - left.classification.score ||
      left.classification.margin - right.classification.margin
    )
    .slice(0, top)
    .map((row) => ({
      job_id: row.job_id,
      title: row.title,
      source_code: row.source_code,
      score: row.classification.score,
      margin: row.classification.margin,
      candidates: row.classification.top_candidates.map((candidate) => ({
        family: candidate.family_label,
        score: candidate.score,
      })),
      evidence: row.classification.evidence.map((item) =>
        `${item.source}:${item.term}`
      ).slice(0, 8),
    }));
}

function buildTopUncategorizedTitles(rows: DryRunRow[], top: number) {
  const grouped = new Map<string, { count: number; sample: DryRunRow }>();

  for (const row of rows) {
    if (row.classification.decision !== "uncategorized") continue;
    const key = normalizeTaxonomyText(row.title) || "(untitled)";
    const current = grouped.get(key) ?? { count: 0, sample: row };
    current.count += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, top)
    .map(([normalized_title, value]) => ({
      normalized_title,
      count: value.count,
      sample_title: value.sample.title,
      sample_source_code: value.sample.source_code,
      sample_legacy_job_family: value.sample.legacy_job_family,
    }));
}

function buildTopUncategorizedJobs(rows: DryRunRow[], top: number) {
  return rows
    .filter((row) => row.classification.decision === "uncategorized")
    .sort((left, right) =>
      right.classification.score - left.classification.score
    )
    .slice(0, top)
    .map((row) => ({
      job_id: row.job_id,
      title: row.title,
      source_code: row.source_code,
      company_name: row.company_name,
      legacy_job_family: row.legacy_job_family,
      score: row.classification.score,
      top_candidates: row.classification.top_candidates.map((candidate) => ({
        family: candidate.family_label,
        score: candidate.score,
      })),
    }));
}

function sortRecordEntries(record: Record<string, number>) {
  return Object.entries(record)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) =>
      right.count - left.count || left.key.localeCompare(right.key)
    );
}

function buildTopMatchedValuesByRuleId(
  decisionRows: DryRunDecisionRow[],
  top = 10,
) {
  const grouped = new Map<string, Map<string, number>>();
  for (const row of decisionRows) {
    if (row.decision !== "classified") continue;
    const ruleBucket = grouped.get(row.rule_id) ?? new Map<string, number>();
    const matchedValue = row.matched_value || "(empty)";
    ruleBucket.set(matchedValue, (ruleBucket.get(matchedValue) ?? 0) + 1);
    grouped.set(row.rule_id, ruleBucket);
  }

  return Array.from(grouped.entries())
    .map(([rule_id, valueMap]) => ({
      rule_id,
      values: Array.from(valueMap.entries())
        .map(([matched_value, count]) => ({ matched_value, count }))
        .sort((left, right) =>
          right.count - left.count ||
          left.matched_value.localeCompare(right.matched_value)
        )
        .slice(0, top),
    }))
    .sort((left, right) =>
      (right.values[0]?.count ?? 0) - (left.values[0]?.count ?? 0) ||
      left.rule_id.localeCompare(right.rule_id)
    )
    .slice(0, top);
}

function buildSampleByCategory(
  decisionRows: DryRunDecisionRow[],
  perCategory = 10,
) {
  const grouped = new Map<string, DryRunDecisionRow[]>();
  for (const row of decisionRows) {
    if (row.decision !== "classified") continue;
    const bucket = grouped.get(row.proposed_job_family) ?? [];
    bucket.push(row);
    grouped.set(row.proposed_job_family, bucket);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .map(([proposed_job_family, rows]) => ({
      proposed_job_family,
      count: rows.length,
      examples: rows.slice(0, perCategory).map((row) => ({
        job_id: row.job_id,
        title: row.title,
        source_code: row.source_code,
        rule_id: row.rule_id,
        rule_source: row.rule_source,
        matched_value: row.matched_value,
        confidence: row.confidence,
        would_write: row.would_write,
      })),
    }));
}

function buildQualityAlerts(
  metrics: AggregateMetrics,
  decisionRows: DryRunDecisionRow[],
): string[] {
  const alerts: string[] = [];
  const classifiedTotal = metrics.classified_high +
    metrics.classified_medium +
    metrics.classified_low;
  for (
    const { key, count } of sortRecordEntries(
      metrics.distribution_by_proposed_job_family,
    )
  ) {
    if (classifiedTotal > 0 && count / classifiedTotal > 0.4) {
      alerts.push(
        `category_over_40_percent:${key}:${count}/${classifiedTotal}`,
      );
    }
  }

  const writeRuleCounts: Record<string, number> = {};
  for (const row of decisionRows) {
    if (!row.would_write) continue;
    incrementCount(writeRuleCounts, row.rule_id);
  }
  for (const { key, count } of sortRecordEntries(writeRuleCounts)) {
    if (
      metrics.would_write_count > 0 && count / metrics.would_write_count > 0.3
    ) {
      alerts.push(
        `rule_over_30_percent_of_writes:${key}:${count}/${metrics.would_write_count}`,
      );
    }
  }

  return alerts;
}

function buildReport(
  rows: DryRunRow[],
  limit: number | null,
  top: number,
  minConfidence: ConfidenceThreshold,
): ReportShape {
  const total = rows.length;
  const blank = rows.filter((row) => row.baseline_status === "blank").length;
  const mapped = rows.filter((row) => row.baseline_status === "mapped").length;
  const unmapped =
    rows.filter((row) => row.baseline_status === "unmapped").length;
  const classified =
    rows.filter((row) => row.classification.decision === "classified").length;
  const ambiguous =
    rows.filter((row) => row.classification.decision === "ambiguous").length;
  const uncategorized =
    rows.filter((row) => row.classification.decision === "uncategorized")
      .length;
  const decisionRows = buildDecisionRows(rows, minConfidence);
  const metrics = buildAggregateMetrics(decisionRows);
  const sourceSummary = buildSourceSummary(decisionRows);

  return {
    generated_at: new Date().toISOString(),
    min_confidence: minConfidence,
    cohort: {
      description:
        "jobs feed-visible: is_active=true, is_expired=false, quality_status ok/null",
      total_jobs: total,
      limit_applied: limit,
    },
    versions: {
      taxonomy: JOB_FAMILY_TAXONOMY_VERSION,
      classifier: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    },
    baseline: {
      blank,
      mapped,
      unmapped,
      raw_uncategorized_rate: toPct(blank + unmapped, total),
    },
    outcomes: {
      classified,
      ambiguous,
      uncategorized,
      classified_rate: toPct(classified, total),
      ambiguous_rate: toPct(ambiguous, total),
      uncategorized_rate: toPct(uncategorized, total),
    },
    metrics,
    metrics_by_source: Object.fromEntries(
      sourceSummary.map((item) => [item.source_code, item]),
    ),
    quality: {
      top_uncategorized_titles: buildTopUncategorizedTitles(rows, 20),
      top_matched_values_by_rule_id: buildTopMatchedValuesByRuleId(
        decisionRows,
        10,
      ),
      sample_by_category: buildSampleByCategory(decisionRows, 10),
      alerts: buildQualityAlerts(metrics, decisionRows),
    },
    jobs: decisionRows,
    confidence_breakdown: buildConfidenceBreakdown(rows),
    source_summary: sourceSummary,
    family_summary: buildFamilySummary(rows),
    examples_by_category: buildExamplesByCategory(rows),
    top_ambiguities: buildTopAmbiguities(rows, top),
    top_uncategorized_titles: buildTopUncategorizedTitles(rows, top),
    top_uncategorized_jobs: buildTopUncategorizedJobs(rows, top),
  };
}

function renderMarkdown(report: ReportShape): string {
  const lines = [
    "# Job family dry-run",
    "",
    `Generated at: ${report.generated_at}`,
    `Min confidence: ${report.min_confidence}`,
    `Cohort: ${report.cohort.description}`,
    `Total jobs: ${report.cohort.total_jobs}`,
    "",
    "## Baseline",
    `- Blank legacy family: ${report.baseline.blank}`,
    `- Mapped legacy family: ${report.baseline.mapped}`,
    `- Unmapped legacy family: ${report.baseline.unmapped}`,
    `- Raw uncategorized rate: ${report.baseline.raw_uncategorized_rate}%`,
    "",
    "## Outcomes",
    `- Classified: ${report.outcomes.classified} (${report.outcomes.classified_rate}%)`,
    `- Would write: ${report.metrics.would_write_count}`,
    `- Ambiguous: ${report.outcomes.ambiguous} (${report.outcomes.ambiguous_rate}%)`,
    `- Uncategorized: ${report.outcomes.uncategorized} (${report.outcomes.uncategorized_rate}%)`,
    "",
    "## Family summary",
    "| Family | Count | % total | Avg score | Avg margin | H | M | L |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.family_summary.map((item) =>
      `| ${item.family_label} | ${item.count} | ${item.pct_of_total}% | ${item.avg_score} | ${item.avg_margin} | ${item.high} | ${item.medium} | ${item.low} |`
    ),
    "",
    "## Source summary",
    "| Source | Tested | Would write | High | Medium | Low | Ambiguous | Uncategorized |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.source_summary.map((item) =>
      `| ${item.source_code} | ${item.total_tested} | ${item.would_write_count} | ${item.classified_high} | ${item.classified_medium} | ${item.classified_low} | ${item.ambiguous} | ${item.uncategorized} |`
    ),
    "",
    "## Examples by category",
    ...report.examples_by_category.flatMap((category) => [
      `### ${category.family_label} (${category.count})`,
      ...((category.examples as Array<Record<string, unknown>>) ?? []).map((
        example,
      ) =>
        `- ${example.title ?? "(untitled)"} | ${
          example.source_code ?? "(unknown)"
        } | score ${example.score}`
      ),
      "",
    ]),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

async function saveReport(output_dir: string, report: ReportShape) {
  await Deno.mkdir(output_dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(
    /\..+$/,
    "",
  );
  const json_path = `${output_dir}/dry_run_report_${stamp}.json`;
  const md_path = `${output_dir}/dry_run_report_${stamp}.md`;

  await Deno.writeTextFile(json_path, JSON.stringify(report, null, 2));
  await Deno.writeTextFile(md_path, renderMarkdown(report));

  return { json_path, md_path };
}

function printSummary(
  report: ReportShape,
  saved: { json_path: string; md_path: string },
) {
  console.log("");
  console.log("=== Job family dry-run summary ===");
  console.log(`Cohort total: ${report.cohort.total_jobs}`);
  console.log(
    `Baseline raw uncategorized: ${report.baseline.raw_uncategorized_rate}%`,
  );
  console.log(
    `Classified: ${report.outcomes.classified} (${report.outcomes.classified_rate}%)`,
  );
  console.log(`Would write: ${report.metrics.would_write_count}`);
  console.log(
    `Ambiguous: ${report.outcomes.ambiguous} (${report.outcomes.ambiguous_rate}%)`,
  );
  console.log(
    `Uncategorized: ${report.outcomes.uncategorized} (${report.outcomes.uncategorized_rate}%)`,
  );
  console.log("");
  console.log("Top families:");
  for (const item of report.family_summary.slice(0, 10)) {
    console.log(
      `- ${item.family_label}: ${item.count} (${item.pct_of_total}%), avg score ${item.avg_score}`,
    );
  }
  console.log("");
  console.log(`JSON report: ${saved.json_path}`);
  console.log(`Markdown report: ${saved.md_path}`);
}

async function main() {
  const { limit, input_json, min_confidence, output_dir, top } = parseArgs();
  const jobs = input_json
    ? await readLocalJobs(input_json, limit)
    : await (async () => {
      const supabaseUrl = await getEnvValue("SUPABASE_URL");
      const serviceRoleKey = await getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
      return await fetchVisibleFeedJobs(supabaseUrl, serviceRoleKey, limit);
    })();
  const sourceMap = input_json
    ? new Map<string, JobSourceRow>()
    : await (async () => {
      const supabaseUrl = await getEnvValue("SUPABASE_URL");
      const serviceRoleKey = await getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
      return await fetchSourceCodes(
        supabaseUrl,
        serviceRoleKey,
        jobs.map((job) => job.job_source_id).filter((value): value is string =>
          Boolean(value)
        ),
      );
    })();

  const rows = buildDryRunRows(jobs, sourceMap);
  const report = buildReport(rows, limit, top, min_confidence);
  const saved = await saveReport(output_dir, report);
  printSummary(report, saved);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
