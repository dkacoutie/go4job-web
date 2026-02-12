// supabase/functions/ingest_source/index.ts
/**
 * Ingest sources router (DB-driven).
 *
 * Auth:
 *  - x-cron-secret: <CRON_SECRET>
 *  - OR Authorization: Bearer <CRON_SECRET>
 *
 * Key goals:
 *  - Resolve job_source from job_sources.code
 *  - Route by job_sources.ingest_method (NOT hardcoded codes)
 *  - Idempotent upsert on (job_source_id, external_id)
 *  - Write a job_source_runs row (status: running|success|failed) only
 *  - RSS generic supports RSS2 + Atom (no DOMParser)
 *  - Limit can be set per-source in job_sources.ingest_config.limit
 */

import { fetchEmploiCiItems } from "./sources/emploi_ci.ts";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.3";

type Json = Record<string, unknown>;

const BUILD_ID = "2026-02-10_rss_generic_no_domparser_v2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}_missing`);
  return v;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function requireCronAuth(req: Request): Response | null {
  const expected = Deno.env.get("CRON_SECRET") || "";
  if (!expected) return json({ ok: false, error: "CRON_SECRET_not_set_in_env", build_id: BUILD_ID }, 500);

  const viaHeader = req.headers.get("x-cron-secret") || "";
  const viaBearer = getBearer(req) || "";

  const ok = (viaHeader && viaHeader === expected) || (viaBearer && viaBearer === expected);
  if (!ok) return json({ ok: false, error: "unauthorized", build_id: BUILD_ID }, 401);

  return null;
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
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
  const res = await fetch(url, { method: "GET", headers: baseHeaders(serviceKey) });
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

async function sbPatch(url: string, serviceKey: string, patch: unknown) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_patch_failed: ${res.status}\n${t}`);
  }
}

async function sbUpsertMany(
  url: string,
  serviceKey: string,
  rows: unknown[],
  onConflict: string,
) {
  const fullUrl = `${url}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(fullUrl, {
    method: "POST",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_upsert_failed: ${res.status}\n${t}`);
  }
}

/** base64url without padding */
function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
}

function safeIsoDate(s: unknown): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type RssItem = {
  title: string | null;
  link: string | null;
  guid: string | null;
  published_at: string | null;
  description: string | null;
};

function pickFirstString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = pickFirstString(x);
      if (s) return s;
    }
  }
  if (v && typeof v === "object") {
    const t = (v as any)["#text"];
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

function normalizeLink(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object") {
    const href = (v as any)["@_href"];
    if (typeof href === "string" && href.trim()) return href.trim();
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = normalizeLink(x);
      if (s) return s;
    }
  }
  return null;
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<{ text: string; contentType: string; status: number; statusText: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent": "Go4Job-JobRadar/1.0 (+rss_generic)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    return { text, contentType, status: res.status, statusText: res.statusText };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse RSS2/Atom via fast-xml-parser (no DOMParser).
 */
async function fetchRssGenericItems(
  feedUrl: string,
  limit: number,
): Promise<{ items: RssItem[]; parsed: Json }> {
  // 15s is a good compromise; pg_net can still time out earlier if configured too low.
  const { text, contentType, status, statusText } = await fetchTextWithTimeout(feedUrl, 15_000);

  if (status < 200 || status >= 300) {
    throw new Error(`rss_fetch_failed: ${status} ${statusText}\n${text.slice(0, 400)}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: false,
  });

  let obj: any;
  try {
    obj = parser.parse(text);
  } catch (e) {
    throw new Error(`rss_parse_failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const items: RssItem[] = [];

  // RSS 2.0: rss.channel.item
  const rssItems = obj?.rss?.channel?.item ?? obj?.channel?.item ?? null;
  if (rssItems) {
    const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
    for (const it of arr.slice(0, limit)) {
      items.push({
        title: pickFirstString(it?.title),
        link: normalizeLink(it?.link),
        guid: pickFirstString(it?.guid),
        published_at: safeIsoDate(pickFirstString(it?.pubDate) || pickFirstString(it?.published)),
        description: pickFirstString(it?.description) || pickFirstString(it?.["content:encoded"]) || null,
      });
    }

    return {
      items,
      parsed: {
        feed_url: feedUrl,
        content_type: contentType,
        format: "rss2",
        total_items: items.length,
      },
    };
  }

  // Atom: feed.entry
  const atomEntries = obj?.feed?.entry ?? null;
  if (atomEntries) {
    const arr = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    for (const e of arr.slice(0, limit)) {
      items.push({
        title: pickFirstString(e?.title),
        link: normalizeLink(e?.link),
        guid: pickFirstString(e?.id),
        published_at: safeIsoDate(pickFirstString(e?.published) || pickFirstString(e?.updated)),
        description: pickFirstString(e?.summary) || pickFirstString(e?.content) || null,
      });
    }

    return {
      items,
      parsed: {
        feed_url: feedUrl,
        content_type: contentType,
        format: "atom",
        total_items: items.length,
      },
    };
  }

  throw new Error("rss_parse_failed: no_item_or_entry_found");
}

function normalizeIngestMethod(raw: string | null): string | null {
  const m = (raw || "").trim();
  if (!m) return null;
  if (m === "rss") return "rss_generic"; // alias to prevent the exact bug you hit
  return m;
}

function configLimit(ingest_config: Json | null | undefined): number | null {
  const v = (ingest_config as any)?.limit;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

Deno.serve(async (req) => {
  if (req.method === "GET") return json({ ok: true, status: "ingest_source_alive", build_id: BUILD_ID });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed", build_id: BUILD_ID }, 405);

  const authResp = requireCronAuth(req);
  if (authResp) return authResp;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json_body", build_id: BUILD_ID }, 400);
  }

  const source_code = typeof body?.source_code === "string" ? body.source_code : null;
  const dry_run = Boolean(body?.dry_run ?? false);
  const trigger = typeof body?.trigger === "string" ? body.trigger : "manual_or_cron";
  const run_kind = typeof body?.run_kind === "string" ? body.run_kind : "ingest";

  if (!source_code) return json({ ok: false, error: "missing_source_code", build_id: BUILD_ID }, 400);

  const startedAt = new Date();
  let job_source_id: string | null = null;
  let runId: number | null = null;

  let itemsFetched = 0;
  let jobsSeen = 0;
  let jobsUpserted = 0;

  let ingest_method: string | null = null;

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const jobSourcesBase = `${supabaseUrl}/rest/v1/job_sources`;
    const runsBase = `${supabaseUrl}/rest/v1/job_source_runs`;
    const jobsBase = `${supabaseUrl}/rest/v1/jobs`;

    const jobSourceRow = await (async () => {
      const url =
        `${jobSourcesBase}?select=id,code,ingest_method,ingest_config,country,region,active,ingest_status&code=eq.${encodeURIComponent(source_code)}&limit=1`;
      const rows = await sbGet<
        Array<{
          id: string;
          code: string;
          ingest_method: string | null;
          ingest_config: Json;
          country: string | null;
          region: string | null;
          active: boolean;
          ingest_status: string;
        }>
      >(url, serviceKey);

      return rows?.[0] ?? null;
    })();

    if (!jobSourceRow) {
      return json({ ok: false, error: "unknown_source_code_in_db", source_code, build_id: BUILD_ID }, 400);
    }

    job_source_id = jobSourceRow.id;
    ingest_method = normalizeIngestMethod(jobSourceRow.ingest_method);

    // ✅ limit priority: body.limit > ingest_config.limit > default 50
    const limitFromBody = Number(body?.limit);
    const limitFromConfig = configLimit(jobSourceRow.ingest_config);
    const effectiveLimit = clampInt(
      Number.isFinite(limitFromBody) ? limitFromBody : (limitFromConfig ?? 50),
      1,
      500,
    );

    const isActive = (jobSourceRow.active ?? (jobSourceRow as any).is_active ?? false);
    if (!isActive || jobSourceRow.ingest_status !== "ready") {
      return json(
        {
          ok: false,
          error: "source_not_ready_or_inactive",
          source_code,
          active: isActive,
          ingest_status: jobSourceRow.ingest_status,
          build_id: BUILD_ID,
        },
        400,
      );
    }

    // ✅ Create run row
    {
      const runRow = {
        job_source_id,
        started_at: startedAt.toISOString(),
        finished_at: null,
        status: "running",
        run_kind,
        trigger,

        fetched_count: 0,
        inserted_count: 0,
        updated_count: 0,
        ok: false,
        http_status: 0,
        items_fetched: 0,
        jobs_seen: 0,
        jobs_upserted: 0,
        duration_ms: 0,

        error: null,
        error_code: null,
        error_message: null,
        meta: { source_code, build_id: BUILD_ID, ingest_method, limit: effectiveLimit },
      };

      const inserted = await sbInsertOne<Array<{ id: number }>>(runsBase, serviceKey, runRow);
      runId = inserted?.[0]?.id ?? null;
    }

    // ===== RSS GENERIC =====
    if (ingest_method === "rss_generic") {
      const feed_url_raw = (jobSourceRow.ingest_config?.feed_url as string | undefined) || "";
      const feed_url = feed_url_raw.trim();
      if (!feed_url) throw new Error("rss_generic_missing_feed_url");

      const data = await fetchRssGenericItems(feed_url, effectiveLimit);

      itemsFetched = data.items?.length ?? 0;
      jobsSeen = itemsFetched;

      if (dry_run) {
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        if (runId) {
          await sbPatch(`${runsBase}?id=eq.${runId}`, serviceKey, {
            finished_at: finishedAt.toISOString(),
            status: "success",
            ok: true,
            http_status: 200,

            fetched_count: itemsFetched,
            items_fetched: itemsFetched,
            jobs_seen: jobsSeen,
            jobs_upserted: 0,
            inserted_count: 0,
            updated_count: 0,
            duration_ms: durationMs,

            error: null,
            error_code: null,
            error_message: null,
            meta: { source_code, build_id: BUILD_ID, dry_run: true, ingest_method, parsed: data.parsed, limit: effectiveLimit },
          });
        }

        return json({
          ok: true,
          source_code,
          ingest_method,
          limit: effectiveLimit,
          dry_run: true,
          status: "dry_run_parsed",
          parsed: data.parsed,
          sample: (data.items ?? []).slice(0, 3),
          build_id: BUILD_ID,
        });
      }

      const nowIso = new Date().toISOString();

      const rows = await Promise.all(
        (data.items ?? []).map(async (it) => {
          const base = `${it.guid || ""}||${it.link || ""}||${it.title || ""}||${it.published_at || ""}`;
          const digest = await sha256Base64Url(base);
          const external_id = `rss:${source_code}:${digest.slice(0, 20)}`;

          return {
            job_source_id,
            external_id,

            title: it.title || "(untitled)",
            company_name: null,
            location: null,
            country: jobSourceRow.country ?? null,

            remote_type: null,
            contract_type: null,
            seniority: null,

            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_period: null,

            description_html: null,
            description_text: null,

            apply_url: it.link,
            source_url: it.link,

            tags: [],

            posted_at: null,
            published_at: it.published_at,
            expires_at: null,

            updated_at: nowIso,
            last_seen_at: nowIso,

            is_active: true,
            is_expired: false,

            job_json: {
              source_code,
              provider: "rss_generic",
              feed_url,
              guid: it.guid,
              original_link: it.link,
              description: it.description ? it.description.slice(0, 2000) : null,
            } satisfies Json,
          };
        }),
      );

      if (rows.length) {
        await sbUpsertMany(jobsBase, serviceKey, rows, "job_source_id,external_id");
        jobsUpserted = rows.length;
      }

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      if (runId) {
        await sbPatch(`${runsBase}?id=eq.${runId}`, serviceKey, {
          finished_at: finishedAt.toISOString(),
          status: "success",
          ok: true,
          http_status: 200,

          fetched_count: itemsFetched,
          items_fetched: itemsFetched,
          jobs_seen: jobsSeen,
          jobs_upserted: jobsUpserted,
          inserted_count: jobsUpserted,
          updated_count: 0,
          duration_ms: durationMs,

          error: null,
          error_code: null,
          error_message: null,
          meta: { source_code, build_id: BUILD_ID, ingest_method, parsed: data.parsed, limit: effectiveLimit },
        });
      }

      return json({
        ok: true,
        source_code,
        ingest_method,
        limit: effectiveLimit,
        dry_run: false,
        status: "upserted",
        jobs_upserted: jobsUpserted,
        build_id: BUILD_ID,
      });
    }

    // ===== EMPLOI_CI (SCRAPE) =====
    if (source_code === "emploi_ci") {
      const data = await fetchEmploiCiItems(clampInt(Number(body?.limit ?? 50), 1, 200));

      itemsFetched = data.items?.length ?? 0;
      jobsSeen = itemsFetched;

      if (dry_run) {
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        if (runId) {
          await sbPatch(`${runsBase}?id=eq.${runId}`, serviceKey, {
            finished_at: finishedAt.toISOString(),
            status: "success",
            ok: true,
            http_status: 200,

            fetched_count: itemsFetched,
            items_fetched: itemsFetched,
            jobs_seen: jobsSeen,
            jobs_upserted: 0,
            inserted_count: 0,
            updated_count: 0,
            duration_ms: durationMs,

            error: null,
            error_code: null,
            error_message: null,
            meta: { source_code, build_id: BUILD_ID, dry_run: true, list_url: data.list_url, parsed: data.parsed },
          });
        }

        return json({
          ok: true,
          source_code,
          ingest_method: "scrape",
          limit: clampInt(Number(body?.limit ?? 50), 1, 200),
          dry_run: true,
          status: "dry_run_parsed",
          parsed: data.parsed,
          list_url: data.list_url,
          sample: data.sample,
          build_id: BUILD_ID,
        });
      }

      const nowIso = new Date().toISOString();

      const rows = (data.items ?? []).map((it) => ({
        job_source_id,
        external_id: it.external_id,
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

        tags: [],

        posted_at: null,
        published_at: null,
        expires_at: null,

        updated_at: nowIso,
        last_seen_at: nowIso,

        is_active: true,
        is_expired: false,

        job_json: {
          source_code: "emploi_ci",
          provider: "educarriere",
          fetched_from: data.list_url,
          original_url: it.url,
        } satisfies Json,
      }));

      if (rows.length) {
        await sbUpsertMany(jobsBase, serviceKey, rows, "job_source_id,external_id");
        jobsUpserted = rows.length;
      }

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      if (runId) {
        await sbPatch(`${runsBase}?id=eq.${runId}`, serviceKey, {
          finished_at: finishedAt.toISOString(),
          status: "success",
          ok: true,
          http_status: 200,

          fetched_count: itemsFetched,
          items_fetched: itemsFetched,
          jobs_seen: jobsSeen,
          jobs_upserted: jobsUpserted,
          inserted_count: jobsUpserted,
          updated_count: 0,
          duration_ms: durationMs,

          error: null,
          error_code: null,
          error_message: null,
          meta: { source_code, build_id: BUILD_ID, list_url: data.list_url, parsed: data.parsed },
        });
      }

      return json({
        ok: true,
        source_code,
        ingest_method: "scrape",
        limit: clampInt(Number(body?.limit ?? 50), 1, 200),
        dry_run: false,
        status: "upserted",
        parsed: data.parsed,
        jobs_upserted: jobsUpserted,
        build_id: BUILD_ID,
      });
    }

    throw new Error(`unknown_ingest_method: ${ingest_method || "(null)"}`);
  } catch (e) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey && runId) {
        const runsBase = `${supabaseUrl}/rest/v1/job_source_runs`;
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        await sbPatch(`${runsBase}?id=eq.${runId}`, serviceKey, {
          finished_at: finishedAt.toISOString(),
          status: "failed",
          ok: false,
          http_status: 500,

          fetched_count: itemsFetched,
          items_fetched: itemsFetched,
          jobs_seen: jobsSeen,
          jobs_upserted: jobsUpserted,
          inserted_count: 0,
          updated_count: 0,
          duration_ms: durationMs,

          error_message: e instanceof Error ? e.message : String(e),
          meta: { source_code, job_source_id, ingest_method, build_id: BUILD_ID },
        });
      }
    } catch {
      // ignore
    }

    return json(
      {
        ok: false,
        error: "ingest_failed",
        message: e instanceof Error ? e.message : String(e),
        build_id: BUILD_ID,
      },
      500,
    );
  }
});
  
