// supabase/functions/admin_test_source/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.3";

function corsHeaders(origin: string | null) {
  const allowOrigin = origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}_missing`);
  return v;
}

type Validation = { level: "info" | "warn" | "error"; message: string };

type Body = {
  source_code: string;
  limit?: number;
  fetch_sample?: boolean; // default true
};

async function isAdminUser(supabaseAdmin: any, userId: string): Promise<boolean> {
  // profiles.is_admin (primary)
  try {
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id,is_admin")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profErr && prof?.is_admin === true) return true;
  } catch {
    // ignore
  }

  // fallback: admin_users
  try {
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminErr && adminRow?.user_id) return true;
  } catch {
    // ignore
  }

  return false;
}

function arrify<T>(v: T | T[] | null | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pickText(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    // fast-xml-parser may store text in "#text"
    const t = v["#text"];
    if (typeof t === "string") return t.trim();
  }
  return String(v).trim();
}

function pickLink(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();

  // Atom: <link href="...">
  if (typeof v === "object") {
    const href = v["@_href"] ?? v["href"];
    if (typeof href === "string") return href.trim();
    const t = v["#text"];
    if (typeof t === "string") return t.trim();
  }
  return "";
}

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Go4Job-AdminTest/1.0 (+JobRadar)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  // CORS
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method === "GET") return json({ ok: true, status: "admin_test_source_alive" }, 200, origin);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  // Parse body
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json_body" }, 400, origin);
  }

  const source_code = String(body?.source_code ?? "").trim().toLowerCase();
  const limit = Number(body?.limit ?? 10);
  const fetch_sample = body?.fetch_sample ?? true;

  if (!source_code) return json({ ok: false, error: "missing_source_code" }, 400, origin);

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const anonKey = mustEnv("SUPABASE_ANON_KEY");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // ✅ Require authenticated user (valid JWT)
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "not_authenticated" }, 401, origin);
    }
    const userId = userData.user.id;

    // Admin client (service role)
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const okAdmin = await isAdminUser(supabaseAdmin, userId);
    if (!okAdmin) return json({ ok: false, error: "forbidden_admin_only" }, 403, origin);

    // Fetch job_source
    const { data: src, error: srcErr } = await supabaseAdmin
      .from("job_sources")
      .select("id, code, ingest_method, ingest_status, ingest_config, is_active")
      .eq("code", source_code)
      .maybeSingle();

    if (srcErr) throw srcErr;
    if (!src) return json({ ok: false, error: "SOURCE_NOT_FOUND", source_code }, 404, origin);

    const validations: Validation[] = [];
    if (!src.is_active) validations.push({ level: "warn", message: "Source is not active (is_active=false)." });
    if (src.ingest_status && String(src.ingest_status).toLowerCase() !== "ready") {
      validations.push({ level: "warn", message: `ingest_status=${src.ingest_status}` });
    }

    const ingest_method = String(src.ingest_method ?? "").trim().toLowerCase();
    const cfg = src.ingest_config ?? {};

    // RSS: do real fetch + parse (dry-run)
    let sample_items: Array<{ title: string; url: string; published_at?: string }> = [];

    if (ingest_method === "rss") {
      const feed_url = cfg?.feed_url ?? cfg?.url ?? null;
      if (!feed_url) {
        validations.push({ level: "error", message: "Missing ingest_config.feed_url for RSS source." });
      } else if (typeof feed_url === "string" && !feed_url.startsWith("http")) {
        validations.push({ level: "error", message: "feed_url must start with http/https." });
      } else if (fetch_sample) {
        validations.push({ level: "info", message: `Fetching RSS feed…` });

        let res: Response;
        try {
          res = await fetchWithTimeout(String(feed_url), 12000);
        } catch (e: any) {
          validations.push({ level: "error", message: `Fetch failed: ${e?.message ?? String(e)}` });
          return json(
            {
              ok: true,
              admin_user_id: userId,
              source: {
                id: src.id,
                code: src.code,
                ingest_method: src.ingest_method,
                ingest_status: src.ingest_status,
                is_active: src.is_active,
                ingest_config: src.ingest_config,
              },
              validations,
              note: "Dry-run RSS fetch done.",
            },
            200,
            origin,
          );
        }

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          validations.push({ level: "error", message: `HTTP ${res.status} while fetching feed.` });
          if (txt) validations.push({ level: "info", message: `Response (truncated): ${txt.slice(0, 200)}` });
        } else {
          const xml = await res.text();
          validations.push({ level: "info", message: `HTTP ${res.status} OK. Parsing XML…` });

          const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            trimValues: true,
          });

          let doc: any;
          try {
            doc = parser.parse(xml);
          } catch (e: any) {
            validations.push({ level: "error", message: `XML parse failed: ${e?.message ?? String(e)}` });
            doc = null;
          }

          if (doc) {
            // RSS 2.0
            const rssItems =
              arrify(doc?.rss?.channel?.item).length
                ? arrify(doc?.rss?.channel?.item)
                : arrify(doc?.channel?.item);

            // Atom
            const atomEntries =
              arrify(doc?.feed?.entry).length
                ? arrify(doc?.feed?.entry)
                : [];

            const items = rssItems.length ? rssItems : atomEntries;

            if (!items.length) {
              validations.push({ level: "error", message: "No items/entries found in feed." });
            } else {
              validations.push({ level: "info", message: `Found ${items.length} items in feed.` });

              const n = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 10, 20));
              const picked = items.slice(0, n);

              sample_items = picked.map((it: any) => {
                // RSS
                const title = pickText(it?.title) || "(no title)";
                const url = pickText(it?.link) || pickLink(it?.link) || pickText(it?.guid) || "";
                const pub = pickText(it?.pubDate) || pickText(it?.published) || pickText(it?.updated) || "";

                return { title, url, published_at: pub || undefined };
              });

              const missingUrl = sample_items.filter((x) => !x.url).length;
              const missingTitle = sample_items.filter((x) => !x.title || x.title === "(no title)").length;

              if (missingTitle) validations.push({ level: "warn", message: `${missingTitle} sample items missing title.` });
              if (missingUrl) validations.push({ level: "warn", message: `${missingUrl} sample items missing url/link.` });

              validations.push({ level: "info", message: `Sample shown: ${sample_items.length} item(s).` });
            }
          }
        }

        validations.push({ level: "info", message: "RSS sources are ingested server-side by ingest_source (cron)." });
      }
    } else if (ingest_method === "scrape") {
      validations.push({ level: "info", message: "Scrape source: dry-run not implemented yet (needs a dedicated ingestor)." });
    } else if (ingest_method === "api") {
      validations.push({ level: "info", message: "API source: dry-run not implemented yet (handled by server-side ingestor/cron)." });
    } else {
      validations.push({ level: "warn", message: `Unknown ingest_method=${src.ingest_method}` });
    }

    return json(
      {
        ok: true,
        admin_user_id: userId,
        source: {
          id: src.id,
          code: src.code,
          ingest_method: src.ingest_method,
          ingest_status: src.ingest_status,
          is_active: src.is_active,
          ingest_config: src.ingest_config,
        },
        validations,
        sample_items,
        note: "MVP: validates admin access + does a real RSS dry-run fetch/parse when ingest_method=rss.",
      },
      200,
      origin,
    );
  } catch (e: any) {
    return json({ ok: false, error: "admin_test_source_failed", message: e?.message ?? String(e) }, 500, origin);
  }
});
