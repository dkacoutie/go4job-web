import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CvPayload = {
  label?: string | null;
  cv_text?: string | null;
  cv_json?: Record<string, unknown> | null;
  skills?: string[] | null;
  skills_by_category?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
};

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://jobradar.go4jobapp.com",
]);

function getCorsHeaders(origin: string | null) {
  const o = origin && allowedOrigins.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(status: number, body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function sanitizeText(input: unknown) {
  if (typeof input !== "string") return input;
  return input
    .replace(/\uFEFF/g, "")
    // control chars except tab/newline/carriage return + C1 controls
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    // surrogates (invalid on their own)
    .replace(/[\uD800-\uDFFF]/g, "")
    // non-BMP codepoints (avoid invalid unicode escapes in Postgres JSON)
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "");
}

function sanitizeKey(input: unknown) {
  if (typeof input !== "string") return "";
  const k = sanitizeText(input);
  return typeof k === "string" ? k.trim() : "";
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const safeKey = sanitizeKey(k);
      if (!safeKey) continue;
      out[safeKey] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

function safeJsonValue(value: unknown, fallback: unknown) {
  try {
    return JSON.parse(
      JSON.stringify(value, (_k, v) => (typeof v === "string" ? sanitizeText(v) : v)),
    );
  } catch {
    return fallback;
  }
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => sanitizeText(String(v ?? "")) as string)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

function sanitizePayload(p: CvPayload): CvPayload {
  return {
    label: sanitizeText(p.label ?? null) as string | null,
    cv_text: sanitizeText(p.cv_text ?? null) as string | null,
    cv_json: safeJsonValue(p.cv_json ?? {}, {}) as Record<string, unknown>,
    skills: sanitizeStringArray(p.skills),
    skills_by_category: safeJsonValue(p.skills_by_category ?? {}, {}) as Record<string, unknown>,
    contact: safeJsonValue(p.contact ?? {}, {}) as Record<string, unknown>,
    file_path: sanitizeText(p.file_path ?? null) as string | null,
    file_name: sanitizeText(p.file_name ?? null) as string | null,
    file_size: typeof p.file_size === "number" ? p.file_size : null,
    mime_type: sanitizeText(p.mime_type ?? null) as string | null,
  };
}

function buildFallbackPayload(base: CvPayload, drop: Partial<Record<keyof CvPayload, true>>): CvPayload {
  return {
    label: base.label ?? "CV",
    cv_text: drop.cv_text ? null : base.cv_text ?? null,
    cv_json: drop.cv_json ? {} : (base.cv_json ?? {}),
    skills: drop.skills ? [] : (base.skills ?? []),
    skills_by_category: drop.skills_by_category ? {} : (base.skills_by_category ?? {}),
    contact: drop.contact ? {} : (base.contact ?? {}),
    file_path: base.file_path ?? null,
    file_name: base.file_name ?? null,
    file_size: base.file_size ?? null,
    mime_type: base.mime_type ?? null,
  };
}

function isUnicodeDbError(msg: string) {
  return /unsupported unicode escape sequence/i.test(msg) || /invalid byte sequence/i.test(msg);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "method_not_allowed" }, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    if (!supabaseUrl || !anonKey) {
      return jsonResponse(500, { ok: false, error: "server_misconfigured" }, corsHeaders);
    }

    let body: { action?: string; payload?: CvPayload } | null = null;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "invalid_json_body" }, corsHeaders);
    }

    const action = String(body?.action || "").trim();

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = userData?.user ?? null;
    if (userErr || !user) {
      return jsonResponse(401, { ok: false, error: "unauthorized" }, corsHeaders);
    }

    if (action === "get_active") {
      const { data, error } = await supabase
        .from("user_cvs")
        .select("id,label,cv_text,cv_json,skills,skills_by_category,contact,is_active,updated_at,file_path,file_name,file_size,mime_type")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return jsonResponse(500, { ok: false, error: "db_error", message: error.message }, corsHeaders);
      }

      return jsonResponse(200, { ok: true, data: data ?? null }, corsHeaders);
    }

    if (action === "archive") {
      const { error } = await supabase
        .from("user_cvs")
        .update({ is_active: false })
        .eq("user_id", user.id)
        .eq("is_active", true);

      if (error) {
        return jsonResponse(500, { ok: false, error: "db_error", message: error.message }, corsHeaders);
      }

      return jsonResponse(200, { ok: true }, corsHeaders);
    }

    if (action === "upsert") {
      const safePayload = sanitizePayload(body?.payload ?? {});

      const { data: existing, error: exErr } = await supabase
        .from("user_cvs")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (exErr) {
        return jsonResponse(500, { ok: false, error: "db_error", message: exErr.message }, corsHeaders);
      }

      const tryUpsert = async (payload: CvPayload) => {
        if (existing?.id) {
          return await supabase
            .from("user_cvs")
            .update({ ...payload })
            .eq("id", existing.id)
            .select()
            .maybeSingle();
        }
        return await supabase
          .from("user_cvs")
          .insert({
            user_id: user.id,
            is_active: true,
            ...payload,
          })
          .select()
          .maybeSingle();
      };

      let result = await tryUpsert(safePayload);
      if (result.error) {
        const msg = result.error.message || "";
        if (isUnicodeDbError(msg)) {
          const fallbackOrder: Array<Partial<Record<keyof CvPayload, true>>> = [
            { cv_json: true },
            { skills_by_category: true },
            { skills: true },
            { cv_text: true },
            { contact: true },
            { cv_json: true, skills_by_category: true, skills: true },
            { cv_json: true, skills_by_category: true, skills: true, cv_text: true, contact: true },
          ];

          for (const drop of fallbackOrder) {
            const fallback = buildFallbackPayload(safePayload, drop);
            result = await tryUpsert(fallback);
            if (!result.error) {
              return jsonResponse(
                200,
                { ok: true, data: result.data ?? null, warning: "unicode_stripped", dropped: Object.keys(drop) },
                corsHeaders,
              );
            }
            if (!isUnicodeDbError(result.error.message || "")) {
              return jsonResponse(
                500,
                { ok: false, error: "db_error", message: result.error.message },
                corsHeaders,
              );
            }
          }

          return jsonResponse(
            500,
            { ok: false, error: "db_error", message: result.error.message },
            corsHeaders,
          );
        }
        return jsonResponse(
          500,
          { ok: false, error: "db_error", message: result.error.message },
          corsHeaders,
        );
      }

      return jsonResponse(200, { ok: true, data: result.data ?? null }, corsHeaders);
    }

    return jsonResponse(400, { ok: false, error: "invalid_action" }, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { ok: false, error: "server_error", message }, corsHeaders);
  }
});
