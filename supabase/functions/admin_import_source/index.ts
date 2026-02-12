// supabase/functions/admin_import_source/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  source_code?: string;
  limit?: number;
};

function corsHeaders(origin: string | null) {
  const allowOrigin = origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

async function isAdminUser(supabaseAdmin: any, userId: string): Promise<boolean> {
  // profiles.is_admin
  try {
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id,is_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profErr && prof?.is_admin === true) return true;
  } catch {}

  // fallback admin_users
  try {
    const { data: adminRow, error: adminErr } = await supabaseAdmin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!adminErr && adminRow?.user_id) return true;
  } catch {}

  return false;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  // CORS
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method === "GET") return json({ ok: true, status: "admin_import_source_alive" }, 200, origin);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  // Parse body
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json_body" }, 400, origin);
  }

  const source_code = String(body?.source_code ?? "").trim().toLowerCase();
  const limitRaw = Number(body?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

  if (!source_code) return json({ ok: false, error: "missing_source_code" }, 400, origin);

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const anonKey = mustEnv("SUPABASE_ANON_KEY");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();

    if (!cronSecret) {
      return json({ ok: false, error: "CRON_SECRET_not_set" }, 500, origin);
    }

    // ✅ Require authenticated user (JWT)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ ok: false, error: "missing_authorization_header" }, 401, origin);
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "not_authenticated" }, 401, origin);
    }

    const userId = userData.user.id;

    // ✅ Admin check via service role
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const okAdmin = await isAdminUser(supabaseAdmin, userId);
    if (!okAdmin) return json({ ok: false, error: "forbidden_admin_only" }, 403, origin);

    // ✅ Call ingest_source securely (server-side) with CRON_SECRET
    const ingestUrl = `${supabaseUrl}/functions/v1/ingest_source`;
    const ingestRes = await fetchWithTimeout(
      ingestUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
          "User-Agent": "Go4Job-AdminImport/1.0 (+JobRadar)",
        },
        body: JSON.stringify({ source_code, limit, dry_run: false }),
      },
      25000,
    );

    const ingestText = await ingestRes.text().catch(() => "");
    let ingestJson: any = null;
    try {
      ingestJson = ingestText ? JSON.parse(ingestText) : null;
    } catch {
      ingestJson = { raw: ingestText };
    }

    if (!ingestRes.ok) {
      return json(
        {
          ok: false,
          error: "ingest_source_failed",
          status: ingestRes.status,
          ingest: ingestJson,
        },
        502,
        origin,
      );
    }

    return json(
      {
        ok: true,
        source_code,
        limit,
        imported_at: new Date().toISOString(),
        ingest: ingestJson,
      },
      200,
      origin,
    );
  } catch (e: any) {
    return json({ ok: false, error: "admin_import_source_failed", message: e?.message ?? String(e) }, 500, origin);
  }
});
