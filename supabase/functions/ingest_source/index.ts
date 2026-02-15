// supabase/functions/ingest_source/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchEmploiCiItems } from "./sources/emploi_ci.ts";
import { fetchRssFeedItems } from "./sources/rss_generic.ts";

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

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    const cleanParams = new URLSearchParams();
    const block = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "ref",
      "source",
    ];
    for (const [k, v] of url.searchParams.entries()) {
      if (block.includes(k.toLowerCase())) continue;
      cleanParams.append(k, v);
    }
    url.search = cleanParams.toString();
    let out = url.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
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
  const separators = [" @ ", " - ", " | ", " — ", " – "];
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
      const data = await fetchEmploiCiItems(limit);

      if (dry_run) {
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

      // job_source_id (temporaire en dur pour valider l'ingestion)
      const job_source_id = "ed25b64d-ace6-4296-8985-46702d58785d";

      const now = new Date().toISOString();
      const jobsBase = `${supabaseUrl}/rest/v1/jobs`;

      let inserted = 0;
      let updated = 0;

      // Upsert manuel : check -> insert ou patch
      for (const it of data.items) {
        const external_id = it.external_id;

        // 1) existe deja ?
        const checkUrl =
          `${jobsBase}?select=id&job_source_id=eq.${job_source_id}` +
          `&external_id=eq.${encodeURIComponent(external_id)}&limit=1`;

        const found = await sbGet<Array<{ id: string }>>(checkUrl, serviceKey);
        const exists = found?.length ? found[0].id : null;

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
          tags: [],
          posted_at: null,
          published_at: null,
          expires_at: null,
          updated_at: now,
          last_seen_at: now,
          sort_at: now,
          is_active: true,
          is_expired: false,
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

    if (jobSource.ingest_method !== "rss_generic") {
      return json({ ok: false, error: "unsupported_ingest_method" }, 400);
    }

    if (jobSource.is_active === false) {
      return json({ ok: false, error: "job_source_inactive" }, 400);
    }

    const feedUrl = jobSource.ingest_config?.feed_url;
    if (!feedUrl || typeof feedUrl !== "string") {
      return json({ ok: false, error: "missing_feed_url" }, 400);
    }

    const maxItems = Math.max(1, Math.min(limit, Number(jobSource.ingest_config?.limit ?? 50)));
    const data = await fetchRssFeedItems(feedUrl, maxItems);

    if (dry_run) {
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

      const link = normalizeUrl(item.link || "");
      const guid = item.guid?.trim() || "";

      const publishedIso = item.published_at ?? null;

      const summary = (item.summary || "").trim();
      const content = (item.content || "").trim();
      const html = content || summary;
      const text = html ? stripHtml(html) : "";

      const jobType = detectJobType(title, text);

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
        location: jobSource.region ?? null,
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
        tags: [],
        posted_at: publishedIso,
        published_at: publishedIso,
        expires_at: null,
        scraped_at: now,
        updated_at: now,
        last_seen_at: now,
        sort_at: publishedIso ?? now,
        is_active: true,
        is_expired: false,
        job_type: jobType,
        job_json: {
          source_code,
          feed_url: data.feed_url,
          guid: guid || null,
        },
      });
    }

    const { error: upErr } = await supabase.from("jobs").upsert(rows, { onConflict: "external_id" });
    if (upErr) {
      return json({ ok: false, error: "jobs_upsert_failed", message: upErr.message }, 500);
    }

    return json({
      ok: true,
      source_code,
      limit: maxItems,
      dry_run: false,
      status: "rss_upserted",
      parsed: data.parsed,
      upserted: rows.length,
    });
  } catch (e) {
    return json(
      { ok: false, error: "ingest_failed", message: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
