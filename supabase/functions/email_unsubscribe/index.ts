import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type UnsubscribeTokenRow = {
  id: string;
  token: string;
  email: string;
  email_normalized: string;
  user_id: string | null;
  email_key: string;
  segment: string;
  used_at: string | null;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function textResponse(
  status: number,
  title: string,
  message: string,
) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(`${title}\n\n${message}`, {
    status,
    headers,
  });
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "";

  const visibleStart = localPart.slice(0, 2);
  const visibleEnd = localPart.length > 4 ? localPart.slice(-1) : "";
  return `${visibleStart}${"*".repeat(Math.max(3, localPart.length - visibleStart.length - visibleEnd.length))}${visibleEnd}@${domain}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanEnv(value: string | undefined) {
  return (value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return textResponse(
      405,
      "M\u00e9thode non autoris\u00e9e",
      "Ce lien de d\u00e9sinscription doit \u00eatre ouvert depuis l'email re\u00e7u.",
    );
  }

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();

  if (!token || !isUuid(token)) {
    return textResponse(
      400,
      "Lien invalide",
      "Ce lien de d\u00e9sinscription est invalide ou expir\u00e9.",
    );
  }

  const supabaseUrl = cleanEnv(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanEnv(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) {
    return textResponse(
      500,
      "Erreur temporaire",
      "La d\u00e9sinscription ne peut pas \u00eatre finalis\u00e9e pour le moment.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: unsubscribeToken, error: tokenError } = await supabase
    .from("email_unsubscribe_tokens")
    .select("id, token, email, email_normalized, user_id, email_key, segment, used_at")
    .eq("token", token)
    .maybeSingle<UnsubscribeTokenRow>();

  if (tokenError || !unsubscribeToken) {
    return textResponse(
      404,
      "Lien invalide",
      "Ce lien de d\u00e9sinscription est invalide ou expir\u00e9.",
    );
  }

  const now = new Date().toISOString();
  const emailNormalized = unsubscribeToken.email_normalized.trim().toLowerCase();
  const email = unsubscribeToken.email.trim();

  const { error: suppressionError } = await supabase
    .from("email_suppressions")
    .upsert(
      {
        user_id: unsubscribeToken.user_id,
        email,
        email_normalized: emailNormalized,
        reason: "unsubscribed",
        source: "email_unsubscribe",
        metadata: {
          token_id: unsubscribeToken.id,
          email_key: unsubscribeToken.email_key,
          segment: unsubscribeToken.segment,
        },
      },
      {
        onConflict: "email_normalized",
        ignoreDuplicates: true,
      },
    );

  if (suppressionError) {
    return textResponse(
      500,
      "Erreur temporaire",
      "La d\u00e9sinscription ne peut pas \u00eatre finalis\u00e9e pour le moment.",
    );
  }

  if (!unsubscribeToken.used_at) {
    await supabase
      .from("email_unsubscribe_tokens")
      .update({ used_at: now })
      .eq("id", unsubscribeToken.id)
      .is("used_at", null);
  }

  await supabase
    .from("email_logs")
    .update({
      status: "unsubscribed",
      unsubscribed_at: now,
    })
    .eq("email_normalized", emailNormalized)
    .eq("email_key", unsubscribeToken.email_key);

  const maskedEmail = maskEmail(email);
  const message = maskedEmail
    ? `Tu es bien d\u00e9sinscrit(e) des emails JobRadar pour ${maskedEmail}.\nTu peux fermer cette page.`
    : "Tu es bien d\u00e9sinscrit(e) des emails JobRadar.\nTu peux fermer cette page.";

  return textResponse(
    200,
    "D\u00e9sinscription confirm\u00e9e",
    message,
  );
});

