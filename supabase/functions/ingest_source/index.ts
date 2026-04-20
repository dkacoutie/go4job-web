// supabase/functions/ingest_source/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchAejItems } from "./sources/aej_html.ts";
import { fetchCoordinationSudItems } from "./sources/coordination_sud.ts";
import { fetchEmploiCiItems } from "./sources/emploi_ci.ts";
import { fetchFedAfricaItems } from "./sources/fedafrica.ts";
import { fetchGenericListItems } from "./sources/generic_list.ts";
import { fetchHimalayasItems } from "./sources/himalayas_api.ts";
import { fetchRssFeedItems } from "./sources/rss_generic.ts";
import { fetchSmartRecruitersItems } from "./sources/smartrecruiters.ts";
import { fetchTzportalItems } from "./sources/tzportal_bceao.ts";
import { fetchUnecaItems } from "./sources/uneca.ts";
import {
  buildCrossSourceJobIdentity,
  canonicalizeJobUrl,
} from "../_shared/jobIdentity.ts";

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

async function sbInsertOne<T>(url: string, serviceKey: string, row: unknown): Promise<T> {
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

async function sbPatch<T>(url: string, serviceKey: string, patch: unknown): Promise<T> {
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
    const url = `${supabaseUrl}/rest/v1/job_source_runs?id=eq.${encodeURIComponent(runId)}`;
    await sbPatch(url, serviceKey, patch);
  } catch {
    // best effort only
  }
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
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
  if (/(alternance|apprentissage|apprenticeship|apprenti)/.test(text)) return "apprenticeship";
  if (/(internship|intern\b|trainee|stagiaire|stage|graduate programme|graduate program)/.test(text)) {
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

class JobsUpsertFailedError extends Error {
  inserted: number;
  updated: number;

  constructor(message: string, inserted = 0, updated = 0) {
    super(message);
    this.name = "JobsUpsertFailedError";
    this.inserted = inserted;
    this.updated = updated;
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

  let existingIds = new Set<string>();
  if (externalIds.length > 0) {
    const { data: existingRows, error: existingErr } = await supabase
      .from("jobs")
      .select("external_id")
      .in("external_id", externalIds);

    if (existingErr) throw existingErr;
    existingIds = new Set(
      (existingRows ?? [])
        .map((row: { external_id?: string | null }) => (row.external_id ?? "").trim())
        .filter(Boolean),
    );
  }

  const inserted = externalIds.filter((externalId) => !existingIds.has(externalId)).length;
  const updated = externalIds.filter((externalId) => existingIds.has(externalId)).length;
  const requestedBatchSize = toPositiveInt(options?.batchSize);
  const fallbackBatchSize = uniqueRows.length || 1;
  const batchSize = Math.max(
    1,
    Math.min(fallbackBatchSize, requestedBatchSize ?? fallbackBatchSize),
  );

  let insertedCommitted = 0;
  let updatedCommitted = 0;
  for (let i = 0; i < uniqueRows.length; i += batchSize) {
    const chunk = uniqueRows.slice(i, i + batchSize);
    const chunkExternalIds = chunk
      .map((row) => (row.external_id ?? "").trim())
      .filter(Boolean);
    const chunkInserted = chunkExternalIds.filter((externalId) => !existingIds.has(externalId)).length;
    const chunkUpdated = chunkExternalIds.filter((externalId) => existingIds.has(externalId)).length;

    const { error: upErr } = await supabase
      .from("jobs")
      .upsert(chunk, { onConflict: "external_id" });

    if (upErr) {
      throw new JobsUpsertFailedError(upErr.message, insertedCommitted, updatedCommitted);
    }

    insertedCommitted += chunkInserted;
    updatedCommitted += chunkUpdated;
  }

  return { uniqueRows, inserted, updated };
}

type ScrapedItem = {
  external_id?: string;
  title: string;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  contract_type?: string | null;
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
  const seed = `${normalizedTitle}|${normalizedSourceUrl}|${item.published_at ?? ""}`;
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
    const sourceUrl = normalizeOptionalUrl(it.source_url) ?? normalizeOptionalUrl(it.apply_url);
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
      posted_at: it.published_at ?? null,
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
      },
    });
  }

  return rows;
}

