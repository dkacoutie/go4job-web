import { Client } from "jsr:@db/postgres@0.19.4";

import type { JobFamilyClassification } from "../shared/jobradar/jobFamilyClassifier.ts";
import {
  classifyJobFamilyForControlledWrite,
  JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
} from "../shared/jobradar/jobFamilyControlledClassifier.ts";
import {
  getJobFamilySourcePolicy,
  isWriteSafeConfidence,
  JOB_FAMILY_ALLOWED_SOURCES_FOR_CONTROLLED_WRITE,
  JOB_FAMILY_BLOCKED_SOURCES,
  JOB_FAMILY_CONTROLLED_WRITE_VERSION,
  JOB_FAMILY_SOURCE_POLICY,
  JOB_FAMILY_SOURCE_POLICY_VERSION,
} from "../shared/jobradar/jobFamilyControlledWriteConfig.ts";
import { JOB_FAMILY_TAXONOMY_VERSION } from "../shared/jobradar/jobFamilyTaxonomy.ts";

type JobRow = {
  id: string;
  title: string | null;
  company_name: string | null;
  source_code: string | null;
  job_family: string | null;
  enrichment_id: string | null;
  required_skills: string[] | null;
  optional_skills: string[] | null;
  job_skills: string[] | null;
  tags: string[] | string | null;
  official_desc: string | null;
  description_text: string | null;
  job_json?: Record<string, unknown> | null;
  degree_required: string | null;
  experience_years_min: number | null;
  experience_years_max: number | null;
};

type ClassifiedRow = JobRow & {
  source_code: string;
  raw_source_code: string | null;
  classification: JobFamilyClassification;
};

type WriteConfidenceThreshold = "high" | "medium";

type BatchWriteResultRow = {
  job_id: string | null;
  action: string | null;
  skip_reason: string | null;
  enrichment_id: string | null;
  version: number | null;
  error_message: string | null;
};

type ReportExample = {
  job_id: string;
  title: string | null;
  company_name: string | null;
  source_code: string | null;
  raw_source_code: string | null;
  previous_job_family: string | null;
  proposed_job_family: string;
  decision: JobFamilyClassification["decision"];
  confidence: JobFamilyClassification["confidence"];
  rule_id: string;
  rule_source: string;
  matched_value: string;
  score: number;
  margin: number;
  would_write: boolean;
};

type BatchResultExample = {
  job_id: string | null;
  title: string | null;
  source_code: string | null;
  proposed_job_family: string | null;
  confidence: JobFamilyClassification["confidence"] | null;
  rule_id: string | null;
  action: string | null;
  db_action: string | null;
  skip_reason: string | null;
  db_skip_reason: string | null;
  error_message: string | null;
  db_error_message: string | null;
  enrichment_id: string | null;
  rollback_mode: boolean;
};

type RunReport = {
  run_mode: "apply" | "dry_run";
  started_at: string;
  finished_at: string;
  write_version: string;
  source_policy: string;
  source_policy_version: string;
  classifier_version: string;
  taxonomy_version: string;
  allowed_sources: string[];
  blocked_sources: string[];
  batch_size: number;
  min_confidence: WriteConfidenceThreshold;
  total_scanned: number;
  candidate_count: number;
  planned_write_count: number;
  would_write_count: number;
  written_count: number;
  blocked_by_blocklist_count: number;
  skipped_for_quality_count: number;
  already_conformant_or_no_rewrite_count: number;
  runtime_other_count: number;
  skipped_ambiguous_count: number;
  skipped_uncategorized_count: number;
  write_rate: number;
  top_written_sources: Array<{
    source_code: string;
    count: number;
  }>;
  top_blocked_by_blocklist_sources: Array<{
    source_code: string;
    count: number;
  }>;
  candidate_examples: ReportExample[];
  skipped_for_quality_examples: ReportExample[];
  skipped_uncategorized_examples: ReportExample[];
  already_conformant_or_no_rewrite_examples: ReportExample[];
  runtime_other_examples: ReportExample[];
  batch_result_examples: BatchResultExample[];
  runtime_other_result_examples: BatchResultExample[];
  anomalies: Array<Record<string, unknown>>;
};

type RunReportWithPath = RunReport & {
  rollback: boolean;
  report_path: string;
};

type BatchSummary = {
  batch_number: number;
  run_mode: "apply" | "dry_run";
  total_scanned: number;
  candidate_count: number;
  written_count: number;
  total_written_so_far: number;
  already_conformant_or_no_rewrite_count: number;
  runtime_other_count: number;
  anomalies_count: number;
  top_sources: Array<{ source_code: string; count: number }>;
  top_families: Array<{ family_key: string; count: number }>;
  report_path: string;
};

