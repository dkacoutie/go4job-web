import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCrossSourceJobIdentity,
  canonicalizeJobUrl,
} from "../_shared/jobIdentity.ts";

type ImportRequest = {
  source: "jooble" | "adzuna" | string;
  external_id?: string;
  url: string;
  title: string;
  company?: string | null;
  location?: string | null;
  snippet?: string | null;
  raw?: unknown;
};

type ZoneTag = "africa" | "remote";

const VILLES_WA = [
  "abidjan",
  "dakar",
  "cotonou",
  "lome",
  "ouagadougou",
  "bamako",
  "niamey",
  "conakry",
  "accra",
  "bissau",
  "monrovia",
  "freetown",
];
const VILLES_CA = [
  "douala",
  "yaounde",
  "kinshasa",
  "brazzaville",
  "libreville",
  "ndjamena",
  "n'djamena",
  "bangui",
  "malabo",
];
const PAYS_WA = [
  "cote d'ivoire",
  "ivory coast",
  "senegal",
  "benin",
  "togo",
  "burkina",
  "mali",
  "niger",
  "guinee",
  "guinea",
  "ghana",
  "sierra leone",
  "liberia",
  "guinea-bissau",
];
const PAYS_CA = [
  "cameroun",
  "cameroon",
  "rdc",
  "drc",
  "congo",
  "gabon",
  "tchad",
  "chad",
  "centrafrique",
  "central african",
  "guinee equatoriale",
  "equatorial guinea",
];
const TOKENS_AFRICA = [
  "africa",
  "afrique",
  "west africa",
  "afrique de l'ouest",
  "central africa",
  "afrique centrale",
];
const TOKENS_REMOTE = [
  "remote",
  "teletravail",
  "hybrid",
  "hybride",
  "global",
  "worldwide",
];

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMatch(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function containsAny(hay: string, tokens: string[]) {
  return tokens.some((t) => hay.includes(normalizeMatch(t)));
}

async function sha1Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickZone(payload: { title?: string; company?: string; location?: string; snippet?: string }): ZoneTag | null {
  const hay = normalizeMatch(
    [payload.location, payload.title, payload.company, payload.snippet].filter(Boolean).join(" ")
  );
  if (containsAny(hay, TOKENS_REMOTE)) return "remote";
  if (
    containsAny(hay, VILLES_WA) ||
    containsAny(hay, VILLES_CA) ||
    containsAny(hay, PAYS_WA) ||
    containsAny(hay, PAYS_CA) ||
    containsAny(hay, TOKENS_AFRICA)
  ) {
    return "africa";
  }
  return null;
}

async function getJobSourceId(supabase: ReturnType<typeof createClient>, source: string) {
  const isJooble = source === "jooble";
  const code = isJooble ? "jooble_api" : "adzuna_api";
  const name = isJooble ? "Jooble (API)" : "Adzuna (API/Partner)";

  const { data, error } = await supabase.from("job_sources").select("id").eq("code", code).maybeSingle();
  if (error) throw error;
  if (data?.id) return data.id as string;

  const insertPayload = isJooble
    ? {
      code,
      name,
      ingest_method: "api_external",
      ingest_status: "ready",
      ingest_config: {},
      is_active: false,
      region: "Africa/Global",
      priority: 40,
    }
    : {
      code,
      name,
      ingest_method: "api_adzuna",
      ingest_status: "ready",
      ingest_config: {
        search_url_template: "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}",
        default_country: "fr",
        fallback_country: "gb",
        results_per_page: 10,
        max_pages: 1,
        staging_only: true,
        subset_label: "staging_small_subset",
        refresh_hours: 24,
        default_params: {},
      },
      is_active: false,
      country: null,
      region: "Africa/Global",
      priority: 67,
    };

  const insert = await supabase
    .from("job_sources")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insert.error) throw insert.error;
  if (!insert.data?.id) throw new Error("job_source_insert_failed");
  return insert.data.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!supabaseUrl || !serviceKey) return json(500, { ok: false, error: "server_misconfigured" });

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (!token) return json(401, { ok: false, error: "missing_auth" });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) return json(401, { ok: false, error: "invalid_auth" });

  let body: ImportRequest;
  try {
    body = (await req.json()) as ImportRequest;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const source = (body?.source ?? "").trim().toLowerCase();
  if (source !== "jooble" && source !== "adzuna") {
    return json(400, { ok: false, error: "invalid_source" });
  }

  const title = normalizeText(body?.title);
  const url = normalizeText(body?.url);
  if (!title || !url) return json(400, { ok: false, error: "missing_fields" });
  if (!/^https?:\/\//i.test(url)) return json(400, { ok: false, error: "invalid_url" });

  const company = normalizeText(body?.company ?? "");
  const location = normalizeText(body?.location ?? "");
  const snippet = normalizeText(body?.snippet ?? "");

  const zone = pickZone({ title, company, location, snippet });
  if (!zone) {
    return json(200, {
      ok: true,
      status: "rejected_geo",
      message: "Import limité Afrique/Remote pour garder JobRadar premium.",
    });
  }

  const { canonicalUrl, urlKey } = canonicalizeJobUrl(url);
  const externalSeed = normalizeText(body?.external_id ?? "");
  const externalId = externalSeed
    ? externalSeed.startsWith(`${source}:`)
      ? externalSeed
      : `${source}:${externalSeed}`
    : `${source}:${await sha1Hex(canonicalUrl || url)}`;

  const dupeByExternal = await supabase.from("jobs").select("id").eq("external_id", externalId).maybeSingle();
  if (dupeByExternal.error) return json(500, { ok: false, error: dupeByExternal.error.message });
  if (dupeByExternal.data?.id) {
    return json(200, { ok: true, status: "duplicate", job_id: dupeByExternal.data.id });
  }

  const dedupeKey = urlKey || canonicalUrl || url;
  if (dedupeKey) {
    const pattern = `${dedupeKey}%`;
    const { data: dupeUrl, error: dupeErr } = await supabase
      .from("jobs")
      .select("id")
      .or(`source_url.ilike.${pattern},apply_url.ilike.${pattern}`)
      .maybeSingle();

    if (dupeErr) return json(500, { ok: false, error: dupeErr.message });
    if (dupeUrl?.id) {
      return json(200, { ok: true, status: "duplicate", job_id: dupeUrl.id });
    }
  }

  let jobSourceId: string;
  try {
    jobSourceId = await getJobSourceId(supabase, source);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: msg || "job_source_lookup_failed" });
  }

  const identity = await buildCrossSourceJobIdentity({
    title,
    companyName: company || null,
    location: location || null,
    sourceUrl: url,
    applyUrl: url,
  });

  const insertRow = {
    job_source_id: jobSourceId,
    external_id: externalId,
    title,
    company_name: company || null,
    location: location || null,
    source_url: url,
    apply_url: url,
    canonical_url: identity.canonicalUrl,
    dedupe_identity_key: identity.dedupeIdentityKey,
    cross_source_fingerprint: identity.crossSourceFingerprint,
    description_text: snippet || null,
    job_json: body?.raw ?? null,
    is_active: true,
    job_status: "active",
    quality_status: "ok",
    published_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("jobs")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (insertErr) return json(500, { ok: false, error: insertErr.message });
  if (!inserted?.id) return json(500, { ok: false, error: "insert_failed" });

  let status: "imported" | "quarantined" = "imported";
  if (!insertRow.apply_url) {
    status = "quarantined";
    await supabase.from("jobs").update({ quality_status: "quarantined" }).eq("id", inserted.id);
  }

  const needsEnrich = !snippet || snippet.length < 200;
  const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  if (needsEnrich && cronSecret) {
    const base = supabaseUrl.replace(/\/$/, "");
    const enrichUrl = `${base}/functions/v1/job_auto_enrich_8020`;
    try {
      await fetch(enrichUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({ limit: 1, dry_run: false }),
      });
    } catch {
      // ignore enrich errors
    }
  }

  return json(200, { ok: true, status, job_id: inserted.id, zone });
});
