// supabase/functions/ingest_source/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AEJ_MAX_ITEMS_PER_RUN, fetchAejItems } from "./sources/aej_html.ts";
import { fetchAdzunaItems } from "./sources/adzuna_api.ts";
import { fetchEmploiCiItems } from "./sources/emploi_ci.ts";
import { fetchEmploiCiPortalItems } from "./sources/emploi_ci_portal.ts";
import { fetchEmploiMaPortalItems } from "./sources/emploi_ma_portal.ts";
import { fetchEmploiSenegalPortalItems } from "./sources/emploisenegal_portal.ts";
import { fetchFranceTravailItems } from "./sources/france_travail_api.ts";
import { fetchHimalayasItems } from "./sources/himalayas_api.ts";
import { fetchRssFeedItems } from "./sources/rss_generic.ts";
import { fetchReliefWebJobs } from "./sources/reliefweb_api.ts";
import {
  fetchProjobivoireRssDryRun,
  type ProjobivoireRssImportItem,
  type ProjobivoireRssCompareItem,
} from "./sources/projobivoire_rss.ts";
import { fetchMyJobMagPortalItems } from "./sources/myjobmag_portal.ts";
import { fetchMyJobMagRssItems } from "./sources/myjobmag_rss.ts";
import { fetchNgoJobsAfricaRssItems } from "./sources/ngojobs_africa_rss.ts";
import { fetchJobWebGhanaPortalItems } from "./sources/jobwebghana_portal.ts";
import { fetchHotNigerianJobsPortalItems } from "./sources/hotnigerianjobs_portal.ts";
import { fetchNovojobPortalItems } from "./sources/novojob_portal.ts";
import { fetchGoAfricaOnlineCiPortalItems } from "./sources/goafricaonline_ci_portal.ts";
import { fetchJobbermanPortalItems } from "./sources/jobberman_portal.ts";
import {
  buildCrossSourceJobIdentity,
  canonicalizeJobUrl,
} from "../_shared/jobIdentity.ts";
import {
  computeJobQuality,
  type JobQualityFlag,
  type JobQualityStatus,
} from "./_shared/jobQuality.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}_missing`);
  return v;
}

function baseHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  } as Record<string, string>;
}

async function sbGet<T>(url: string, serviceKey: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: baseHeaders(serviceKey),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_get_failed: ${res.status}\n${t}`);
  }
  return (await res.json()) as T;
}

async function sbInsertOne<T>(
  url: string,
  serviceKey: string,
  row: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_insert_failed: ${res.status}\n${t}`);
  }
  return (await res.json()) as T;
}

