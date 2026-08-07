// supabase/functions/admin_configure_source/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string | null) {
    const allowOrigin = origin ?? "*";
    return {
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizeCode(input: unknown): string {
    return String(input ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
}

function normalizeUrl(input: unknown): string {
    return String(input ?? "").trim();
}

function pgErrorToMessage(e: any): { status: number; body: any } {
    const msg = e?.message ?? String(e);
    const code = e?.code ?? e?.hint ?? null;

  if (e?.code === "23505") {
        return {
                status: 409,
                body: {
                          ok: false,
                          error: "duplicate",
                          message: "Doublon detecte (contrainte unique).",
                          details: msg,
                },
        };
  }

  return {
        status: 500,
        body: { ok: false, error: "internal_error", message: msg, code },
  };
}

const SUPPORTED_ACTIONS = ["upsert_rss", "mark_ready", "set_active"] as const;

// JR-0024 (07/08/2026): l'ancien check local (profiles.is_admin OU presence brute
// dans admin_users, sans filtre is_active/role) permettait a un admin revoque
// (admin_users.is_active=false) de garder un acces d'ecriture complet. Remplace
// par le RPC is_admin_user() (meme verification que admin_health). Deploye le 07/08/2026.

Deno.serve(async (req) => {
    const origin = req.headers.get("origin");

             if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

             let raw: any;
    try {
          raw = await req.json();
    } catch {
          return json({ ok: false, error: "invalid_json_body" }, 400, origin);
    }

             const action = String(raw?.action ?? "").trim().toLowerCase();

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

      const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

      if (action === "upsert_rss") {
              const code = normalizeCode(raw?.code);
              const name = String(raw?.name ?? "").trim();
              const feed_url = normalizeUrl(raw?.feed_url);
              const default_location = String(raw?.default_location ?? "").trim() || null;
              const default_country = String(raw?.default_country ?? "").trim() || null;
              const ttlInput = raw?.expire_ttl_days ?? raw?.expire_after_days;
              const expire_ttl_days = Number(ttlInput);
              const activate = raw?.activate ?? true;

                     if (!code) return json({ ok: false, message: "Le champ 'code' est obligatoire." }, 400, origin);
              if (!name) return json({ ok: false, message: "Le champ 'name' est obligatoire." }, 400, origin);
              if (!feed_url.startsWith("http")) {
                        return json({ ok: false, message: "feed_url doit commencer par http/https." }, 400, origin);
              }
              if (!Number.isFinite(expire_ttl_days) || expire_ttl_days < 1) {
                        return json({ ok: false, message: "expire_ttl_days doit etre >= 1." }, 400, origin);
              }

                     const ingest_config = {
                               feed_url,
                               default_location,
                               default_country,
                               expire_ttl_days,
                               expire_mode: "ttl",
                               provider: "rss_generic",
                               external_id_prefix_source: true,
                     };

                     const payload = {
                               code,
                               name,
                               ingest_method: "rss_generic",
                               ingest_status: "ready",
                               is_active: !!activate,
                               ingest_config,
                     };

                     const { data, error } = await supabaseAdmin
                .from("job_sources")
                .upsert(payload as any, { onConflict: "code" })
                .select("id, code, name, ingest_method, ingest_status, is_active, ingest_config")
                .single();

                     if (error) throw error;

                     return json({ ok: true, action: "upsert_rss", source: data }, 200, origin);
      }

      if (action === "mark_ready") {
              const code = normalizeCode(raw?.code);
              const activate = raw?.activate ?? true;
              if (!code) return json({ ok: false, message: "Le champ 'code' est obligatoire." }, 400, origin);

                     const { data, error } = await supabaseAdmin
                .from("job_sources")
                .update({ ingest_status: "ready", is_active: !!activate, code })
                .eq("code", code)
                .select("id, code, name, ingest_method, ingest_status, is_active, ingest_config")
                .single();

                     if (error) throw error;

                     return json({ ok: true, action: "mark_ready", source: data }, 200, origin);
      }

      if (action === "set_active") {
              const code = normalizeCode(raw?.code);
              const is_active = !!raw?.is_active;
              if (!code) return json({ ok: false, message: "Le champ 'code' est obligatoire." }, 400, origin);

                     const { data, error } = await supabaseAdmin
                .from("job_sources")
                .update({ is_active, code })
                .eq("code", code)
                .select("id, code, name, ingest_method, ingest_status, is_active, ingest_config")
                .single();

                     if (error) throw error;

                     return json({ ok: true, action: "set_active", source: data }, 200, origin);
      }

      return json(
        { ok: false, message: "Unknown action", received_action: action, supported_actions: SUPPORTED_ACTIONS },
              400,
              origin,
            );
             } catch (e: any) {
    const mapped = pgErrorToMessage(e);
                   return json(mapped.body, mapped.status, origin);
             }
});
