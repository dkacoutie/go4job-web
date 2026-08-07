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
    dry_run?: boolean;
};

function pickBestMessage(payload: any, fallback: string) {
    if (!payload) return fallback;
    if (typeof payload === "string") return payload;
    if (typeof payload !== "object") return String(payload);
    const msg = payload.message ?? payload.error ?? payload.hint ?? payload.details ?? null;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    try {
          return JSON.stringify(payload);
    } catch {
          return fallback;
    }
}

// JR-0024 (07/08/2026): l'ancien check local (profiles.is_admin OU presence brute
// dans admin_users, sans filtre is_active/role) permettait a un admin revoque de
// garder un acces complet. Remplace par is_admin_user(). Deploye le 07/08/2026.

Deno.serve(async (req) => {
    const origin = req.headers.get("origin");

             if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method === "GET") return json({ ok: true, status: "admin_run_ingest_alive" }, 200, origin);
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

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
                   const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
                   if (!cronSecret) {
                           return json({ ok: false, error: "CRON_SECRET_not_set_in_env" }, 500, origin);
                   }

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

      const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin_user");
                   if (adminErr || isAdmin !== true) return json({ ok: false, error: "forbidden_admin_only" }, 403, origin);

      const ingestUrl = `${supabaseUrl}/functions/v1/ingest_source`;
                   const res = await fetch(ingestUrl, {
                           method: "POST",
                           headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
                           body: JSON.stringify({ source_code, limit, dry_run: true, trigger: "admin_run_ingest" }),
                   });

      const text = await res.text();
                   let payload: any = null;
                   try {
                           payload = JSON.parse(text);
                   } catch {
                           payload = { raw: text };
                   }

      if (!res.ok) {
              const rootMsg = pickBestMessage(payload, `HTTP ${res.status} from ingest_source`);
              return json(
                { ok: false, error: "ingest_source_failed", message: rootMsg, source_code, ingest_http_status: res.status, ingest_response: payload },
                        502,
                        origin,
                      );
      }

      return json({ ok: true, admin_user_id: userId, source_code, limit, dry_run: true, ingest: payload }, 200, origin);
             } catch (e: any) {
    return json({ ok: false, error: "admin_run_ingest_failed", message: e?.message ?? String(e) }, 500, origin);
             }
});
