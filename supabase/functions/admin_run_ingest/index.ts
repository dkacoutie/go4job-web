// supabase/functions/admin_run_ingest/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}_missing`);
  return v;
}

type Body = {
  source_code: string;
  limit?: number;
  dry_run?: boolean; // ignoré (on force dry_run=true)
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

function pickBestMessage(payload: any, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return String(payload);

  // cas fréquents
  const msg =
    payload.message ??
    payload.error ??
    payload.hint ??
    payload.details ??
    (payload.ingest_response?.message ?? payload.ingest_response?.error) ??
    null;

  if (typeof msg === "string" && msg.trim()) return msg.trim();

  try {
    return JSON.stringify(payload);
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  // CORS
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method === "GET") return json({ ok: true, status: "admin_run_ingest_alive" }, 200, origin);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  // Body
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json_body" }, 400, origin);
  }

  const source_code = String(body?.source_code ?? "").trim().toLowerCase();
  const limitRaw = Number(body?.limit ?? 30);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 30, 50));

  if (!source_code) return json({ ok: false, error: "missing_source_code" }, 400, origin);

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const anonKey = mustEnv("SUPABASE_ANON_KEY");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
    if (!cronSecret) {
      return json({ ok: false, error: "CRON_SECRET_not_set_in_env", message: "Secret CRON_SECRET manquant côté admin_run_ingest." }, 500, origin);
    }

    // ✅ Require authenticated user (JWT)
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

    // ✅ Admin check
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const okAdmin = await isAdminUser(supabaseAdmin, userId);
    if (!okAdmin) return json({ ok: false, error: "forbidden_admin_only" }, 403, origin);

    // ✅ Call ingest_source server-side WITH cron secret (never exposed to browser)
    const ingestUrl = `${supabaseUrl}/functions/v1/ingest_source`;
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        source_code,
        limit,
        dry_run: true, // force dry-run
        trigger: "admin_run_ingest",
      }),
    });

    const text = await res.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    if (!res.ok) {
      // ⭐ IMPORTANT: remonter la vraie erreur pour l’afficher dans l’UI
      const rootMsg = pickBestMessage(payload, `HTTP ${res.status} from ingest_source`);
      return json(
        {
          ok: false,
          error: "ingest_source_failed",
          message: rootMsg,
          source_code,
          ingest_http_status: res.status,
          ingest_response: payload,
        },
        502,
        origin,
      );
    }

    return json(
      {
        ok: true,
        admin_user_id: userId,
        source_code,
        limit,
        dry_run: true,
        ingest: payload,
      },
      200,
      origin,
    );
  } catch (e: any) {
    return json({ ok: false, error: "admin_run_ingest_failed", message: e?.message ?? String(e) }, 500, origin);
  }
});