async function sbPatch<T>(
  url: string,
  serviceKey: string,
  patch: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_patch_failed: ${res.status}\n${t}`);
  }
  return (await res.json()) as T;
}

async function createRun(
  supabaseUrl: string,
  serviceKey: string,
  jobSourceId: string,
  runKind: string,
) {
  try {
    const url = `${supabaseUrl}/rest/v1/job_source_runs`;
    const row = await sbInsertOne<Array<{ id: string }>>(url, serviceKey, {
      job_source_id: jobSourceId,
      run_kind: runKind,
      status: "running",
      fetched_count: 0,
      inserted_count: 0,
      updated_count: 0,
    });
    const id = row?.[0]?.id ? String(row[0].id) : null;
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

async function finishRun(
  supabaseUrl: string,
  serviceKey: string,
  runId: string | null,
  patch: Record<string, unknown>,
) {
  if (!runId) return;
  try {
    const url = `${supabaseUrl}/rest/v1/job_source_runs?id=eq.${
      encodeURIComponent(runId)
    }`;
    await sbPatch(url, serviceKey, patch);
  } catch {
    // best effort only
  }
}

async function patchJobSourceMetadata(
  supabaseUrl: string,
  serviceKey: string,
  jobSourceId: string | null | undefined,
  patch: Record<string, unknown>,
) {
  if (!jobSourceId) return;
  try {
    const url = `${supabaseUrl}/rest/v1/job_sources?id=eq.${
      encodeURIComponent(jobSourceId)
    }`;
    await sbPatch(url, serviceKey, patch);
  } catch {
    // best effort only
  }
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTitleCompany(rawTitle: string) {
  const title = rawTitle.trim();
  const separators = [" @ ", " - ", " | "];
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { title: parts[0], company: parts[1] };
      }
    }
  }
  return { title, company: "" };
}

function detectJobType(title: string, desc: string) {
  const text = `${title} ${desc}`.toLowerCase();
  if (/(volunteer|volunteering|volontariat)/.test(text)) return "volunteering";
  if (/(alternance|apprentissage|apprenticeship|apprenti)/.test(text)) {
    return "apprenticeship";
  }
  if (
    /(internship|intern\b|trainee|stagiaire|stage|graduate programme|graduate program)/
      .test(text)
  ) {
    return "internship";
  }
  return null;
}

function deriveJobStatus(isExpired?: boolean) {
  return isExpired ? "expired" : "active";
}

function dedupeRowsByExternalId<T extends { external_id?: string }>(rows: T[]) {
  const byId = new Map<string, T>();
  const noId: T[] = [];
  for (const row of rows) {
    const key = (row?.external_id ?? "").trim();
    if (!key) {
      noId.push(row);
      continue;
    }
    byId.set(key, row);
  }
  return noId.concat(Array.from(byId.values()));
}

function countDuplicateExternalIds(
  rows: Array<{ external_id?: string | null }>,
) {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = (row?.external_id ?? "").trim();
    if (!key) continue;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
  }
  return duplicates;
}

function countMissingExpiresAt(rows: Array<{ expires_at?: string | null }>) {
  return rows.filter((row) => !row.expires_at).length;
}

function countExpiredAtBirth(rows: Array<{ is_expired?: boolean | null }>) {
  return rows.filter((row) => row.is_expired === true).length;
}

function normalizeOptionalUrl(raw: string | null | undefined) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  const normalized = canonicalizeJobUrl(value).canonicalUrl;
  return normalized && normalized.length ? normalized : null;
}

function toPositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const integer = Math.trunc(parsed);
  return integer > 0 ? integer : null;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
}

function hasOwnKey(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasDiagnosticPaginationParams(body: Record<string, unknown>) {
  return ["start_page", "startPage", "max_pages", "maxPages"].some((key) =>
    hasOwnKey(body, key)
  );
}

function sumNumericField(rows: unknown, field: string) {
  if (!Array.isArray(rows)) return null;
  return rows.reduce((total, row) => {
    const value = asPlainObject(row)[field];
    const numeric = Number(value);
    return total + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
}

function countPagesWithItems(rows: unknown) {
  if (!Array.isArray(rows)) return null;
  return rows.filter((row) => {
    const stat = asPlainObject(row);
    const parsed = Number(stat.parsed_count);
    const added = Number(stat.added_count);
    return (Number.isFinite(parsed) && parsed > 0) ||
      (Number.isFinite(added) && added > 0);
  }).length;
}

function buildCiRunMeta(params: {
  sourceCode: string;
  requestedLimit: number;
  effectiveLimit: number;
  writeMode: "dry_run" | "import";
  insertedCount: number;
  updatedCount: number;
  data: Record<string, unknown>;
  rotation?: {
    sourceCode: string;
    stateKey: string;
    startPage: number;
    maxPages: number;
    nextStartPage: number;
    startPages: number[];
  };
}) {
  const pageStats = Array.isArray(params.data.page_stats)
    ? params.data.page_stats
    : [];
  const rotationWindow = params.rotation
    ? {
      start_page: params.rotation.startPage,
      end_page: params.rotation.startPage + params.rotation.maxPages - 1,
      max_pages: params.rotation.maxPages,
    }
    : null;
  const pagination: Record<string, unknown> = {
    source_code: params.sourceCode,
    requested_limit: params.requestedLimit,
    effective_limit: params.effectiveLimit,
    start_page: params.data.effective_start_page ?? null,
    max_pages: params.data.effective_max_pages ?? null,
    pages_fetched: params.data.pages_fetched ?? null,
    next_start_page: params.rotation?.nextStartPage ?? null,
    rotation_window: rotationWindow,
    rotation_start_pages: params.rotation?.startPages ?? null,
    rotation_state_key: params.rotation?.stateKey ?? null,
    pages_with_items: countPagesWithItems(pageStats),
    items_parsed: params.data.parsed ?? null,
    items_deduplicated: sumNumericField(pageStats, "duplicate_count"),
    empty_pages_consecutive: null,
    stopped_reason: params.data.stopped_reason ?? null,
    parsed_count_by_page: params.data.parsed_count_by_page ?? {},
    page_stats: pageStats,
  };

  if (typeof params.data.skipped_quality_count === "number") {
    pagination.skipped_quality_count = params.data.skipped_quality_count;
  }

  return {
    pagination,
    write_mode: params.writeMode,
    inserted_count: params.insertedCount,
    updated_count: params.updatedCount,
  };
}

const CI_PAGINATION_ROTATION_CONFIG: Record<
  string,
  { stateKey: string; startPages: number[]; maxPages: number }
> = {
  emploi_ci: {
    stateKey: "emploi_ci",
    startPages: [1, 6, 11, 16, 21, 26],
    maxPages: 5,
  },
  emploi_ci__dup__17d5574e: {
    stateKey: "emploi_ci__dup__17d5574e",
    startPages: [1, 6, 11],
    maxPages: 5,
  },
};

function getCiPaginationRotation(
  sourceCode: string,
  ingestConfig: Record<string, unknown>,
) {
  const config = CI_PAGINATION_ROTATION_CONFIG[sourceCode] ??
    CI_PAGINATION_ROTATION_CONFIG.emploi_ci;
  const runtimeState = asPlainObject(ingestConfig.runtime_state);
  const rotationRoot = asPlainObject(runtimeState.ci_pagination_rotation);
  const sourceState = asPlainObject(rotationRoot[config.stateKey]);
  const rawNextStartPage = Number(
    sourceState.next_start_page ?? sourceState.nextStartPage,
  );
  const candidateStartPage = Number.isFinite(rawNextStartPage)
    ? Math.trunc(rawNextStartPage)
    : 1;
  const startPage = config.startPages.includes(candidateStartPage)
    ? candidateStartPage
    : 1;
  const currentIndex = config.startPages.indexOf(startPage);
  const nextStartPage =
    config.startPages[(currentIndex + 1) % config.startPages.length] ?? 1;

  return {
    sourceCode,
    stateKey: config.stateKey,
    startPage,
    maxPages: config.maxPages,
    nextStartPage,
    startPages: config.startPages,
  };
}

function buildNextCiRuntimeState(params: {
  ingestConfig: Record<string, unknown>;
  rotation: ReturnType<typeof getCiPaginationRotation>;
  finishedAt: string;
  data: Record<string, unknown>;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
}) {
  const runtimeState = asPlainObject(params.ingestConfig.runtime_state);
  const rotationRoot = asPlainObject(runtimeState.ci_pagination_rotation);
  const previousSourceState = asPlainObject(
    rotationRoot[params.rotation.stateKey],
  );

  return {
    ...runtimeState,
    ci_pagination_rotation: {
      ...rotationRoot,
      [params.rotation.stateKey]: {
        ...previousSourceState,
        source_code: params.rotation.sourceCode,
        start_pages: params.rotation.startPages,
        window_size_pages: params.rotation.maxPages,
        last_start_page: params.rotation.startPage,
        next_start_page: params.rotation.nextStartPage,
        last_pages_fetched: params.data.pages_fetched ?? null,
        last_stopped_reason: params.data.stopped_reason ?? null,
        last_fetched: params.fetchedCount,
        last_inserted: params.insertedCount,
        last_updated: params.updatedCount,
        last_success_at: params.finishedAt,
      },
    },
  };
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter(Boolean),
    ),
  );
}

async function fetchKnownJobValues(
  supabase: any,
  jobSourceId: string,
  column: "source_url" | "external_id",
  values: string[],
) {
  const known = new Set<string>();
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const { data, error } = await supabase
      .from("jobs")
      .select(column)
      .eq("job_source_id", jobSourceId)
      .in(column, chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of data ?? []) {
      const value = typeof row?.[column] === "string" ? row[column].trim() : "";
      if (value) known.add(value);
    }
  }
  return known;
}

async function compareDryRunCandidatesWithDb(
  supabaseUrl: string,
  serviceKey: string,
  jobSourceId: string,
  items: Array<{
    external_id?: string | null;
    source_url?: string | null;
    title?: string | null;
  }>,
) {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const sourceUrls = uniqueNonEmptyStrings(
    items.map((item) => item.source_url),
  );
  const externalIds = uniqueNonEmptyStrings(
    items.map((item) => item.external_id),
  );

  try {
    const knownUrls = sourceUrls.length > 0
      ? await fetchKnownJobValues(
        supabase,
        jobSourceId,
        "source_url",
        sourceUrls,
      )
      : new Set<string>();
    const knownExternalIds = externalIds.length > 0
      ? await fetchKnownJobValues(
        supabase,
        jobSourceId,
        "external_id",
        externalIds,
      )
      : new Set<string>();
    const knownExternalIdCount = items.filter((item) => {
      const externalId = typeof item.external_id === "string"
        ? item.external_id.trim()
        : "";
      return externalId && knownExternalIds.has(externalId);
    }).length;
    const newExternalIdCount = items.filter((item) => {
      const externalId = typeof item.external_id === "string"
        ? item.external_id.trim()
        : "";
      return externalId && !knownExternalIds.has(externalId);
    }).length;
    const knownUrlCount = items.filter((item) => {
      const sourceUrl = typeof item.source_url === "string"
        ? item.source_url.trim()
        : "";
      return sourceUrl && knownUrls.has(sourceUrl);
    }).length;
    const newCandidates = items.filter((item) => {
      const externalId = typeof item.external_id === "string"
        ? item.external_id.trim()
        : "";
      const sourceUrl = typeof item.source_url === "string"
        ? item.source_url.trim()
        : "";
      return externalId && sourceUrl && !knownExternalIds.has(externalId) &&
        !knownUrls.has(sourceUrl);
    });

    return {
      db_comparison_available: true,
      db_comparison_reason: null,
      known_url_count: knownUrlCount,
      new_candidate_count: newCandidates.length,
      known_external_id_count: knownExternalIdCount,
      new_external_id_count: newExternalIdCount,
      sample_new: newCandidates.slice(0, 10).map((item) => ({
        external_id: item.external_id ?? null,
        title: item.title ?? null,
        source_url: item.source_url ?? null,
      })),
    };
  } catch (error) {
    return {
      db_comparison_available: false,
      db_comparison_reason: error instanceof Error
        ? `jobs_lookup_failed:${error.message}`
        : "jobs_lookup_failed",
      known_url_count: null,
      new_candidate_count: null,
      known_external_id_count: null,
      new_external_id_count: null,
      sample_new: [],
    };
  }
}

function commercialDryRunResponse(data: {
  source_code: string;
  source_family: string;
  dry_run: true;
  detected_country: string | null;
  list_url: string;
  parsed_count: number;
  fetched_count: number;
  feeds_fetched: number;
  pages_fetched: number;
  skipped_quality_count: number;
  stopped_reason: string;
  sample_jobs: unknown[];
  meta: Record<string, unknown>;
}) {
  return {
    ok: true,
    source_code: data.source_code,
    dry_run: true,
    status: "dry_run_parsed",
    source_family: data.source_family,
    detected_country: data.detected_country,
    list_url: data.list_url,
    parsed: data.parsed_count,
    parsed_count: data.parsed_count,
    fetched_count: data.fetched_count,
    feeds_fetched: data.feeds_fetched,
    pages_fetched: data.pages_fetched,
    skipped_quality_count: data.skipped_quality_count,
    stopped_reason: data.stopped_reason,
    sample: data.sample_jobs.slice(0, 3),
    sample_jobs: data.sample_jobs.slice(0, 5),
    meta: data.meta,
  };
}

function normalizeAdzunaSortMode(value: unknown): "freshness" | "exploration" {
  return value === "freshness" ? "freshness" : "exploration";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ADZUNA_ACTIVE_WINDOW_DAYS = 60;

function roundMetric(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function computeOfferFreshnessMetrics(
  items: Array<{ published_at?: string | null }>,
  referenceDate = new Date(),
) {
  const referenceTime = referenceDate.getTime();
  const offerAgesDays: number[] = [];

  for (const item of items) {
    const publishedAt = typeof item?.published_at === "string"
      ? item.published_at.trim()
      : "";
    if (!publishedAt) continue;

    const publishedTime = Date.parse(publishedAt);
    if (!Number.isFinite(publishedTime)) continue;

    const ageDays = Math.max(0, (referenceTime - publishedTime) / MS_PER_DAY);
    offerAgesDays.push(ageDays);
  }

  if (offerAgesDays.length === 0) {
    return {
      avg_offer_age_days: null,
      pct_offers_under_7_days: null,
      median_offer_age_days: null,
      pct_offers_under_3_days: null,
    };
  }

  const sortedAgesDays = [...offerAgesDays].sort((a, b) => a - b);
  const avgAgeDays = sortedAgesDays.reduce((sum, value) => sum + value, 0) /
    sortedAgesDays.length;
  const middleIndex = Math.floor(sortedAgesDays.length / 2);
  const medianAgeDays = sortedAgesDays.length % 2 === 0
    ? (sortedAgesDays[middleIndex - 1] + sortedAgesDays[middleIndex]) / 2
    : sortedAgesDays[middleIndex];
  const pctUnderDays = (thresholdDays: number) =>
    (sortedAgesDays.filter((value) => value < thresholdDays).length * 100) /
    sortedAgesDays.length;

  return {
    avg_offer_age_days: roundMetric(avgAgeDays),
    pct_offers_under_7_days: roundMetric(pctUnderDays(7)),
    median_offer_age_days: roundMetric(medianAgeDays),
    pct_offers_under_3_days: roundMetric(pctUnderDays(3)),
  };
}

function normalizeAdzunaExplicitExpiresAt(
  payload: Record<string, unknown> | null | undefined,
) {
  const raw = asPlainObject(payload);
  const candidate = raw.expiry_date ?? raw.expiration_date ?? raw.expires_at;
  const text = typeof candidate === "string"
    ? candidate.trim()
    : typeof candidate === "number"
    ? String(candidate)
    : null;

  if (!text) return null;

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeAdzunaLifecycle(
  item: {
    published_at?: string | null;
    payload?: Record<string, unknown> | null;
  },
  referenceDate = new Date(),
) {
  const referenceTime = referenceDate.getTime();
  const publishedAt =
    typeof item.published_at === "string" && item.published_at.trim()
      ? item.published_at.trim()
      : null;
  const explicitExpiresAt = normalizeAdzunaExplicitExpiresAt(item.payload);
  const publishedTime = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  const publishedIsRecent = Number.isFinite(publishedTime) &&
    Math.max(0, (referenceTime - publishedTime) / MS_PER_DAY) <=
      ADZUNA_ACTIVE_WINDOW_DAYS;
  const explicitExpiryPassed = explicitExpiresAt
    ? Date.parse(explicitExpiresAt) <= referenceTime
    : false;
  const shouldBeActive = publishedIsRecent && !explicitExpiryPassed;
  const shouldBeExpired = !shouldBeActive;

  return {
    published_at: publishedAt,
    expires_at: explicitExpiresAt,
    is_active: shouldBeActive,
    is_expired: shouldBeExpired,
    job_status: deriveJobStatus(shouldBeExpired),
  };
}

class JobsUpsertFailedError extends Error {
  inserted: number;
  updated: number;
  chunkIndex: number | null;

  constructor(
    message: string,
    inserted = 0,
    updated = 0,
    chunkIndex: number | null = null,
  ) {
    super(message);
    this.name = "JobsUpsertFailedError";
    this.inserted = inserted;
    this.updated = updated;
    this.chunkIndex = chunkIndex;
  }
}

async function upsertJobsWithStats(
  supabase: any,
  rows: Array<{ external_id?: string }>,
  options?: { batchSize?: number | null },
) {
  const uniqueRows = dedupeRowsByExternalId(rows);
  const externalIds = uniqueRows
    .map((row) => (row.external_id ?? "").trim())
    .filter(Boolean);
  const requestedBatchSize = toPositiveInt(options?.batchSize);
  const fallbackBatchSize = uniqueRows.length || 1;
  const batchSize = Math.max(
    1,
    Math.min(fallbackBatchSize, requestedBatchSize ?? fallbackBatchSize),
  );

  let existingIds = new Set<string>();
  if (externalIds.length > 0) {
    for (let i = 0; i < externalIds.length; i += batchSize) {
      const idChunk = externalIds.slice(i, i + batchSize);
      const { data: existingRows, error: existingErr } = await supabase
        .from("jobs")
        .select("external_id")
        .in("external_id", idChunk);

      if (existingErr) {
        throw new JobsUpsertFailedError(
          existingErr.message,
          0,
          0,
          Math.floor(i / batchSize) + 1,
        );
      }
      for (
        const existingId of (existingRows ?? [])
          .map((row: { external_id?: string | null }) =>
            (row.external_id ?? "").trim()
          )
          .filter(Boolean)
      ) {
        existingIds.add(existingId);
      }
    }
  }

  const inserted =
    externalIds.filter((externalId) => !existingIds.has(externalId)).length;
  const updated =
    externalIds.filter((externalId) => existingIds.has(externalId)).length;

  let insertedCommitted = 0;
  let updatedCommitted = 0;
  for (let i = 0; i < uniqueRows.length; i += batchSize) {
    const chunkIndex = Math.floor(i / batchSize) + 1;
    const chunk = uniqueRows.slice(i, i + batchSize);
    const chunkExternalIds = chunk
      .map((row) => (row.external_id ?? "").trim())
      .filter(Boolean);
    const chunkInserted = chunkExternalIds.filter((externalId) =>
      !existingIds.has(externalId)
    ).length;
    const chunkUpdated = chunkExternalIds.filter((externalId) =>
      existingIds.has(externalId)
    ).length;

    const { error: upErr } = await supabase
      .from("jobs")
      .upsert(chunk, { onConflict: "external_id" });

    if (upErr) {
      throw new JobsUpsertFailedError(
        upErr.message,
        insertedCommitted,
        updatedCommitted,
        chunkIndex,
      );
    }

    insertedCommitted += chunkInserted;
    updatedCommitted += chunkUpdated;
  }

  return {
    uniqueRows,
    inserted,
    updated,
    upsertChunkSize: batchSize,
    upsertChunkCount: Math.ceil(uniqueRows.length / batchSize),
  };
}

type ScrapedItem = {
  external_id?: string;
  title: string;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  contract_type?: string | null;
  sector?: string | null;
  experience?: string | null;
  posted_at?: string | null;
  description_text?: string | null;
  description_html?: string | null;
  source_url: string;
  apply_url?: string | null;
  published_at?: string | null;
  expires_at?: string | null;
  is_expired?: boolean;
};

async function buildExternalId(sourceCode: string, item: ScrapedItem) {
  const raw = (item.external_id ?? "").trim();
  if (raw) return raw;
  const normalizedTitle = (item.title ?? "").replace(/\s+/g, " ").trim();
  const normalizedSourceUrl = normalizeOptionalUrl(item.source_url) ?? "";
  const seed = `${normalizedTitle}|${normalizedSourceUrl}|${
    item.published_at ?? ""
  }`;
  const hash = await sha256Hex(seed);
  return `${sourceCode}:${hash}`;
}

async function mapScrapedItemsToRows(
  items: ScrapedItem[],
  jobSource: any,
  sourceCode: string,
  listUrl: string,
) {
  const now = new Date().toISOString();
  const rows = [];

  for (const it of items) {
    const external_id = await buildExternalId(sourceCode, it);
    const title = (it.title || "Offre d'emploi").trim();
    const desc = it.description_text || "";
    const jobType = detectJobType(title, desc);
    const postedAt = it.posted_at ?? it.published_at ?? null;
    const sourceUrl = normalizeOptionalUrl(it.source_url) ??
      normalizeOptionalUrl(it.apply_url);
    const applyUrl = normalizeOptionalUrl(it.apply_url) ?? sourceUrl;
    const location = it.location ?? jobSource.region ?? null;
    const companyName = it.company_name ?? null;
    const identity = await buildCrossSourceJobIdentity({
      title,
      companyName,
      location,
      sourceUrl,
      applyUrl,
    });

    rows.push({
      job_source_id: jobSource.id,
      external_id,
      title,
      company_name: companyName,
      location,
      country: it.country ?? jobSource.country ?? null,
      remote_type: null,
      contract_type: it.contract_type ?? null,
      seniority: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description_html: it.description_html ?? null,
      description_text: it.description_text ?? null,
      apply_url: applyUrl,
      source_url: sourceUrl,
      canonical_url: identity.canonicalUrl,
      dedupe_identity_key: identity.dedupeIdentityKey,
      cross_source_fingerprint: identity.crossSourceFingerprint,
      tags: [],
      posted_at: postedAt,
      published_at: it.published_at ?? null,
      expires_at: it.expires_at ?? null,
      scraped_at: now,
      updated_at: now,
      last_seen_at: now,
      is_active: it.is_expired ? false : true,
      is_expired: it.is_expired ?? false,
      job_status: deriveJobStatus(it.is_expired),
      job_type: jobType,
      job_json: {
        source_code: sourceCode,
        list_url: listUrl,
        sector: it.sector ?? null,
        experience: it.experience ?? null,
        posted_at: postedAt,
      },
    });
  }

  return rows;
}

const GOAFRICAONLINE_CI_QUALITY_TERMS = [
  "betting",
  "casino",
  "gambling",
  "1xbet",
  "melbet",
  "crypto",
  "mlm",
  "parrainage",
  "revenus passifs",
  "trading miracle",
  "whatsapp only",
  "whatsapp-only",
];

function normalizeGuardSignal(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isRealGoAfricaOnlineCiJobUrl(rawUrl: string | null | undefined) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return false;
  if (/(sharer\.php|\/share\b|share=|whatsapp|linkedin|facebook|twitter)/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    return hostname === "goafricaonline.com" && /^\/ci\/emploi\/job-\d+-[^/]+$/i.test(pathname);
  } catch {
    return false;
  }
}

function goAfricaOnlineCiImportRejectionReason(item: ScrapedItem) {
  const title = (item.title ?? "").trim();
  const companyName = (item.company_name ?? "").trim();
  const country = (item.country ?? "").trim();
  const sourceUrl = item.source_url ?? "";
  if (!title || title.length < 5) return "missing_title";
  if (!companyName || companyName.length < 2) return "missing_company_name";
  if (country !== "Cote d'Ivoire") return "invalid_country";
  if (!isRealGoAfricaOnlineCiJobUrl(sourceUrl)) return "invalid_source_url";

  const haystack = normalizeGuardSignal(`${title} ${companyName} ${item.description_text ?? ""} ${sourceUrl}`);
  if (GOAFRICAONLINE_CI_QUALITY_TERMS.some((term) => haystack.includes(normalizeGuardSignal(term)))) {
    return "blocked_quality_term";
  }
  return null;
}

function isGoAfricaOnlineCiImportConfirmed(confirm: unknown, requestedLimit: number | null) {
  if (requestedLimit === null || requestedLimit > 150) return false;
  if (requestedLimit <= 50) return confirm === "IMPORT_GOAFRICAONLINE_CI_PORTAL";
  if (requestedLimit <= 100) return confirm === "IMPORT_GOAFRICAONLINE_CI_PORTAL_LIMIT_100";
  return confirm === "IMPORT_GOAFRICAONLINE_CI_PORTAL_LIMIT_150";
}

function parseRequiredProbeInt(
  body: Record<string, unknown>,
  key: string,
  max: number,
) {
  if (!hasOwnKey(body, key)) {
    return { value: null, error: `missing_${key}` };
  }

  const parsed = Number(body[key]);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed < 1) {
    return { value: null, error: `${key}_must_be_positive_integer` };
  }

  if (parsed > max) {
    return { value: null, error: `${key}_exceeds_${max}` };
  }

  return { value: parsed, error: null };
}

function validateProjobivoireControlledImportProbe(
  body: Record<string, unknown>,
) {
  const errors: string[] = [];

  const isManualProbe =
    body.trigger === "manual_probe" &&
    body.run_kind === "controlled_import_probe";
  const isControlledCronProbe =
    body.trigger === "controlled_cron_probe" &&
    body.run_kind === "controlled_cron_probe";

  if (body.source_code !== "projobivoire_rss") {
    errors.push("source_code_must_be_projobivoire_rss");
  }
  if (!hasOwnKey(body, "dry_run") || body.dry_run !== false) {
    errors.push("dry_run_must_be_false");
  }
  if (body.allow_import !== true) {
    errors.push("allow_import_must_be_true");
  }
  if (!isManualProbe && !isControlledCronProbe) {
    errors.push("trigger_run_kind_must_be_manual_probe_or_controlled_cron_probe");
  }
  if (isManualProbe && body.confirm !== "IMPORT_PROJOBIVOIRE_RSS_V1") {
    errors.push("confirm_must_be_IMPORT_PROJOBIVOIRE_RSS_V1");
  }
  if (isControlledCronProbe && hasOwnKey(body, "confirm")) {
    errors.push("confirm_must_be_omitted_for_controlled_cron_probe");
  }

  const limit = parseRequiredProbeInt(body, "limit", 15);
  if (limit.error) errors.push(limit.error);
  const maxPages = parseRequiredProbeInt(body, "max_pages", 2);
  if (maxPages.error) errors.push(maxPages.error);

  return {
    ok: errors.length === 0,
    errors,
    limit: limit.value,
    maxPages: maxPages.value,
    trigger: isControlledCronProbe ? "controlled_cron_probe" : "manual_probe",
    runKind: isControlledCronProbe ? "controlled_cron_probe" : "controlled_import_probe",
  };
}

function isImportableProjobivoireItem(item: ProjobivoireRssImportItem) {
  return item.country_classification === "probable_ci" &&
    item.is_expired !== true &&
    Boolean((item.title ?? "").trim()) &&
    Boolean((item.source_url ?? "").trim());
}

type ProjobivoireDbJobCandidate = {
  id?: string | null;
  title?: string | null;
  company_name?: string | null;
  source_url?: string | null;
  canonical_url?: string | null;
  expires_at?: string | null;
  job_source_id?: string | null;
  job_sources?: { code?: string | null } | Array<{ code?: string | null }> | null;
};

type ProjobivoireDuplicateSample = {
  projobivoire_title: string | null;
  projobivoire_company: string | null;
  projobivoire_canonical_url: string | null;
  matched_job_id: string | null;
  matched_source_code: string | null;
  matched_title: string | null;
  matched_company: string | null;
  duplicate_level: "strong" | "probable" | "weak";
  reasons: string[];
};

type ProjobivoireDbDuplicateDiagnostics = {
  compare_db: true;
  items_considered_for_db_compare: number;
  strong_duplicate_count: number;
  probable_duplicate_count: number;
  weak_match_count: number;
  unique_candidate_count: number;
  ambiguous_excluded_count: number;
  expired_excluded_count: number;
  db_candidates_scanned: number;
  matches_by_source_code: Record<string, number>;
  sample_duplicates: ProjobivoireDuplicateSample[];
  sample_unique_candidates: Array<{
    external_id_candidate: string | null;
    title: string | null;
    company: string | null;
    canonical_url_candidate: string | null;
    expires_at: string | null;
    country_classification: string;
  }>;
};

const PROJOBIVOIRE_DB_COMPARE_STOPWORDS = new Set([
  "assistant",
  "assistante",
  "junior",
  "senior",
  "stagiaire",
  "stage",
  "responsable",
  "chef",
  "directeur",
  "directrice",
  "manager",
  "coordinateur",
  "coordinatrice",
  "charge",
  "chargee",
  "technicien",
  "technicienne",
  "ingenieur",
  "expert",
  "consultante",
  "consultant",
  "analyste",
  "agent",
  "confirme",
  "confirmee",
  "experimente",
  "debutant",
  "emploi",
  "poste",
  "recrutement",
  "cote",
  "ivoire",
  "ci",
  "noc",
  "ter",
  "btp",
  "rh",
  "it",
  "si",
  "dsi",
  "daf",
  "drh",
  "gestion",
  "service",
  "services",
  "departement",
  "general",
  "generale",
  "adjoint",
  "adjointe",
  "hf",
  "fh",
  "h",
  "f",
  "abidjan",
  "pour",
  "avec",
  "dans",
  "une",
  "des",
  "les",
  "aux",
  "sur",
]);

function normalizeProjobivoireCompareValue(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countProjobivoireWhere<T>(items: T[], predicate: (item: T) => boolean) {
  return items.filter(predicate).length;
}

function tokenizeProjobivoireCompare(value: string | null | undefined) {
  return normalizeProjobivoireCompareValue(value)
    .split(/\s+/)
    .filter((token) =>
      token.length >= 3 && !PROJOBIVOIRE_DB_COMPARE_STOPWORDS.has(token)
    );
}

function pickProjobivoireTitleNeedle(title: string | null | undefined) {
  return tokenizeProjobivoireCompare(title)
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

function analyzeProjobivoireTitleTokens(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftTokens = new Set(tokenizeProjobivoireCompare(left));
  const rightTokens = new Set(tokenizeProjobivoireCompare(right));
  const sharedTokens: string[] = [];
  for (const token of leftTokens) {
    if (rightTokens.has(token)) sharedTokens.push(token);
  }
  const comparableTokenCount = Math.min(leftTokens.size, rightTokens.size);
  const score = leftTokens.size && rightTokens.size
    ? sharedTokens.length / Math.max(leftTokens.size, rightTokens.size)
    : 0;
  return {
    leftTokens,
    rightTokens,
    sharedTokens,
    comparableTokenCount,
    score,
  };
}

function tokenSimilarity(left: string | null | undefined, right: string | null | undefined) {
  return analyzeProjobivoireTitleTokens(left, right).score;
}

function sourceCodeFromDbCandidate(candidate: ProjobivoireDbJobCandidate) {
  const relation = candidate.job_sources;
  if (Array.isArray(relation)) return relation[0]?.code ?? null;
  return relation?.code ?? null;
}

function normalizeDateToken(value: string | null | undefined) {
  const normalized = normalizeProjobivoireCompareValue(value);
  if (!normalized) return "";
  const directDate = new Date(value ?? "");
  if (!Number.isNaN(directDate.getTime())) {
    return directDate.toISOString().slice(0, 10);
  }
  return normalized;
}

function classifyProjobivoireDbMatch(
  item: ProjobivoireRssCompareItem,
  candidate: ProjobivoireDbJobCandidate,
) {
  const reasons: string[] = [];
  const itemUrl = normalizeOptionalUrl(item.canonical_url_candidate);
  const candidateCanonicalUrl = normalizeOptionalUrl(candidate.canonical_url);
  const candidateSourceUrl = normalizeOptionalUrl(candidate.source_url);
  if (
    itemUrl &&
    (itemUrl === candidateCanonicalUrl || itemUrl === candidateSourceUrl)
  ) {
    reasons.push("same_canonical_or_source_url");
    return { level: "strong" as const, reasons };
  }

  const itemTitle = normalizeProjobivoireCompareValue(item.title);
  const candidateTitle = normalizeProjobivoireCompareValue(candidate.title);
  const itemCompany = normalizeProjobivoireCompareValue(item.company);
  const candidateCompany = normalizeProjobivoireCompareValue(candidate.company_name);
  const sameTitle = itemTitle.length > 0 && itemTitle === candidateTitle;
  const sameCompany = itemCompany.length > 0 && itemCompany === candidateCompany;
  const titleAnalysis = analyzeProjobivoireTitleTokens(item.title, candidate.title);
  const titleScore = titleAnalysis.score;
  const companyScore = tokenSimilarity(item.company, candidate.company_name);
  const itemDeadline = normalizeDateToken(item.expires_at);
  const candidateDeadline = normalizeDateToken(candidate.expires_at);
  const sameDeadline = itemDeadline.length > 0 && itemDeadline === candidateDeadline;
  const hasEnoughWeakTitleSignal = titleAnalysis.sharedTokens.length >= 2 ||
    (titleAnalysis.comparableTokenCount >= 3 && titleScore >= 0.82);

  if (sameTitle) reasons.push("same_normalized_title");
  if (sameCompany) reasons.push("same_normalized_company");
  if (titleAnalysis.sharedTokens.length > 0) {
    reasons.push(`shared_significant_tokens:${titleAnalysis.sharedTokens.join(",")}`);
  }
  if (titleScore >= 0.82) reasons.push(`title_similarity:${titleScore.toFixed(2)}`);
  if (companyScore >= 0.67) reasons.push(`company_similarity:${companyScore.toFixed(2)}`);
  if (sameDeadline) reasons.push("same_deadline");

  if (sameTitle && sameCompany) {
    return { level: "strong" as const, reasons };
  }
  if (titleScore >= 0.82 && (sameCompany || companyScore >= 0.67 || sameDeadline)) {
    return { level: "probable" as const, reasons };
  }
  if (
    hasEnoughWeakTitleSignal &&
    (titleScore >= 0.65 || (sameCompany && titleScore >= 0.45))
  ) {
    return { level: "weak" as const, reasons };
  }
  if (
    titleScore > 0 &&
    (titleAnalysis.leftTokens.size < 2 || titleAnalysis.rightTokens.size < 2)
  ) {
    reasons.push("insufficient_significant_title_tokens");
  }
  if (titleScore > 0 && titleAnalysis.sharedTokens.length < 2) {
    reasons.push("generic_only_match_ignored");
  }
  if (!sameCompany && companyScore < 0.67) {
    reasons.push("company_missing_or_different");
  }
  return null;
}

async function fetchProjobivoireDbCandidatesForItem(
  params: {
    supabaseUrl: string;
    serviceKey: string;
    item: ProjobivoireRssCompareItem;
  },
) {
  const select =
    "id,title,company_name,source_url,canonical_url,expires_at,job_source_id,job_sources(code)";
  const candidates = new Map<string, ProjobivoireDbJobCandidate>();
  const addCandidates = (rows: ProjobivoireDbJobCandidate[]) => {
    for (const row of rows) {
      const key = row.id ?? `${row.title ?? ""}|${row.company_name ?? ""}`;
      if (key) candidates.set(key, row);
    }
  };

  const url = normalizeOptionalUrl(params.item.canonical_url_candidate);
  if (url) {
    const urlQuery = `${params.supabaseUrl}/rest/v1/jobs?select=${select}` +
      `&or=(canonical_url.eq.${encodeURIComponent(url)},source_url.eq.${encodeURIComponent(url)})` +
      `&limit=10`;
    addCandidates(await sbGet<ProjobivoireDbJobCandidate[]>(urlQuery, params.serviceKey));
  }

  const titleNeedle = pickProjobivoireTitleNeedle(params.item.title);
  if (titleNeedle) {
    const titleQuery = `${params.supabaseUrl}/rest/v1/jobs?select=${select}` +
      `&title=ilike.*${encodeURIComponent(titleNeedle)}*` +
      `&order=created_at.desc&limit=25`;
    addCandidates(await sbGet<ProjobivoireDbJobCandidate[]>(titleQuery, params.serviceKey));
  }

  return [...candidates.values()].slice(0, 30);
}

async function compareProjobivoireDbDuplicates(
  params: {
    supabaseUrl: string;
    serviceKey: string;
    items: ProjobivoireRssCompareItem[];
  },
): Promise<ProjobivoireDbDuplicateDiagnostics> {
  const ambiguousExcludedCount = countProjobivoireWhere(
    params.items,
    (item) => item.country_classification === "ambiguous",
  );
  const expiredExcludedCount = countProjobivoireWhere(params.items, (item) => item.is_expired === true);
  const itemsToCompare = params.items.filter((item) =>
    item.country_classification === "probable_ci" && item.is_expired === false
  );

  let strongDuplicateCount = 0;
  let probableDuplicateCount = 0;
  let weakMatchCount = 0;
  let dbCandidatesScanned = 0;
  const matchesBySourceCode: Record<string, number> = {};
  const sampleDuplicates: ProjobivoireDuplicateSample[] = [];
  const sampleUniqueCandidates: ProjobivoireDbDuplicateDiagnostics["sample_unique_candidates"] = [];

  for (const item of itemsToCompare) {
    const candidates = await fetchProjobivoireDbCandidatesForItem({
      supabaseUrl: params.supabaseUrl,
      serviceKey: params.serviceKey,
      item,
    });
    dbCandidatesScanned += candidates.length;

    const matches = candidates
      .map((candidate) => ({
        candidate,
        match: classifyProjobivoireDbMatch(item, candidate),
      }))
      .filter((entry): entry is {
        candidate: ProjobivoireDbJobCandidate;
        match: NonNullable<ReturnType<typeof classifyProjobivoireDbMatch>>;
      } => Boolean(entry.match))
      .sort((left, right) => {
        const rank = { strong: 3, probable: 2, weak: 1 };
        return rank[right.match.level] - rank[left.match.level];
      });

    const best = matches[0] ?? null;
    if (!best) {
      if (sampleUniqueCandidates.length < 5) {
        sampleUniqueCandidates.push({
          external_id_candidate: item.external_id_candidate,
          title: item.title,
          company: item.company,
          canonical_url_candidate: item.canonical_url_candidate,
          expires_at: item.expires_at,
          country_classification: item.country_classification,
        });
      }
      continue;
    }

    if (best.match.level === "strong") strongDuplicateCount += 1;
    if (best.match.level === "probable") probableDuplicateCount += 1;
    if (best.match.level === "weak") weakMatchCount += 1;

    const sourceCode = sourceCodeFromDbCandidate(best.candidate) ?? "unknown";
    matchesBySourceCode[sourceCode] = (matchesBySourceCode[sourceCode] ?? 0) + 1;

    if (sampleDuplicates.length < 5) {
      sampleDuplicates.push({
        projobivoire_title: item.title,
        projobivoire_company: item.company,
        projobivoire_canonical_url: item.canonical_url_candidate,
        matched_job_id: best.candidate.id ?? null,
        matched_source_code: sourceCode,
        matched_title: best.candidate.title ?? null,
        matched_company: best.candidate.company_name ?? null,
        duplicate_level: best.match.level,
        reasons: best.match.reasons,
      });
    }
  }

  return {
    compare_db: true,
    items_considered_for_db_compare: itemsToCompare.length,
    strong_duplicate_count: strongDuplicateCount,
    probable_duplicate_count: probableDuplicateCount,
    weak_match_count: weakMatchCount,
    unique_candidate_count: Math.max(
      0,
      itemsToCompare.length - strongDuplicateCount - probableDuplicateCount - weakMatchCount,
    ),
    ambiguous_excluded_count: ambiguousExcludedCount,
    expired_excluded_count: expiredExcludedCount,
    db_candidates_scanned: dbCandidatesScanned,
    matches_by_source_code: matchesBySourceCode,
    sample_duplicates: sampleDuplicates,
    sample_unique_candidates: sampleUniqueCandidates,
  };
}

Deno.serve(async (req) => {
  // Healthcheck
  if (req.method === "GET") {
    return json({ ok: true, status: "ingest_source_alive" });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Auth via x-cron-secret
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    return json({ ok: false, error: "CRON_SECRET_not_set_in_env" }, 500);
  }

  const provided = req.headers.get("x-cron-secret");
  if (provided !== expected) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // Body JSON
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json_body" }, 400);
  }

  const source_code = body?.source_code;
  const limit = Number(body?.limit ?? 30);
  const dry_run = Boolean(body?.dry_run ?? false);
  const hasRequestedLimit = body?.limit !== undefined && body?.limit !== null;

  if (!source_code || typeof source_code !== "string") {
    return json({ ok: false, error: "missing_source_code" }, 400);
  }

  let currentRunId: string | null = null;
  try {
    if (source_code === "projobivoire_rss") {
      if (dry_run === true) {
        const compareDb = body?.compare_db === true;
        const data = await fetchProjobivoireRssDryRun({
          dryRun: true,
          maxPages: body?.max_pages ?? body?.maxPages,
          limit,
          includeItemsForDbCompare: compareDb,
        });

        const { items_for_db_compare, ...response } = data;
        if (!compareDb) {
          return json(response);
        }

        const supabaseUrl = mustEnv("SUPABASE_URL");
        const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
        const dbDuplicateDiagnostics = await compareProjobivoireDbDuplicates({
          supabaseUrl,
          serviceKey,
          items: items_for_db_compare ?? [],
        });

        return json({
          ...response,
          db_duplicate_diagnostics: dbDuplicateDiagnostics,
        });
      }

      const controlledProbe = validateProjobivoireControlledImportProbe(
        asPlainObject(body),
      );
      if (!controlledProbe.ok || controlledProbe.limit === null || controlledProbe.maxPages === null) {
        return json({
          ok: false,
          error: "projobivoire_rss_import_requires_controlled_probe",
          message:
            "projobivoire_rss real imports are blocked unless the controlled manual probe confirmation and limits are provided.",
          required: {
            source_code: "projobivoire_rss",
            dry_run: false,
            allow_import: true,
            confirm: "IMPORT_PROJOBIVOIRE_RSS_V1",
            limit: "1..15",
            max_pages: "1..2",
            trigger: controlledProbe.trigger,
            run_kind: controlledProbe.runKind,
          },
          validation_errors: controlledProbe.errors,
        }, 409);
      }

      const supabaseUrl = mustEnv("SUPABASE_URL");
      const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
      const jobSourceUrl = `${supabaseUrl}/rest/v1/job_sources?select=` +
        `id,code,name,ingest_method,ingest_config,is_active,ingest_status,country,region,priority,activated_at,last_ingested_at,last_success_at,last_checked_at` +
        `&code=eq.${encodeURIComponent(source_code)}&limit=1`;
      const jobSourceArr = await sbGet<any[]>(jobSourceUrl, serviceKey);
      const jobSource = jobSourceArr?.[0] ?? null;
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        controlledProbe.runKind,
      );
      currentRunId = runId;

      const data = await fetchProjobivoireRssDryRun({
        dryRun: true,
        maxPages: controlledProbe.maxPages,
        limit: controlledProbe.limit,
        includeItemsForImport: true,
      });

      if (!data.ok) {
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: "projobivoire_rss_probe_parse_failed",
          fetched_count: data.fetched_count,
          inserted_count: 0,
          updated_count: 0,
          meta: {
            trigger: controlledProbe.trigger,
            run_kind: controlledProbe.runKind,
            diagnostics: data.diagnostics,
          },
        });
        return json({
          ok: false,
          error: "projobivoire_rss_probe_parse_failed",
          dry_run: false,
          diagnostics: data.diagnostics,
        }, 502);
      }

      const importCandidates = (data.items_for_import ?? [])
        .filter(isImportableProjobivoireItem)
        .slice(0, controlledProbe.limit);
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      const now = new Date().toISOString();
      const rows = [];
      const qualityStatusCounts: Record<JobQualityStatus, number> = {
        active: 0,
        needs_review: 0,
        rejected: 0,
      };
      const qualityFlagCounts: Partial<Record<JobQualityFlag, number>> = {};
      for (const item of importCandidates) {
        const title = (item.title ?? "Offre d'emploi").trim();
        const descriptionText = (item.description_text ?? "").trim();
        const sourceUrl = normalizeOptionalUrl(item.source_url);
        const applyUrl = normalizeOptionalUrl(item.apply_url) ?? sourceUrl;
        const location = item.location ?? jobSource.region ?? null;
        const companyName = item.company_name ?? null;
        const quality = computeJobQuality({
          title,
          company_name: companyName,
          company_name_source: item.company_name_source,
          description_text: descriptionText || null,
          source_url: sourceUrl,
          expires_at: item.expires_at_iso,
          is_expired: item.is_expired,
          country_classification: item.country_classification,
        });
        qualityStatusCounts[quality.status] += 1;
        for (const flag of quality.flags) {
          qualityFlagCounts[flag] = (qualityFlagCounts[flag] ?? 0) + 1;
        }
        const identity = await buildCrossSourceJobIdentity({
          title,
          companyName,
          location,
          sourceUrl,
          applyUrl,
        });
        const externalId = item.external_id?.trim()
          ? item.external_id.trim()
          : await buildExternalId(source_code, {
            title,
            company_name: companyName,
            location,
            country: jobSource.country ?? null,
            contract_type: item.contract_type,
            description_html: item.description_html,
            description_text: descriptionText,
            source_url: sourceUrl ?? applyUrl ?? "",
            apply_url: applyUrl,
            published_at: item.published_at,
            expires_at: item.expires_at_iso,
            is_expired: item.is_expired ?? false,
          });
        const tags = item.category ? [item.category] : [];

        rows.push({
          job_source_id: jobSource.id,
          external_id: externalId,
          title,
          company_name: companyName,
          location,
          country: jobSource.country ?? "Cote d'Ivoire",
          remote_type: null,
          contract_type: item.contract_type,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: item.description_html,
          description_text: descriptionText || null,
          apply_url: applyUrl,
          source_url: sourceUrl,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags,
          posted_at: item.published_at,
          published_at: item.published_at,
          expires_at: item.expires_at_iso,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: quality.status === "active",
          is_expired: false,
          job_status: quality.status === "active" ? "active" : "stale",
          job_type: detectJobType(title, `${descriptionText} ${item.contract_type ?? ""}`),
          job_json: {
            _quality: quality,
            source_code,
            provider: "projobivoire_rss",
            trigger: controlledProbe.trigger,
            run_kind: controlledProbe.runKind,
            wp_post_id: item.wp_post_id,
            guid: item.guid,
            category: item.category,
            company_name_source: item.company_name_source,
            country_classification: item.country_classification,
            classification_reasons: item.classification_reasons,
            raw_expires_at: item.expires_at,
          },
        });
      }

      if (rows.length === 0) {
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "success",
          ok: true,
          fetched_count: 0,
          inserted_count: 0,
          updated_count: 0,
          meta: {
            trigger: controlledProbe.trigger,
            run_kind: controlledProbe.runKind,
            requested_limit: controlledProbe.limit,
            max_pages: controlledProbe.maxPages,
            parsed_count: data.fetched_count,
            import_candidate_count: importCandidates.length,
            skipped_import_count: Math.max(0, data.fetched_count - importCandidates.length),
            quality_active_count: qualityStatusCounts.active,
            quality_needs_review_count: qualityStatusCounts.needs_review,
            quality_rejected_count: qualityStatusCounts.rejected,
            quality_flag_counts: qualityFlagCounts,
            reason: "no_importable_candidates",
            diagnostics: data.diagnostics,
          },
        });

        return json({
          ok: true,
          source_code,
          dry_run: false,
          status: controlledProbe.runKind === "controlled_cron_probe"
            ? "projobivoire_rss_controlled_cron_probe_no_importable_candidates"
            : "projobivoire_rss_controlled_import_probe_no_importable_candidates",
          trigger: controlledProbe.trigger,
          run_kind: controlledProbe.runKind,
          limit: controlledProbe.limit,
          max_pages: controlledProbe.maxPages,
          parsed: data.fetched_count,
          import_candidate_count: importCandidates.length,
          skipped_import_count: Math.max(0, data.fetched_count - importCandidates.length),
          quality_active_count: qualityStatusCounts.active,
          quality_needs_review_count: qualityStatusCounts.needs_review,
          quality_rejected_count: qualityStatusCounts.rejected,
          quality_flag_counts: qualityFlagCounts,
          reason: "no_importable_candidates",
          inserted: 0,
          updated: 0,
          upserted: 0,
          rows_to_upsert: 0,
          diagnostics: data.diagnostics,
        });
      }

      const upsertBatchSize = Math.min(
        rows.length || 1,
        toPositiveInt(jobSource.ingest_config?.upsert_batch_size) ?? 15,
      );
      let inserted = 0;
      let updated = 0;
      let upsertChunkCount = 0;
      try {
        const upsertResult = await upsertJobsWithStats(supabase, rows, {
          batchSize: upsertBatchSize,
        });
        inserted = upsertResult.inserted;
        updated = upsertResult.updated;
        upsertChunkCount = upsertResult.upsertChunkCount;
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
          meta: {
            trigger: controlledProbe.trigger,
            run_kind: controlledProbe.runKind,
            requested_limit: controlledProbe.limit,
            max_pages: controlledProbe.maxPages,
          },
        });
        return json({
          ok: false,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: new Date().toISOString(),
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
        meta: {
          trigger: controlledProbe.trigger,
          run_kind: controlledProbe.runKind,
          requested_limit: controlledProbe.limit,
          max_pages: controlledProbe.maxPages,
          parsed_count: data.fetched_count,
          import_candidate_count: importCandidates.length,
          skipped_import_count: Math.max(0, data.fetched_count - importCandidates.length),
          quality_active_count: qualityStatusCounts.active,
          quality_needs_review_count: qualityStatusCounts.needs_review,
          quality_rejected_count: qualityStatusCounts.rejected,
          quality_flag_counts: qualityFlagCounts,
          diagnostics: data.diagnostics,
          upsert_chunk_count: upsertChunkCount,
        },
      });

      return json({
        ok: true,
        source_code,
        dry_run: false,
        status: controlledProbe.runKind === "controlled_cron_probe"
          ? "projobivoire_rss_controlled_cron_probe_upserted"
          : "projobivoire_rss_controlled_import_probe_upserted",
        trigger: controlledProbe.trigger,
        run_kind: controlledProbe.runKind,
        limit: controlledProbe.limit,
        max_pages: controlledProbe.maxPages,
        parsed: data.fetched_count,
        import_candidate_count: importCandidates.length,
        skipped_import_count: Math.max(0, data.fetched_count - importCandidates.length),
        quality_active_count: qualityStatusCounts.active,
        quality_needs_review_count: qualityStatusCounts.needs_review,
        quality_rejected_count: qualityStatusCounts.rejected,
        quality_flag_counts: qualityFlagCounts,
        rows_to_upsert: rows.length,
        inserted,
        updated,
        upserted: rows.length,
        diagnostics: data.diagnostics,
      });
    }

    if (source_code === "emploisenegal_portal") {
      // Senegal pilot dry-run stays read-only: no job_sources lookup, no runs, no DB writes.
      if (dry_run) {
        const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : null;
        const pilotLimit = toBoundedInt(limit, 30, 1, 100);
        const pilotMaxPages = toBoundedInt(body?.max_pages, 10, 1, 10);
        const data = await fetchEmploiSenegalPortalItems(pilotLimit, {
          maxPages: pilotMaxPages,
        });

        return json({
          ok: true,
          source_code,
          requested_limit: requestedLimit,
          effective_limit: pilotLimit,
          limit: pilotLimit,
          max_pages_used: data.max_pages_used,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          pages_fetched: data.pages_fetched,
          parsed: data.parsed,
          skipped_quality_count: data.skipped_quality_count,
          suspicious_signal_count: data.suspicious_signal_count,
          stopped_reason: data.stopped_reason,
          sample: data.sample.slice(0, 3),
        });
      }

      if (
        body?.allow_import !== true ||
        body?.confirm !== "IMPORT_EMPLOISENEGAL_PORTAL"
      ) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "emploisenegal_portal_import_requires_confirmation",
        }, 409);
      }
    }

    if (source_code === "emploi_ma_portal") {
      // Morocco pilot is dry-run only: no job_sources lookup, no runs, no DB writes.
      if (!dry_run) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "emploi_ma_portal_import_disabled_dry_run_only",
        }, 409);
      }

      const pilotLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
      const data = await fetchEmploiMaPortalItems(pilotLimit, {
        maxPages: 2,
      });

      return json({
        ok: true,
        source_code,
        limit: pilotLimit,
        dry_run: true,
        status: "dry_run_parsed",
        list_url: data.list_url,
        pages_fetched: data.pages_fetched,
        parsed: data.parsed,
        skipped_quality_count: data.skipped_quality_count,
        suspicious_signal_count: data.suspicious_signal_count,
        stopped_reason: data.stopped_reason,
        sample: data.sample.slice(0, 3),
      });
    }

    if (source_code === "reliefweb_api") {
      if (!dry_run) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "reliefweb_api_import_disabled_dry_run_only",
        }, 409);
      }

      const reliefwebAppname =
        typeof body?.appname === "string" && body.appname.trim()
          ? body.appname.trim()
          : typeof body?.reliefweb_appname === "string" &&
              body.reliefweb_appname.trim()
          ? body.reliefweb_appname.trim()
          : Deno.env.get("RELIEFWEB_APPNAME")?.trim() ?? "";

      if (!reliefwebAppname) {
        return json({
          ok: false,
          source_code,
          dry_run: true,
          error: "reliefweb_appname_missing",
          message:
            "ReliefWeb API requires an appname. Pass body.appname or set RELIEFWEB_APPNAME.",
        }, 400);
      }

      const requestedLimit = hasRequestedLimit && Number.isFinite(limit)
        ? Math.trunc(limit)
        : null;
      const effectiveLimit = toBoundedInt(limit, 50, 1, 100);
      const offset = toBoundedInt(body?.offset, 0, 0, 10000);
      const countries = toStringArray(body?.countries);
      const data = await fetchReliefWebJobs({
        appname: reliefwebAppname,
        limit: effectiveLimit,
        offset,
        countries,
      });

      return json({
        ok: true,
        source_code,
        dry_run: true,
        status: "dry_run_parsed",
        requested_limit: requestedLimit,
        effective_limit: data.effective_limit,
        offset: data.offset,
        countries_requested: data.countries_requested,
        parsed: data.parsed,
        sample: data.items.slice(0, 5),
        meta: {
          endpoint: data.endpoint,
          total_count: data.total_count,
          content_type: data.meta.content_type,
          request_body: data.meta.request_body,
        },
      });
    }

    const commercialDryRunLimit = source_code === "goafricaonline_ci_portal"
      ? toBoundedInt(limit, 50, 1, 150)
      : toBoundedInt(limit, 50, 1, 100);
    if (
      [
        "myjobmag_ng_rss",
        "myjobmag_gh_rss",
        "ngojobs_africa_rss",
        "jobwebghana_portal",
        "hotnigerianjobs_portal",
        "novojob_portal",
        "goafricaonline_ci_portal",
        "jobberman_ng_portal",
        "jobberman_gh_portal",
        "myjobmag_ng_portal",
        "myjobmag_gh_portal",
      ].includes(source_code)
    ) {
      if (!dry_run) {
        if (source_code === "myjobmag_gh_portal") {
          return json({
            ok: false,
            source_code,
            dry_run: false,
            error: "myjobmag_source_dry_run_only_not_validated",
          }, 409);
        }

        const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : null;
        const jobWebGhanaImportAllowed = source_code === "jobwebghana_portal" &&
          body?.allow_import === true &&
          body?.confirm === "IMPORT_JOBWEBGHANA_PORTAL" &&
          requestedLimit !== null &&
          requestedLimit <= 50;
        const novojobImportAllowed = source_code === "novojob_portal" &&
          body?.allow_import === true &&
          body?.confirm === "IMPORT_NOVOJOB_PORTAL" &&
          requestedLimit !== null &&
          requestedLimit <= 50;
        const myJobMagNgImportAllowed = source_code === "myjobmag_ng_portal" &&
          body?.allow_import === true &&
          body?.confirm === "IMPORT_MYJOBMAG_NG_PORTAL";
        const goAfricaOnlineCiImportAllowed = source_code === "goafricaonline_ci_portal" &&
          body?.allow_import === true &&
          isGoAfricaOnlineCiImportConfirmed(body?.confirm, requestedLimit);

        if (
          !jobWebGhanaImportAllowed &&
          !novojobImportAllowed &&
          !myJobMagNgImportAllowed &&
          !goAfricaOnlineCiImportAllowed
        ) {
          return json({
            ok: false,
            source_code,
            dry_run: false,
            error: source_code === "jobwebghana_portal"
              ? "jobwebghana_import_requires_explicit_confirmation"
              : source_code === "novojob_portal"
              ? "novojob_import_requires_explicit_confirmation"
              : source_code === "myjobmag_ng_portal"
              ? "myjobmag_ng_import_requires_explicit_confirmation"
              : source_code === "goafricaonline_ci_portal"
              ? "goafricaonline_ci_import_requires_explicit_confirmation"
              : `${source_code}_import_disabled_dry_run_only`,
          }, 409);
        }
      }

      if (dry_run && (source_code === "myjobmag_ng_rss" || source_code === "myjobmag_gh_rss")) {
        return json(commercialDryRunResponse(await fetchMyJobMagRssItems(source_code, {
          limit: commercialDryRunLimit,
        })));
      }
      if (dry_run && (source_code === "myjobmag_ng_portal" || source_code === "myjobmag_gh_portal")) {
        return json(commercialDryRunResponse(await fetchMyJobMagPortalItems(source_code, {
          limit: commercialDryRunLimit,
        })));
      }
      if (dry_run && source_code === "ngojobs_africa_rss") {
        return json(commercialDryRunResponse(await fetchNgoJobsAfricaRssItems({
          limit: commercialDryRunLimit,
        })));
      }
      if (dry_run && source_code === "jobwebghana_portal") {
        return json(commercialDryRunResponse(await fetchJobWebGhanaPortalItems({
          limit: commercialDryRunLimit,
        })));
      }
      if (dry_run && source_code === "hotnigerianjobs_portal") {
        return json(commercialDryRunResponse(await fetchHotNigerianJobsPortalItems({
          limit: commercialDryRunLimit,
        })));
      }
      if (dry_run && source_code === "novojob_portal") {
        return json(commercialDryRunResponse(await fetchNovojobPortalItems({
          limit: commercialDryRunLimit,
        })));
      }
      if (dry_run && source_code === "goafricaonline_ci_portal") {
        const goAfricaOnlineCiMaxPages = toBoundedInt(body?.max_pages, 6, 1, 6);
        return json(commercialDryRunResponse(await fetchGoAfricaOnlineCiPortalItems({
          limit: commercialDryRunLimit,
          maxPages: goAfricaOnlineCiMaxPages,
        })));
      }
      if (dry_run && (source_code === "jobberman_ng_portal" || source_code === "jobberman_gh_portal")) {
        return json(commercialDryRunResponse(await fetchJobbermanPortalItems(source_code, {
          limit: commercialDryRunLimit,
        })));
      }
    }

    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Fetch job source by code (for rss_generic)
    const jobSourceUrl = `${supabaseUrl}/rest/v1/job_sources?select=` +
      `id,code,name,ingest_method,ingest_config,is_active,ingest_status,country,region,priority,activated_at,last_ingested_at,last_success_at,last_checked_at` +
      `&code=eq.${encodeURIComponent(source_code)}&limit=1`;

    const jobSourceArr = await sbGet<any[]>(jobSourceUrl, serviceKey);
    const jobSource = jobSourceArr?.[0] ?? null;

    if (source_code === "myjobmag_ng_portal") {
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const importCap = 60;
      const importLimit = toBoundedInt(limit, 20, 1, importCap);
      if (
        dry_run ||
        body?.allow_import !== true ||
        body?.confirm !== "IMPORT_MYJOBMAG_NG_PORTAL"
      ) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "myjobmag_ng_import_requires_explicit_confirmation",
          import_cap: importCap,
        }, 409);
      }

      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;

      const supabase = createClient(supabaseUrl, serviceKey);
      const data = await fetchMyJobMagPortalItems("myjobmag_ng_portal", {
        limit: importLimit,
      });
      const rows = await mapScrapedItemsToRows(
        data.items,
        jobSource,
        source_code,
        data.list_url,
      );

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
          batchSize: 100,
        }));
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
        });
        return json({
          ok: false,
          source_code,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
      });

      return json({
        ok: true,
        source_code,
        dry_run: false,
        status: "myjobmag_ng_portal_upserted",
        requested_limit: Number.isFinite(limit) ? Math.trunc(limit) : null,
        effective_limit: importLimit,
        limit: importLimit,
        import_cap: importCap,
        parsed_count: data.parsed_count,
        inserted_count: inserted,
        updated_count: updated,
        inserted,
        updated,
        skipped_stale_count: data.meta.skipped_stale_count ?? 0,
        enrichment_matched_count: data.meta.enrichment_matched_count ?? 0,
        stopped_reason: data.stopped_reason,
        warnings: data.meta.warnings ?? [],
      });
    }

    if (source_code === "jobwebghana_portal") {
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : null;
      if (
        dry_run ||
        body?.allow_import !== true ||
        body?.confirm !== "IMPORT_JOBWEBGHANA_PORTAL" ||
        requestedLimit === null ||
        requestedLimit > 50
      ) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "jobwebghana_import_requires_explicit_confirmation",
        }, 409);
      }

      const importLimit = toBoundedInt(limit, 30, 1, 50);
      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;

      const supabase = createClient(supabaseUrl, serviceKey);
      const data = await fetchJobWebGhanaPortalItems({ limit: importLimit });
      const rows = await mapScrapedItemsToRows(
        data.items,
        jobSource,
        source_code,
        data.list_url,
      );

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
          batchSize: 100,
        }));
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
        });
        return json({
          ok: false,
          source_code,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
      });

      return json({
        ok: true,
        source_code,
        requested_limit: requestedLimit,
        effective_limit: importLimit,
        limit: importLimit,
        dry_run: false,
        status: "jobwebghana_portal_upserted",
        parsed: data.parsed_count,
        inserted,
        updated,
        skipped_quality_count: data.skipped_quality_count,
        pages_fetched: data.pages_fetched,
        feeds_fetched: data.feeds_fetched,
        stopped_reason: data.stopped_reason,
      });
    }

    if (source_code === "novojob_portal") {
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : null;
      if (
        dry_run ||
        body?.allow_import !== true ||
        body?.confirm !== "IMPORT_NOVOJOB_PORTAL" ||
        requestedLimit === null ||
        requestedLimit > 50
      ) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "novojob_import_requires_explicit_confirmation",
        }, 409);
      }

      const importLimit = toBoundedInt(limit, 30, 1, 50);
      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;

      const supabase = createClient(supabaseUrl, serviceKey);
      const data = await fetchNovojobPortalItems({ limit: importLimit });
      const rows = await mapScrapedItemsToRows(
        data.items,
        jobSource,
        source_code,
        data.list_url,
      );

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
          batchSize: 100,
        }));
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
        });
        return json({
          ok: false,
          source_code,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
      });

      return json({
        ok: true,
        source_code,
        requested_limit: requestedLimit,
        effective_limit: importLimit,
        limit: importLimit,
        dry_run: false,
        status: "novojob_portal_upserted",
        parsed: data.parsed_count,
        parsed_count: data.parsed_count,
        fetched_count: data.fetched_count,
        inserted,
        updated,
        skipped_quality_count: data.skipped_quality_count,
        pages_fetched: data.pages_fetched,
        feeds_fetched: data.feeds_fetched,
        stopped_reason: data.stopped_reason,
        unique_url_count: data.meta.unique_url_count,
        duplicate_url_count: data.meta.duplicate_url_count,
        rejected_social_url_count: data.meta.rejected_social_url_count,
        rejected_navigation_url_count: data.meta.rejected_navigation_url_count,
        rejected_missing_company_count: data.meta.rejected_missing_company_count,
        rejected_invalid_job_url_count: data.meta.rejected_invalid_job_url_count,
      });
    }

    if (source_code === "goafricaonline_ci_portal") {
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : null;
      if (
        dry_run ||
        body?.allow_import !== true ||
        !isGoAfricaOnlineCiImportConfirmed(body?.confirm, requestedLimit)
      ) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "goafricaonline_ci_import_requires_explicit_confirmation",
        }, 409);
      }

      const importLimit = toBoundedInt(limit, 30, 1, 150);
      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;

      const supabase = createClient(supabaseUrl, serviceKey);
      const data = await fetchGoAfricaOnlineCiPortalItems({ limit: importLimit });
      const invalidItems = data.items
        .map((item, index) => ({
          index,
          source_url: item.source_url,
          reason: goAfricaOnlineCiImportRejectionReason(item),
        }))
        .filter((item) => item.reason);
      if (invalidItems.length > 0) {
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: "goafricaonline_ci_import_quality_guard_failed",
          fetched_count: data.items.length,
          inserted_count: 0,
          updated_count: 0,
        });
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "goafricaonline_ci_import_quality_guard_failed",
          invalid_count: invalidItems.length,
          invalid_items: invalidItems.slice(0, 10),
        }, 409);
      }

      const rows = await mapScrapedItemsToRows(
        data.items,
        jobSource,
        source_code,
        data.list_url,
      );

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
          batchSize: 100,
        }));
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
        });
        return json({
          ok: false,
          source_code,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
      });

      return json({
        ok: true,
        source_code,
        requested_limit: requestedLimit,
        effective_limit: importLimit,
        limit: importLimit,
        dry_run: false,
        status: "goafricaonline_ci_portal_upserted",
        parsed: data.parsed_count,
        parsed_count: data.parsed_count,
        fetched_count: data.fetched_count,
        inserted,
        updated,
        skipped_quality_count: data.skipped_quality_count,
        pages_fetched: data.pages_fetched,
        feeds_fetched: data.feeds_fetched,
        stopped_reason: data.stopped_reason,
        unique_url_count: data.meta.unique_url_count,
        duplicate_url_count: data.meta.duplicate_url_count,
        rejected_social_url_count: data.meta.rejected_social_url_count,
        rejected_navigation_url_count: data.meta.rejected_navigation_url_count,
        rejected_missing_company_count: data.meta.rejected_missing_company_count,
        rejected_invalid_job_url_count: data.meta.rejected_invalid_job_url_count,
        parser_mode: data.meta.parser_mode,
        country_detected_count: data.meta.country_detected_count,
        country_unknown_count: data.meta.country_unknown_count,
        max_pages_used: data.meta.max_pages_used,
        per_page_valid_counts: data.meta.per_page_valid_counts,
      });
    }

    if (source_code === "emploisenegal_portal") {
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : null;
      const importLimit = toBoundedInt(limit, 30, 1, 50);
      const importMaxPages = toBoundedInt(body?.max_pages, 10, 1, 10);
      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;
      const data = await fetchEmploiSenegalPortalItems(importLimit, {
        maxPages: importMaxPages,
      });
      const importableItems = data.items.filter((it) =>
        (it.suspicious_terms ?? []).length === 0
      );
      const skippedSuspiciousCount = data.items.length - importableItems.length;
      const supabase = createClient(supabaseUrl, serviceKey);
      const now = new Date().toISOString();
      const rows = [];

      for (const it of importableItems) {
        const title = (it.title || "Offre d'emploi").trim();
        const companyName = it.company_name ?? null;
        const location = it.location ?? jobSource.region ?? null;
        const sourceUrl = normalizeOptionalUrl(it.source_url);
        const applyUrl = normalizeOptionalUrl(it.apply_url) ?? sourceUrl;
        const identity = await buildCrossSourceJobIdentity({
          title,
          companyName,
          location,
          sourceUrl,
          applyUrl,
        });
        const jobType = detectJobType(title, it.description_text ?? "");

        rows.push({
          job_source_id: jobSource.id,
          external_id: it.external_id,
          title,
          company_name: companyName,
          location,
          country: it.country,
          remote_type: null,
          contract_type: it.contract_type ?? null,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: null,
          description_text: it.description_text ?? null,
          apply_url: applyUrl,
          source_url: sourceUrl,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: it.tags ?? [],
          posted_at: it.published_at,
          published_at: it.published_at,
          expires_at: it.expires_at ?? null,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: true,
          is_expired: false,
          job_status: "active",
          job_type: jobType,
          job_json: {
            source_code,
            provider: "emploisenegal_portal",
            fetched_from: data.list_url,
            original_url: it.source_url,
            quality_filtered: {
              skipped_quality_count: data.skipped_quality_count,
              skipped_suspicious_count: skippedSuspiciousCount,
            },
          },
        });
      }

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
          batchSize: 100,
        }));
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
        });
        return json({
          ok: false,
          source_code,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
      });

      return json({
        ok: true,
        source_code,
        requested_limit: requestedLimit,
        effective_limit: importLimit,
        limit: importLimit,
        max_pages_used: data.max_pages_used,
        dry_run: false,
        status: "emploisenegal_portal_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        skipped_quality_count: data.skipped_quality_count,
        skipped_suspicious_count: skippedSuspiciousCount,
        suspicious_signal_count: data.suspicious_signal_count,
        pages_fetched: data.pages_fetched,
        stopped_reason: data.stopped_reason,
      });
    }

    if (source_code === "emploi_ci") {
      const job_source_id = "ed25b64d-ace6-4296-8985-46702d58785d";
      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }
      if (!dry_run && hasDiagnosticPaginationParams(asPlainObject(body))) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "diagnostic_pagination_requires_dry_run",
          message:
            "start_page/max_pages are diagnostic-only for emploi_ci until rotation is validated.",
        }, 409);
      }

      const runId = dry_run ? null : await createRun(
        supabaseUrl,
        serviceKey,
        job_source_id,
        "ingest",
      );
      currentRunId = runId;

      if (dry_run) {
        const diagnosticStartPage = toBoundedInt(
          body?.start_page ?? body?.startPage,
          1,
          1,
          1000,
        );
        const diagnosticMaxPages = toBoundedInt(
          body?.max_pages ?? body?.maxPages,
          31,
          1,
          31,
        );
        const data = await fetchEmploiCiItems(limit, {
          startPage: diagnosticStartPage,
          maxPages: diagnosticMaxPages,
        });
        const dbComparison = await compareDryRunCandidatesWithDb(
          supabaseUrl,
          serviceKey,
          job_source_id,
          data.items,
        );

        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "success",
          ok: true,
          fetched_count: data.items.length,
          inserted_count: 0,
          updated_count: 0,
        });
        return json({
          ok: true,
          source_code,
          limit,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          effective_start_page: data.effective_start_page,
          effective_max_pages: data.effective_max_pages,
          pages_fetched: data.pages_fetched,
          page_stats: data.page_stats,
          parsed_count_by_page: data.parsed_count_by_page,
          parsed: data.parsed,
          stopped_reason: data.stopped_reason,
          sample_source_urls: data.items.slice(0, 20).map((item) =>
            item.source_url
          ),
          sample_external_ids: data.items.slice(0, 20).map((item) =>
            item.external_id
          ),
          ...dbComparison,
          sample: data.sample,
        });
      }

      const emploiCiIngestConfig = asPlainObject(jobSource?.ingest_config);
      const ciRotation = getCiPaginationRotation(source_code, emploiCiIngestConfig);
      const data = await fetchEmploiCiItems(limit, {
        startPage: ciRotation.startPage,
        maxPages: ciRotation.maxPages,
      });

      // job_source_id (fixed seed for this source)
      const now = new Date().toISOString();
      const jobsBase = `${supabaseUrl}/rest/v1/jobs`;

      let inserted = 0;
      let updated = 0;

      // Upsert manually: check -> insert or patch
      for (const it of data.items) {
        const external_id = it.external_id;

        const checkUrl =
          `${jobsBase}?select=id&job_source_id=eq.${job_source_id}` +
          `&external_id=eq.${encodeURIComponent(external_id)}&limit=1`;

        const found = await sbGet<Array<{ id: string }>>(checkUrl, serviceKey);
        const exists = found?.length ? found[0].id : null;
        const identity = await buildCrossSourceJobIdentity({
          title: it.title,
          companyName: it.company_name,
          location: it.location,
          sourceUrl: it.source_url,
          applyUrl: it.apply_url,
        });

        const baseRow = {
          job_source_id,
          external_id,
          title: it.title,
          company_name: it.company_name,
          location: it.location,
          country: it.country,
          remote_type: null,
          contract_type: it.contract_type,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: null,
          description_text: it.description_text,
          apply_url: it.apply_url,
          source_url: it.source_url,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: [],
          posted_at: it.published_at,
          published_at: it.published_at,
          expires_at: it.expires_at,
          updated_at: now,
          last_seen_at: now,
          is_active: true,
          is_expired: false,
          job_status: "active",
          job_json: {
            source_code: "emploi_ci",
            provider: "educarriere",
            fetched_from: data.list_url,
            original_url: it.source_url,
          },
        };

        if (!exists) {
          const row = {
            ...baseRow,
            scraped_at: now,
            created_at: now,
          };

          await sbInsertOne(jobsBase, serviceKey, row);
          inserted++;
        } else {
          const patchUrl = `${jobsBase}?job_source_id=eq.${job_source_id}` +
            `&external_id=eq.${encodeURIComponent(external_id)}`;

          await sbPatch(patchUrl, serviceKey, baseRow);
          updated++;
        }
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: data.items.length,
        inserted_count: inserted,
        updated_count: updated,
        meta: buildCiRunMeta({
          sourceCode: source_code,
          requestedLimit: limit,
          effectiveLimit: limit,
          writeMode: "import",
          insertedCount: inserted,
          updatedCount: updated,
          data: data as Record<string, unknown>,
          rotation: ciRotation,
        }),
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, job_source_id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
        ingest_config: {
          ...emploiCiIngestConfig,
          runtime_state: buildNextCiRuntimeState({
            ingestConfig: emploiCiIngestConfig,
            rotation: ciRotation,
            finishedAt,
            data: data as Record<string, unknown>,
            fetchedCount: data.items.length,
            insertedCount: inserted,
            updatedCount: updated,
          }),
        },
      });

      return json({
        ok: true,
        source_code,
        limit,
        dry_run: false,
        status: "upserted_manual",
        parsed: data.parsed,
        inserted,
        updated,
        start_page: data.effective_start_page,
        max_pages: data.effective_max_pages,
        pages_fetched: data.pages_fetched,
        next_start_page: ciRotation.nextStartPage,
      });
    }

    if (source_code === "emploi_ci__dup__17d5574e") {
      if (dry_run) {
        const diagnosticStartPage = toBoundedInt(
          body?.start_page ?? body?.startPage,
          1,
          1,
          1000,
        );
        const diagnosticMaxPages = toBoundedInt(
          body?.max_pages ?? body?.maxPages,
          15,
          1,
          15,
        );
        const data = await fetchEmploiCiPortalItems(limit, {
          startPage: diagnosticStartPage,
          maxPages: diagnosticMaxPages,
        });
        const dbComparison = jobSource
          ? await compareDryRunCandidatesWithDb(
            supabaseUrl,
            serviceKey,
            jobSource.id,
            data.items,
          )
          : {
            db_comparison_available: false,
            db_comparison_reason: "job_source_not_found",
            known_url_count: null,
            new_candidate_count: null,
            known_external_id_count: null,
            new_external_id_count: null,
          };

        return json({
          ok: true,
          source_code,
          limit,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          effective_start_page: data.effective_start_page,
          effective_max_pages: data.effective_max_pages,
          pages_fetched: data.pages_fetched,
          page_stats: data.page_stats,
          parsed_count_by_page: data.parsed_count_by_page,
          parsed: data.parsed,
          skipped_quality_count: data.skipped_quality_count,
          stopped_reason: data.stopped_reason,
          sample_source_urls: data.items.slice(0, 20).map((item) =>
            item.source_url
          ),
          sample_external_ids: data.items.slice(0, 20).map((item) =>
            item.external_id
          ),
          ...dbComparison,
          sample: data.sample,
        });
      }

      if (hasDiagnosticPaginationParams(asPlainObject(body))) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "diagnostic_pagination_requires_dry_run",
          message:
            "start_page/max_pages are diagnostic-only for emploi_ci__dup__17d5574e until rotation is validated.",
        }, 409);
      }

      if (
        body?.allow_import !== true ||
        body?.confirm !== "IMPORT_EMPLOI_CI_PORTAL"
      ) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "emploi_ci_portal_import_requires_confirmation",
        }, 409);
      }

      if (!jobSource) {
        return json({ ok: false, error: "job_source_not_found" }, 404);
      }

      const importLimit = Math.max(1, Math.min(Math.trunc(limit), 400));
      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;
      const emploiCiPortalIngestConfig = asPlainObject(jobSource.ingest_config);
      const ciPortalRotation = getCiPaginationRotation(
        source_code,
        emploiCiPortalIngestConfig,
      );
      const data = await fetchEmploiCiPortalItems(importLimit, {
        startPage: ciPortalRotation.startPage,
        maxPages: ciPortalRotation.maxPages,
      });
      const supabase = createClient(supabaseUrl, serviceKey);
      const now = new Date().toISOString();
      const rows = [];

      for (const it of data.items) {
        const title = (it.title || "Offre d'emploi").trim();
        const companyName = it.company_name ?? null;
        const location = it.location ?? jobSource.region ?? null;
        const sourceUrl = normalizeOptionalUrl(it.source_url);
        const applyUrl = normalizeOptionalUrl(it.apply_url) ?? sourceUrl;
        const identity = await buildCrossSourceJobIdentity({
          title,
          companyName,
          location,
          sourceUrl,
          applyUrl,
        });
        const jobType = detectJobType(title, it.description_text ?? "");

        rows.push({
          job_source_id: jobSource.id,
          external_id: it.external_id,
          title,
          company_name: companyName,
          location,
          country: it.country,
          remote_type: null,
          contract_type: it.contract_type ?? null,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: null,
          description_text: it.description_text ?? null,
          apply_url: applyUrl,
          source_url: sourceUrl,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: it.tags ?? [],
          posted_at: it.published_at,
          published_at: it.published_at,
          expires_at: it.expires_at ?? null,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: true,
          is_expired: false,
          job_status: "active",
          job_type: jobType,
          job_json: {
            source_code,
            provider: "emploi_ci_portal",
            fetched_from: data.list_url,
            original_url: it.source_url,
            quality_filtered: {
              skipped_quality_count: data.skipped_quality_count,
            },
          },
        });
      }

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
          batchSize: 100,
        }));
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
        });
        return json({
          ok: false,
          source_code,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
        meta: buildCiRunMeta({
          sourceCode: source_code,
          requestedLimit: limit,
          effectiveLimit: importLimit,
          writeMode: "import",
          insertedCount: inserted,
          updatedCount: updated,
          data: data as Record<string, unknown>,
          rotation: ciPortalRotation,
        }),
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
        ingest_config: {
          ...emploiCiPortalIngestConfig,
          runtime_state: buildNextCiRuntimeState({
            ingestConfig: emploiCiPortalIngestConfig,
            rotation: ciPortalRotation,
            finishedAt,
            data: data as Record<string, unknown>,
            fetchedCount: rows.length,
            insertedCount: inserted,
            updatedCount: updated,
          }),
        },
      });

      return json({
        ok: true,
        source_code,
        limit: importLimit,
        dry_run: false,
        status: "emploi_ci_portal_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        skipped_quality_count: data.skipped_quality_count,
        start_page: data.effective_start_page,
        max_pages: data.effective_max_pages,
        pages_fetched: data.pages_fetched,
        next_start_page: ciPortalRotation.nextStartPage,
        stopped_reason: data.stopped_reason,
      });
    }

    if (!jobSource) {
      return json({ ok: false, error: "job_source_not_found" }, 404);
    }

    const method = (jobSource.ingest_method ?? "rss_generic").toLowerCase();

    if (method === "aej_html") {
      const aejDryRun = Boolean(body?.dry_run ?? true);
      if (jobSource.is_active === false && !aejDryRun) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = typeof jobSource.ingest_config?.list_url === "string"
        ? jobSource.ingest_config.list_url
        : "https://agenceemploijeunes.ci/offres-emploi";
      const startPage = toBoundedInt(
        body?.start_page ?? body?.startPage ?? jobSource.ingest_config?.start_page,
        1,
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const maxPages = toBoundedInt(body?.max_pages ?? jobSource.ingest_config?.max_pages, 2, 1, 20);
      const requestedAejLimit = toBoundedInt(
        body?.limit ?? limit,
        30,
        1,
        AEJ_MAX_ITEMS_PER_RUN,
      );
      const configuredAejLimit = toBoundedInt(
        jobSource.ingest_config?.limit,
        30,
        1,
        AEJ_MAX_ITEMS_PER_RUN,
      );
      const maxItems = Math.min(requestedAejLimit, configuredAejLimit);
      const delayMs = toBoundedInt(body?.delay_ms ?? jobSource.ingest_config?.delay_ms, 800, 0, 5000);

      if (!aejDryRun && (body?.allow_import !== true || body?.confirm !== "IMPORT_AEJ_CI_V2")) {
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "aej_ci_import_requires_explicit_confirmation",
          message: 'Pass allow_import=true and confirm="IMPORT_AEJ_CI_V2" to run a real AEJ import.',
        }, 409);
      }

      const data = await fetchAejItems(listUrl, maxPages, maxItems, delayMs, startPage);

      if (aejDryRun) {
        const emptyStatus = data.items.length === 0
          ? data.stopped_reason === "fetch_failed" || data.stopped_reason === "page_not_ok"
            ? 502
            : 422
          : 200;
        return json({
          ok: data.items.length > 0,
          source_code,
          limit: maxItems,
          dry_run: true,
          status: data.items.length > 0 ? "dry_run_parsed" : "dry_run_empty",
          list_url: data.list_url,
          parsed: data.parsed,
          parsed_count: data.parsed_count,
          fetched_count: data.fetched_count,
          start_page: startPage,
          pages_fetched: data.pages_fetched,
          detail_pages_fetched: data.detail_pages_fetched,
          skipped_quality_count: data.skipped_quality_count,
          duplicate_count: data.duplicate_count,
          stopped_reason: data.stopped_reason,
          warnings: data.warnings,
          sample: data.items.slice(0, 3),
          sample_jobs: data.items.slice(0, 5),
          meta: data.meta,
        }, emptyStatus);
      }

      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;

      if (data.items.length === 0) {
        const finishedAt = new Date().toISOString();
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: finishedAt,
          status: "failed",
          ok: false,
          error: `aej_no_items_fetched: ${data.stopped_reason}`,
          fetched_count: 0,
          inserted_count: 0,
          updated_count: 0,
        });
        await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
          last_checked_at: finishedAt,
          ingest_status: "error",
        });
        return json({
          ok: false,
          source_code,
          dry_run: false,
          error: "aej_no_items_fetched",
          fetched_count: data.fetched_count,
          start_page: startPage,
          pages_fetched: data.pages_fetched,
          stopped_reason: data.stopped_reason,
          warnings: data.warnings,
          meta: data.meta,
        }, 422);
      }

      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      const now = new Date().toISOString();

      const rows = await Promise.all(data.items.map(async (it) => {
        const desc = it.description_text || "";
        const jobType = detectJobType(
          it.title,
          `${desc} ${it.contract_type ?? ""}`,
        );
        const location = it.location || jobSource.region || null;
        const identity = await buildCrossSourceJobIdentity({
          title: it.title,
          companyName: null,
          location,
          sourceUrl: it.source_url,
          applyUrl: it.source_url,
        });

        return {
          job_source_id: jobSource.id,
          external_id: it.external_id,
          title: it.title,
          company_name: it.company_name,
          location,
          country: "CI",
          remote_type: null,
          contract_type: it.contract_type || null,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: it.description_html,
          description_text: it.description_text,
          apply_url: it.source_url,
          source_url: it.source_url,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: ["CI", "aej_html_v2"],
          posted_at: it.posted_at,
          published_at: it.published_at,
          expires_at: it.expires_at,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: !it.is_expired,
          is_expired: it.is_expired,
          job_status: deriveJobStatus(it.is_expired),
          job_type: jobType,
          job_json: {
            source_code,
            list_url: data.list_url,
            reference: it.reference,
            sector: it.sector,
            fetched_count: data.fetched_count,
            stopped_reason: data.stopped_reason,
          },
        };
      }));

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows));
      } catch (upErr) {
        const err = upErr as Error;
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: 0,
          updated_count: 0,
        });
        await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
          last_checked_at: new Date().toISOString(),
          ingest_status: "error",
        });
        return json({
          ok: false,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_status: "ready",
      });

      return json({
        ok: true,
        source_code,
        limit: maxItems,
        dry_run: false,
        status: "aej_upserted",
        parsed: data.parsed,
        fetched_count: data.fetched_count,
        start_page: startPage,
        pages_fetched: data.pages_fetched,
        skipped_quality_count: data.skipped_quality_count,
        duplicate_count: data.duplicate_count,
        stopped_reason: data.stopped_reason,
        inserted,
        updated,
        upserted: rows.length,
        meta: data.meta,
      });
    }

    if (method === "api_himalayas") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const apiUrl = jobSource.ingest_config?.api_url ||
        "https://himalayas.app/jobs/api";
      const searchUrl = jobSource.ingest_config?.search_url ||
        "https://himalayas.app/jobs/api/search";
      const attributionName =
        typeof jobSource.ingest_config?.attribution_name === "string" &&
          jobSource.ingest_config.attribution_name.trim()
          ? jobSource.ingest_config.attribution_name.trim()
          : "Himalayas";
      const attributionUrl =
        typeof jobSource.ingest_config?.attribution_url === "string" &&
          jobSource.ingest_config.attribution_url.trim()
          ? jobSource.ingest_config.attribution_url.trim()
          : "https://himalayas.app/jobs";
      const subsetLabel =
        typeof jobSource.ingest_config?.subset_label === "string" &&
          jobSource.ingest_config.subset_label.trim()
          ? jobSource.ingest_config.subset_label.trim()
          : "staging_small_subset";
      const stagingOnly = Boolean(
        jobSource.ingest_config?.staging_only ?? false,
      );
      const searchQuery =
        typeof jobSource.ingest_config?.search_query === "string"
          ? jobSource.ingest_config.search_query
          : null;
      const configuredMaxPages = Math.max(
        1,
        Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 1)),
      );
      const startOffset = Math.max(
        0,
        Math.trunc(Number(jobSource.ingest_config?.offset ?? 0)),
      );
      const requestedLimit = hasRequestedLimit && Number.isFinite(limit)
        ? Math.max(1, Math.min(100, Math.trunc(limit)))
        : 20;
      const rawConfiguredLimit = Number(jobSource.ingest_config?.limit);
      const configuredLimit = Math.max(
        1,
        Math.min(
          100,
          Number.isFinite(rawConfiguredLimit)
            ? rawConfiguredLimit
            : requestedLimit,
        ),
      );
      const maxItems = hasRequestedLimit
        ? requestedLimit
        : Math.max(requestedLimit, configuredLimit);
      const maxPages = Math.min(
        5,
        Math.max(configuredMaxPages, Math.ceil(maxItems / 20)),
      );

      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;
      const data = await fetchHimalayasItems({
        apiUrl,
        searchUrl,
        searchQuery,
        limit: maxItems,
        maxPages,
        offset: startOffset,
      });

      if (dry_run) {
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "success",
          ok: true,
          fetched_count: data.items.length,
          inserted_count: 0,
          updated_count: 0,
        });
        return json({
          ok: true,
          source_code,
          limit: maxItems,
          requested_limit: requestedLimit,
          effective_limit: maxItems,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          parsed: data.parsed,
          inserted: 0,
          updated: 0,
          upserted: 0,
          skipped: 0,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      const now = new Date().toISOString();

      const rows = [];
      for (const item of data.items) {
        const preferredSourceUrl = normalizeOptionalUrl(item.canonical_url) ??
          normalizeOptionalUrl(item.source_url) ??
          normalizeOptionalUrl(item.apply_url);
        const applyUrl = normalizeOptionalUrl(item.apply_url) ??
          preferredSourceUrl;
        const canonicalSeedUrl = preferredSourceUrl ?? applyUrl;
        const identity = await buildCrossSourceJobIdentity({
          title: item.title,
          companyName: item.company_name,
          location: item.location,
          sourceUrl: canonicalSeedUrl,
          applyUrl,
        });
        const externalId = item.external_id?.trim()
          ? `${source_code}:${item.external_id.trim()}`
          : await buildExternalId(source_code, {
            title: item.title,
            company_name: item.company_name,
            location: item.location,
            country: item.country,
            description_html: item.description_html,
            description_text: null,
            source_url: canonicalSeedUrl ?? applyUrl ?? data.list_url,
            apply_url: applyUrl,
            published_at: item.published_at,
            expires_at: item.expires_at,
            is_expired: item.is_expired,
          });

        rows.push({
          job_source_id: jobSource.id,
          external_id: externalId,
          title: item.title,
          company_name: item.company_name,
          location: item.location,
          country: item.country,
          country_codes: item.country_codes,
          remote_type: item.remote_type ?? "remote",
          contract_type: null,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: item.description_html,
          description_text: null,
          apply_url: applyUrl,
          source_url: preferredSourceUrl ?? applyUrl,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: item.tags ?? [],
          posted_at: item.published_at,
          published_at: item.published_at,
          expires_at: item.expires_at,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: item.is_expired ? false : true,
          is_expired: item.is_expired,
          job_status: deriveJobStatus(item.is_expired),
          job_type: null,
          job_json: {
            source_code,
            provider: "himalayas_api",
            endpoint: data.list_url,
            staging_only: stagingOnly,
            subset_label: subsetLabel,
            attribution: {
              name: attributionName,
              url: attributionUrl,
            },
            guid: item.external_id,
            raw: item.payload,
          },
        });
      }

      let inserted = 0;
      let updated = 0;
      try {
        ({ inserted, updated } = await upsertJobsWithStats(supabase, rows));
      } catch (upErr) {
        const err = upErr as Error;
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: 0,
          updated_count: 0,
        });
        return json({
          ok: false,
          error: "jobs_upsert_failed",
          message: err.message,
        }, 500);
      }

      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: new Date().toISOString(),
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
      });

      return json({
        ok: true,
        source_code,
        limit: maxItems,
        requested_limit: requestedLimit,
        effective_limit: maxItems,
        dry_run: false,
        status: "himalayas_api_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
        skipped: 0,
      });
    }

    if (method === "api_france_travail") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const clientId = mustEnv("FRANCE_TRAVAIL_CLIENT_ID");
      const clientSecret = mustEnv("FRANCE_TRAVAIL_CLIENT_SECRET");
      const searchUrl =
        typeof jobSource.ingest_config?.search_url === "string" &&
          jobSource.ingest_config.search_url.trim()
          ? jobSource.ingest_config.search_url.trim()
          : Deno.env.get("FRANCE_TRAVAIL_SEARCH_URL")?.trim() ||
            "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
      const tokenUrl = typeof jobSource.ingest_config?.token_url === "string" &&
          jobSource.ingest_config.token_url.trim()
        ? jobSource.ingest_config.token_url.trim()
        : Deno.env.get("FRANCE_TRAVAIL_TOKEN_URL")?.trim() ||
          "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
      const scope = typeof jobSource.ingest_config?.scope === "string" &&
          jobSource.ingest_config.scope.trim()
        ? jobSource.ingest_config.scope.trim()
        : Deno.env.get("FRANCE_TRAVAIL_SCOPE")?.trim() ||
          "api_offresdemploiv2 o2dsoffre";
      const subsetLabel =
        typeof jobSource.ingest_config?.subset_label === "string" &&
          jobSource.ingest_config.subset_label.trim()
          ? jobSource.ingest_config.subset_label.trim()
          : "staging_small_subset";
      const stagingOnly = Boolean(
        jobSource.ingest_config?.staging_only ?? false,
      );
      const ingestConfig = asPlainObject(jobSource.ingest_config);
      const baseSearchParams = ingestConfig.search_params &&
          typeof ingestConfig.search_params === "object" &&
          !Array.isArray(ingestConfig.search_params)
        ? asPlainObject(ingestConfig.search_params)
        : {};
      const runtimeState = asPlainObject(ingestConfig.runtime_state);
      const rotationSegments: Record<string, unknown>[] = Array.isArray(
          ingestConfig.rotation_segments,
        )
        ? ingestConfig.rotation_segments
          .map((segment) => asPlainObject(segment))
          .filter((segment) => Object.keys(segment).length > 0)
        : ingestConfig.rotation_segments &&
            typeof ingestConfig.rotation_segments === "object"
        ? Object.entries(asPlainObject(ingestConfig.rotation_segments))
          .map(([key, segment]) => ({
            key,
            ...asPlainObject(segment),
          }))
          .filter((segment) => Object.keys(segment).length > 1)
        : [];
      const configuredSegmentKey =
        typeof ingestConfig.segment_key === "string" &&
          ingestConfig.segment_key.trim()
          ? ingestConfig.segment_key.trim()
          : typeof runtimeState.segment_key === "string" &&
              runtimeState.segment_key.trim()
          ? runtimeState.segment_key.trim()
          : typeof runtimeState.current_segment_key === "string" &&
              runtimeState.current_segment_key.trim()
          ? runtimeState.current_segment_key.trim()
          : typeof ingestConfig.current_segment_key === "string" &&
              ingestConfig.current_segment_key.trim()
          ? ingestConfig.current_segment_key.trim()
          : typeof baseSearchParams.segment_key === "string" &&
              baseSearchParams.segment_key.trim()
          ? baseSearchParams.segment_key.trim()
          : null;
      const segmentCount = rotationSegments.length;
      const configuredSegmentIndex = toPositiveInt(
        ingestConfig.current_segment_index ??
          runtimeState.current_segment_index,
      );
      const defaultSegmentIndex = segmentCount > 0
        ? Math.min(Math.max(configuredSegmentIndex ?? 0, 0), segmentCount - 1)
        : 0;
      const keyedSegmentIndex = configuredSegmentKey
        ? rotationSegments.findIndex((segment) =>
          segment.key === configuredSegmentKey ||
          segment.segment_key === configuredSegmentKey
        )
        : -1;
      const currentSegmentIndex = keyedSegmentIndex >= 0
        ? keyedSegmentIndex
        : defaultSegmentIndex;
      const currentSegment = segmentCount > 0
        ? rotationSegments[currentSegmentIndex] ?? null
        : null;
      const segmentKey = configuredSegmentKey ??
        (typeof currentSegment?.key === "string" && currentSegment.key.trim()
          ? currentSegment.key.trim()
          : typeof currentSegment?.segment_key === "string" &&
              currentSegment.segment_key.trim()
          ? currentSegment.segment_key.trim()
          : "generic_recent");
      const segmentLabel =
        typeof currentSegment?.label === "string" && currentSegment.label.trim()
          ? currentSegment.label.trim()
          : typeof currentSegment?.segment_label === "string" &&
              currentSegment.segment_label.trim()
          ? currentSegment.segment_label.trim()
          : segmentKey;
      const nextSegmentIndex = segmentCount > 0
        ? (currentSegmentIndex + 1) % segmentCount
        : currentSegmentIndex;
      const nextSegment = segmentCount > 0
        ? rotationSegments[nextSegmentIndex] ?? null
        : null;
      const nextSegmentKey =
        typeof nextSegment?.key === "string" && nextSegment.key.trim()
          ? nextSegment.key.trim()
          : typeof nextSegment?.segment_key === "string" &&
              nextSegment.segment_key.trim()
          ? nextSegment.segment_key.trim()
          : segmentKey;
      const rotationMode = typeof ingestConfig.rotation_mode === "string" &&
          ingestConfig.rotation_mode.trim()
        ? ingestConfig.rotation_mode.trim()
        : segmentCount > 0
        ? "rotation_segments"
        : "single";
      const segmentSearchParams = currentSegment?.search_params &&
          typeof currentSegment.search_params === "object" &&
          !Array.isArray(currentSegment.search_params)
        ? asPlainObject(currentSegment.search_params)
        : currentSegment?.params &&
            typeof currentSegment.params === "object" &&
            !Array.isArray(currentSegment.params)
        ? asPlainObject(currentSegment.params)
        : {};
      const searchParams = {
        ...baseSearchParams,
        ...segmentSearchParams,
      };
      const maxPages = Math.max(
        1,
        Math.min(
          10,
          Number(currentSegment?.max_pages ?? ingestConfig.max_pages ?? 1),
        ),
      );
      const requestedLimit = Math.max(1, Math.min(100, limit));
      const configuredLimit = Math.max(
        1,
        Math.min(
          100,
          requestedLimit,
          Number(ingestConfig.limit ?? requestedLimit),
        ),
      );
      const configuredRangeStep = Math.max(
        1,
        Math.min(100, Number(ingestConfig.range_step ?? configuredLimit)),
      );
      const rangeStep = Math.min(configuredRangeStep, configuredLimit);
      const maxItems = Math.min(1000, rangeStep * maxPages);
      const upsertChunkSize = Math.max(
        1,
        Math.min(500, toPositiveInt(ingestConfig.upsert_batch_size) ?? 250),
      );
      const franceTravailMetaBase = {
        requested_limit: requestedLimit,
        range_step: rangeStep,
        max_pages: maxPages,
        effective_limit: maxItems,
        segment_key: segmentKey,
        segment_label: segmentLabel,
        next_segment_key: nextSegmentKey,
        current_segment_index: currentSegmentIndex,
        next_segment_index: nextSegmentIndex,
        rotation_mode: rotationMode,
        upsert_chunk_size: upsertChunkSize,
      };

      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;
      const data = await fetchFranceTravailItems({
        clientId,
        clientSecret,
        tokenUrl,
        searchUrl,
        scope,
        limit: maxItems,
        maxPages,
        rangeStep,
        searchParams,
      });
      const skippedDuplicates = countDuplicateExternalIds(data.items);
      const expiredAtBirth = countExpiredAtBirth(data.items);
      const missingExpiresAt = countMissingExpiresAt(data.items);

      if (dry_run) {
        const meta = {
          ...franceTravailMetaBase,
          fetched: data.items.length,
          inserted: 0,
          updated: 0,
          upsert_chunk_count: Math.ceil(data.items.length / upsertChunkSize),
          skipped_duplicates: skippedDuplicates,
          expired_at_birth: expiredAtBirth,
          missing_expires_at: missingExpiresAt,
        };
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "success",
          ok: true,
          fetched_count: data.items.length,
          inserted_count: 0,
          updated_count: 0,
          meta,
        });
        return json({
          ok: true,
          source_code,
          limit: maxItems,
          meta,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          parsed: data.parsed,
          total_available: data.total_available,
          content_range: data.content_range,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      const now = new Date().toISOString();

      const rows = [];
      for (const item of data.items) {
        const sourceUrl = normalizeOptionalUrl(item.source_url) ??
          normalizeOptionalUrl(item.apply_url) ??
          normalizeOptionalUrl(item.detail_url);
        const applyUrl = normalizeOptionalUrl(item.apply_url) ??
          normalizeOptionalUrl(item.detail_url) ??
          sourceUrl;
        const location = item.location ?? jobSource.region ?? null;
        const companyName = item.company_name ?? null;
        const identity = await buildCrossSourceJobIdentity({
          title: item.title,
          companyName,
          location,
          sourceUrl,
          applyUrl,
        });
        const descriptionText = item.description_text ?? null;
        const jobType = detectJobType(
          item.title,
          `${descriptionText ?? ""} ${item.contract_type ?? ""}`,
        );

        rows.push({
          job_source_id: jobSource.id,
          external_id: item.external_id,
          title: item.title,
          company_name: companyName,
          location,
          country: item.country ?? jobSource.country ?? "France",
          remote_type: null,
          contract_type: item.contract_type ?? null,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: null,
          description_text: descriptionText,
          apply_url: applyUrl,
          source_url: sourceUrl,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: [],
          posted_at: item.published_at,
          published_at: item.published_at,
          expires_at: item.expires_at,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: item.is_expired ? false : true,
          is_expired: item.is_expired,
          job_status: deriveJobStatus(item.is_expired),
          job_type: jobType,
          job_json: {
            source_code,
            provider: "france_travail_api",
            endpoint: data.list_url,
            staging_only: stagingOnly,
            subset_label: subsetLabel,
            total_available: data.total_available,
            content_range: data.content_range,
            detail_url: item.detail_url,
            offer_id: item.offer_id,
            search_params: searchParams,
            raw: item.payload,
          },
        });
      }

      let inserted = 0;
      let updated = 0;
      let upsertChunkCount = 0;
      try {
        const upsertResult = await upsertJobsWithStats(supabase, rows, {
          batchSize: upsertChunkSize,
        });
        inserted = upsertResult.inserted;
        updated = upsertResult.updated;
        upsertChunkCount = upsertResult.upsertChunkCount;
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        const chunkSuffix = err.chunkIndex ? `_chunk_${err.chunkIndex}` : "";
        const meta = {
          ...franceTravailMetaBase,
          fetched: rows.length,
          inserted: err.inserted,
          updated: err.updated,
          upsert_chunk_count: Math.ceil(rows.length / upsertChunkSize),
          skipped_duplicates: skippedDuplicates,
          expired_at_birth: expiredAtBirth,
          missing_expires_at: missingExpiresAt,
        };
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed${chunkSuffix}: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
          meta,
        });
        return json({
          ok: false,
          error: `jobs_upsert_failed${chunkSuffix}`,
          message: err.message,
          meta,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      const meta = {
        ...franceTravailMetaBase,
        fetched: rows.length,
        inserted,
        updated,
        upsert_chunk_count: upsertChunkCount,
        skipped_duplicates: skippedDuplicates,
        expired_at_birth: expiredAtBirth,
        missing_expires_at: missingExpiresAt,
      };
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
        meta,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_config: {
          ...ingestConfig,
          current_segment_index: nextSegmentIndex,
          segment_key: nextSegmentKey,
          runtime_state: {
            ...runtimeState,
            current_segment_index: nextSegmentIndex,
            current_segment_key: nextSegmentKey,
            last_segment_index: currentSegmentIndex,
            last_segment_key: segmentKey,
            last_segment_label: segmentLabel,
            last_fetched: rows.length,
            last_inserted: inserted,
            last_updated: updated,
            last_effective_limit: maxItems,
            last_success_at: finishedAt,
          },
        },
        ...(jobSource.is_active === true && !jobSource.activated_at
          ? { activated_at: finishedAt }
          : {}),
      });

      return json({
        ok: true,
        source_code,
        limit: maxItems,
        meta,
        dry_run: false,
        status: "france_travail_api_upserted",
        parsed: data.parsed,
        total_available: data.total_available,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "api_adzuna") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const appId = mustEnv("ADZUNA_APP_ID");
      const appKey = mustEnv("ADZUNA_APP_KEY");
      const searchUrlTemplate =
        typeof jobSource.ingest_config?.search_url_template === "string" &&
          jobSource.ingest_config.search_url_template.trim()
          ? jobSource.ingest_config.search_url_template.trim()
          : "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}";
      const defaultCountry =
        typeof jobSource.ingest_config?.default_country === "string" &&
          jobSource.ingest_config.default_country.trim()
          ? jobSource.ingest_config.default_country.trim()
          : "fr";
      const fallbackCountry =
        typeof jobSource.ingest_config?.fallback_country === "string" &&
          jobSource.ingest_config.fallback_country.trim()
          ? jobSource.ingest_config.fallback_country.trim()
          : null;
      const subsetLabel =
        typeof jobSource.ingest_config?.subset_label === "string" &&
          jobSource.ingest_config.subset_label.trim()
          ? jobSource.ingest_config.subset_label.trim()
          : "staging_small_subset";
      const stagingOnly = Boolean(
        jobSource.ingest_config?.staging_only ?? false,
      );
      const baseIngestConfig = asPlainObject(jobSource.ingest_config);
      const runtimeState = asPlainObject(baseIngestConfig.runtime_state);
      const baseDefaultParams = baseIngestConfig.default_params &&
          typeof baseIngestConfig.default_params === "object" &&
          !Array.isArray(baseIngestConfig.default_params)
        ? asPlainObject(baseIngestConfig.default_params)
        : {};
      const rotationSegments: Record<string, unknown>[] = Array.isArray(
          baseIngestConfig.rotation_segments,
        )
        ? baseIngestConfig.rotation_segments
          .map((segment) => asPlainObject(segment))
          .filter((segment) => Object.keys(segment).length > 0)
        : baseIngestConfig.rotation_segments &&
            typeof baseIngestConfig.rotation_segments === "object"
        ? Object.entries(asPlainObject(baseIngestConfig.rotation_segments))
          .map(([key, segment]) => ({
            key,
            ...asPlainObject(segment),
          }))
          .filter((segment) => Object.keys(segment).length > 1)
        : [];
      const segmentCount = rotationSegments.length;
      const configuredSegmentIndex = toPositiveInt(
        baseIngestConfig.current_segment_index ??
          runtimeState.current_segment_index,
      );
      const currentSegmentIndex = segmentCount > 0
        ? Math.min(Math.max(configuredSegmentIndex ?? 0, 0), segmentCount - 1)
        : 0;
      const currentSegment = segmentCount > 0
        ? rotationSegments[currentSegmentIndex] ?? {}
        : {};
      const nextSegmentIndex = segmentCount > 0
        ? (currentSegmentIndex + 1) % segmentCount
        : currentSegmentIndex;
      const nextSegment = segmentCount > 0
        ? rotationSegments[nextSegmentIndex] ?? {}
        : {};
      const segmentKey =
        typeof currentSegment.key === "string" && currentSegment.key.trim()
          ? currentSegment.key.trim()
          : typeof currentSegment.segment_key === "string" &&
              currentSegment.segment_key.trim()
          ? currentSegment.segment_key.trim()
          : "adzuna_default";
      const segmentLabel =
        typeof currentSegment.label === "string" && currentSegment.label.trim()
          ? currentSegment.label.trim()
          : typeof currentSegment.segment_label === "string" &&
              currentSegment.segment_label.trim()
          ? currentSegment.segment_label.trim()
          : segmentKey;
      const nextSegmentKey =
        typeof nextSegment.key === "string" && nextSegment.key.trim()
          ? nextSegment.key.trim()
          : typeof nextSegment.segment_key === "string" &&
              nextSegment.segment_key.trim()
          ? nextSegment.segment_key.trim()
          : segmentKey;
      const rotationMode = typeof baseIngestConfig.rotation_mode === "string" &&
          baseIngestConfig.rotation_mode.trim()
        ? baseIngestConfig.rotation_mode.trim()
        : segmentCount > 0
        ? "rotation_segments"
        : "single";
      const segmentParams = currentSegment.search_params &&
          typeof currentSegment.search_params === "object" &&
          !Array.isArray(currentSegment.search_params)
        ? asPlainObject(currentSegment.search_params)
        : currentSegment.params &&
            typeof currentSegment.params === "object" &&
            !Array.isArray(currentSegment.params)
        ? asPlainObject(currentSegment.params)
        : {};
      const searchParamsWithoutSort = Object.fromEntries(
        Object.entries({ ...baseDefaultParams, ...segmentParams }).filter((
          [key],
        ) => key !== "sort_by"),
      );
      const sortMode = normalizeAdzunaSortMode(
        currentSegment.sort_mode ?? baseIngestConfig.sort_mode,
      );
      const segmentSortBy = typeof segmentParams.sort_by === "string" &&
          segmentParams.sort_by.trim()
        ? segmentParams.sort_by.trim()
        : null;
      const defaultParams = sortMode === "freshness"
        ? { ...searchParamsWithoutSort, sort_by: "date" }
        : segmentSortBy
        ? { ...searchParamsWithoutSort, sort_by: segmentSortBy }
        : searchParamsWithoutSort;
      const segmentDefaultCountry =
        typeof currentSegment.country === "string" &&
          currentSegment.country.trim()
          ? currentSegment.country.trim()
          : typeof segmentParams.country === "string" &&
              segmentParams.country.trim()
          ? segmentParams.country.trim()
          : typeof currentSegment.default_country === "string" &&
              currentSegment.default_country.trim()
          ? currentSegment.default_country.trim()
          : defaultCountry;
      const segmentFallbackCountry =
        typeof currentSegment.fallback_country === "string" &&
          currentSegment.fallback_country.trim()
          ? currentSegment.fallback_country.trim()
          : fallbackCountry;
      const configuredMaxPages = Math.max(
        1,
        Math.min(
          20,
          Number(currentSegment.max_pages ?? baseIngestConfig.max_pages ?? 1),
        ),
      );
      const pageSize = Math.max(
        1,
        Math.min(
          50,
          Number(
            currentSegment.results_per_page ??
              baseIngestConfig.results_per_page ??
              10,
          ),
        ),
      );
      const requestedLimit = Math.max(1, Math.min(1000, limit));
      const maxSegmentPagesByBudget = Math.max(
        1,
        Math.floor(requestedLimit / pageSize),
      );
      const segmentPagesRequested = segmentCount > 0
        ? Math.min(20, segmentCount, maxSegmentPagesByBudget)
        : null;
      const effectiveMaxPages = hasRequestedLimit
        ? Math.min(
          20,
          Math.max(configuredMaxPages, Math.ceil(requestedLimit / pageSize)),
        )
        : configuredMaxPages;
      const pagesRequested = segmentPagesRequested ?? effectiveMaxPages;
      const maxItems = Math.min(requestedLimit, pageSize * pagesRequested);
      const segmentPages = asPlainObject(runtimeState.segment_pages);
      const currentSegmentPageState = asPlainObject(segmentPages[segmentKey]);
      const startPage = sortMode === "exploration"
        ? toBoundedInt(
          currentSegmentPageState.next_page ?? runtimeState.next_page,
          1,
          1,
          999,
        )
        : 1;
      const upsertChunkSize = Math.max(
        1,
        Math.min(500, toPositiveInt(baseIngestConfig.upsert_batch_size) ?? 250),
      );
      const adzunaMetaBase = {
        requested_limit: requestedLimit,
        effective_limit: maxItems,
        results_per_page: pageSize,
        pages_requested: pagesRequested,
        start_page: startPage,
        segment_key: segmentKey,
        segment_label: segmentLabel,
        current_segment_index: currentSegmentIndex,
        next_segment_index: nextSegmentIndex,
        next_segment_key: nextSegmentKey,
        rotation_mode: rotationMode,
        country_requested: segmentDefaultCountry,
        fallback_country: segmentFallbackCountry,
        sort_mode: sortMode,
        search_params: defaultParams,
        segment_params: segmentParams,
        upsert_chunk_size: upsertChunkSize,
      };

      const runId = await createRun(
        supabaseUrl,
        serviceKey,
        jobSource.id,
        "ingest",
      );
      currentRunId = runId;
      let data: {
        list_url: string;
        parsed: number;
        items: Awaited<ReturnType<typeof fetchAdzunaItems>>["items"];
        raw_fetched: number;
        skipped_duplicates: number;
        total_available: number | null;
        country_used: string;
        fallback_used: boolean;
        start_page: number;
        last_page_fetched: number | null;
        next_page: number;
      };
      let segmentsProcessed: Array<Record<string, unknown>> = [];
      let nextSegmentIndexAfterRun = nextSegmentIndex;
      let nextSegmentKeyAfterRun = nextSegmentKey;
      const nextSegmentPages = { ...segmentPages };

      if (segmentCount > 0) {
        const items: Awaited<ReturnType<typeof fetchAdzunaItems>>["items"] = [];
        const seenExternalIds = new Set<string>();
        let rawFetched = 0;
        let skippedDuplicates = 0;
        let listUrl = "";
        let totalAvailable: number | null = null;
        let countryUsed = segmentDefaultCountry;
        let fallbackUsed = false;
        let firstStartPage = startPage;
        let lastPageFetched: number | null = null;
        let lastNextPage = startPage;

        // TODO: V2 could spend remaining budget on high-yield segments.
        for (
          let segmentOffset = 0;
          segmentOffset < pagesRequested && items.length < maxItems;
          segmentOffset += 1
        ) {
          const index = (currentSegmentIndex + segmentOffset) % segmentCount;
          const segment = rotationSegments[index] ?? {};
          const key = typeof segment.key === "string" && segment.key.trim()
            ? segment.key.trim()
            : typeof segment.segment_key === "string" &&
                segment.segment_key.trim()
            ? segment.segment_key.trim()
            : `adzuna_segment_${index}`;
          const label = typeof segment.label === "string" &&
              segment.label.trim()
            ? segment.label.trim()
            : typeof segment.segment_label === "string" &&
                segment.segment_label.trim()
            ? segment.segment_label.trim()
            : key;
          const params = segment.search_params &&
              typeof segment.search_params === "object" &&
              !Array.isArray(segment.search_params)
            ? asPlainObject(segment.search_params)
            : segment.params &&
                typeof segment.params === "object" &&
                !Array.isArray(segment.params)
            ? asPlainObject(segment.params)
            : {};
          const paramsWithoutSort = Object.fromEntries(
            Object.entries({ ...baseDefaultParams, ...params }).filter((
              [paramKey],
            ) => paramKey !== "sort_by"),
          );
          const segmentMode = normalizeAdzunaSortMode(
            segment.sort_mode ?? baseIngestConfig.sort_mode,
          );
          const segmentSortBy = typeof params.sort_by === "string" &&
              params.sort_by.trim()
            ? params.sort_by.trim()
            : null;
          const paramsForFetch = segmentMode === "freshness"
            ? { ...paramsWithoutSort, sort_by: "date" }
            : segmentSortBy
            ? { ...paramsWithoutSort, sort_by: segmentSortBy }
            : paramsWithoutSort;
          const country = typeof segment.country === "string" &&
              segment.country.trim()
            ? segment.country.trim()
            : typeof params.country === "string" && params.country.trim()
            ? params.country.trim()
            : typeof segment.default_country === "string" &&
                segment.default_country.trim()
            ? segment.default_country.trim()
            : defaultCountry;
          const fallback = typeof segment.fallback_country === "string" &&
              segment.fallback_country.trim()
            ? segment.fallback_country.trim()
            : fallbackCountry;
          const pageState = asPlainObject(segmentPages[key]);
          const segmentStartPage = segmentMode === "exploration"
            ? toBoundedInt(
              pageState.next_page ?? runtimeState.next_page,
              1,
              1,
              999,
            )
            : 1;
          const remaining = maxItems - items.length;
          const segmentData = await fetchAdzunaItems({
            appId,
            appKey,
            searchUrlTemplate,
            defaultCountry: country,
            fallbackCountry: fallback,
            defaultParams: paramsForFetch,
            limit: Math.min(pageSize, remaining),
            maxPages: 1,
            resultsPerPage: pageSize,
            startPage: segmentStartPage,
          });

          rawFetched += segmentData.raw_fetched;
          skippedDuplicates += segmentData.skipped_duplicates;
          listUrl = segmentData.list_url;
          totalAvailable = segmentData.total_available ?? totalAvailable;
          countryUsed = segmentData.country_used;
          fallbackUsed = fallbackUsed || segmentData.fallback_used;
          if (segmentOffset === 0) firstStartPage = segmentData.start_page;
          lastPageFetched = segmentData.last_page_fetched ?? lastPageFetched;
          lastNextPage = segmentData.next_page;

          let segmentFetched = 0;
          let segmentInterSegmentDuplicates = 0;
          for (const item of segmentData.items) {
            const externalId = item.external_id?.trim();
            if (externalId) {
              if (seenExternalIds.has(externalId)) {
                segmentInterSegmentDuplicates += 1;
                continue;
              }
              seenExternalIds.add(externalId);
            }
            items.push(item);
            segmentFetched += 1;
            if (items.length >= maxItems) break;
          }
          skippedDuplicates += segmentInterSegmentDuplicates;

          const segmentPagePatch = {
            ...pageState,
            next_page: segmentMode === "exploration"
              ? segmentData.next_page
              : 1,
            last_page_ingested: segmentData.last_page_fetched,
            last_start_page: segmentData.start_page,
            last_country_used: segmentData.country_used,
          };
          nextSegmentPages[key] = segmentPagePatch;
          segmentsProcessed.push({
            key,
            label,
            country: segmentData.country_used,
            params: paramsForFetch,
            search_params: paramsForFetch,
            start_page: segmentData.start_page,
            last_page_ingested: segmentData.last_page_fetched,
            next_page: segmentData.next_page,
            raw_fetched: segmentData.raw_fetched,
            fetched: segmentFetched,
            skipped_duplicates: segmentData.skipped_duplicates +
              segmentInterSegmentDuplicates,
          });
        }

        const processedCount = segmentsProcessed.length;
        nextSegmentIndexAfterRun = processedCount >= segmentCount
          ? 0
          : (currentSegmentIndex + processedCount) % segmentCount;
        const nextConfiguredSegment =
          rotationSegments[nextSegmentIndexAfterRun] ?? {};
        nextSegmentKeyAfterRun =
          typeof nextConfiguredSegment.key === "string" &&
              nextConfiguredSegment.key.trim()
            ? nextConfiguredSegment.key.trim()
            : typeof nextConfiguredSegment.segment_key === "string" &&
                nextConfiguredSegment.segment_key.trim()
            ? nextConfiguredSegment.segment_key.trim()
            : "adzuna_default";

        data = {
          list_url: listUrl,
          parsed: items.length,
          items,
          raw_fetched: rawFetched,
          skipped_duplicates: skippedDuplicates,
          total_available: totalAvailable,
          country_used: countryUsed,
          fallback_used: fallbackUsed,
          start_page: firstStartPage,
          last_page_fetched: lastPageFetched,
          next_page: lastNextPage,
        };
      } else {
        data = await fetchAdzunaItems({
          appId,
          appKey,
          searchUrlTemplate,
          defaultCountry: segmentDefaultCountry,
          fallbackCountry: segmentFallbackCountry,
          defaultParams,
          limit: maxItems,
          maxPages: effectiveMaxPages,
          resultsPerPage: pageSize,
          startPage,
        });
        nextSegmentPages[segmentKey] = {
          ...currentSegmentPageState,
          next_page: sortMode === "exploration" ? data.next_page : 1,
          last_page_ingested: data.last_page_fetched,
          last_start_page: data.start_page,
          last_country_used: data.country_used,
        };
        segmentsProcessed = [{
          key: segmentKey,
          label: segmentLabel,
          country: data.country_used,
          params: defaultParams,
          search_params: defaultParams,
          start_page: data.start_page,
          last_page_ingested: data.last_page_fetched,
          next_page: data.next_page,
          raw_fetched: data.raw_fetched,
          fetched: data.items.length,
          skipped_duplicates: data.skipped_duplicates,
        }];
      }
      const offerFreshnessMetrics = computeOfferFreshnessMetrics(data.items);

      if (dry_run) {
        const meta = {
          ...adzunaMetaBase,
          start_page: data.start_page,
          last_page_ingested: data.last_page_fetched,
          next_page: data.next_page,
          country_used: data.country_used,
          fallback_used: data.fallback_used,
          total_available: data.total_available,
          total_segments_processed: segmentsProcessed.length,
          segments_processed: segmentsProcessed,
          next_segment_index: nextSegmentIndexAfterRun,
          next_segment_key: nextSegmentKeyAfterRun,
          raw_fetched: data.raw_fetched,
          fetched: data.items.length,
          inserted: 0,
          updated: 0,
          skipped_duplicates: data.skipped_duplicates,
          rotation_new_count: 0,
          rotation_seen_count: 0,
          rotation_new_ratio: null,
          rotation_seen_ratio: null,
          upsert_chunk_count: Math.ceil(data.items.length / upsertChunkSize),
          ...offerFreshnessMetrics,
        };
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "success",
          ok: true,
          fetched_count: data.items.length,
          inserted_count: 0,
          updated_count: 0,
          meta,
        });
        return json({
          ok: true,
          source_code,
          limit: maxItems,
          meta,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          parsed: data.parsed,
          total_available: data.total_available,
          country_used: data.country_used,
          fallback_used: data.fallback_used,
          sort_mode: sortMode,
          start_page: data.start_page,
          next_page: data.next_page,
          last_page_fetched: data.last_page_fetched,
          raw_fetched: data.raw_fetched,
          skipped_duplicates: data.skipped_duplicates,
          ...offerFreshnessMetrics,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      });
      const nowDate = new Date();
      const now = nowDate.toISOString();

      const rows = [];
      for (const item of data.items) {
        const adzunaLifecycle = normalizeAdzunaLifecycle(item, nowDate);
        const sourceUrl = normalizeOptionalUrl(item.source_url) ??
          normalizeOptionalUrl(item.apply_url);
        const applyUrl = normalizeOptionalUrl(item.apply_url) ?? sourceUrl;
        const location = item.location ?? jobSource.region ?? null;
        const companyName = item.company_name ?? null;
        const identity = await buildCrossSourceJobIdentity({
          title: item.title,
          companyName,
          location,
          sourceUrl,
          applyUrl,
        });
        const descriptionText = item.description_text ?? null;
        const jobType = detectJobType(
          item.title,
          `${descriptionText ?? ""} ${item.contract_type ?? ""}`,
        );
        const externalId = item.external_id?.trim()
          ? item.external_id.trim()
          : await buildExternalId(source_code, {
            title: item.title,
            company_name: companyName,
            location,
            country: item.country,
            contract_type: item.contract_type,
            description_html: null,
            description_text: descriptionText,
            source_url: sourceUrl ?? applyUrl ?? data.list_url,
            apply_url: applyUrl,
            published_at: adzunaLifecycle.published_at,
            expires_at: adzunaLifecycle.expires_at,
            is_expired: adzunaLifecycle.is_expired,
          });

        rows.push({
          job_source_id: jobSource.id,
          external_id: externalId,
          title: item.title,
          company_name: companyName,
          location,
          country: item.country ?? jobSource.country ?? null,
          country_codes: item.country_code ? [item.country_code] : null,
          remote_type: item.remote_type,
          contract_type: item.contract_type,
          seniority: null,
          salary_min: item.salary_min,
          salary_max: item.salary_max,
          salary_currency: item.salary_currency,
          salary_period: null,
          description_html: null,
          description_text: descriptionText,
          apply_url: applyUrl,
          source_url: sourceUrl,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: item.tags ?? [],
          posted_at: adzunaLifecycle.published_at,
          published_at: adzunaLifecycle.published_at,
          expires_at: adzunaLifecycle.expires_at,
          scraped_at: now,
          updated_at: now,
          last_seen_at: now,
          is_active: adzunaLifecycle.is_active,
          is_expired: adzunaLifecycle.is_expired,
          job_status: adzunaLifecycle.job_status,
          job_type: jobType,
          job_json: {
            source_code,
            provider: "adzuna_api",
            endpoint: data.list_url,
            staging_only: stagingOnly,
            subset_label: subsetLabel,
            attribution: {
              name: "Adzuna",
              url: "https://www.adzuna.com/",
            },
            country_used: data.country_used,
            fallback_used: data.fallback_used,
            total_available: data.total_available,
            ad_id: item.ad_id,
            country_code: item.country_code,
            default_params: defaultParams,
            raw: item.payload,
          },
        });
      }

      let inserted = 0;
      let updated = 0;
      let upsertChunkCount = 0;
      try {
        const upsertResult = await upsertJobsWithStats(supabase, rows, {
          batchSize: upsertChunkSize,
        });
        inserted = upsertResult.inserted;
        updated = upsertResult.updated;
        upsertChunkCount = upsertResult.upsertChunkCount;
      } catch (upErr) {
        const err = upErr instanceof JobsUpsertFailedError
          ? upErr
          : new JobsUpsertFailedError((upErr as Error).message);
        const chunkSuffix = err.chunkIndex ? `_chunk_${err.chunkIndex}` : "";
        const meta = {
          ...adzunaMetaBase,
          start_page: data.start_page,
          last_page_ingested: data.last_page_fetched,
          next_page: data.next_page,
          country_used: data.country_used,
          fallback_used: data.fallback_used,
          total_available: data.total_available,
          total_segments_processed: segmentsProcessed.length,
          segments_processed: segmentsProcessed,
          next_segment_index: nextSegmentIndexAfterRun,
          next_segment_key: nextSegmentKeyAfterRun,
          raw_fetched: data.raw_fetched,
          fetched: rows.length,
          inserted: err.inserted,
          updated: err.updated,
          skipped_duplicates: data.skipped_duplicates,
          rotation_new_count: err.inserted,
          rotation_seen_count: err.updated,
          rotation_new_ratio: null,
          rotation_seen_ratio: null,
          upsert_chunk_count: Math.ceil(rows.length / upsertChunkSize),
          ...offerFreshnessMetrics,
        };
        await finishRun(supabaseUrl, serviceKey, currentRunId, {
          finished_at: new Date().toISOString(),
          status: "failed",
          ok: false,
          error: `jobs_upsert_failed${chunkSuffix}: ${err.message}`,
          fetched_count: rows.length,
          inserted_count: err.inserted,
          updated_count: err.updated,
          meta,
        });
        return json({
          ok: false,
          error: `jobs_upsert_failed${chunkSuffix}`,
          message: err.message,
          meta,
        }, 500);
      }

      const finishedAt = new Date().toISOString();
      const rotationBase = inserted + updated;
      const rotationNewRatio = rotationBase > 0
        ? Number((inserted / rotationBase).toFixed(4))
        : null;
      const rotationSeenRatio = rotationBase > 0
        ? Number((updated / rotationBase).toFixed(4))
        : null;
      const processedSegmentKeys = new Set(
        segmentsProcessed
          .map((segment) => typeof segment.key === "string" ? segment.key : "")
          .filter(Boolean),
      );
      const runtimeSegmentPages = Object.fromEntries(
        Object.entries(nextSegmentPages).map(([key, value]) => [
          key,
          processedSegmentKeys.has(key)
            ? { ...asPlainObject(value), last_finished_at: finishedAt }
            : value,
        ]),
      );
      const nextRuntimeState = {
        ...runtimeState,
        next_page: sortMode === "exploration" ? data.next_page : 1,
        current_segment_index: nextSegmentIndexAfterRun,
        current_segment_key: nextSegmentKeyAfterRun,
        segment_pages: runtimeSegmentPages,
        last_page_ingested: data.last_page_fetched,
        last_start_page: data.start_page,
        last_segment_index: currentSegmentIndex,
        last_segment_key: segmentKey,
        last_segment_label: segmentLabel,
        last_segments_processed: segmentsProcessed,
        next_segment_index: nextSegmentIndexAfterRun,
        next_segment_key: nextSegmentKeyAfterRun,
        last_country_used: data.country_used,
        last_sort_mode: sortMode,
        last_limit: maxItems,
        last_parsed: data.parsed,
        last_raw_fetched: data.raw_fetched,
        last_skipped_duplicates: data.skipped_duplicates,
        last_total_available: data.total_available,
        last_finished_at: finishedAt,
        last_offer_freshness_metrics: offerFreshnessMetrics,
        last_rotation: {
          new_count: inserted,
          seen_count: updated,
          new_ratio: rotationNewRatio,
          seen_ratio: rotationSeenRatio,
        },
      };
      const meta = {
        ...adzunaMetaBase,
        start_page: data.start_page,
        last_page_ingested: data.last_page_fetched,
        next_page: data.next_page,
        country_used: data.country_used,
        fallback_used: data.fallback_used,
        total_available: data.total_available,
        total_segments_processed: segmentsProcessed.length,
        segments_processed: segmentsProcessed,
        next_segment_index: nextSegmentIndexAfterRun,
        next_segment_key: nextSegmentKeyAfterRun,
        raw_fetched: data.raw_fetched,
        fetched: rows.length,
        inserted,
        updated,
        skipped_duplicates: data.skipped_duplicates,
        rotation_new_count: inserted,
        rotation_seen_count: updated,
        rotation_new_ratio: rotationNewRatio,
        rotation_seen_ratio: rotationSeenRatio,
        upsert_chunk_count: upsertChunkCount,
        ...offerFreshnessMetrics,
      };
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: finishedAt,
        status: "success",
        ok: true,
        fetched_count: rows.length,
        inserted_count: inserted,
        updated_count: updated,
        meta,
      });
      await patchJobSourceMetadata(supabaseUrl, serviceKey, jobSource.id, {
        last_checked_at: finishedAt,
        last_ingested_at: finishedAt,
        last_success_at: finishedAt,
        ingest_config: {
          ...baseIngestConfig,
          current_segment_index: nextSegmentIndexAfterRun,
          segment_key: nextSegmentKeyAfterRun,
          sort_mode: sortMode,
          runtime_state: nextRuntimeState,
        },
        ...(jobSource.is_active === true && !jobSource.activated_at
          ? { activated_at: finishedAt }
          : {}),
      });

      return json({
        ok: true,
        source_code,
        limit: maxItems,
        meta,
        dry_run: false,
        status: "adzuna_api_upserted",
        parsed: data.parsed,
        total_available: data.total_available,
        country_used: data.country_used,
        fallback_used: data.fallback_used,
        sort_mode: sortMode,
        start_page: data.start_page,
        next_page: data.next_page,
        last_page_fetched: data.last_page_fetched,
        raw_fetched: data.raw_fetched,
        skipped_duplicates: data.skipped_duplicates,
        ...offerFreshnessMetrics,
        rotation_new_count: inserted,
        rotation_seen_count: updated,
        rotation_new_ratio: rotationNewRatio,
        rotation_seen_ratio: rotationSeenRatio,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method !== "rss_generic" && method !== "rss") {
      return json({ ok: false, error: "unsupported_ingest_method" }, 400);
    }

    if (jobSource.is_active === false && !dry_run) {
      return json({ ok: false, error: "job_source_inactive" }, 400);
    }

    const feedUrl = jobSource.ingest_config?.feed_url;
    if (!feedUrl || typeof feedUrl !== "string") {
      return json({ ok: false, error: "missing_feed_url" }, 400);
    }

    const maxItems = Math.max(
      1,
      Math.min(limit, Number(jobSource.ingest_config?.limit ?? 50)),
    );
    const rssUpsertBatchSize =
      toPositiveInt(jobSource.ingest_config?.upsert_batch_size) ??
        (maxItems > 25 ? 25 : maxItems);
    const runId = await createRun(
      supabaseUrl,
      serviceKey,
      jobSource.id,
      "ingest",
    );
    currentRunId = runId;
    const data = await fetchRssFeedItems(feedUrl, maxItems);

    if (dry_run) {
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: new Date().toISOString(),
        status: "success",
        ok: true,
        fetched_count: data.items.length,
        inserted_count: 0,
        updated_count: 0,
      });
      return json({
        ok: true,
        source_code,
        limit: maxItems,
        dry_run: true,
        status: "dry_run_parsed",
        feed_url: data.feed_url,
        parsed: data.parsed,
        sample: data.items.slice(0, 3),
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const now = new Date().toISOString();

    const rows = [];
    for (const item of data.items) {
      const rawTitle = item.title || "Untitled";
      const parsed = parseTitleCompany(rawTitle);
      const title = parsed.title || rawTitle;
      const company = parsed.company || null;
      const location = jobSource.region ?? null;
      const link = canonicalizeJobUrl(item.link || "").canonicalUrl ?? "";
      const guid = item.guid?.trim() || "";

      const publishedIso = item.published_at ?? null;

      const summary = (item.summary || "").trim();
      const content = (item.content || "").trim();
      const html = content || summary;
      const text = html ? stripHtml(html) : "";

      const jobType = detectJobType(title, text);
      const identity = await buildCrossSourceJobIdentity({
        title,
        companyName: company,
        location,
        sourceUrl: link || null,
        applyUrl: link || null,
      });

      let external_id = "";
      if (guid) {
        external_id = `${source_code}:${guid}`;
      } else if (link) {
        const hash = await sha256Hex(
          `${title}|${company ?? ""}|${jobSource.region ?? ""}|${
            publishedIso ?? ""
          }|${link}`,
        );
        external_id = `${source_code}:${hash}`;
      } else {
        const hash = await sha256Hex(
          `${title}|${company ?? ""}|${jobSource.region ?? ""}|${
            publishedIso ?? ""
          }`,
        );
        external_id = `${source_code}:${hash}`;
      }

      rows.push({
        job_source_id: jobSource.id,
        external_id,
        title,
        company_name: company,
        location,
        country: jobSource.country ?? null,
        remote_type: null,
        contract_type: null,
        seniority: null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        description_html: html ? html : null,
        description_text: text ? text : null,
        apply_url: link || null,
        source_url: link || null,
        canonical_url: identity.canonicalUrl,
        dedupe_identity_key: identity.dedupeIdentityKey,
        cross_source_fingerprint: identity.crossSourceFingerprint,
        tags: [],
        posted_at: publishedIso,
        published_at: publishedIso,
        expires_at: null,
        scraped_at: now,
        updated_at: now,
        last_seen_at: now,
        is_active: true,
        is_expired: false,
        job_status: "active",
        job_type: jobType,
        job_json: {
          source_code,
          feed_url: data.feed_url,
          guid: guid || null,
        },
      });
    }

    let inserted = 0;
    let updated = 0;
    try {
      ({ inserted, updated } = await upsertJobsWithStats(supabase, rows, {
        batchSize: rssUpsertBatchSize,
      }));
    } catch (upErr) {
      const err = upErr instanceof JobsUpsertFailedError
        ? upErr
        : new JobsUpsertFailedError((upErr as Error).message);
      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: new Date().toISOString(),
        status: "failed",
        ok: false,
        error: `jobs_upsert_failed: ${err.message}`,
        fetched_count: rows.length,
        inserted_count: err.inserted,
        updated_count: err.updated,
      });
      return json({
        ok: false,
        error: "jobs_upsert_failed",
        message: err.message,
      }, 500);
    }

    await finishRun(supabaseUrl, serviceKey, currentRunId, {
      finished_at: new Date().toISOString(),
      status: "success",
      ok: true,
      fetched_count: rows.length,
      inserted_count: inserted,
      updated_count: updated,
    });

    return json({
      ok: true,
      source_code,
      limit: maxItems,
      dry_run: false,
      status: "rss_upserted",
      parsed: data.parsed,
      inserted,
      updated,
      upserted: rows.length,
    });
  } catch (e) {
    await finishRun(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      currentRunId,
      {
        finished_at: new Date().toISOString(),
        status: "failed",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        fetched_count: 0,
        inserted_count: 0,
        updated_count: 0,
      },
    );
    return json(
      {
        ok: false,
        error: "ingest_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});
