import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://go4jobapp.com",
  "https://jobradar.go4jobapp.com",
]);

type HealthPayload = {
  overview: unknown;
  sources: unknown;
  runs: unknown;
  crons: unknown;
};

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, headers);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "missing_session" }, headers);
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const anonKey = cleanSecret(Deno.env.get("SUPABASE_ANON_KEY"));
  const serviceKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "server_misconfigured" }, headers);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return json(401, { ok: false, error: "invalid_session" }, headers);
  }

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin_user");
  if (adminError) {
    return json(403, { ok: false, error: "admin_check_failed" }, headers);
  }

  if (isAdmin !== true) {
    return json(403, { ok: false, error: "admin_only" }, headers);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [overviewRes, sourcesRes, runsRes, cronsRes] = await Promise.all([
    serviceClient.rpc("admin_health_v1_overview"),
    serviceClient.rpc("admin_health_v1_sources"),
    serviceClient.rpc("admin_health_v1_runs"),
    serviceClient.rpc("admin_health_v1_crons"),
  ]);

  const firstError = overviewRes.error ?? sourcesRes.error ?? runsRes.error ?? cronsRes.error;
  if (firstError) {
    console.error("admin_health RPC failed", {
      overview: overviewRes.error,
      sources: sourcesRes.error,
      runs: runsRes.error,
      crons: cronsRes.error,
    });

    return json(500, {
      ok: false,
      error: "health_rpc_failed",
      message: "Unable to load admin health data.",
    }, headers);
  }

  const payload: HealthPayload = {
    overview: overviewRes.data,
    sources: sourcesRes.data,
    runs: runsRes.data,
    crons: cronsRes.data,
  };

  return json(200, {
    ok: true,
    scope: "jobradar_health_v1_read_only",
    data: payload,
  }, headers);
});
