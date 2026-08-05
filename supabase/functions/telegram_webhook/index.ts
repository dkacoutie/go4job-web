import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Webhook public Telegram (verify_jwt = false : Telegram n'envoie pas de JWT
// Supabase). Authentifié par le header X-Telegram-Bot-Api-Secret-Token,
// configuré une fois via setWebhook — voir marche à suivre de déploiement.
//
// Secrets requis :
//  - TELEGRAM_BOT_TOKEN
//  - TELEGRAM_WEBHOOK_SECRET (chaîne choisie par nous, transmise à Telegram
//    via setWebhook, jamais devinable depuis l'extérieur)
//
// Répond toujours 200 à Telegram (même en cas de payload invalide ou de
// secret incorrect) pour éviter des retries agressifs côté Telegram ; le
// filtrage se fait avant tout traitement.

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

function cleanSecret(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Best-effort : une confirmation manquée ne doit jamais faire échouer le webhook.
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return ok({ ok: true, ignored: "not_post" });
  }

  const webhookSecret = cleanSecret(Deno.env.get("TELEGRAM_WEBHOOK_SECRET"));
  const botToken = cleanSecret(Deno.env.get("TELEGRAM_BOT_TOKEN"));
  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!webhookSecret || !botToken || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: "server_misconfigured" }), { status: 500 });
  }

  const receivedSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (receivedSecret !== webhookSecret) {
    return ok({ ok: true, ignored: "invalid_secret" });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return ok({ ok: true, ignored: "invalid_payload" });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat?.id;

  if (!chatId || !text.startsWith("/start")) {
    return ok({ ok: true, ignored: "not_a_start_command" });
  }

  const code = text.replace("/start", "").trim();

  if (!code) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Pour lier ce compte, utilise le lien depuis ton profil JobRadar (bouton "Lier Telegram").',
    );
    return ok({ ok: true, result: "missing_code" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: profile, error: lookupError } = await supabase
    .from("profiles")
    .select("user_id, telegram_link_code_expires_at")
    .eq("telegram_link_code", code)
    .maybeSingle();

  if (lookupError || !profile) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "Ce lien n'est plus valide. Retourne sur ton profil JobRadar pour en générer un nouveau.",
    );
    return ok({ ok: true, result: "code_not_found" });
  }

  const expiresAt = profile.telegram_link_code_expires_at
    ? new Date(profile.telegram_link_code_expires_at as string)
    : null;

  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "Ce lien a expiré. Retourne sur ton profil JobRadar pour en générer un nouveau.",
    );
    return ok({ ok: true, result: "code_expired" });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      telegram_chat_id: String(chatId),
      notif_telegram: true,
      telegram_link_code: null,
      telegram_link_code_expires_at: null,
    })
    .eq("user_id", profile.user_id as string);

  if (updateError) {
    await sendTelegramMessage(botToken, chatId, "Une erreur est survenue côté serveur, réessaie plus tard.");
    return ok({ ok: false, error: "link_write_failed" });
  }

  await sendTelegramMessage(
    botToken,
    chatId,
    "✅ Compte lié. Tu recevras désormais un rappel Telegram en plus de l'email quand de nouvelles offres correspondent à tes alertes JobRadar.",
  );

  return ok({ ok: true, result: "linked" });
});
