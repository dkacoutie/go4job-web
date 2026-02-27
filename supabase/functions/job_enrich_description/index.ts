import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JobRow = {
  id: string;
  source_url: string | null;
  apply_url: string | null;
  description_text: string | null;
  description_html: string | null;
  official_desc: string | null;
  desc_source: string | null;
  desc_last_error: string | null;
  desc_updated_at: string | null;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  ai_description_status: string | null;
};

const MIN_DESC_LEN = 400;
const BACKOFF_DEFAULT_MS = 6 * 60 * 60 * 1000;
const BACKOFF_HARD_MS = 12 * 60 * 60 * 1000;

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html: string) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return normalizeText(doc.body.textContent ?? "");
  } catch {
    return normalizeText(
      (html ?? "")
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/?[^>]+(>|$)/g, " ")
    );
  }
}

function extractMain(html: string) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");

    const removeSelectors = "script,style,noscript,iframe,object,embed,svg,header,footer,nav,aside,form";
    doc.querySelectorAll(removeSelectors).forEach((n) => n.remove());

    const selectors = [
      "[itemprop='description']",
      ".job-description",
      ".job_desc",
      ".offer-description",
      ".offre-description",
      ".description",
      "#description",
      ".content",
      "article",
      "main",
    ];

    const candidates = new Set<Element>();
    for (const sel of selectors) {
      doc.querySelectorAll(sel).forEach((el) => candidates.add(el));
    }
    if (candidates.size === 0 && doc.body) candidates.add(doc.body);

    let best: Element | null = null;
    let bestLen = 0;
    for (const el of candidates) {
      const txt = normalizeText(el.textContent ?? "");
      if (txt.length > bestLen) {
        best = el;
        bestLen = txt.length;
      }
    }

    if (!best) return { html: "", text: "" };

    const htmlOut = (best.innerHTML ?? "").trim();
    const textOut = normalizeText(best.textContent ?? "");

    return { html: htmlOut, text: textOut };
  } catch {
    const text = stripHtmlToText(html ?? "");
    return { html: "", text };
  }
}

function safeTruncate(input: string, max: number) {
  if (input.length <= max) return input;
  return input.slice(0, max).trim();
}

function computeQuality(text: string) {
  const len = text.length;
  let score = Math.min(80, Math.round(len / 10));
  if (/\n|\r/.test(text)) score += 6;
  if (/(mission|responsabilit|profil|requirements|qualification)/i.test(text)) score += 8;
  if (/[-*•]\s+/.test(text)) score += 6;
  return Math.min(100, score);
}

function currentDescText(job: JobRow) {
  const official = (job.official_desc ?? "").trim();
  if (official) return official;
  const text = (job.description_text ?? "").trim();
  if (text) return text;
  const html = (job.description_html ?? "").trim();
  if (!html) return "";
  return stripHtmlToText(html);
}

function isSufficient(text: string) {
  return text.trim().length >= MIN_DESC_LEN;
}

