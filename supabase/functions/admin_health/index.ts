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

type HealthRpcKey = keyof HealthPayload;

const healthRpcs: Array<{ key: HealthRpcKey; name: string }> = [
  { key: "overview", name: "admin_health_v1_overview" },
  { key: "sources", name: "admin_health_v1_sources" },
  { key: "runs", name: "admin_health_v1_runs" },
  { key: "crons", name: "admin_health_v1_crons" },
];

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

function cleanErrorValue(value: unknown, maxLen = 260): string | null {
  if (typeof value !== "string") return null;

  const cleaned = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]")
    .trim();

  return cleaned ? cleaned.slice(0, maxLen) : null;
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

  if (!supabaseUrl || !anonKey) {
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

  const rpcResults = await Promise.all(
    healthRpcs.map(async (rpc) => ({
      ...rpc,
      result: await userClient.rpc(rpc.name),
    })),
  );

  const failedRpc = rpcResults.find((rpc) => rpc.result.error);
  if (failedRpc?.result.error) {
    const rpcError = failedRpc.result.error;
    const safeError = {
      rpc: failedRpc.name,
      code: cleanErrorValue(rpcError.code, 80),
      message: cleanErrorValue(rpcError.message),
      details: cleanErrorValue(rpcError.details),
      hint: cleanErrorValue(rpcError.hint),
    };

    console.error("admin_health RPC failed", safeError);

    return json(500, {
      ok: false,
      error: "health_rpc_failed",
      failed_rpc: failedRpc.name,
      code: safeError.code,
      message: "Unable to load admin health data.",
      technical_message: safeError.message,
    }, headers);
  }

  const payload = rpcResults.reduce(
    (acc, rpc) => ({
      ...acc,
      [rpc.key]: rpc.result.data,
    }),
    {} as HealthPayload,
  );

  return json(200, {
    ok: true,
    scope: "jobradar_health_v1_read_only",
    data: payload,
  }, headers);
});