Deno.serve(async (req) => {
  // Healthcheck
  if (req.method === "GET") return json({ ok: true, status: "ingest_source_alive" });

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // Auth via x-cron-secret
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ ok: false, error: "CRON_SECRET_not_set_in_env" }, 500);

  const provided = req.headers.get("x-cron-secret");
  if (provided !== expected) return json({ ok: false, error: "unauthorized" }, 401);

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

  if (!source_code || typeof source_code !== "string") {
    return json({ ok: false, error: "missing_source_code" }, 400);
  }

  let currentRunId: string | null = null;
  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Fetch job source by code (for rss_generic)
    const jobSourceUrl =
      `${supabaseUrl}/rest/v1/job_sources?select=` +
      `id,code,name,ingest_method,ingest_config,is_active,ingest_status,country,region,priority` +
      `&code=eq.${encodeURIComponent(source_code)}&limit=1`;

    const jobSourceArr = await sbGet<any[]>(jobSourceUrl, serviceKey);
    const jobSource = jobSourceArr?.[0] ?? null;

    if (source_code === "emploi_ci") {
      const runId = await createRun(supabaseUrl, serviceKey, "ed25b64d-ace6-4296-8985-46702d58785d", "ingest");
      currentRunId = runId;
      const data = await fetchEmploiCiItems(limit);

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
          limit,
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.sample,
        });
      }

      // job_source_id (fixed seed for this source)
      const job_source_id = "ed25b64d-ace6-4296-8985-46702d58785d";

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
          companyName: null,
          location: it.location,
          sourceUrl: it.url,
          applyUrl: it.url,
        });

        const baseRow = {
          job_source_id,
          external_id,
          title: it.title,
          company_name: null,
          location: it.location,
          country: it.country,
          remote_type: null,
          contract_type: null,
          seniority: null,
          salary_min: null,
          salary_max: null,
          salary_currency: null,
          salary_period: null,
          description_html: null,
          description_text: null,
          apply_url: it.url,
          source_url: it.url,
          canonical_url: identity.canonicalUrl,
          dedupe_identity_key: identity.dedupeIdentityKey,
          cross_source_fingerprint: identity.crossSourceFingerprint,
          tags: [],
          posted_at: null,
          published_at: null,
          expires_at: null,
          updated_at: now,
          last_seen_at: now,
          is_active: true,
          is_expired: false,
          job_status: "active",
          job_json: {
            source_code: "emploi_ci",
            provider: "educarriere",
            fetched_from: data.list_url,
            original_url: it.url,
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
          const patchUrl =
            `${jobsBase}?job_source_id=eq.${job_source_id}` +
            `&external_id=eq.${encodeURIComponent(external_id)}`;

          await sbPatch(patchUrl, serviceKey, baseRow);
          updated++;
        }
      }

      await finishRun(supabaseUrl, serviceKey, currentRunId, {
        finished_at: new Date().toISOString(),
        status: "success",
        ok: true,
        fetched_count: data.items.length,
        inserted_count: inserted,
        updated_count: updated,
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
      });
    }

    if (!jobSource) {
      return json({ ok: false, error: "job_source_not_found" }, 404);
    }

    const method = (jobSource.ingest_method ?? "rss_generic").toLowerCase();

    if (method === "aej_html") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = jobSource.ingest_config?.list_url ||
        "https://www.agenceemploijeunes.ci/site/offres-emplois";
      const maxPages = Math.max(1, Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 2)));
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 30)));
      const delayMs = Math.max(0, Number(jobSource.ingest_config?.delay_ms ?? 800));

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchAejItems(listUrl, maxPages, maxItems, delayMs);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const now = new Date().toISOString();

      const rows = await Promise.all(data.items.map(async (it) => {
        const desc = it.description_text || "";
        const jobType = detectJobType(it.title, `${desc} ${it.contract_type ?? ""}`);
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
          company_name: null,
          location,
          country: jobSource.country || "Cote d'Ivoire",
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
          tags: [],
          posted_at: null,
          published_at: null,
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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "aej_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "scrape_fedafrica") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = jobSource.ingest_config?.list_url || "https://www.fedafrica.com/offres";
      const maxPages = Math.max(1, Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 2)));
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 30)));
      const delayMs = Math.max(0, Number(jobSource.ingest_config?.delay_ms ?? 800));

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchFedAfricaItems(listUrl, maxPages, maxItems, delayMs);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const rows = await mapScrapedItemsToRows(
        data.items as ScrapedItem[],
        jobSource,
        source_code,
        data.list_url,
      );

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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "fedafrica_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "scrape_tzportal_bceao") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = jobSource.ingest_config?.list_url || "https://bceao2.tzportal.io/fr/jobs";
      const maxPages = Math.max(1, Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 1)));
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 30)));
      const delayMs = Math.max(0, Number(jobSource.ingest_config?.delay_ms ?? 800));

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchTzportalItems(listUrl, maxPages, maxItems, delayMs);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const rows = await mapScrapedItemsToRows(
        data.items as ScrapedItem[],
        jobSource,
        source_code,
        data.list_url,
      );

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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "bceao_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "scrape_coordination_sud") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = jobSource.ingest_config?.list_url || "https://www.coordinationsud.org/espace-emploi/";
      const maxPages = Math.max(1, Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 2)));
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 40)));
      const delayMs = Math.max(0, Number(jobSource.ingest_config?.delay_ms ?? 800));

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchCoordinationSudItems(listUrl, maxPages, maxItems, delayMs);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const rows = await mapScrapedItemsToRows(
        data.items as ScrapedItem[],
        jobSource,
        source_code,
        data.list_url,
      );

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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "coordination_sud_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "scrape_uneca") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = jobSource.ingest_config?.list_url ||
        "https://www.uneca.org/fr/%C3%A0-propos/opportunit%C3%A9s";
      const fallbackUrl = jobSource.ingest_config?.fallback_url || null;
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 30)));
      const delayMs = Math.max(0, Number(jobSource.ingest_config?.delay_ms ?? 800));

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchUnecaItems(listUrl, fallbackUrl, maxItems, delayMs);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const rows = await mapScrapedItemsToRows(
        data.items as ScrapedItem[],
        jobSource,
        source_code,
        data.list_url,
      );

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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "uneca_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "api_smartrecruiters") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const companyId = jobSource.ingest_config?.company_id || "TALENT2AFRICA";
      const apiKey = jobSource.ingest_config?.api_key || null;
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 50)));

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchSmartRecruitersItems(companyId, maxItems, apiKey);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const rows = await mapScrapedItemsToRows(
        data.items as ScrapedItem[],
        jobSource,
        source_code,
        data.list_url,
      );

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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "smartrecruiters_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "api_himalayas") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const apiUrl = jobSource.ingest_config?.api_url || "https://himalayas.app/jobs/api";
      const searchUrl = jobSource.ingest_config?.search_url || "https://himalayas.app/jobs/api/search";
      const attributionName = typeof jobSource.ingest_config?.attribution_name === "string" &&
          jobSource.ingest_config.attribution_name.trim()
        ? jobSource.ingest_config.attribution_name.trim()
        : "Himalayas";
      const attributionUrl = typeof jobSource.ingest_config?.attribution_url === "string" &&
          jobSource.ingest_config.attribution_url.trim()
        ? jobSource.ingest_config.attribution_url.trim()
        : "https://himalayas.app/jobs";
      const subsetLabel = typeof jobSource.ingest_config?.subset_label === "string" &&
          jobSource.ingest_config.subset_label.trim()
        ? jobSource.ingest_config.subset_label.trim()
        : "staging_small_subset";
      const stagingOnly = Boolean(jobSource.ingest_config?.staging_only ?? false);
      const searchQuery = typeof jobSource.ingest_config?.search_query === "string"
        ? jobSource.ingest_config.search_query
        : null;
      const maxPages = Math.max(1, Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 1)));
      const startOffset = Math.max(0, Math.trunc(Number(jobSource.ingest_config?.offset ?? 0)));
      const configuredLimit = Math.max(1, Math.min(20, Number(jobSource.ingest_config?.limit ?? 5)));
      const requestedLimit = Math.max(1, Math.min(20, limit));
      const maxItems = Math.min(configuredLimit, requestedLimit);

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
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
          dry_run: true,
          status: "dry_run_parsed",
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const now = new Date().toISOString();

      const rows = [];
      for (const item of data.items) {
        const preferredSourceUrl = normalizeOptionalUrl(item.canonical_url) ??
          normalizeOptionalUrl(item.source_url) ??
          normalizeOptionalUrl(item.apply_url);
        const applyUrl = normalizeOptionalUrl(item.apply_url) ?? preferredSourceUrl;
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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "himalayas_api_upserted",
        parsed: data.parsed,
        inserted,
        updated,
        upserted: rows.length,
      });
    }

    if (method === "scrape_generic") {
      if (jobSource.is_active === false && !dry_run) {
        return json({ ok: false, error: "job_source_inactive" }, 400);
      }

      const listUrl = jobSource.ingest_config?.list_url;
      if (!listUrl || typeof listUrl !== "string") {
        return json({ ok: false, error: "missing_list_url" }, 400);
      }

      const maxPages = Math.max(1, Math.min(5, Number(jobSource.ingest_config?.max_pages ?? 1)));
      const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 20)));
      const delayMs = Math.max(0, Number(jobSource.ingest_config?.delay_ms ?? 800));
      const linkPattern = jobSource.ingest_config?.link_pattern ?? null;

      const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
      currentRunId = runId;
      const data = await fetchGenericListItems(listUrl, maxPages, maxItems, delayMs, linkPattern);

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
          list_url: data.list_url,
          parsed: data.parsed,
          sample: data.items.slice(0, 3),
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const scraped = data.items.map((it: any) => ({
        title: it.title || "Offre d'emploi",
        source_url: it.source_url,
        apply_url: it.source_url,
        published_at: it.published_at ?? null,
        description_text: null,
        description_html: null,
        is_expired: false,
      })) as ScrapedItem[];

      const rows = await mapScrapedItemsToRows(scraped, jobSource, source_code, data.list_url);
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
        return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
        status: "generic_upserted",
        parsed: data.parsed,
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

    const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 50)));
    const rssUpsertBatchSize = toPositiveInt(jobSource.ingest_config?.upsert_batch_size) ??
      (maxItems > 25 ? 25 : maxItems);
    const runId = await createRun(supabaseUrl, serviceKey, jobSource.id, "ingest");
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

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
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
        const hash = await sha256Hex(`${title}|${company ?? ""}|${jobSource.region ?? ""}|${publishedIso ?? ""}|${link}`);
        external_id = `${source_code}:${hash}`;
      } else {
        const hash = await sha256Hex(`${title}|${company ?? ""}|${jobSource.region ?? ""}|${publishedIso ?? ""}`);
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
      return json({ ok: false, error: "jobs_upsert_failed", message: err.message }, 500);
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
      { ok: false, error: "ingest_failed", message: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