type RolloutReport = {
  started_at: string;
  finished_at: string;
  rollout_max_total: number;
  rollout_batch_write: number;
  min_confidence: WriteConfidenceThreshold;
  apply: boolean;
  total_written: number;
  total_batches: number;
  stopped_reason: string;
  per_batch_summary: BatchSummary[];
  aggregated_top_sources: Array<{ source_code: string; count: number }>;
  aggregated_top_families: Array<{ family_key: string; count: number }>;
  anomalies: Array<Record<string, unknown>>;
};

type PreflightExample = {
  job_id: string;
  title: string | null;
  company_name: string | null;
  source_code: string;
  raw_source_code: string | null;
  proposed_job_family: string;
  confidence: JobFamilyClassification["confidence"];
  rule_id: string;
};

type PreflightAllowlistReport = {
  started_at: string;
  finished_at: string;
  rollout_max_total: number;
  rollout_batch_write: number;
  min_confidence: WriteConfidenceThreshold;
  total_scanned: number;
  candidate_count: number;
  candidate_sources: Array<{ source_code: string; count: number }>;
  allowed_sources: string[];
  missing_allowed_sources: string[];
  affected_candidates_count: number;
  examples_by_missing_source: Record<string, PreflightExample[]>;
};

function parseArgs() {
  const parsed = new Map<string, string>();
  for (const arg of Deno.args) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=", 2);
    parsed.set(key, value);
  }
  const minConfidence = parsed.get("min-confidence") ?? "high";
  if (minConfidence !== "high" && minConfidence !== "medium") {
    throw new Error(
      "Invalid --min-confidence. Expected one of: high, medium.",
    );
  }

  return {
    apply: parsed.get("apply") === "true",
    rollback: parsed.get("rollback") === "true",
    limit: parsed.has("limit") ? Number(parsed.get("limit")) : null,
    max_write: parsed.has("max-write") ? Number(parsed.get("max-write")) : null,
    min_confidence: minConfidence as WriteConfidenceThreshold,
    rollout: parsed.get("rollout") === "true",
    rollout_max_total: parsed.has("rollout-max-total")
      ? Math.max(1, Number(parsed.get("rollout-max-total")))
      : 5000,
    rollout_batch_write: parsed.has("rollout-batch-write")
      ? Math.max(1, Number(parsed.get("rollout-batch-write")))
      : 500,
    preflight_allowlist: parsed.get("preflight-allowlist") === "true",
    summary_only: parsed.get("summary-only") === "true",
    batch_size: parsed.has("batch-size")
      ? Math.max(1, Number(parsed.get("batch-size")))
      : 250,
    output_dir: parsed.get("output-dir") ??
      ".codex-artifacts/job-family-controlled-write",
  };
}

async function readDbPassword(): Promise<string> {
  const fromEnv = Deno.env.get("SUPABASE_DB_PASSWORD")?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(
    "Missing SUPABASE_DB_PASSWORD. Pass it in env for controlled write runs.",
  );
}

async function readPoolerUrl(): Promise<URL> {
  const raw = await Deno.readTextFile("supabase/.temp/pooler-url");
  return new URL(raw.trim());
}

function toTextArray(
  value: string[] | string | null | undefined,
): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  return String(value)
    .replace(/^\{|\}$/g, "")
    .split(/[,;|\n]/)
    .map((item) => item.replace(/^"+|"+$/g, "").trim())
    .filter(Boolean);
}

