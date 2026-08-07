import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type AuditRequestBody = {
    section?: string | null;
    source_limit?: number | string | null;
    country_limit?: number | string | null;
    family_limit?: number | string | null;
};

const ALLOWED_ORIGINS = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://jobradar.go4jobapp.com",
  ]);

const ALLOWED_SECTIONS = new Set([
    "all",
    "overview",
    "sources",
    "geo",
    "coverage",
    "feed",
    "duplicates",
  ]);

function clean(value: string | null | undefined): string {
    return (value ?? "").trim();
}

function cleanSecret(value: string | null | undefined): string {
    let normalized = clean(value);
    normalized = normalized.replace(/^['"]|['"]$/g, "");
    if (normalized.toLowerCase().startsWith("bearer ")) {
          normalized = normalized.slice(7).trim();
    }
    return normalized;
}

function getCorsHeaders(origin: string | null): Record<string, string> {
    const allowOrigin =
          origin && ALLOWED_ORIGINS.has(origin)
        ? origin
            : "https://jobradar.go4jobapp.com";

  return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(
    status: number,
    body: Record<string, unknown>,
    corsHeaders: Record<string, string>,
  ) {
    return new Response(JSON.stringify(body), {
          status,
          headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json; charset=utf-8",
          },
    });
}

function parseLimit(value: string | number | null | undefined, fallback: number, max: number) {
    if (typeof value === "number" && Number.isFinite(value)) {
          return Math.min(Math.max(Math.trunc(value), 1), max);
    }

  const parsed = Number.parseInt(clean(typeof value === "string" ? value : ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), max);
}

async function readBody(req: Request): Promise<AuditRequestBody> {
    if (req.method.toUpperCase() !== "POST") return {};

  const contentType = clean(req.headers.get("content-type")).toLowerCase();
    if (!contentType.includes("application/json")) return {};

  try {
        const parsed = (await req.json()) as AuditRequestBody | null;
        return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
        return {};
  }
}

async function resolveAdminUser(params: {
    req: Request;
    supabaseUrl: string;
    anonKey: string;
}): Promise<
    | { ok: true; userId: string; email: string | null }
  | { ok: false; status: number; error: string }
> {
    const authHeader = clean(params.req.headers.get("Authorization"));
    if (!authHeader) {
          return { ok: false, status: 401, error: "missing_authorization" };
    }

  const userClient = createClient(params.supabaseUrl, params.anonKey, {
        auth: { persistSession: false },
        global: {
                headers: {
                          Authorization: authHeader,
                },
        },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user?.id) {
          return { ok: false, status: 401, error: "invalid_user" };
    }

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin_user");
    if (adminError) {
          return {
                  ok: false,
                  status: 500,
                  error: `admin_check_failed:${adminError.message}`,
          };
    }

  if (isAdmin !== true) {
        return { ok: false, status: 403, error: "admin_access_required" };
  }

  return {
        ok: true,
        userId: userData.user.id,
        email: userData.user.email ?? null,
  };
}

Deno.serve(async (req) => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));

             if (req.method.toUpperCase() === "OPTIONS") {
                   return new Response(null, { status: 204, headers: corsHeaders });
             }

             if (!["GET", "POST"].includes(req.method.toUpperCase())) {
                   return json(405, { ok: false, error: "method_not_allowed" }, corsHeaders);
             }

             const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
    const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

             if (!supabaseUrl || !anonKey || !serviceRoleKey) {
                   return json(
                           500,
                     { ok: false, error: "missing_supabase_env" },
                           corsHeaders,
                         );
             }

             try {
                   const body = await readBody(req);
                   const url = new URL(req.url);

      const section = clean(url.searchParams.get("section") ?? body.section ?? "all").toLowerCase() || "all";
                   const sourceLimit = parseLimit(
                           url.searchParams.get("source_limit") ?? body.source_limit,
                           250,
                           500,
                         );
                   const countryLimit = parseLimit(
                           url.searchParams.get("country_limit") ?? body.country_limit,
                           25,
                           100,
                         );
                   const familyLimit = parseLimit(
                           url.searchParams.get("family_limit") ?? body.family_limit,
                           25,
                           100,
                         );

      if (!ALLOWED_SECTIONS.has(section)) {
              return json(
                        400,
                {
                            ok: false,
                            error: "invalid_section",
                            allowed_sections: Array.from(ALLOWED_SECTIONS),
                },
                        corsHeaders,
                      );
      }

      const caller = await resolveAdminUser({
              req,
              supabaseUrl,
              anonKey,
      });

      if (!caller.ok) {
              return json(caller.status, { ok: false, error: caller.error }, corsHeaders);
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
              auth: { persistSession: false },
      });

      const { data, error } = await adminClient.rpc("admin_jobradar_audit_snapshot", {
              p_section: section,
              p_source_limit: sourceLimit,
              p_country_limit: countryLimit,
              p_family_limit: familyLimit,
      });

      if (error) {
              return json(
                        500,
                {
                            ok: false,
                            error: "audit_snapshot_failed",
                            message: error.message,
                },
                        corsHeaders,
                      );
      }

      return json(
              200,
        {
                  ok: true,
                  data,
                  meta: {
                              requested_section: section,
                              source_limit: sourceLimit,
                              country_limit: countryLimit,
                              family_limit: familyLimit,
                              requested_by_user_id: caller.userId,
                              requested_by_email: caller.email,
                  },
        },
              corsHeaders,
            );
             } catch (error) {
                   return json(
                           500,
                     {
                               ok: false,
                               error: "unexpected_error",
                               message: error instanceof Error ? error.message : String(error),
                     },
                           corsHeaders,
                         );
             }
});
