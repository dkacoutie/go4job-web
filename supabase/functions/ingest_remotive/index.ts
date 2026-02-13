// supabase/functions/ingest_remotive/index.ts
/**
 * Ingest Remotive jobs into public.jobs with reliable, idempotent upsert.
 *
 * Auth:
 *  - x-cron-secret: <CRON_SECRET>
 *  - OR Authorization: Bearer <CRON_SECRET>
 *
 * Goals:
 *  - last_seen_at updated on every seen job
 *  - upsert on (job_source_id, external_id)
 *  - optional expire unseen jobs (OFF by default)
 *  - job_source_runs row created + updated for monitoring
 */

type Json = Record<string, unknown>;

const BUILD_ID = "2026-02-13_ingest_remotive_html_clean_v2";
const SENTINEL_ISO = "1970-01-01T00:00:00.000Z";

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
  if (!expected) {
    return json({ ok: false, error: "CRON_SECRET_not_set_in_env", build_id: BUILD_ID }, 500);
  }

  const viaHeader = req.headers.get("x-cron-secret") || "";
  const viaBearer = getBearer(req) || "";

  const ok = (viaHeader && viaHeader === expected) || (viaBearer && viaBearer === expected);
  if (!ok) return json({ ok: false, error: "Unauthorized", build_id: BUILD_ID }, 401);

  return null;
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function decodeHtmlEntities(input: string): string {
  let s = String(input ?? "");

  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };

  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => {
    const k = String(name || "").toLowerCase();
    return k in named ? named[k] : m;
  });

  s = s.replace(/&#(\d+);/g, (m, num) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return m;
    try { return String.fromCodePoint(n); } catch { return m; }
  });

  s = s.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => {
    const n = parseInt(hex, 16);
    if (!Number.isFinite(n)) return m;
    try { return String.fromCodePoint(n); } catch { return m; }
  });

  return s;
}

function stripHtml(html: string): string {
  const withBreaks = String(html ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*section\s*>/gi, "\n")
    .replace(/<\/\s*h[1-6]\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "\n- ")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<\/\s*ul\s*>/gi, "\n")
    .replace(/<\/\s*ol\s*>/gi, "\n")
    .replace(/<\/\s*tr\s*>/gi, "\n")
    .replace(/<\/\s*td\s*>/gi, " | ")
    .replace(/<\/\s*th\s*>/gi, " | ");

  return decodeHtmlEntities(withBreaks)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
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

async function sbPatch(url: string, serviceKey: string, patch: unknown, returnRepresentation = false) {
  const prefer = returnRepresentation ? "return=representation" : "return=minimal";
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...baseHeaders(serviceKey),
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`supabase_patch_failed: ${res.status}\n${t}`);
  }
  if (returnRepresentation) return await res.json();
  return null;
}

