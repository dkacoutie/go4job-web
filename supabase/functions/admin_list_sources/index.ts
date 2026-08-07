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

// JR-0024 (07/08/2026): l'ancien check local (profiles.is_admin OU presence brute
// dans admin_users, sans filtre is_active/role) permettait a un admin revoque
// (admin_users.is_active=false) de garder un acces complet. Remplace par le RPC
// is_admin_user() (meme verification que admin_health), qui filtre is_active=true
// et role in ('super_admin','admin'). Deploye en production le 07/08/2026.

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

      const supabaseUser = createClient(supabaseUrl, anonKey, {
              global: { headers: { Authorization: authHeader } },
              auth: { persistSession: false },
      });

      const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
                   if (userErr || !userData?.user) {
                           return json({ ok: false, message: "Not authenticated" }, 401, origin);
                   }

      const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin_user");
                   if (adminErr || isAdmin !== true) {
                           return json({ ok: false, message: "Forbidden (admin only)" }, 403, origin);
                   }

      const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
              auth: { persistSession: false },
      });

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