function getJobTimeMs(job: JobRow): number {
  const candidates = [job.published_at, job.created_at, job.updated_at, job.desc_updated_at].filter(Boolean) as string[];
  for (const d of candidates) {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function shouldBackoff(job: JobRow): boolean {
  const err = (job.desc_last_error ?? "").toLowerCase().trim();
  if (!err) return false;
  const last = job.desc_updated_at ? Date.parse(job.desc_updated_at) : NaN;
  if (Number.isNaN(last)) return false;
  const hard = /(429|rate|timeout|forbidden|captcha|blocked|cloudflare)/.test(err);
  const backoff = hard ? BACKOFF_HARD_MS : BACKOFF_DEFAULT_MS;
  return Date.now() - last < backoff;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, x-cron-secret, content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  if (req.method === "GET") {
    return json(200, { ok: true, status: "job_enrich_description_alive" }, corsHeaders);
  }

  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" }, corsHeaders);

  const expected = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  if (!expected) return json(500, { ok: false, error: "Missing CRON_SECRET env" }, corsHeaders);
  if (provided !== expected && bearer !== expected) return json(401, { ok: false, error: "Unauthorized" }, corsHeaders);

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") ?? 8)));
  const dryRun = url.searchParams.get("dry_run") === "1" || url.searchParams.get("dry_run") === "true";

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL) return json(500, { ok: false, error: "Missing SUPABASE_URL env" }, corsHeaders);
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY env" }, corsHeaders);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: rows, error: selectErr } = await supabase
    .from("jobs")
    .select(
      "id, source_url, apply_url, description_text, description_html, official_desc, desc_source, desc_last_error, desc_updated_at, published_at, created_at, updated_at, ai_description_status"
    )
    .eq("is_active", true)
    .eq("is_expired", false)
    .not("source_url", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit * 3);

  if (selectErr) return json(500, { ok: false, error: selectErr.message }, corsHeaders);

  const jobsRaw = (rows ?? []) as JobRow[];
  const jobs = jobsRaw.slice().sort((a, b) => getJobTimeMs(b) - getJobTimeMs(a));
  const results: Array<Record<string, unknown>> = [];
  let processed = 0;

  for (const job of jobs) {
    if (processed >= limit) break;

    const current = currentDescText(job);
    if (isSufficient(current)) {
      results.push({ id: job.id, ok: true, skipped: "already_sufficient" });
      continue;
    }

    if (shouldBackoff(job)) {
      results.push({ id: job.id, ok: true, skipped: "backoff" });
      continue;
    }

    const targetUrl = job.source_url || job.apply_url;
    if (!targetUrl) {
      results.push({ id: job.id, ok: false, error: "missing_source_url" });
      continue;
    }

    processed += 1;
    const nowIso = new Date().toISOString();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(targetUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        if (!dryRun) {
          const patch: Record<string, unknown> = {
            desc_last_error: `fetch_failed:${res.status}`,
            desc_updated_at: nowIso,
          };
          if (job.ai_description_status !== "ok") patch.ai_description_status = "pending";
          await supabase.from("jobs").update(patch).eq("id", job.id);
        }
        results.push({ id: job.id, url: targetUrl, ok: false, status: res.status });
        continue;
      }

      const html = await res.text();
      const extracted = extractMain(html);

      const nextText = safeTruncate(extracted.text || "", 20000);
      const nextHtml = safeTruncate(extracted.html || "", 50000);

      const quality = computeQuality(nextText);
      const sufficient = isSufficient(nextText);

      if (dryRun) {
        results.push({
          id: job.id,
          url: targetUrl,
          ok: true,
          quality,
          sufficient,
          preview: nextText.slice(0, 220),
        });
        continue;
      }

      const patch: Record<string, unknown> = {
        updated_at: nowIso,
        desc_updated_at: nowIso,
        desc_quality: quality,
        desc_source: nextText ? "scraped" : "none",
        desc_last_error: null,
      };

      if (nextText) patch.official_desc = nextText;
      if (!job.description_text && nextText) patch.description_text = nextText;
      if (!job.description_html && nextHtml) patch.description_html = nextHtml;

      if (!sufficient && job.ai_description_status !== "ok") {
        patch.ai_description_status = "pending";
      }

      const { error: upErr } = await supabase.from("jobs").update(patch).eq("id", job.id);
      if (upErr) {
        results.push({ id: job.id, url: targetUrl, ok: false, error: upErr.message });
      } else {
        results.push({ id: job.id, url: targetUrl, ok: true, quality, sufficient });
      }
    } catch (e) {
      if (!dryRun) {
        const patch: Record<string, unknown> = {
          desc_last_error: String(e).slice(0, 300),
          desc_updated_at: nowIso,
        };
        if (job.ai_description_status !== "ok") patch.ai_description_status = "pending";
        await supabase.from("jobs").update(patch).eq("id", job.id);
      }
      results.push({ id: job.id, url: targetUrl, ok: false, error: String(e) });
    }
  }

  return json(
    200,
    {
      ok: true,
      dry_run: dryRun,
      processed,
      results,
    },
    corsHeaders,
  );
});

