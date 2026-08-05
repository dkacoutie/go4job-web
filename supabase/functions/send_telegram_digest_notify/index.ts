import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Ping Telegram best-effort après un digest email déjà envoyé
// (jobradar_digest_runs, alimenté par send_job_alert_digest_v2). Ne remplace
// jamais l'email et ne duplique pas son contenu détaillé : un rappel court
// avec un lien vers l'app. Ce choix délibéré évite de toucher au pipeline
// email existant (send_job_alert_digest_v2), déjà éprouvé et par le passé
// source d'un incident de déploiement — voir historique du projet.
//
// Appelée par cron via private.cron_send_telegram_digest_notify(), avec le
// même header x-cron-secret que send_job_alert_digest_v2.
//
// Secrets requis : TELEGRAM_BOT_TOKEN, CRON_SECRET (déjà utilisé ailleurs)

const APP_URL = "https://jobradar.go4jobapp.com";
const DIGEST_CHANNEL = "job_alert_digest_v2";
const LOOKBACK_HOURS = 24;

type DigestRun = {
  id: string;
  user_id: string;
  job_count: number | null;
};

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    throw new Error(`telegram_send_failed_${res.status}`);
  }
}

function digestMessage(jobCount: number): string {
  if (jobCount > 0) {
    const plural = jobCount > 1 ? "s" : "";
    return `🔔 ${jobCount} nouvelle${plural} offre${plural} correspondant à vos alertes JobRadar aujourd'hui.\nDétails : ${APP_URL}/jobradar/notifications`;
  }
  return `🔔 Votre point JobRadar du jour est prêt.\nDétails : ${APP_URL}/jobradar/notifications`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }

  const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const receivedSecret = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || receivedSecret !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  const botToken = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

  if (!botToken || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: "server_misconfigured" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Étape 1 : qui a réellement lié Telegram (requête séparée, sans compter
  // sur une relation FK détectée automatiquement par PostgREST).
  const { data: linkedProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("user_id, telegram_chat_id")
    .eq("notif_telegram", true)
    .not("telegram_chat_id", "is", null);

  if (profilesError) {
    return new Response(
      JSON.stringify({ ok: false, error: "profiles_lookup_failed", detail: profilesError.message }),
      { status: 500 },
    );
  }

  const chatIdByUser = new Map<string, string>();
  for (const p of linkedProfiles ?? []) {
    if (p.telegram_chat_id) chatIdByUser.set(p.user_id as string, p.telegram_chat_id as string);
  }

  if (chatIdByUser.size === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, skipped: 0, failed: 0, checked: 0, reason: "no_linked_users" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // Étape 2 : digests email envoyés récemment pour ces utilisateurs.
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: runs, error: runsError } = await supabase
    .from("jobradar_digest_runs")
    .select("id, user_id, job_count")
    .eq("channel", DIGEST_CHANNEL)
    .gte("created_at", since)
    .in("user_id", Array.from(chatIdByUser.keys()));

  if (runsError) {
    return new Response(
      JSON.stringify({ ok: false, error: "runs_lookup_failed", detail: runsError.message }),
      { status: 500 },
    );
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const run of (runs ?? []) as DigestRun[]) {
    const chatId = chatIdByUser.get(run.user_id);
    if (!chatId) {
      skipped++;
      continue;
    }

    // Idempotence : ne jamais pinguer deux fois le même run.
    const { data: alreadySent } = await supabase
      .from("jobradar_telegram_notify_log")
      .select("run_id")
      .eq("run_id", run.id)
      .maybeSingle();

    if (alreadySent) {
      skipped++;
      continue;
    }

    try {
      await sendTelegramMessage(botToken, chatId, digestMessage(run.job_count ?? 0));
      const { error: logError } = await supabase
        .from("jobradar_telegram_notify_log")
        .insert({ run_id: run.id });
      if (logError && logError.code !== "23505") {
        // Non bloquant : au pire un futur run pourrait re-tenter cet envoi,
        // préférable à ne jamais confirmer un envoi réellement réussi.
      }
      sent++;
    } catch {
      failed++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, sent, skipped, failed, checked: (runs ?? []).length }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
});