function buildClient(poolerUrl: URL, password: string) {
  const username = decodeURIComponent(poolerUrl.username);
  const database = poolerUrl.pathname.replace(/^\//, "") || "postgres";

  return new Client({
    hostname: poolerUrl.hostname,
    port: Number(poolerUrl.port || "5432"),
    user: username,
    password,
    database,
  });
}

function buildMeta(row: ClassifiedRow) {
  return {
    source: JOB_FAMILY_CONTROLLED_WRITE_VERSION,
    source_policy: JOB_FAMILY_SOURCE_POLICY,
    source_policy_version: JOB_FAMILY_SOURCE_POLICY_VERSION,
    classifier_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
    family_key: row.classification.family_key,
    family_label: row.classification.family_label,
    decision: row.classification.decision,
    confidence: row.classification.confidence,
    rule_id: row.classification.rule_trace.rule_id,
    rule_source: row.classification.rule_trace.rule_source,
    matched_value: row.classification.rule_trace.matched_value,
    score: row.classification.score,
    margin: row.classification.margin,
    source_code: row.source_code,
    raw_source_code: row.raw_source_code,
    ambiguity_policy: "exclude_all_ambiguous_v1",
    write_safe_confidence: ["high", "medium"],
    top_candidates: row.classification.top_candidates.slice(0, 3).map((
      candidate,
    ) => ({
      family_key: candidate.family_key,
      family_label: candidate.family_label,
      score: candidate.score,
    })),
    evidence: row.classification.evidence.slice(0, 12),
    written_at: new Date().toISOString(),
  };
}

function buildEnrichment(row: ClassifiedRow) {
  return {
    job_family: row.classification.family_key,
    job_skills: toTextArray(row.job_skills),
    required_skills: toTextArray(row.required_skills),
    optional_skills: toTextArray(row.optional_skills),
    degree_required: row.degree_required,
    experience_years_min: row.experience_years_min,
    experience_years_max: row.experience_years_max,
  };
}

function toPct(part: number, total: number): number {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

async function fetchFeedVisibleJobs(
  client: Client,
  limit: number | null,
): Promise<JobRow[]> {
  const query = `
    select
      j.id,
      j.title,
      j.company_name,
      s.code as source_code,
      j.job_family,
      j.enrichment_id,
      j.required_skills,
      j.optional_skills,
      j.job_skills,
      j.tags,
      j.official_desc,
      j.description_text,
      j.job_json,
      j.degree_required,
      j.experience_years_min,
      j.experience_years_max
    from public.jobs j
    left join public.job_sources s on s.id = j.job_source_id
    where j.is_active = true
      and j.is_expired = false
      and (j.quality_status = 'ok' or j.quality_status is null)
    order by j.published_at desc nulls last, j.scraped_at desc nulls last, j.created_at desc nulls last
    ${limit != null ? `limit ${Math.max(1, Math.trunc(limit))}` : ""}
  `;

  const result = await client.queryObject<JobRow>(query);
  return result.rows;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function countBySource(
  rows: ClassifiedRow[],
): Array<{ source_code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.source_code, (counts.get(row.source_code) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([source_code, count]) => ({ source_code, count }))
    .sort((left, right) =>
      right.count - left.count ||
      left.source_code.localeCompare(right.source_code)
    );
}

function countByFamily(
  rows: ClassifiedRow[],
): Array<{ family_key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const familyKey = row.classification.family_key;
    counts.set(familyKey, (counts.get(familyKey) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([family_key, count]) => ({ family_key, count }))
    .sort((left, right) =>
      right.count - left.count ||
      left.family_key.localeCompare(right.family_key)
    );
}

function mergeCounts<T extends string>(
  counts: Map<T, number>,
  entries: Array<{ count: number } & Record<string, unknown>>,
  key: keyof (typeof entries)[number],
): void {
  for (const entry of entries) {
    const value = entry[key];
    if (typeof value !== "string") continue;
    counts.set(value as T, (counts.get(value as T) ?? 0) + entry.count);
  }
}

function sortedCounts(
  counts: Map<string, number>,
  keyName: "source_code" | "family_key",
): Array<{ source_code: string; count: number } | {
  family_key: string;
  count: number;
}> {
  return Array.from(counts.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => {
      const leftKey = String(left[keyName]);
      const rightKey = String(right[keyName]);
      return right.count - left.count || leftKey.localeCompare(rightKey);
    }) as Array<{ source_code: string; count: number } | {
      family_key: string;
      count: number;
    }>;
}

function buildReportExample(
  row: ClassifiedRow,
  wouldWrite: boolean,
): ReportExample {
  return {
    job_id: row.id,
    title: row.title,
    company_name: row.company_name,
    source_code: row.source_code,
    raw_source_code: row.raw_source_code,
    previous_job_family: row.job_family,
    proposed_job_family: row.classification.family_key,
    decision: row.classification.decision,
    confidence: row.classification.confidence,
    rule_id: row.classification.rule_trace.rule_id,
    rule_source: row.classification.rule_trace.rule_source,
    matched_value: row.classification.rule_trace.matched_value,
    score: row.classification.score,
    margin: row.classification.margin,
    would_write: wouldWrite,
  };
}

function buildReportExamples(
  rows: ClassifiedRow[],
  limit: number,
  wouldWrite: boolean,
): ReportExample[] {
  return rows.slice(0, limit).map((row) => buildReportExample(row, wouldWrite));
}

function buildBatchResultExample(
  item: BatchWriteResultRow,
  row: ClassifiedRow | null,
  rollback: boolean,
): BatchResultExample {
  return {
    job_id: item.job_id,
    title: row?.title ?? null,
    source_code: row?.source_code ?? null,
    proposed_job_family: row?.classification.family_key ?? null,
    confidence: row?.classification.confidence ?? null,
    rule_id: row?.classification.rule_trace.rule_id ?? null,
    action: item.action,
    db_action: item.action,
    skip_reason: item.skip_reason,
    db_skip_reason: item.skip_reason,
    error_message: item.error_message,
    db_error_message: item.error_message,
    enrichment_id: item.enrichment_id,
    rollback_mode: rollback,
  };
}

function meetsMinConfidence(
  confidence: JobFamilyClassification["confidence"],
  minConfidence: WriteConfidenceThreshold,
): boolean {
  if (minConfidence === "medium") {
    return confidence === "high" || confidence === "medium";
  }
  return confidence === "high";
}

function buildCandidateRows(
  rows: ClassifiedRow[],
  minConfidence: WriteConfidenceThreshold,
) {
  const candidates: ClassifiedRow[] = [];
  const blockedByBlocklist: ClassifiedRow[] = [];
  const skippedAmbiguous: ClassifiedRow[] = [];
  const skippedForQuality: ClassifiedRow[] = [];
  const skippedUncategorized: ClassifiedRow[] = [];
  const alreadyConformantOrNoRewrite: ClassifiedRow[] = [];

  for (const row of rows) {
    if (getJobFamilySourcePolicy(row.source_code).blocked_by_blocklist) {
      blockedByBlocklist.push(row);
      continue;
    }

    if (row.classification.decision === "uncategorized") {
      skippedUncategorized.push(row);
      continue;
    }

    if (row.classification.decision === "ambiguous") {
      skippedAmbiguous.push(row);
      continue;
    }

    if (
      row.classification.family_key === "other_uncategorized" ||
      !isWriteSafeConfidence(row.classification.confidence)
    ) {
      skippedForQuality.push(row);
      continue;
    }

    if (!meetsMinConfidence(row.classification.confidence, minConfidence)) {
      skippedForQuality.push(row);
      continue;
    }

    if (
      row.enrichment_id &&
      row.job_family?.trim() === row.classification.family_key
    ) {
      alreadyConformantOrNoRewrite.push(row);
      continue;
    }

    candidates.push(row);
  }

  return {
    candidates,
    blockedByBlocklist,
    skippedAmbiguous,
    skippedForQuality,
    skippedUncategorized,
    alreadyConformantOrNoRewrite,
  };
}

function buildBatchPayload(rows: ClassifiedRow[]) {
  return rows.map((row) => ({
    job_id: row.id,
    source_code: row.source_code,
    decision: row.classification.decision,
    confidence: row.classification.confidence,
    family_key: row.classification.family_key,
    enrichment: buildEnrichment(row),
    meta: buildMeta(row),
  }));
}

async function callBatchFunction(
  client: Client,
  rows: ClassifiedRow[],
  rollback: boolean,
): Promise<BatchWriteResultRow[]> {
  if (rollback) await client.queryArray("begin");

  try {
    const result = await client.queryObject<BatchWriteResultRow>(
      "select * from public.insert_job_enrichment_batch($1::jsonb, $2::text[])",
      [
        JSON.stringify(buildBatchPayload(rows)),
        [...JOB_FAMILY_ALLOWED_SOURCES_FOR_CONTROLLED_WRITE],
      ],
    );

    if (rollback) await client.queryArray("rollback");
    return result.rows;
  } catch (error) {
    if (rollback) {
      try {
        await client.queryArray("rollback");
      } catch {
        // ignore rollback errors after a failed batch call
      }
    }
    throw error;
  }
}

function indexByJobId(rows: ClassifiedRow[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

async function executeBatches(
  client: Client,
  rows: ClassifiedRow[],
  batchSize: number,
  rollback: boolean,
) {
  const byJobId = indexByJobId(rows);
  const writtenRows: ClassifiedRow[] = [];
  const skippedOther: ClassifiedRow[] = [];
  const anomalies: Array<Record<string, unknown>> = [];
  const batchResultExamples: BatchResultExample[] = [];
  const runtimeOtherResultExamples: BatchResultExample[] = [];

  for (const chunk of chunkArray(rows, batchSize)) {
    const results = await callBatchFunction(client, chunk, rollback);
    for (const item of results) {
      const row = item.job_id ? byJobId.get(item.job_id) : null;
      const resultExample = buildBatchResultExample(item, row ?? null, rollback);
      if (batchResultExamples.length < 50) {
        batchResultExamples.push(resultExample);
      }
      const action = (item.action ?? "").trim().toLowerCase();
      const skipReason = (item.skip_reason ?? "").trim().toLowerCase();

      if (action === "written" && row) {
        writtenRows.push(row);
        continue;
      }

      if (row) skippedOther.push(row);
      if (runtimeOtherResultExamples.length < 50) {
        runtimeOtherResultExamples.push(resultExample);
      }

      if (skipReason === "other" || item.error_message) {
        anomalies.push({
          type: "batch_skip_other",
          job_id: item.job_id,
          title: row?.title ?? null,
          source_code: row?.source_code ?? null,
          skip_reason: item.skip_reason,
          error_message: item.error_message,
        });
      }
    }
  }

  return {
    writtenRows,
    skippedOther,
    batchResultExamples,
    runtimeOtherResultExamples,
    anomalies,
  };
}

async function saveReport(outputDir: string, report: RunReport) {
  await Deno.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(
    /\..+$/,
    "",
  );
  const jsonPath = `${outputDir}/job-family-controlled-write-${stamp}.json`;
  await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2));
  return jsonPath;
}

function renderRolloutMarkdown(report: RolloutReport): string {
  const lines = [
    "# Job Family Controlled Write Rollout",
    "",
    `Started: ${report.started_at}`,
    `Finished: ${report.finished_at}`,
    `Apply: ${report.apply}`,
    `Min confidence: ${report.min_confidence}`,
    `Rollout max total: ${report.rollout_max_total}`,
    `Rollout batch write: ${report.rollout_batch_write}`,
    `Total written: ${report.total_written}`,
    `Total batches: ${report.total_batches}`,
    `Stopped reason: ${report.stopped_reason}`,
    "",
    "## Batches",
    "",
    "| Batch | Mode | Scanned | Candidates | Written | Total | Conformant | Runtime other | Anomalies | Report |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...report.per_batch_summary.map((batch) =>
      `| ${batch.batch_number} | ${batch.run_mode} | ${batch.total_scanned} | ${batch.candidate_count} | ${batch.written_count} | ${batch.total_written_so_far} | ${batch.already_conformant_or_no_rewrite_count} | ${batch.runtime_other_count} | ${batch.anomalies_count} | ${batch.report_path} |`
    ),
  ];
  return `${lines.join("\n")}\n`;
}

function renderPreflightMarkdown(report: PreflightAllowlistReport): string {
  const lines = [
    "# Job Family Controlled Write Allowlist Preflight",
    "",
    `Started: ${report.started_at}`,
    `Finished: ${report.finished_at}`,
    `Min confidence: ${report.min_confidence}`,
    `Rollout max total: ${report.rollout_max_total}`,
    `Rollout batch write: ${report.rollout_batch_write}`,
    `Total scanned: ${report.total_scanned}`,
    `Candidate count: ${report.candidate_count}`,
    `Affected candidates: ${report.affected_candidates_count}`,
    `Missing allowed sources: ${report.missing_allowed_sources.join(", ") || "(none)"}`,
    "",
    "## Candidate Sources",
    "",
    ...report.candidate_sources.map((item) =>
      `- ${item.source_code}: ${item.count}`
    ),
  ];
  return `${lines.join("\n")}\n`;
}

async function saveRolloutReport(outputDir: string, report: RolloutReport) {
  await Deno.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(
    /\..+$/,
    "",
  );
  const jsonPath = `${outputDir}/job-family-controlled-write-rollout-${stamp}.json`;
  const mdPath = `${outputDir}/job-family-controlled-write-rollout-${stamp}.md`;
  await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2));
  await Deno.writeTextFile(mdPath, renderRolloutMarkdown(report));
  return { jsonPath, mdPath };
}

async function savePreflightReport(
  outputDir: string,
  report: PreflightAllowlistReport,
) {
  await Deno.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(
    /\..+$/,
    "",
  );
  const jsonPath =
    `${outputDir}/job-family-controlled-write-preflight-${stamp}.json`;
  const mdPath = `${outputDir}/job-family-controlled-write-preflight-${stamp}.md`;
  await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2));
  await Deno.writeTextFile(mdPath, renderPreflightMarkdown(report));
  return { jsonPath, mdPath };
}

