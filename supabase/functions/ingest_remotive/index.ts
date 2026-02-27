import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function safeIsoDate(v: unknown): string | null {
  const s = safeStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function safeTags(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.map((x) => String(x).trim()).filter(Boolean);
  return arr.length ? arr : null;
}

Deno.serve(async (req) => {
  // CORS (utile si test navigateur)
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-debug-cron, content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };

  if (req.method.toUpperCase() === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" }, corsHeaders);
  }

  // Auth CRON (x-cron-secret or Bearer)
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";

  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  if (!CRON_SECRET) return json(500, { ok: false, error: "Missing CRON_SECRET env" }, corsHeaders);

  // DEBUG (ne révèle pas le secret)
  if (req.headers.get("x-debug-cron") === "1") {
    const [cronHex, tokenHex] = await Promise.all([sha256Hex(CRON_SECRET), sha256Hex(token)]);
    return json(
      200,
      {
        ok: true,
        cron_len: CRON_SECRET.length,
        token_len: token.length,
        cron_sha256: cronHex,
        token_sha256: tokenHex,
        equal: CRON_SECRET === token,
      },
      corsHeaders,
    );
  }

  if (!(token && token === CRON_SECRET) && !(cronHeader && cronHeader === CRON_SECRET)) {
    return json(401, { ok: false, error: "Unauthorized" }, corsHeaders);
  }

  // Env Supabase
  const SUPABASE_URL = Deno.env.get("SB_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL) return json(500, { ok: false, error: "Missing SB_URL env" }, corsHeaders);
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "Missing SB_SERVICE_ROLE_KEY env" }, corsHeaders);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 0) job_source_id Remotive
  const { data: src, error: srcErr } = await supabase
    .from("job_sources")
    .select("id,name")
    .ilike("name", "%remotive%")
    .limit(1)
    .maybeSingle();

  if (srcErr) return json(500, { ok: false, step: "job_sources_select", error: srcErr.message }, corsHeaders);
  if (!src?.id) return json(500, { ok: false, error: "job_sources: Remotive not found (seed manquant)" }, corsHeaders);

  const jobSourceId = String(src.id);

  // ---- Monitoring: job_source_runs
  // CHECK status: running | success | failed
  let runId: string | null = null;
  try {
    const { data: runRow, error: runErr } = await supabase
      .from("job_source_runs")
      .insert({
        job_source_id: jobSourceId,
        status: "running",
        fetched_count: 0,
        inserted_count: 0,
        updated_count: 0,
      })
      .select("id")
      .single();

    if (!runErr && runRow?.id !== undefined && runRow?.id !== null) {
      runId = String(runRow.id);
      if (!runId.trim()) runId = null;
    }
  } catch {
    runId = null;
  }

  const finishRun = async (patch: Record<string, unknown>) => {
    if (!runId) return;
    try {
      await supabase.from("job_source_runs").update(patch).eq("id", runId);
    } catch {
      // silencieux: ne doit jamais casser l’ingest
    }
  };

  try {
    // 1) Fetch Remotive
    const r = await fetch("https://remotive.com/api/remote-jobs");
    if (!r.ok) {
      await finishRun({
        finished_at: new Date().toISOString(),
        status: "failed",
        ok: false,
        error: `fetch_remotive: ${r.status}`,
        fetched_count: 0,
        inserted_count: 0,
        updated_count: 0,
      });
      return json(500, { ok: false, step: "fetch_remotive", status: r.status }, corsHeaders);
    }

    const payload = await r.json();
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const nowIso = new Date().toISOString();

    // 2) Mapper vers public.jobs
    const rows = jobs.map((j: any) => {
      const externalId = safeStr(j?.id);
      const ext = externalId ? `remotive:${externalId}` : `remotive:${crypto.randomUUID()}`;

      const descriptionHtml = safeStr(j?.description) ?? "";
      const descriptionText = descriptionHtml ? stripHtml(descriptionHtml) : null;

      const postedAt = safeIsoDate(j?.publication_date);
      const tags = safeTags(j?.tags);

      return {
        job_source_id: jobSourceId,
        external_id: ext,

        title: safeStr(j?.title),
        company_name: safeStr(j?.company_name),

        location: safeStr(j?.candidate_required_location) ?? "Remote",
        country: null,
        remote_type: "remote",

        contract_type: safeStr(j?.job_type),
        seniority: null,

        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,

        description_html: descriptionHtml || null,
        description_text: descriptionText,

        apply_url: safeStr(j?.url),
        source_url: safeStr(j?.url),

        tags, // ✅ text[] ou null

        posted_at: postedAt,
        published_at: postedAt,
        expires_at: null,

        scraped_at: nowIso,
        updated_at: nowIso,
        last_seen_at: nowIso,

        is_active: true,
        is_expired: false,

        job_json: j,
      };
    });

    // 3) Upsert
    const { error: upErr } = await supabase.from("jobs").upsert(rows, { onConflict: "external_id" });

    if (upErr) {
      await finishRun({
        finished_at: new Date().toISOString(),
        status: "failed",
        ok: false,
        error: `jobs_upsert: ${upErr.message}`,
        fetched_count: jobs.length,
        inserted_count: 0,
        updated_count: 0,
      });
      return json(500, { ok: false, step: "jobs_upsert", error: upErr.message }, corsHeaders);
    }

    await finishRun({
      finished_at: new Date().toISOString(),
      status: "success",
      ok: true,
      fetched_count: jobs.length,
      inserted_count: rows.length,
      updated_count: 0,
    });

    return json(
      200,
      { ok: true, source: "remotive", fetched: jobs.length, upserted: rows.length, run_id: runId },
      corsHeaders,
    );
  } catch (e) {
    await finishRun({
      finished_at: new Date().toISOString(),
      status: "failed",
      ok: false,
      error: String(e),
      fetched_count: 0,
      inserted_count: 0,
      updated_count: 0,
    });
    return json(500, { ok: false, step: "catch", error: String(e), run_id: runId }, corsHeaders);
  }
});
