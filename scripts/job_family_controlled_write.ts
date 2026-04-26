import { Client } from "jsr:@db/postgres@0.19.4";

import type { JobFamilyClassification } from "../shared/jobradar/jobFamilyClassifier.ts";
import {
  classifyJobFamilyForControlledWrite,
  JOB_FAMILY_CONTROLLED_CLASSIFIER_VERSION,
} from "../shared/jobradar/jobFamilyControlledClassifier.ts";
import {
  getJobFamilySourcePolicy,
  isWriteSafeConfidence,
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

type BatchWriteResultRow = {
  job_id: string | null;
  action: string | null;
  skip_reason: string | null;
  enrichment_id: string | null;
  version: number | null;
  error_message: string | null;
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
  blocked_sources: string[];
  batch_size: number;
  total_scanned: number;
  candidate_count: number;
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
  anomalies: Array<Record<string, unknown>>;
};

function parseArgs() {
  const parsed = new Map<string, string>();
  for (const arg of Deno.args) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=", 2);
    parsed.set(key, value);
  }

  return {
    apply: parsed.get("apply") === "true",
    rollback: parsed.get("rollback") === "true",
    limit: parsed.has("limit") ? Number(parsed.get("limit")) : null,
    max_write: parsed.has("max-write") ? Number(parsed.get("max-write")) : null,
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

function buildCandidateRows(rows: ClassifiedRow[]) {
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
        [...JOB_FAMILY_BLOCKED_SOURCES],
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

  for (const chunk of chunkArray(rows, batchSize)) {
    const results = await callBatchFunction(client, chunk, rollback);
    for (const item of results) {
      const row = item.job_id ? byJobId.get(item.job_id) : null;
      const action = (item.action ?? "").trim().toLowerCase();
      const skipReason = (item.skip_reason ?? "").trim().toLowerCase();

      if (action === "written" && row) {
        writtenRows.push(row);
        continue;
      }

      if (row) skippedOther.push(row);

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

async function main() {
  const args = parseArgs();
  const startedAt = new Date().toISOString();
  const password = await readDbPassword();
  const poolerUrl = await readPoolerUrl();
  const client = buildClient(poolerUrl, password);

  await client.connect();
  try {
    const jobs = await fetchFeedVisibleJobs(client, args.limit);
    const classifiedRows: ClassifiedRow[] = jobs.map((job) => {
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

    const prepared = buildCandidateRows(classifiedRows);
    const candidateRows = args.max_write != null
      ? prepared.candidates.slice(0, Math.max(0, Math.trunc(args.max_write)))
      : prepared.candidates;

    let writtenRows: ClassifiedRow[] = [];
    let runtimeSkippedOther: ClassifiedRow[] = [];
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
      blocked_sources: [...JOB_FAMILY_BLOCKED_SOURCES],
      batch_size: args.batch_size,
      total_scanned: classifiedRows.length,
      candidate_count: candidateRows.length,
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
      anomalies: anomalies.slice(0, 25),
    };

    const jsonPath = await saveReport(args.output_dir, report);
    console.log(JSON.stringify(
      {
        ...report,
        rollback: args.rollback,
        report_path: jsonPath,
      },
      null,
      2,
    ));
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