async function sbUpsertMany(
  url: string,
  serviceKey: string,
  rows: unknown[],
  onConflict: string,
) {
  // PostgREST upsert = POST with Prefer + on_conflict query param
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

type RemotiveApiJob = {
  id: number;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
};

async function fetchRemotiveJobs(limit: number) {
  const apiUrl = "https://remotive.com/api/remote-jobs";
  const res = await fetch(apiUrl, { method: "GET" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`remotive_fetch_failed: ${res.status}\n${t}`);
  }
  const data = (await res.json()) as { jobs?: RemotiveApiJob[] };
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const safeLimit = clampInt(limit, 1, 1000);

  return {
    api_url: apiUrl,
    jobs: jobs.slice(0, safeLimit),
    total: jobs.length,
  };
}

Deno.serve(async (req) => {
  // Healthcheck
  if (req.method === "GET") {
    return json({ ok: true, status: "ingest_remotive_alive", build_id: BUILD_ID });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed", build_id: BUILD_ID }, 405);
  }

  // ✅ Auth: x-cron-secret OR Bearer CRON_SECRET (NO JWT)
  const authResp = requireCronAuth(req);
  if (authResp) return authResp;

  // Body JSON (optional)
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = clampInt(Number(body?.limit ?? 200), 1, 1000);
  const trigger = typeof body?.trigger === "string" ? body.trigger : "manual_or_cron";
  const run_kind = typeof body?.run_kind === "string" ? body.run_kind : "ingest";
  const force = Boolean(body?.force ?? false);

  // Default OFF (safer)
  const expire_unseen = Boolean(body?.expire_unseen ?? false);

  const startedAt = new Date();
  let runId: number | null = null;
  let job_source_id: string | null = null;

  // Stats
  let fetched = 0;
  let upserted = 0;

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const jobSourcesBase = `${supabaseUrl}/rest/v1/job_sources`;
    const runsBase = `${supabaseUrl}/rest/v1/job_source_runs`;
    const jobsBase = `${supabaseUrl}/rest/v1/jobs`;

    // Resolve job_source_id from code=remotive
    {
      const url = `${jobSourcesBase}?select=id,code&code=eq.remotive&limit=1`;
      const rows = await sbGet<Array<{ id: string; code: string }>>(url, serviceKey);
      if (!rows?.length) {
        return json({ ok: false, error: "job_source_remotive_missing", build_id: BUILD_ID }, 500);
      }
      job_source_id = rows[0].id;
    }

    // Optional skip if last success is too recent (avoid spam)
    if (!force) {
      const lastRunUrl =
        `${runsBase}?select=started_at,status&job_source_id=eq.${encodeURIComponent(job_source_id)}&status=eq.success&order=started_at.desc&limit=1`;
      const last = await sbGet<Array<{ started_at: string }>>(lastRunUrl, serviceKey);
      if (last?.[0]?.started_at) {
        const lastTs = new Date(last[0].started_at).getTime();
        const nowTs = Date.now();
        const ageMs = nowTs - lastTs;

        if (ageMs >= 0 && ageMs < 3 * 60 * 1000) {
          return json({
            ok: true,
            skipped: true,
            reason: "FRESH_ENOUGH",
            build_id: BUILD_ID,
            last_started_at: last[0].started_at,
          });
        }
      }
    }

    // Create run row
    {
      const runRow = {
        job_source_id,
        started_at: startedAt.toISOString(),
        finished_at: null,
        status: "running",
        run_kind,
        trigger,

        // safe defaults (NOT NULL friendly)
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
        meta: { source_code: "remotive", build_id: BUILD_ID },
      };

      const inserted = await sbInsertOne<Array<{ id: number }>>(runsBase, serviceKey, runRow);
      runId = inserted?.[0]?.id ?? null;
    }

    const nowIso = new Date().toISOString();

    // OPTIONAL: Pre-mark active jobs as unseen for this run (only if we will expire unseen)
    if (expire_unseen) {
      const patchUrl = `${jobsBase}?job_source_id=eq.${encodeURIComponent(job_source_id)}&is_active=eq.true`;
      await sbPatch(patchUrl, serviceKey, { last_seen_at: SENTINEL_ISO }, false);
    }

    // Fetch Remotive
    const api = await fetchRemotiveJobs(limit);
    fetched = api.jobs.length;

    const rows = api.jobs.map((j) => {
      const external_id = `remotive:${j.id}`;
      const posted_at = j.publication_date ? new Date(j.publication_date).toISOString() : null;

      const descriptionHtml = j.description ?? null;
      const descriptionText = descriptionHtml ? stripHtml(descriptionHtml) : null;

      return {
        job_source_id,
        external_id,

        title: j.title ?? null,
        company_name: j.company_name ?? null,
        location: j.candidate_required_location ?? null,
        country: null,

        remote_type: "remote",
        contract_type: j.job_type ?? null,
        seniority: null,

        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,

        description_html: descriptionHtml,
        description_text: descriptionText,

        apply_url: j.url ?? null,
        source_url: j.url ?? null,

        tags: [],

        posted_at,
        published_at: null,
        expires_at: null,

        updated_at: nowIso,
        last_seen_at: nowIso,

        is_active: true,
        is_expired: false,

        job_json: {
          source_code: "remotive",
          provider: "remotive",
          category: j.category ?? null,
          fetched_from: api.api_url,
          original: j,
        } satisfies Json,
      };
    });

    if (rows.length) {
      // ✅ Critical: upsert on composite unique (job_source_id, external_id)
      await sbUpsertMany(jobsBase, serviceKey, rows, "job_source_id,external_id");
      upserted = rows.length;
    }

    // OPTIONAL: Expire unseen jobs (still sentinel)
    if (expire_unseen) {
      const patchUrl =
        `${jobsBase}?job_source_id=eq.${encodeURIComponent(job_source_id)}&is_active=eq.true&last_seen_at=eq.${encodeURIComponent(SENTINEL_ISO)}`;
      await sbPatch(
        patchUrl,
        serviceKey,
        { is_active: false, is_expired: true, updated_at: nowIso, expires_at: nowIso },
        false,
      );
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    if (runId) {
      await sbPatch(
        `${runsBase}?id=eq.${runId}`,
        serviceKey,
        {
          finished_at: finishedAt.toISOString(),
          status: "success",
          ok: true,
          http_status: 200,

          fetched_count: fetched,
          items_fetched: fetched,
          jobs_seen: fetched,
          jobs_upserted: upserted,
          inserted_count: upserted, // split insert/update unknown with return=minimal
          updated_count: 0,
          duration_ms: durationMs,

          error: null,
          error_code: null,
          error_message: null,
          meta: { source_code: "remotive", build_id: BUILD_ID, limit, fetched, upserted, expire_unseen },
        },
        false,
      );
    }

    return json({
      ok: true,
      source: "remotive",
      source_code: "remotive",
      dry_run: false,
      limit,
      fetched,
      upserted,
      expire_unseen,
      job_source_id,
      run_id: runId,
      build_id: BUILD_ID,
    });
  } catch (e) {
    // Mark run failed (best-effort)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey && runId) {
        const runsBase = `${supabaseUrl}/rest/v1/job_source_runs`;
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        await sbPatch(
          `${runsBase}?id=eq.${runId}`,
          serviceKey,
          {
            finished_at: finishedAt.toISOString(),
            status: "failed",
            ok: false,
            http_status: 500,
            duration_ms: durationMs,
            error_message: e instanceof Error ? e.message : String(e),
            meta: { source_code: "remotive", job_source_id, build_id: BUILD_ID },
          },
          false,
        );
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
