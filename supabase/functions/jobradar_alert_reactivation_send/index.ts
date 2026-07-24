// Ajustement 3 (spec activation/paiement, session Cowork du 24/07/2026) :
// relance email UNIQUE (au maximum un email par utilisateur, jamais une
// séquence) pour les comptes créés avant l'Ajustement 1 (consentement en
// onboarding), qui ont donc pu atteindre l'aperçu sans jamais avoir eu
// l'occasion de créer une alerte gratuite.
//
// Volontairement séparée de marketing_lifecycle_planner /
// send_marketing_email_queue plutôt que d'étendre ces fonctions : ces
// dernières ont des portes de confirmation câblées en dur sur la seule
// campagne "non_paying_without_alert" / "create_alert_email_1" déjà en
// production (celle des 218 emails déjà envoyés, sans effet mesurable :
// cf audit du 24/07/2026). Les modifier pour une nouvelle campagne aurait
// un vrai risque de régression sur un mécanisme qui fonctionne déjà pour
// autre chose. Cette fonction est donc autonome : elle réutilise la vue
// déjà existante jobradar_marketing_reactivation_candidates (déjà prudente :
// exclut emails de test/suppression, utilisateurs payants ou abonnés actifs)
// filtrée sur le segment "non_paying_without_alert", mais applique SA
// PROPRE clé d'email (EMAIL_KEY ci-dessous, distincte de
// "create_alert_email_1") et SA PROPRE vérification "jamais plus d'un
// envoi" via email_logs, indépendante de l'ancienne campagne.
//
// Garde-fous :
// - dry_run par défaut (aucun envoi réel sans dry_run:false explicite ET
//   confirm === REACTIVATION_SEND_CONFIRM).
// - Limite dure par appel (MAX_LIMIT), pensée pour un déclenchement manuel
//   ou un cron à très faible volume quotidien.
// - Un utilisateur ne peut jamais recevoir plus d'un email sous cette clé :
//   une ligne email_logs (statut queued/sent/delivered/opened/clicked) fait
//   sortir définitivement le candidat, y compris entre deux appels.
// - Exclusion supplémentaire sur notification_prefs.unsubscribed_at (au
//   dessus de la vérification email_suppressions déjà faite par la vue).
// - Protégée par CRON_SECRET, jamais appelable anonymement.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const EMAIL_KEY = "jobradar_alert_reactivation_v1";
const SEGMENT_KEY = "non_paying_without_alert";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const OVERFETCH_FACTOR = 4;
const REACTIVATION_SEND_CONFIRM = "SEND_JOBRADAR_ALERT_REACTIVATION_V1";
// Statuts qui comptent comme "déjà pris en charge" pour ne jamais renvoyer
// deux fois sous cette même clé. "failed" est volontairement exclu : un
// échec technique (fournisseur indisponible, etc.) peut être retenté plus
// tard sans que ça viole la règle "au maximum un email".
const ALREADY_HANDLED_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "opened",
  "clicked",
];

type Body = {
  dry_run?: boolean | null;
  limit?: number | null;
  confirm?: string | null;
};

