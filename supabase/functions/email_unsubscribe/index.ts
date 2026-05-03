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

const APP_URL = "https://jobradar.go4jobapp.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHtmlPage(
  title: string,
  message: string,
  variant: "success" | "error" = "success",
) {
  const accent = variant === "success" ? "#0b5ed7" : "#b42318";

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f4f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
      <section style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5eaf2;border-radius:12px;padding:28px;">
        <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#0b1420;">Go4Job / JobRadar</p>
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:${accent};">${escapeHtml(title)}</h1>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#374151;">${escapeHtml(message)}</p>
        <a href="${APP_URL}" style="display:inline-block;background:#0b5ed7;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;padding:12px 16px;">
          Retourner sur JobRadar
        </a>
      </section>
    </main>
  </body>
</html>`;
}

function htmlResponse(status: number, html: string) {
  return new Response(html, {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "text/html; charset=utf-8",
    },
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
    return htmlResponse(
      405,
      renderHtmlPage(
        "Méthode non autorisée",
        "Ce lien de désinscription doit être ouvert depuis l'email reçu.",
        "error",
      ),
    );
  }

  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();

  if (!token || !isUuid(token)) {
    return htmlResponse(
      400,
      renderHtmlPage(
        "Lien invalide",
        "Ce lien de désinscription est invalide ou expiré.",
        "error",
      ),
    );
  }

  const supabaseUrl = cleanEnv(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanEnv(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) {
    return htmlResponse(
      500,
      renderHtmlPage(
        "Erreur temporaire",
        "La désinscription ne peut pas être finalisée pour le moment.",
        "error",
      ),
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
    return htmlResponse(
      404,
      renderHtmlPage(
        "Lien invalide",
        "Ce lien de désinscription est invalide ou expiré.",
        "error",
      ),
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
    return htmlResponse(
      500,
      renderHtmlPage(
        "Erreur temporaire",
        "La désinscription ne peut pas être finalisée pour le moment.",
        "error",
      ),
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
    ? `Tu es bien désinscrit(e) des emails JobRadar pour ${maskedEmail}.`
    : "Tu es bien désinscrit(e) des emails JobRadar.";

  return htmlResponse(
    200,
    renderHtmlPage(
      "désinscription confirmée",
      message,
      "success",
    ),
  );
});

