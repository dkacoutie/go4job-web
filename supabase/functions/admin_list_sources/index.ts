// supabase/functions/admin_list_sources/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  } catch {
    // ignore
  }

  // fallback admin_users
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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method === "GET") {
    // ok
  } else if (req.method === "POST") {
    // ok (si tu veux filtrer plus tard)
  } else {
    return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const anonKey = mustEnv("SUPABASE_ANON_KEY");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("Authorization") ?? "";

    // Require authenticated user
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, message: "Not authenticated" }, 401, origin);
    }

    const userId = userData.user.id;

    // Admin client (service role)
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const okAdmin = await isAdminUser(supabaseAdmin, userId);
    if (!okAdmin) {
      return json({ ok: false, message: "Forbidden (admin only)" }, 403, origin);
    }

    const { data, error } = await supabaseAdmin
      .from("job_sources")
      .select("id, code, name, ingest_method, ingest_status, is_active, ingest_config")
      .order("code", { ascending: true });

    if (error) throw error;

    return json({ ok: true, sources: data ?? [] }, 200, origin);
  } catch (e: any) {
    return json({ ok: false, message: e?.message ?? String(e) }, 500, origin);
  }
});
