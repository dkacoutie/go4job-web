// supabase/functions/job_enrich_description/index.ts
// Supabase Edge Function (Deno)
//
// Auth (pour le traitement): Authorization: Bearer <CRON_SECRET> OR header x-cron-secret
// Healthcheck: ?limit=0 => réponse immédiate (sans auth) pour debug local

type DescStatus = "pending" | "in_progress" | "done" | "failed" | "blocked";

type JobRow = {
  id: string;
  source_url: string | null;
};

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}

function getCronSecret(req: Request): string | null {
  return req.headers.get("x-cron-secret")?.trim() ?? null;
}

function requireSecret(req: Request) {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected) return { ok: false as const, status: 500, error: "Missing CRON_SECRET env var" };

  const token = getBearer(req) || getCronSecret(req) || "";
  if (!token || token !== expected) return { ok: false as const, status: 401, error: "unauthorized" };

  return { ok: true as const };
}

function clampInt(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampBool(v: string | null) {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
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

function cleanText(input: string): string {
  return decodeHtmlEntities(input ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function safeUrl(url: string): { ok: boolean; error?: string } {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "unsupported_protocol" };
    if (!u.hostname) return { ok: false, error: "missing_hostname" };
    return { ok: true };
  } catch {
    return { ok: false, error: "invalid_url" };
  }
}

function makeReqId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Math.random().toString(16).slice(2)}`;
  }
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

// Lazy imports (reduce cold start)
let _cheerio: any | null = null;
async function getCheerio() {
  if (_cheerio) return _cheerio;
  _cheerio = await import("npm:cheerio@1.0.0-rc.12");
  return _cheerio;
}

let _createClient: any | null = null;
async function getCreateClient() {
  if (_createClient) return _createClient;
  const mod = await import("https://esm.sh/@supabase/supabase-js@2");
  _createClient = mod.createClient;
  return _createClient;
}

async function stripHtmlToText(html: string): Promise<string> {
  const cheerio = await getCheerio();
  const $ = cheerio.load(html);
  $("script,noscript,style,svg,canvas,iframe").remove();
  return cleanText($.root().text());
}

function findJobPosting(x: any): any | null {
  if (!x || typeof x !== "object") return null;

  if (Array.isArray(x["@graph"])) {
    for (const n of x["@graph"]) {
      const found = findJobPosting(n);
      if (found) return found;
    }
  }

  const t = x["@type"];
  if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) return x;

  if (x.mainEntity) {
    const found = findJobPosting(x.mainEntity);
    if (found) return found;
  }

  return null;
}

// Try JSON-LD JobPosting.description first (best quality)
async function extractFromJsonLd(html: string, minChars: number): Promise<string | null> {
  const cheerio = await getCheerio();
  const $ = cheerio.load(html);

  const scripts = $('script[type="application/ld+json"]')
    .map((_: any, el: any) => $(el).text())
    .get()
    .filter(Boolean);

  for (const raw of scripts) {
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];

      for (const obj of candidates) {
        const jobPosting = findJobPosting(obj);
        if (!jobPosting) continue;

        const desc = jobPosting.description ?? jobPosting.jobDescription ?? null;
        if (typeof desc === "string" && cleanText(desc).length >= Math.min(200, minChars)) {
          const text = await stripHtmlToText(desc);
          if (text.length >= minChars) return text;
        }
      }
    } catch {
      // ignore invalid json-ld
    }
  }

  return null;
}

async function extractFromDom(html: string, minChars: number): Promise<string | null> {
  const cheerio = await getCheerio();
  const $ = cheerio.load(html);

  $("script,noscript,style,svg,canvas,iframe").remove();

  const selectors = [
    "main",
    "article",
    '[role="main"]',
    ".job-description",
    ".jobDescription",
    ".description",
    ".posting",
    ".content",
    "#job",
    "#job-description",
    "#description",
    "[itemprop='description']",
  ];

  let bestText = "";
  for (const sel of selectors) {
    const el = $(sel).first();
    if (!el || !el.length) continue;
    const t = cleanText(el.text());
    if (t.length > bestText.length) bestText = t;
  }

  if (bestText.length < minChars) {
    const bodyText = cleanText($("body").text());
    if (bodyText.length > bestText.length) bestText = bodyText;
  }

  if (bestText.length >= minChars) return bestText;
  return null;
}

async function fetchHtml(
  url: string,
  fetchTimeoutMs: number,
): Promise<{ ok: boolean; status: number; html?: string; error?: string }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort("fetch_timeout"), fetchTimeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; Go4JobBot/1.0; +https://go4job.org) AppleWebKit/537.36 (KHTML, like Gecko)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });

    const status = res.status;
    const html = await res.text();

    if (!res.ok) return { ok: false, status, error: `http_${status}` };
    return { ok: true, status, html };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

function looksBlocked(status: number, err: string) {
  const e = (err ?? "").toLowerCase();
  return status === 403 || status === 429 || e.includes("cloudflare") || e.includes("captcha");
}

function remainingMs(deadlineMs: number) {
  return Math.max(0, deadlineMs - nowMs());
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(label), ms);

  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        ctrl.signal.addEventListener("abort", () => rej(new Error(label)));
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function updateJobDesc(supabase: any, jobId: string, text: string) {
  const payloadBoth: Record<string, unknown> = {
    official_desc: text,
    description_text: text,
    desc_status: "done" as DescStatus,
    desc_last_error: null,
    desc_updated_at: new Date().toISOString(),
  };

  const payloadFallback: Record<string, unknown> = {
    description_text: text,
    desc_status: "done" as DescStatus,
    desc_last_error: null,
    desc_updated_at: new Date().toISOString(),
  };

  const r1 = await supabase.from("jobs").update(payloadBoth).eq("id", jobId);
  if (!r1.error) return { ok: true as const, mode: "both" as const };

  const msg = (r1.error?.message ?? "").toLowerCase();
  if (msg.includes('column "official_desc"') && msg.includes("does not exist")) {
    const r2 = await supabase.from("jobs").update(payloadFallback).eq("id", jobId);
    if (!r2.error) return { ok: true as const, mode: "fallback_description_text" as const };
    return { ok: false as const, error: r2.error?.message ?? "update_failed" };
  }

  return { ok: false as const, error: r1.error?.message ?? "update_failed" };
}

async function handler(req: Request): Promise<Response> {
  const started = nowMs();
  const reqId = makeReqId();

  // CORS / preflight (safe)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, x-cron-secret, content-type",
        "access-control-allow-methods": "GET,POST,HEAD,OPTIONS",
      },
    });
  }

  if (req.method === "HEAD") return new Response(null, { status: 200 });

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "2");
  const limit = clampInt(rawLimit, 0, 5);

  // ✅ Healthcheck ultra-rapide, sans auth (pour debug local)
  if (limit === 0) {
    return jsonResponse({ ok: true, status: "health", reqId, ts: new Date().toISOString() }, 200, {
      "access-control-allow-origin": "*",
    });
  }

  // Auth ONLY for real work
  const auth = requireSecret(req);
  if (!auth.ok) return jsonResponse({ ok: false, reqId, error: auth.error }, auth.status);

  const dryRun = clampBool(url.searchParams.get("dry_run"));
  const pickOnly = clampBool(url.searchParams.get("pick_only"));
  const maxMs = clampInt(Number(url.searchParams.get("max_ms") ?? "25000"), 5000, 29000);
  const perJobMs = clampInt(Number(url.searchParams.get("per_job_ms") ?? "9000"), 2000, 15000);
  const fetchMs = clampInt(Number(url.searchParams.get("fetch_ms") ?? "7000"), 1000, 12000);
  const minChars = clampInt(Number(url.searchParams.get("min_chars") ?? "300"), 120, 2000);

  const deadline = started + maxMs;

  log("job_enrich_desc.start", {
    reqId,
    method: req.method,
    limit,
    dryRun,
    pickOnly,
    maxMs,
    perJobMs,
    fetchMs,
    minChars,
    ts: new Date().toISOString(),
  });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, reqId, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const createClient = await getCreateClient();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Select candidates
  const selT0 = nowMs();
  const sel = await supabase
    .from("jobs")
    .select("id, source_url")
    .eq("desc_status", "pending" as DescStatus)
    .eq("is_active", true)
    .eq("is_expired", false)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  const selMs = Math.round(nowMs() - selT0);

  if (sel.error) {
    log("job_enrich_desc.select_error", { reqId, selMs, error: sel.error.message });
    return jsonResponse({ ok: false, reqId, step: "select", error: sel.error.message }, 500);
  }

  const picked = (sel.data ?? []) as JobRow[];
  log("job_enrich_desc.selected", { reqId, selMs, picked: picked.length });

  if (!picked.length) {
    return jsonResponse({
      ok: true,
      reqId,
      status: "no_pending",
      processed: 0,
      timing_ms: { total: Math.round(nowMs() - started), select: selMs },
    });
  }

  if (pickOnly) {
    return jsonResponse({
      ok: true,
      reqId,
      status: "picked_only",
      picked: picked.map((j) => ({ id: j.id, source_url: j.source_url })),
      timing_ms: { total: Math.round(nowMs() - started), select: selMs },
    });
  }

  // 2) Mark in_progress (best-effort)
  const ids = picked.map((j) => j.id);
  if (!dryRun) {
    const markT0 = nowMs();
    const mark = await supabase
      .from("jobs")
      .update({ desc_status: "in_progress" as DescStatus, desc_last_error: null })
      .in("id", ids)
      .eq("desc_status", "pending" as DescStatus);

    log("job_enrich_desc.mark_in_progress", {
      reqId,
      ms: Math.round(nowMs() - markT0),
      ok: !mark.error,
      error: mark.error?.message ?? null,
    });
  }

  // 3) Process
  let done = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;

  const results: Array<Record<string, unknown>> = [];

  for (const job of picked) {
    const rem = remainingMs(deadline);
    if (rem < 1200) {
      log("job_enrich_desc.stop_low_time", { reqId, remaining_ms: Math.round(rem) });
      break;
    }

    const jobT0 = nowMs();
    const jobId = job.id;
    const sourceUrl = (job.source_url ?? "").trim();
    const baseInfo = { jobId, sourceUrl: sourceUrl ? sourceUrl.slice(0, 240) : null };

    if (!sourceUrl) {
      failed++;
      results.push({ ...baseInfo, ok: false, status: "failed", error: "missing_source_url" });
      if (!dryRun) {
        await supabase.from("jobs").update({
          desc_status: "failed" as DescStatus,
          desc_last_error: "missing_source_url",
        }).eq("id", jobId);
      }
      continue;
    }

    const su = safeUrl(sourceUrl);
    if (!su.ok) {
      failed++;
      results.push({ ...baseInfo, ok: false, status: "failed", error: su.error });
      if (!dryRun) {
        await supabase.from("jobs").update({
          desc_status: "failed" as DescStatus,
          desc_last_error: su.error ?? "invalid_url",
        }).eq("id", jobId);
      }
      continue;
    }

    const effectivePerJobMs = Math.min(perJobMs, Math.max(2000, Math.floor(rem - 700)));
    const jobDeadline = jobT0 + effectivePerJobMs;

    try {
      const fetched = await withTimeout(
        fetchHtml(sourceUrl, Math.min(fetchMs, effectivePerJobMs)),
        effectivePerJobMs,
        "job_timeout",
      );

      if (!fetched.ok) {
        const st = fetched.status;
        const err = fetched.error ?? "fetch_failed";
        const isB = looksBlocked(st, err);
        const newStatus: DescStatus = isB ? "blocked" : "failed";
        if (newStatus === "blocked") blocked++;
        else failed++;

        results.push({ ...baseInfo, ok: false, status: newStatus, http_status: st, error: err, ms: Math.round(nowMs() - jobT0) });

        if (!dryRun) {
          await supabase.from("jobs").update({
            desc_status: newStatus,
            desc_last_error: `${err}${st ? ` (status ${st})` : ""}`,
          }).eq("id", jobId);
        }
        continue;
      }

      const html = fetched.html ?? "";
      const parseRem = remainingMs(jobDeadline);

      if (parseRem < 600) {
        skipped++;
        results.push({ ...baseInfo, ok: false, status: "skipped", error: "low_time_to_parse", ms: Math.round(nowMs() - jobT0) });
        if (!dryRun) {
          await supabase.from("jobs").update({
            desc_status: "failed" as DescStatus,
            desc_last_error: "low_time_to_parse",
          }).eq("id", jobId);
        }
        continue;
      }

      const text = await withTimeout(
        (async () => {
          const fromLd = await extractFromJsonLd(html, minChars);
          const fromDom = fromLd ? null : await extractFromDom(html, minChars);
          return cleanText(fromLd ?? fromDom ?? "");
        })(),
        Math.min(parseRem, 6000),
        "parse_timeout",
      );

      if (!text || text.length < minChars) {
        failed++;
        results.push({ ...baseInfo, ok: false, status: "failed", error: "description_not_found_or_too_short", len: text?.length ?? 0, ms: Math.round(nowMs() - jobT0) });
        if (!dryRun) {
          await supabase.from("jobs").update({
            desc_status: "failed" as DescStatus,
            desc_last_error: `description_not_found_or_too_short (len ${text?.length ?? 0})`,
          }).eq("id", jobId);
        }
        continue;
      }

      if (dryRun) {
        done++;
        results.push({ ...baseInfo, ok: true, status: "dry_run_done", len: text.length, preview: text.slice(0, 220), ms: Math.round(nowMs() - jobT0) });
        continue;
      }

      const upd = await updateJobDesc(supabase, jobId, text);
      if (!upd.ok) {
        failed++;
        results.push({ ...baseInfo, ok: false, status: "failed", error: `db_update_failed: ${upd.error}`, len: text.length, ms: Math.round(nowMs() - jobT0) });
        await supabase.from("jobs").update({
          desc_status: "failed" as DescStatus,
          desc_last_error: `db_update_failed: ${upd.error}`,
        }).eq("id", jobId);
        continue;
      }

      done++;
      results.push({ ...baseInfo, ok: true, status: "done", write_mode: upd.mode, len: text.length, ms: Math.round(nowMs() - jobT0) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      failed++;
      results.push({ ...baseInfo, ok: false, status: "failed", error: msg, ms: Math.round(nowMs() - jobT0) });
      if (!dryRun) {
        await supabase.from("jobs").update({
          desc_status: "failed" as DescStatus,
          desc_last_error: msg,
        }).eq("id", jobId);
      }
    }
  }

  const totalMs = Math.round(nowMs() - started);

  log("job_enrich_desc.end", { reqId, picked: picked.length, done, failed, blocked, skipped, total_ms: totalMs });

  return jsonResponse({
    ok: true,
    reqId,
    limit,
    dry_run: dryRun,
    picked: picked.length,
    done,
    failed,
    blocked,
    skipped,
    timing_ms: { total: totalMs, select: selMs, budget: maxMs },
    results,
  });
}

// ✅ IMPORTANT : enregistrer le handler (sinon timeout)
Deno.serve(handler);