function classifyRows(jobs: JobRow[]): ClassifiedRow[] {
  return jobs.map((job) => {
    const sourcePolicy = getJobFamilySourcePolicy(job.source_code);

    return {
      ...job,
      source_code: sourcePolicy.normalized_source_code,
      raw_source_code: sourcePolicy.raw_source_code,
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

async function runControlledWriteBatch(
  client: Client,
  args: ReturnType<typeof parseArgs>,
  maxWrite: number | null,
  excludedCandidateIds = new Set<string>(),
): Promise<RunReportWithPath> {
  const startedAt = new Date().toISOString();
  const jobs = await fetchFeedVisibleJobs(client, args.limit);
  const classifiedRows = classifyRows(jobs);
  const prepared = buildCandidateRows(classifiedRows, args.min_confidence);
  const eligibleCandidates = prepared.candidates.filter((row) =>
    !excludedCandidateIds.has(row.id)
  );
  const candidateRows = maxWrite != null
    ? eligibleCandidates.slice(0, Math.max(0, Math.trunc(maxWrite)))
    : eligibleCandidates;

  let writtenRows: ClassifiedRow[] = [];
  let runtimeSkippedOther: ClassifiedRow[] = [];
  let batchResultExamples: BatchResultExample[] = [];
  let runtimeOtherResultExamples: BatchResultExample[] = [];
  let anomalies: Array<Record<string, unknown>> = [];

  if (args.apply || args.rollback) {
    const executed = await executeBatches(
      client,
      candidateRows,
      args.batch_size,
      args.rollback,
    );
    writtenRows = executed.writtenRows;
    runtimeSkippedOther = executed.skippedOther;
    batchResultExamples = executed.batchResultExamples;
    runtimeOtherResultExamples = executed.runtimeOtherResultExamples;
    anomalies = executed.anomalies;
  } else {
    writtenRows = candidateRows;
  }

  const report: RunReport = {
    run_mode: args.apply && !args.rollback ? "apply" : "dry_run",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    write_version: JOB_FAMILY_CONTROLLED_WRITE_VERSION,
    source_policy: JOB_FAMILY_SOURCE_POLICY,
    source_policy_version: JOB_FAMILY_SOURCE_POLICY_VERSION,
    classifier_version: JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
    taxonomy_version: JOB_FAMILY_TAXONOMY_VERSION,
    allowed_sources: [...JOB_FAMILY_ALLOWED_SOURCES_FOR_CONTROLLED_WRITE],
    blocked_sources: [...JOB_FAMILY_BLOCKED_SOURCES],
    batch_size: args.batch_size,
    min_confidence: args.min_confidence,
    total_scanned: classifiedRows.length,
    candidate_count: candidateRows.length,
    planned_write_count: candidateRows.length,
    would_write_count: candidateRows.length,
    written_count: writtenRows.length,
    blocked_by_blocklist_count: prepared.blockedByBlocklist.length,
    skipped_for_quality_count: prepared.skippedForQuality.length,
    already_conformant_or_no_rewrite_count:
      prepared.alreadyConformantOrNoRewrite.length,
    runtime_other_count: runtimeSkippedOther.length,
    skipped_ambiguous_count: prepared.skippedAmbiguous.length,
    skipped_uncategorized_count: prepared.skippedUncategorized.length,
    write_rate: toPct(writtenRows.length, classifiedRows.length),
    top_written_sources: countBySource(writtenRows).slice(0, 15),
    top_blocked_by_blocklist_sources: countBySource(
      prepared.blockedByBlocklist,
    )
      .slice(0, 15),
    candidate_examples: buildReportExamples(candidateRows, 50, true),
    skipped_for_quality_examples: buildReportExamples(
      prepared.skippedForQuality,
      25,
      false,
    ),
    skipped_uncategorized_examples: buildReportExamples(
      prepared.skippedUncategorized,
      25,
      false,
    ),
    already_conformant_or_no_rewrite_examples: buildReportExamples(
      prepared.alreadyConformantOrNoRewrite,
      25,
      false,
    ),
    runtime_other_examples: buildReportExamples(
      runtimeSkippedOther,
      25,
      false,
    ),
    batch_result_examples: batchResultExamples.slice(0, 50),
    runtime_other_result_examples: runtimeOtherResultExamples.slice(0, 50),
    anomalies: anomalies.slice(0, 25),
  };

  const jsonPath = await saveReport(args.output_dir, report);
  return {
    ...report,
    rollback: args.rollback,
    report_path: jsonPath,
  };
}

function toPreflightExample(row: ClassifiedRow): PreflightExample {
  return {
    job_id: row.id,
    title: row.title,
    company_name: row.company_name,
    source_code: row.source_code,
    raw_source_code: row.raw_source_code,
    proposed_job_family: row.classification.family_key,
    confidence: row.classification.confidence,
    rule_id: row.classification.rule_trace.rule_id,
  };
}

async function buildAllowlistPreflightReport(
  client: Client,
  args: ReturnType<typeof parseArgs>,
): Promise<PreflightAllowlistReport> {
  const startedAt = new Date().toISOString();
  const jobs = await fetchFeedVisibleJobs(client, args.limit);
  const classifiedRows = classifyRows(jobs);
  const prepared = buildCandidateRows(classifiedRows, args.min_confidence);
  const candidates = prepared.candidates.slice(0, args.rollout_max_total);

  const allowedSources = [...JOB_FAMILY_ALLOWED_SOURCES_FOR_CONTROLLED_WRITE];
  const allowedSourceSet = new Set<string>(allowedSources);
  const missingSources = Array.from(
    new Set(
      candidates
        .map((row) => row.source_code)
        .filter((sourceCode) => !allowedSourceSet.has(sourceCode)),
    ),
  ).sort();
  const missingSourceSet = new Set(missingSources);
  const affectedCandidates = candidates.filter((row) =>
    missingSourceSet.has(row.source_code)
  );
  const examplesByMissingSource: Record<string, PreflightExample[]> = {};
  for (const row of affectedCandidates) {
    const examples = examplesByMissingSource[row.source_code] ?? [];
    if (examples.length < 10) examples.push(toPreflightExample(row));
    examplesByMissingSource[row.source_code] = examples;
  }

  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    rollout_max_total: args.rollout_max_total,
    rollout_batch_write: args.rollout_batch_write,
    min_confidence: args.min_confidence,
    total_scanned: classifiedRows.length,
    candidate_count: candidates.length,
    candidate_sources: countBySource(candidates),
    allowed_sources: allowedSources,
    missing_allowed_sources: missingSources,
    affected_candidates_count: affectedCandidates.length,
    examples_by_missing_source: examplesByMissingSource,
  };
}

function printPreflightSummary(
  report: PreflightAllowlistReport,
  saved: { jsonPath: string; mdPath: string },
): void {
  console.log(
    [
      `preflight_allowlist`,
      `scanned=${report.total_scanned}`,
      `candidates=${report.candidate_count}`,
      `candidate_sources=${report.candidate_sources.map((item) => `${item.source_code}:${item.count}`).join(",")}`,
      `missing=${report.missing_allowed_sources.join(",") || "(none)"}`,
      `affected=${report.affected_candidates_count}`,
      `json=${saved.jsonPath}`,
      `md=${saved.mdPath}`,
    ].join(" | "),
  );
  for (const sourceCode of report.missing_allowed_sources) {
    const examples = report.examples_by_missing_source[sourceCode] ?? [];
    console.log(
      `missing_source=${sourceCode} | examples=${
        examples.map((example) =>
          `${example.title ?? "(untitled)"} -> ${example.proposed_job_family}/${example.confidence}/${example.rule_id}`
        ).join(" ; ")
      }`,
    );
  }
}

function printBatchSummary(summary: BatchSummary): void {
  console.log(
    [
      `batch=${summary.batch_number}`,
      `mode=${summary.run_mode}`,
      `scanned=${summary.total_scanned}`,
      `candidates=${summary.candidate_count}`,
      `written=${summary.written_count}`,
      `total=${summary.total_written_so_far}`,
      `conformant=${summary.already_conformant_or_no_rewrite_count}`,
      `runtime_other=${summary.runtime_other_count}`,
      `anomalies=${summary.anomalies_count}`,
      `top_sources=${summary.top_sources.map((item) => `${item.source_code}:${item.count}`).join(",")}`,
      `top_families=${summary.top_families.map((item) => `${item.family_key}:${item.count}`).join(",")}`,
      `report=${summary.report_path}`,
    ].join(" | "),
  );
}

async function runRollout(
  client: Client,
  args: ReturnType<typeof parseArgs>,
): Promise<void> {
  const startedAt = new Date().toISOString();
  if (args.apply) {
    const preflightReport = await buildAllowlistPreflightReport(client, args);
    const savedPreflight = await savePreflightReport(
      args.output_dir,
      preflightReport,
    );
    printPreflightSummary(preflightReport, savedPreflight);
    if (preflightReport.missing_allowed_sources.length > 0) {
      const rolloutReport: RolloutReport = {
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        rollout_max_total: args.rollout_max_total,
        rollout_batch_write: args.rollout_batch_write,
        min_confidence: args.min_confidence,
        apply: args.apply,
        total_written: 0,
        total_batches: 0,
        stopped_reason: "missing_allowed_sources",
        per_batch_summary: [],
        aggregated_top_sources: [],
        aggregated_top_families: [],
        anomalies: [{
          type: "missing_allowed_sources",
          missing_allowed_sources: preflightReport.missing_allowed_sources,
          affected_candidates_count:
            preflightReport.affected_candidates_count,
          preflight_report_path: savedPreflight.jsonPath,
        }],
      };
      const savedRollout = await saveRolloutReport(
        args.output_dir,
        rolloutReport,
      );
      console.log(
        [
          `rollout_final total_written=0`,
          `batches=0`,
          `stopped_reason=missing_allowed_sources`,
          `json=${savedRollout.jsonPath}`,
          `md=${savedRollout.mdPath}`,
        ].join(" | "),
      );
      return;
    }
  }

  const seenCandidateIds = new Set<string>();
  const perBatchSummary: BatchSummary[] = [];
  const sourceCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const anomalies: Array<Record<string, unknown>> = [];
  let totalWritten = 0;
  let stoppedReason = "rollout_max_total_reached";

  while (totalWritten < args.rollout_max_total) {
    const remaining = args.rollout_max_total - totalWritten;
    const batchWrite = Math.min(args.rollout_batch_write, remaining);
    const batchNumber = perBatchSummary.length + 1;
    let report: RunReportWithPath;

    try {
      report = await runControlledWriteBatch(
        client,
        args,
        batchWrite,
        seenCandidateIds,
      );
    } catch (error) {
      stoppedReason = "exception";
      anomalies.push({
        type: "rollout_exception",
        batch_number: batchNumber,
        message: error instanceof Error ? error.message : String(error),
      });
      break;
    }

    for (const example of report.candidate_examples) {
      seenCandidateIds.add(example.job_id);
    }
    totalWritten += report.written_count;

    const topFamilies = countByFamilyFromExamples(report.candidate_examples)
      .slice(0, 10);
    mergeCounts(sourceCounts, report.top_written_sources, "source_code");
    mergeCounts(familyCounts, topFamilies, "family_key");

    const summary: BatchSummary = {
      batch_number: batchNumber,
      run_mode: report.run_mode,
      total_scanned: report.total_scanned,
      candidate_count: report.candidate_count,
      written_count: report.written_count,
      total_written_so_far: totalWritten,
      already_conformant_or_no_rewrite_count:
        report.already_conformant_or_no_rewrite_count,
      runtime_other_count: report.runtime_other_count,
      anomalies_count: report.anomalies.length,
      top_sources: report.top_written_sources.slice(0, 5),
      top_families: topFamilies.slice(0, 5),
      report_path: report.report_path,
    };
    perBatchSummary.push(summary);
    printBatchSummary(summary);

    if (report.anomalies.length > 0) {
      stoppedReason = "anomalies_detected";
      anomalies.push(...report.anomalies);
      break;
    }
    if (report.runtime_other_count > 0) {
      stoppedReason = "runtime_other_detected";
      break;
    }
    if (report.written_count === 0) {
      stoppedReason = "written_count_zero";
      break;
    }
    if (totalWritten >= args.rollout_max_total) {
      stoppedReason = "rollout_max_total_reached";
      break;
    }
  }

  const rolloutReport: RolloutReport = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    rollout_max_total: args.rollout_max_total,
    rollout_batch_write: args.rollout_batch_write,
    min_confidence: args.min_confidence,
    apply: args.apply,
    total_written: totalWritten,
    total_batches: perBatchSummary.length,
    stopped_reason: stoppedReason,
    per_batch_summary: perBatchSummary,
    aggregated_top_sources: sortedCounts(sourceCounts, "source_code") as Array<
      { source_code: string; count: number }
    >,
    aggregated_top_families: sortedCounts(familyCounts, "family_key") as Array<
      { family_key: string; count: number }
    >,
    anomalies: anomalies.slice(0, 25),
  };
  const saved = await saveRolloutReport(args.output_dir, rolloutReport);
  console.log(
    [
      `rollout_final total_written=${rolloutReport.total_written}`,
      `batches=${rolloutReport.total_batches}`,
      `stopped_reason=${rolloutReport.stopped_reason}`,
      `json=${saved.jsonPath}`,
      `md=${saved.mdPath}`,
    ].join(" | "),
  );
}

function countByFamilyFromExamples(
  rows: ReportExample[],
): Array<{ family_key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(
      row.proposed_job_family,
      (counts.get(row.proposed_job_family) ?? 0) + 1,
    );
  }
  return Array.from(counts.entries())
    .map(([family_key, count]) => ({ family_key, count }))
    .sort((left, right) =>
      right.count - left.count ||
      left.family_key.localeCompare(right.family_key)
    );
}

async function main() {
  const args = parseArgs();
  const password = await readDbPassword();
  const poolerUrl = await readPoolerUrl();
  const client = buildClient(poolerUrl, password);

  await client.connect();
  try {
    if (args.preflight_allowlist) {
      const report = await buildAllowlistPreflightReport(client, args);
      const saved = await savePreflightReport(args.output_dir, report);
      printPreflightSummary(report, saved);
      return;
    }

    if (args.rollout) {
      await runRollout(client, args);
      return;
    }

    const report = await runControlledWriteBatch(
      client,
      args,
      args.max_write,
    );
    if (args.summary_only) {
      const summary: BatchSummary = {
        batch_number: 1,
        run_mode: report.run_mode,
        total_scanned: report.total_scanned,
        candidate_count: report.candidate_count,
        written_count: report.written_count,
        total_written_so_far: report.written_count,
        already_conformant_or_no_rewrite_count:
          report.already_conformant_or_no_rewrite_count,
        runtime_other_count: report.runtime_other_count,
        anomalies_count: report.anomalies.length,
        top_sources: report.top_written_sources.slice(0, 5),
        top_families: countByFamilyFromExamples(report.candidate_examples)
          .slice(0, 5),
        report_path: report.report_path,
      };
      printBatchSummary(summary);
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    Deno.exit(1);
  }
}
