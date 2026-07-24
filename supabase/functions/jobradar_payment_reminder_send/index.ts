// Ajustement 8 (spec activation/paiement, session Cowork du 24/07/2026) :
// relances email BORNÉES pour les paiements Paystack restés en attente,
// à préparer avant le lancement de la campagne Meta, pas pendant.
//
// Choix d'architecture : un mécanisme de relance "paystack_checkout_recovery_leads"
// existe déjà dans la base, mais c'est une table statique (colonne
// imported_at), issue d'un import ponctuel lors d'une analyse antérieure,
// sans rafraîchissement automatique (aucun cron ne la met à jour). Il ne
// reflète donc pas le statut réel et à jour des paiements. Plutôt que d'y
// rebrancher cette fonction (ce qui demanderait de reconstruire aussi un
// pipeline de rafraîchissement), cette fonction lit directement
// billing_payments — la source vivante — pour respecter l'exigence
// explicite : "rapprocher d'abord le statut avec Paystack, puis décider de
// relancer". En pratique : on ne relance QUE des paiements pending/ongoing
// qui existent encore APRÈS le passage de paystack_reconcile_pending
// (Ajustement 6) — si le cron ci-dessus est planifié juste avant celui-ci,
// tout paiement que Paystack avait déjà résolu est sorti de la sélection
// avant même que cette fonction ne s'exécute.
//
// Garde-fous explicitement demandés :
// - Au maximum 2 relances par paiement, jamais une séquence : 1ère relance
//   après first_delay_minutes (valeur de départ 10 min, configurable),
//   2ème après second_delay_hours (valeur de départ 24h, configurable),
//   chacune trackée indépendamment via email_logs (email_key dédié par
//   étape) — impossible d'en envoyer une 3e sous ces clés.
// - Ne relance jamais une transaction déjà confirmée, définitivement
//   échouée, ou supplantée par un achat ultérieur (vérifié via un paiement
//   'paid'/'paid_test' plus récent pour le même utilisateur, quel que soit
//   le plan).
// - Le lien de reprise pointe vers /pricing (jamais une URL Paystack, qui
//   peut avoir expiré) : reprendre y déclenche un paiement_initialize
//   normal, sans risque de doublon (billing_payments garde son propre
//   contrôle d'idempotence côté paystack_initialize, inchangé ici).
// - Exclusion sur notification_prefs.unsubscribed_at ET email_suppressions
//   (les deux, comme le fait déjà enqueue_paystack_recovery).
// - dry_run par défaut ; envoi réel exigé dry_run:false + confirm explicite.
// - Protégée par CRON_SECRET, jamais appelable anonymement.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const EMAIL_KEY_FIRST = "jobradar_payment_reminder_1";
const EMAIL_KEY_SECOND = "jobradar_payment_reminder_2";
const NON_FINAL_STATUSES = ["pending", "ongoing"];
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const DEFAULT_FIRST_DELAY_MINUTES = 10;
const DEFAULT_SECOND_DELAY_HOURS = 24;
const DEFAULT_MAX_AGE_HOURS = 72;
const REMINDER_SEND_CONFIRM = "SEND_JOBRADAR_PAYMENT_REMINDER_V1";
const ALREADY_HANDLED_STATUSES = ["queued", "sent", "delivered", "opened", "clicked"];

type Body = {
  dry_run?: boolean | null;
  limit?: number | null;
  first_delay_minutes?: number | null;
  second_delay_hours?: number | null;
  max_age_hours?: number | null;
  confirm?: string | null;
};

type PaymentRow = {
  id: string;
  user_id: string;
  plan_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) v = v.slice(7).trim();
  return v;
}

function normalizeBaseUrl(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function clamp(value: number | null | undefined, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, n));
}

function isAuthorized(req: Request) {
  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) return { ok: false, status: 500, error: "server_misconfigured" };
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();
  if (bearer === cronSecret || cronHeader === cronSecret) return { ok: true, status: 200, error: null };
  return { ok: false, status: 401, error: "unauthorized" };
}

function supabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing_supabase_env");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function buildEmail(step: "first" | "second", payment: PaymentRow, resumeUrl: string) {
  const amountLabel =
    (payment.currency || "").toUpperCase() === "XOF" || (payment.currency || "").toUpperCase() === "XAF"
      ? `${payment.amount_minor.toLocaleString("fr-FR")} ${payment.currency}`
      : `${(payment.amount_minor / 100).toFixed(2)} ${payment.currency}`;

  const subject =
    step === "first"
      ? "Ton paiement JobRadar est-il bien passé ?"
      : "Toujours un souci avec ton paiement JobRadar ?";

  const bodyIntro =
    step === "first"
      ? `On voit qu'un paiement de ${amountLabel} a été initié sur JobRadar mais n'a pas encore été confirmé.`
      : `Ton paiement de ${amountLabel} sur JobRadar est toujours en attente de confirmation.`;

  const text =
    `Bonjour,\n\n${bodyIntro}\n\n` +
    `Si tu as déjà confirmé sur ton téléphone, c'est peut-être en cours de traitement : pas besoin de repayer, on vérifie automatiquement et on active ton accès dès la confirmation.\n\n` +
    `Si ça n'a pas abouti, tu peux reprendre ici, sans frais tant que rien n'est confirmé : ${resumeUrl}\n\n` +
    `Un souci ? Réponds à cet email, on t'aide directement.\n\n— L'équipe JobRadar`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:520px;margin:0 auto;">
      <p>Bonjour,</p>
      <p>${bodyIntro}</p>
      <p>Si tu as déjà confirmé sur ton téléphone, c'est peut-être en cours de traitement : pas besoin de repayer, on vérifie automatiquement et on active ton accès dès la confirmation.</p>
      <p>
        <a href="${resumeUrl}" style="display:inline-block;background:#2451ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
          Reprendre mon paiement
        </a>
      </p>
      <p>Un souci ? Réponds à cet email, on t'aide directement.</p>
      <p>— L'équipe JobRadar</p>
    </div>
  `.trim();

  return { subject, html, text };
}

async function sendViaSendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
  cronSecret: string;
}) {
  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const functionsBase =
    normalizeBaseUrl(clean(Deno.env.get("PUBLIC_FUNCTIONS_BASE"))) ||
    `${normalizeBaseUrl(supabaseUrl)}/functions/v1`;

  const resp = await fetch(`${functionsBase}/send_email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": params.cronSecret,
      Authorization: `Bearer ${params.cronSecret}`,
    },
    body: JSON.stringify({ to: params.to, subject: params.subject, html: params.html, text: params.text, tag: params.tag }),
  });

  let data: Record<string, unknown> = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  if (!resp.ok) return { ok: false, error: (data?.error as string) || "send_email_failed" };
  return { ok: true, providerId: (data?.provider_id as string) || null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const auth = isAuthorized(req);
  if (!auth.ok) return json(auth.status, { ok: false, error: auth.error });

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body.dry_run !== false;
  const limit = clamp(body.limit, DEFAULT_LIMIT, MAX_LIMIT) || DEFAULT_LIMIT;
  const firstDelayMinutes = clamp(body.first_delay_minutes, DEFAULT_FIRST_DELAY_MINUTES, 24 * 60);
  const secondDelayHours = clamp(body.second_delay_hours, DEFAULT_SECOND_DELAY_HOURS, 24 * 14);
  const maxAgeHours = clamp(body.max_age_hours, DEFAULT_MAX_AGE_HOURS, 24 * 14);

  if (!dryRun && body.confirm !== REMINDER_SEND_CONFIRM) {
    return json(400, {
      ok: false,
      error: "confirmation_missing",
      details: `Un envoi réel requiert dry_run:false et confirm:'${REMINDER_SEND_CONFIRM}'.`,
    });
  }

  let supabase: SupabaseClient;
  try {
    supabase = supabaseAdmin();
  } catch (error) {
    return json(500, { ok: false, error: "server_misconfigured", details: error instanceof Error ? error.message : String(error) });
  }

  const now = Date.now();
  const oldEnoughForFirst = new Date(now - firstDelayMinutes * 60 * 1000).toISOString();
  const notTooOld = new Date(now - maxAgeHours * 60 * 60 * 1000).toISOString();

  const { data: rawCandidates, error: candidatesError } = await supabase
    .from("billing_payments")
    .select("id,user_id,plan_id,amount_minor,currency,status,created_at")
    .eq("provider_code", "paystack")
    .in("status", NON_FINAL_STATUSES)
    .lte("created_at", oldEnoughForFirst)
    .gte("created_at", notTooOld)
    .order("created_at", { ascending: true })
    .limit(Math.min(100, limit * 4));

  if (candidatesError) {
    return json(500, { ok: false, error: "candidates_read_failed", details: candidatesError.message });
  }

  const candidates = (rawCandidates ?? []) as PaymentRow[];
  const appBaseUrl = normalizeBaseUrl(clean(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com");

  const selected: Array<{ payment: PaymentRow; step: "first" | "second"; email: string }> = [];
  let skippedSuperseded = 0;
  let skippedUnsubscribed = 0;
  let skippedTooSoonForSecond = 0;
  let skippedAlreadyHandled = 0;
  let skippedNoEmail = 0;

  for (const payment of candidates) {
    if (selected.length >= limit) break;

    // Supplanté par un achat ultérieur (même utilisateur, autre paiement
    // déjà confirmé) : ne jamais relancer dans ce cas.
    const { count: supersededCount, error: supersededError } = await supabase
      .from("billing_payments")
      .select("*", { count: "exact", head: true })
      .eq("user_id", payment.user_id)
      .in("status", ["paid", "paid_test"]);
    if (supersededError) {
      return json(500, { ok: false, error: "superseded_check_failed", details: supersededError.message });
    }
    if ((supersededCount ?? 0) > 0) {
      skippedSuperseded += 1;
      continue;
    }

    const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(payment.user_id);
    const email = clean(authUser?.user?.email ?? "");
    if (authUserError || !email) {
      skippedNoEmail += 1;
      continue;
    }
    const emailNormalized = email.toLowerCase();

    const [{ data: prefs }, { count: suppressedCount }] = await Promise.all([
      supabase.from("notification_prefs").select("unsubscribed_at").eq("user_id", payment.user_id).maybeSingle(),
      supabase.from("email_suppressions").select("*", { count: "exact", head: true }).eq("email_normalized", emailNormalized),
    ]);
    if (prefs?.unsubscribed_at || (suppressedCount ?? 0) > 0) {
      skippedUnsubscribed += 1;
      continue;
    }

    const { count: firstSentCount, error: firstSentError } = await supabase
      .from("email_logs")
      .select("*", { count: "exact", head: true })
      .eq("email_normalized", emailNormalized)
      .eq("email_key", EMAIL_KEY_FIRST)
      .in("status", ALREADY_HANDLED_STATUSES);
    if (firstSentError) {
      return json(500, { ok: false, error: "email_logs_check_failed", details: firstSentError.message });
    }

    if ((firstSentCount ?? 0) === 0) {
      selected.push({ payment, step: "first", email });
      continue;
    }

    const oldEnoughForSecond = payment.created_at <= new Date(now - secondDelayHours * 60 * 60 * 1000).toISOString();
    if (!oldEnoughForSecond) {
      skippedTooSoonForSecond += 1;
      continue;
    }

    const { count: secondSentCount, error: secondSentError } = await supabase
      .from("email_logs")
      .select("*", { count: "exact", head: true })
      .eq("email_normalized", emailNormalized)
      .eq("email_key", EMAIL_KEY_SECOND)
      .in("status", ALREADY_HANDLED_STATUSES);
    if (secondSentError) {
      return json(500, { ok: false, error: "email_logs_check_failed", details: secondSentError.message });
    }
    if ((secondSentCount ?? 0) > 0) {
      skippedAlreadyHandled += 1;
      continue;
    }

    selected.push({ payment, step: "second", email });
  }

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      candidates_fetched: candidates.length,
      would_send_count: selected.length,
      would_send_first: selected.filter((s) => s.step === "first").length,
      would_send_second: selected.filter((s) => s.step === "second").length,
      skipped_superseded: skippedSuperseded,
      skipped_unsubscribed: skippedUnsubscribed,
      skipped_too_soon_for_second: skippedTooSoonForSecond,
      skipped_already_handled: skippedAlreadyHandled,
      skipped_no_email: skippedNoEmail,
      first_delay_minutes: firstDelayMinutes,
      second_delay_hours: secondDelayHours,
      max_age_hours: maxAgeHours,
      limit,
    });
  }

  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  let sentCount = 0;
  let failedCount = 0;
  const errors: Array<{ payment_id: string; error: string }> = [];

  for (const item of selected) {
    const emailKey = item.step === "first" ? EMAIL_KEY_FIRST : EMAIL_KEY_SECOND;
    const resumeUrl = `${appBaseUrl}/pricing?utm_source=email&utm_medium=reminder&utm_campaign=${emailKey}`;

    const { data: logRow, error: insertLogError } = await supabase
      .from("email_logs")
      .insert({
        user_id: item.payment.user_id,
        email: item.email,
        email_normalized: item.email.toLowerCase(),
        segment: "paystack_pending_reminder",
        email_key: emailKey,
        subject: item.step === "first" ? "Ton paiement JobRadar est-il bien passé ?" : "Toujours un souci avec ton paiement JobRadar ?",
        dry_run: false,
        status: "queued",
        metadata: { source: "jobradar_payment_reminder_send", payment_id: item.payment.id, reminder_step: item.step },
      })
      .select("id")
      .single();

    if (insertLogError || !logRow) {
      errors.push({ payment_id: item.payment.id, error: insertLogError?.message || "email_logs_insert_failed" });
      failedCount += 1;
      continue;
    }

    const { subject, html, text } = buildEmail(item.step, item.payment, resumeUrl);
    const result = await sendViaSendEmail({ to: item.email, subject, html, text, tag: emailKey, cronSecret });

    if (result.ok) {
      await supabase
        .from("email_logs")
        .update({ status: "sent", sent_at: new Date().toISOString(), resend_message_id: result.providerId })
        .eq("id", logRow.id);
      await supabase.from("billing_events").insert({
        user_id: item.payment.user_id,
        event_type: "payment_reminder_sent",
        payload: { payment_id: item.payment.id, reminder_step: item.step },
      });
      sentCount += 1;
    } else {
      await supabase
        .from("email_logs")
        .update({ status: "failed", metadata: { source: "jobradar_payment_reminder_send", error: result.error } })
        .eq("id", logRow.id);
      failedCount += 1;
      errors.push({ payment_id: item.payment.id, error: result.error || "unknown_error" });
    }
  }

  return json(200, {
    ok: true,
    dry_run: false,
    candidates_fetched: candidates.length,
    selected_count: selected.length,
    sent_count: sentCount,
    failed_count: failedCount,
    skipped_superseded: skippedSuperseded,
    skipped_unsubscribed: skippedUnsubscribed,
    skipped_too_soon_for_second: skippedTooSoonForSecond,
    skipped_already_handled: skippedAlreadyHandled,
    skipped_no_email: skippedNoEmail,
    first_delay_minutes: firstDelayMinutes,
    second_delay_hours: secondDelayHours,
    max_age_hours: maxAgeHours,
    limit,
    errors,
  });
});