type Candidate = {
  user_id: string;
  email: string;
  email_normalized: string;
  registered_at: string | null;
  poste_recherche: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) v = v.slice(7).trim();
  return v;
}

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function normalizeBaseUrl(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function clampLimit(value: number | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function isAuthorized(req: Request) {
  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) return { ok: false, status: 500, error: "server_misconfigured" };

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();

  if (bearer === cronSecret || cronHeader === cronSecret) {
    return { ok: true, status: 200, error: null };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

function supabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing_supabase_env");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildEmail(candidate: Candidate) {
  const appBaseUrl = normalizeBaseUrl(
    clean(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com"
  );
  const feedUrl = `${appBaseUrl}/jobradar/feed`;
  const role = clean(candidate.poste_recherche) || "ton poste";

  const subject = "Ta recherche JobRadar est prête";
  const text =
    `Bonjour,\n\n` +
    `Tu avais commencé une recherche sur JobRadar pour "${role}", mais aucune alerte n'a encore été activée sur ton compte.\n\n` +
    `Active-la gratuitement en un clic, directement depuis ton espace : ${feedUrl}\n\n` +
    `Tu recevras par email les offres qui correspondent à tes critères. Tu peux la modifier ou la désactiver à tout moment.\n\n` +
    `— L'équipe JobRadar`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:520px;margin:0 auto;">
      <p>Bonjour,</p>
      <p>Tu avais commencé une recherche sur JobRadar pour <strong>${role}</strong>, mais aucune alerte n'a encore été activée sur ton compte.</p>
      <p>
        <a href="${feedUrl}" style="display:inline-block;background:#2451ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
          Activer mon alerte gratuite
        </a>
      </p>
      <p>Tu recevras par email les offres qui correspondent à tes critères. Tu peux la modifier ou la désactiver à tout moment depuis la page Alertes.</p>
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
    body: JSON.stringify({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      tag: EMAIL_KEY,
    }),
  });

  let data: Record<string, unknown> = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok) {
    return { ok: false, error: (data?.error as string) || "send_email_failed" };
  }
  return { ok: true, providerId: (data?.provider_id as string) || null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
  const limit = clampLimit(body.limit);

  if (!dryRun && body.confirm !== REACTIVATION_SEND_CONFIRM) {
    return json(400, {
      ok: false,
      error: "confirmation_missing",
      details:
        "Un envoi réel requiert dry_run:false et confirm:'" +
        REACTIVATION_SEND_CONFIRM +
        "'.",
    });
  }

  let supabase: SupabaseClient;
  try {
    supabase = supabaseAdmin();
  } catch (error) {
    return json(500, {
      ok: false,
      error: "server_misconfigured",
      details: error instanceof Error ? error.message : String(error),
    });
  }

  const { data: rawCandidates, error: candidatesError } = await supabase
    .from("jobradar_marketing_reactivation_candidates")
    .select("user_id,email,email_normalized,registered_at,poste_recherche")
    .eq("segment", SEGMENT_KEY)
    .order("registered_at", { ascending: true })
    .limit(Math.min(100, limit * OVERFETCH_FACTOR));

  if (candidatesError) {
    return json(500, {
      ok: false,
      error: "candidates_read_failed",
      details: candidatesError.message,
    });
  }

  const candidates = (rawCandidates ?? []) as Candidate[];

  const selected: Candidate[] = [];
  let skippedAlreadyHandled = 0;
  let skippedUnsubscribed = 0;

  for (const candidate of candidates) {
    if (selected.length >= limit) break;

    const { count: alreadyHandledCount, error: alreadyHandledError } = await supabase
      .from("email_logs")
      .select("*", { count: "exact", head: true })
      .eq("email_normalized", candidate.email_normalized)
      .eq("email_key", EMAIL_KEY)
      .in("status", ALREADY_HANDLED_STATUSES);

    if (alreadyHandledError) {
      return json(500, {
        ok: false,
        error: "email_logs_check_failed",
        details: alreadyHandledError.message,
      });
    }
    if ((alreadyHandledCount ?? 0) > 0) {
      skippedAlreadyHandled += 1;
      continue;
    }

    const { data: prefs, error: prefsError } = await supabase
      .from("notification_prefs")
      .select("unsubscribed_at")
      .eq("user_id", candidate.user_id)
      .maybeSingle();

    if (prefsError) {
      return json(500, {
        ok: false,
        error: "notification_prefs_check_failed",
        details: prefsError.message,
      });
    }
    if (prefs?.unsubscribed_at) {
      skippedUnsubscribed += 1;
      continue;
    }

    selected.push(candidate);
  }

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      email_key: EMAIL_KEY,
      segment_key: SEGMENT_KEY,
      candidates_fetched: candidates.length,
      would_send_count: selected.length,
      skipped_already_handled: skippedAlreadyHandled,
      skipped_unsubscribed: skippedUnsubscribed,
      limit,
    });
  }

  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  let sentCount = 0;
  let failedCount = 0;
  const errors: Array<{ user_id: string; error: string }> = [];

  for (const candidate of selected) {
    // On "réserve" la ligne avant l'envoi (statut queued) pour réduire la
    // fenêtre de double-envoi en cas d'appel concurrent, puis on la met à
    // jour selon le résultat réel de l'appel à send_email.
    const { data: logRow, error: insertLogError } = await supabase
      .from("email_logs")
      .insert({
        user_id: candidate.user_id,
        email: candidate.email,
        email_normalized: candidate.email_normalized,
        segment: SEGMENT_KEY,
        email_key: EMAIL_KEY,
        subject: "Ta recherche JobRadar est prête",
        dry_run: false,
        status: "queued",
        metadata: { source: "jobradar_alert_reactivation_send" },
      })
      .select("id")
      .single();

    if (insertLogError || !logRow) {
      errors.push({
        user_id: candidate.user_id,
        error: insertLogError?.message || "email_logs_insert_failed",
      });
      failedCount += 1;
      continue;
    }

    const { subject, html, text } = buildEmail(candidate);
    const result = await sendViaSendEmail({
      to: candidate.email,
      subject,
      html,
      text,
      cronSecret,
    });

    if (result.ok) {
      await supabase
        .from("email_logs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          resend_message_id: result.providerId,
        })
        .eq("id", logRow.id);
      sentCount += 1;
    } else {
      await supabase
        .from("email_logs")
        .update({
          status: "failed",
          metadata: {
            source: "jobradar_alert_reactivation_send",
            error: result.error,
          },
        })
        .eq("id", logRow.id);
      failedCount += 1;
      errors.push({ user_id: candidate.user_id, error: result.error || "unknown_error" });
    }
  }

  return json(200, {
    ok: true,
    dry_run: false,
    email_key: EMAIL_KEY,
    segment_key: SEGMENT_KEY,
    candidates_fetched: candidates.length,
    selected_count: selected.length,
    sent_count: sentCount,
    failed_count: failedCount,
    skipped_already_handled: skippedAlreadyHandled,
    skipped_unsubscribed: skippedUnsubscribed,
    limit,
    errors,
  });
});
