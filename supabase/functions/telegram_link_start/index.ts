import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Génère un lien de liaison Telegram à usage unique pour l'utilisateur
// authentifié : https://t.me/<bot>?start=<code>
//
// Le code est stocké sur profiles.telegram_link_code (expire après 10 min).
// C'est le webhook Telegram (telegram_webhook) qui le consomme au /start
// pour poser le vrai telegram_chat_id — jamais cette fonction-ci, qui ne
// fait qu'écrire un code temporaire sur la propre ligne de l'appelant
// (RLS "own_profile" standard, aucun privilège élevé nécessaire).
//
// Secret requis : TELEGRAM_BOT_USERNAME (ex: "JobRadarCIBot", sans @)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function generateCode(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  const botUsername = (Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "").trim().replace(/^@/, "");

  if (!supabaseUrl || !anonKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }
  if (!botUsername) {
    return json(500, { ok: false, error: "bot_not_configured" });
  }

  // Client scopé au JWT de l'appelant : respecte RLS, ne peut jamais toucher
  // à une autre ligne que la sienne.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ telegram_link_code: code, telegram_link_code_expires_at: expiresAt })
    .eq("user_id", userData.user.id);

  if (updateError) {
    return json(500, { ok: false, error: "link_code_write_failed" });
  }

  return json(200, {
    ok: true,
    link_url: `https://t.me/${botUsername}?start=${code}`,
    expires_at: expiresAt,
  });
});
