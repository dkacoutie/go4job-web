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

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
          return await fetch(url, { ...init, signal: controller.signal });
    } finally {
          clearTimeout(t);
    }
}

// JR-0024 (07/08/2026): l'ancien check local (profiles.is_admin OU presence brute
// dans admin_users, sans filtre is_active/role) permettait a un admin revoque de
// garder un acces complet (import reel jusqu'a 200 offres). Remplace par
// is_admin_user(). Deploye en production le 07/08/2026.

Deno.serve(async (req) => {
    const origin = req.headers.get("origin");

             if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method === "GET") return json({ ok: true, status: "admin_import_source_alive" }, 200, origin);
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

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
                   const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();

      if (!cronSecret) {
              return json({ ok: false, error: "CRON_SECRET_not_set" }, 500, origin);
      }

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

      const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin_user");
                   if (adminErr || isAdmin !== true) return json({ ok: false, error: "forbidden_admin_only" }, 403, origin);

      const ingestUrl = `${supabaseUrl}/functions/v1/ingest_source`;
                   const ingestRes = await fetchWithTimeout(
                           ingestUrl,
                     {
                               method: "POST",
                               headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret, "User-Agent": "Go4Job-AdminImport/1.0 (+JobRadar)" },
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
              return json({ ok: false, error: "ingest_source_failed", status: ingestRes.status, ingest: ingestJson }, 502, origin);
      }

      return json({ ok: true, source_code, limit, imported_at: new Date().toISOString(), ingest: ingestJson }, 200, origin);
             } catch (e: any) {
    return json({ ok: false, error: "admin_import_source_failed", message: e?.message ?? String(e) }, 500, origin);
             }
});
