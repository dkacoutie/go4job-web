import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function htmlResponse(status: number, html: string) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function base64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64Url(new Uint8Array(sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const url = new URL(req.url);
  const uid = url.searchParams.get("uid") || url.searchParams.get("user_id");
  const token = url.searchParams.get("t") || url.searchParams.get("token");

  if (!uid || !token) {
    return htmlResponse(400, "<h2>Lien invalide</h2><p>Paramètres manquants.</p>");
  }

  const secret = Deno.env.get("CRON_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!secret || !supabaseUrl || !serviceRole) {
    return htmlResponse(500, "<h2>Erreur serveur</h2><p>Configuration manquante.</p>");
  }

  const expected = await sign(secret, `unsubscribe:${uid}`);
  if (!safeEqual(token, expected)) {
    return htmlResponse(400, "<h2>Lien invalide</h2><p>Le lien de desinscription n'est pas valide.</p>");
  }

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  await supabase.from("notification_prefs").upsert({
    user_id: uid,
    digest_enabled: false,
    unsubscribed_at: now,
    updated_at: now,
  });

  const wantsJson = req.headers.get("accept")?.includes("application/json");
  if (wantsJson) return json(200, { ok: true, unsubscribed: true });

  return htmlResponse(
    200,
    `
    <div style="font-family:Arial,sans-serif;padding:24px;">
      <h2>Désinscription confirmée</h2>
      <p>Tu ne recevras plus le digest quotidien JobRadar.</p>
    </div>
    `,
  );
});
