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
  // IMPORTANT: ton index DB impose TRIM(feed_url). On garde la normalisation minimale.
  // (On évite de changer l’URL, juste trim)
  return String(input ?? "").trim();
}

function pgErrorToMessage(e: any): { status: number; body: any } {
  const msg = e?.message ?? String(e);
  const code = e?.code ?? e?.hint ?? null;

  // Postgres unique violation
  if (e?.code === "23505") {
    return {
      status: 409,
      body: {
        ok: false,
        error: "duplicate",
        message:
          "Doublon détecté (contrainte unique). Vérifie le code source et/ou le feed_url RSS : ils doivent être uniques.",
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

    // 1) Require authenticated user (JWT from client)
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, message: "Not authenticated" }, 401, origin);
    }
    const userId = userData.user.id;

    // 2) Admin check (profiles.is_admin OR admin_users)
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let isAdmin = false;

    // 2a) profiles.is_admin
    try {
      const { data: prof, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id,is_admin")
        .eq("user_id", userId)
        .maybeSingle();

      if (!profErr && prof?.is_admin === true) isAdmin = true;
    } catch {
      // ignore
    }

    // 2b) fallback admin_users
    if (!isAdmin) {
      try {
        const { data: adminRow, error: adminErr } = await supabaseAdmin
          .from("admin_users")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (!adminErr && adminRow?.user_id) isAdmin = true;
      } catch {
        // ignore
      }
    }

    if (!isAdmin) {
      return json(
        {
          ok: false,
          message: "Forbidden (admin only)",
          hint: "Set profiles.is_admin=true for your user or add to admin_users",
        },
        403,
        origin,
      );
    }

    // 3) Actions
    if (action === "upsert_rss") {
      const code = normalizeCode(raw?.code);
      const name = String(raw?.name ?? "").trim();
      const feed_url = normalizeUrl(raw?.feed_url);
      const default_location = String(raw?.default_location ?? "").trim() || null;
      const default_country = String(raw?.default_country ?? "").trim() || null;

      // compat: accepte expire_after_days (ancien) OU expire_ttl_days (nouveau)
      const ttlInput = raw?.expire_ttl_days ?? raw?.expire_after_days;
      const expire_ttl_days = Number(ttlInput);

      // par défaut on active (mais tu peux envoyer activate=false)
      const activate = raw?.activate ?? true;

      if (!code) return json({ ok: false, message: "Le champ 'code' est obligatoire." }, 400, origin);
      if (!name) return json({ ok: false, message: "Le champ 'name' (nom affiché) est obligatoire." }, 400, origin);
      if (!feed_url.startsWith("http")) {
        return json({ ok: false, message: "Le champ 'feed_url' doit commencer par http/https." }, 400, origin);
      }
      if (!Number.isFinite(expire_ttl_days) || expire_ttl_days < 1) {
        return json(
          { ok: false, message: "expire_ttl_days (ou expire_after_days) doit être un nombre >= 1." },
          400,
          origin,
        );
      }

      // ✅ Anti-doublon feed_url (message clair avant la contrainte DB)
      // NOTE: repose sur égalité stricte TRIM(feed_url), comme ton index.
      try {
        const { data: existing, error: exErr } = await supabaseAdmin
          .from("job_sources")
          .select("id,code,name,ingest_method,ingest_config")
          .in("ingest_method", ["rss", "rss_generic"])
          // PostgREST JSON path: ingest_config->>feed_url
          .eq("ingest_config->>feed_url", feed_url)
          .limit(5);

        if (!exErr && Array.isArray(existing)) {
          const conflict = existing.find((s: any) => normalizeCode(s?.code) !== code);
          if (conflict) {
            return json(
              {
                ok: false,
                error: "duplicate_feed_url",
                message: "Ce feed_url RSS est déjà utilisé par une autre source (doublon interdit).",
                conflict: { id: conflict.id, code: conflict.code, name: conflict.name, feed_url },
              },
              409,
              origin,
            );
          }
        }
      } catch {
        // si la syntaxe JSON-path n’est pas supportée par l’environnement, on laisse la contrainte DB jouer
      }

      // ✅ aligné avec ingest_source (rss_generic + cfg.feed_url + cfg.expire_ttl_days)
      const ingest_config = {
        feed_url,
        default_location,
        default_country,
        expire_ttl_days,
        expire_mode: "ttl",
        provider: "rss_generic",
        external_id_prefix_source: true, // aide à éviter les collisions d'external_id entre sources
      };

      const payload = {
        code, // normalisé
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
        .update({ ingest_status: "ready", is_active: !!activate, code }) // re-normalise aussi en DB
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
        .update({ is_active, code }) // re-normalise aussi en DB
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
