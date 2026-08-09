// Ajustement 6 (spec activation/paiement, session Cowork du 24/07/2026) :
// filet de sécurité serveur pour les paiements Paystack restés en statut
// non final (pending/ongoing) alors que l'utilisateur n'est peut-être
// jamais revenu sur la page pour déclencher paystack_verify — cas fréquent
// en mobile money, où la confirmation se fait sur le téléphone et peut
// arriver après que l'utilisateur ait fermé l'onglet.
//
// Garde-fous explicitement demandés :
// - Webhook Paystack + paystack_verify (au retour utilisateur) restent les
//   chemins principaux. Cette fonction est un filet, pas un remplacement :
//   elle ne vérifie QUE les paiements pending/ongoing récents (fenêtre
//   MAX_AGE_HOURS, configurable par appel), jamais l'historique ancien.
// - N'écrase jamais un statut déjà final : toute mise à jour de statut
//   passe par billing_apply_payment_update(..., p_only_if_statuses:
//   ['pending','ongoing']), qui ne transitionne que si le statut est
//   encore l'un de ceux-là au moment de l'update (protège contre une
//   course avec le webhook ou un paystack_verify concurrent).
// - N'active jamais un pass sans confirmation directe de Paystack lui-même
//   (même appel GET /transaction/verify/:reference que paystack_verify.ts,
//   jamais une simple présence de référence).
// - N'active jamais un pass deux fois : activate_pass_from_payment est déjà
//   idempotente (vérifie source_payment_id avant d'insérer).
// - Ne marque JAMAIS un paiement "expired" unilatéralement après un délai :
//   si Paystack ne confirme ni succès ni échec, le paiement reste tel
//   quel ; seul le nombre de tentatives et la date de dernière
//   vérification sont enregistrés (dans provider_payload, pas de nouvelle
//   colonne). Au-delà de MAX_ATTEMPTS, le paiement sort simplement de la
//   sélection automatique (aucune écriture de statut inventée).
// - dry_run par défaut : aucune écriture sans dry_run:false explicite.
// - Protégée par CRON_SECRET, jamais appelable anonymement.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const DEFAULT_MAX_AGE_HOURS = 48;
const MAX_AGE_HOURS_CEILING = 24 * 14; // 14 jours, garde-fou dur même si mal configuré
// Rattrapage ponctuel : des paiements restés non finaux bien au-delà de la
// fenêtre habituelle (23 dossiers de mars 2026 découverts le 28/07) ne sont
// structurellement pas atteignables par le cron. Ce plafond élargi n'est
// utilisable qu'avec allow_backfill explicite, jamais par défaut.
const MAX_AGE_HOURS_BACKFILL_CEILING = 24 * 200;
const DEFAULT_MAX_ATTEMPTS = 10;
const NON_FINAL_STATUSES = ["pending", "ongoing"];

type Body = {
  dry_run?: boolean | null;
  limit?: number | null;
  max_age_hours?: number | null;
  max_attempts?: number | null;
  /**
   * Interroge Paystack pour chaque candidat et rapporte le statut distant
   * SANS rien écrire. Sert à décider en connaissance de cause avant une
   * réconciliation réelle : on veut savoir combien de personnes ont payé
   * sans recevoir leur pass avant de toucher à la facturation.
   */
  probe?: boolean | null;
  /** Autorise la fenêtre élargie. Sans ce drapeau, le plafond reste à 14 jours. */
  allow_backfill?: boolean | null;
};

type PaymentRow = {
  id: string;
  user_id: string;
  plan_id: string;
  amount_minor: number;
  currency: string;
  provider_payment_id: string;
  status: string;
  provider_payload: Record<string, unknown> | null;
  created_at: string;
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

function normalizeStatus(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  return s || "unknown";
}

function clamp(value: number | null | undefined, fallback: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
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

  const probe = body.probe === true;
  // Un probe n'écrit jamais, quel que soit dry_run.
  const dryRun = probe ? true : body.dry_run !== false;
  const limit = clamp(body.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const allowBackfill = body.allow_backfill === true;
  const maxAgeHours = clamp(
    body.max_age_hours,
    DEFAULT_MAX_AGE_HOURS,
    allowBackfill ? MAX_AGE_HOURS_BACKFILL_CEILING : MAX_AGE_HOURS_CEILING,
  );
  const maxAttempts = clamp(body.max_attempts, DEFAULT_MAX_ATTEMPTS, 50);

  const paystackSecret = cleanSecret(Deno.env.get("PAYSTACK_SECRET_KEY"));
  if (!paystackSecret) {
    return json(500, { ok: false, error: "missing_paystack_env" });
  }
  const isTestMode = paystackSecret.startsWith("sk_test_");

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

  const minCreatedAt = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

  const { data: rawCandidates, error: candidatesError } = await supabase
    .from("billing_payments")
    .select("id,user_id,plan_id,amount_minor,currency,provider_payment_id,status,provider_payload,created_at")
    .eq("provider_code", "paystack")
    .in("status", NON_FINAL_STATUSES)
    .gte("created_at", minCreatedAt)
    .order("created_at", { ascending: true })
    .limit(Math.min(100, limit * 3));

  if (candidatesError) {
    return json(500, {
      ok: false,
      error: "candidates_read_failed",
      details: candidatesError.message,
    });
  }

  const allCandidates = (rawCandidates ?? []) as PaymentRow[];
  const candidates = allCandidates
    .filter((row) => {
      const attempts = Number(row.provider_payload?.reconciliation_attempts ?? 0);
      return Number.isFinite(attempts) ? attempts < maxAttempts : true;
    })
    .slice(0, limit);
  const cappedCount = allCandidates.length - candidates.length;

  if (probe) {
    // Lecture seule stricte : on interroge Paystack sur chaque référence et
    // on rapporte le statut distant. Aucun appel à billing_apply_payment_update
    // ni à activate_pass_from_payment.
    const findings: Array<Record<string, unknown>> = [];
    let remoteSuccess = 0;
    let remoteFailed = 0;
    let remoteStillPending = 0;
    let remoteUnreadable = 0;

    for (const payment of candidates) {
      let paystackStatus = "unreadable";
      let paidAt: string | null = null;
      let remoteAmount: number | null = null;

      try {
        const resp = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.provider_payment_id)}`,
          { headers: { Authorization: `Bearer ${paystackSecret}` } },
        );
        const verifyData = await resp.json().catch(() => ({} as any));
        if (resp.ok && verifyData?.status) {
          const tx = verifyData?.data ?? {};
          paystackStatus = normalizeStatus(tx?.status);
          paidAt = tx?.paid_at ?? null;
          remoteAmount = typeof tx?.amount === "number" ? tx.amount : null;
        }
      } catch {
        paystackStatus = "unreadable";
      }

      if (paystackStatus === "success") remoteSuccess += 1;
      else if (paystackStatus === "unreadable") remoteUnreadable += 1;
      else if (["pending", "ongoing", "queued"].includes(paystackStatus)) remoteStillPending += 1;
      else remoteFailed += 1;

      findings.push({
        payment_id: payment.id,
        created_at: payment.created_at,
        local_status: payment.status,
        paystack_status: paystackStatus,
        paid_at: paidAt,
        amount_minor: payment.amount_minor,
        currency: payment.currency,
        remote_amount: remoteAmount,
      });
    }

    return json(200, {
      ok: true,
      probe: true,
      dry_run: true,
      wrote_nothing: true,
      candidates_found: allCandidates.length,
      checked_count: candidates.length,
      capped_no_resolution: cappedCount,
      remote_success: remoteSuccess,
      remote_failed: remoteFailed,
      remote_still_pending: remoteStillPending,
      remote_unreadable: remoteUnreadable,
      max_age_hours: maxAgeHours,
      allow_backfill: allowBackfill,
      limit,
      findings,
    });
  }

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      candidates_found: allCandidates.length,
      would_check_count: candidates.length,
      capped_no_resolution: cappedCount,
      max_age_hours: maxAgeHours,
      max_attempts: maxAttempts,
      limit,
    });
  }

  let checkedCount = 0;
  let resolvedPaidCount = 0;
  let resolvedFailedCount = 0;
  let stillPendingCount = 0;
  const errors: Array<{ payment_id: string; error: string }> = [];

  for (const payment of candidates) {
    checkedCount += 1;
    const attemptsBefore = Number(payment.provider_payload?.reconciliation_attempts ?? 0) || 0;
    const nowIso = new Date().toISOString();

    let verifyData: any = {};
    try {
      const resp = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.provider_payment_id)}`,
        { headers: { Authorization: `Bearer ${paystackSecret}` } },
      );
      verifyData = await resp.json().catch(() => ({}));
      if (!resp.ok || !verifyData?.status) {
        // Erreur de communication avec Paystack : on enregistre juste la
        // tentative, sans toucher au statut. Ce sera retenté au prochain
        // passage (dans la limite de max_attempts).
        await supabase.rpc("billing_apply_payment_update", {
          p_payment_id: payment.id,
          p_status: null,
          p_failure_reason: null,
          p_paid_at: null,
          p_payload_patch: {
            reconciliation_attempts: attemptsBefore + 1,
            last_verified_at: nowIso,
            last_reconciliation_error: "paystack_verify_call_failed",
          },
          p_only_if_statuses: null,
        });
        stillPendingCount += 1;
        continue;
      }
    } catch (fetchError) {
      errors.push({
        payment_id: payment.id,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
      continue;
    }

    const tx = verifyData?.data ?? {};
    const paystackStatus = normalizeStatus(tx?.status);

    if (paystackStatus === "success") {
      const targetStatus = isTestMode ? "paid_test" : "paid";
      const { data: updated, error: updateError } = await supabase.rpc(
        "billing_apply_payment_update",
        {
          p_payment_id: payment.id,
          p_status: targetStatus,
          p_failure_reason: null,
          p_paid_at: tx?.paid_at || nowIso,
          p_payload_patch: {
            paystack_reconcile: tx,
            confirmation_path: "scheduled_reconciliation",
            reconciliation_attempts: attemptsBefore + 1,
            last_verified_at: nowIso,
          },
          p_only_if_statuses: NON_FINAL_STATUSES,
        },
      );

      if (updateError) {
        errors.push({ payment_id: payment.id, error: updateError.message });
        continue;
      }

      resolvedPaidCount += 1;

      // updated.status ne vaut targetStatus que si la transition a bien eu
      // lieu (guard p_only_if_statuses) : si le webhook ou un
      // paystack_verify concurrent avait déjà résolu ce paiement entre la
      // lecture des candidats et ici, on ne l'active pas une seconde fois.
      if (updated && (updated.status === "paid" || updated.status === "paid_test")) {
        const { error: activateError } = await supabase.rpc("activate_pass_from_payment", {
          p_payment_id: payment.id,
        });
        if (activateError) {
          errors.push({ payment_id: payment.id, error: `activate_failed: ${activateError.message}` });
        }
      }
      continue;
    }

    if (paystackStatus === "pending" || paystackStatus === "ongoing" || paystackStatus === "queued") {
      await supabase.rpc("billing_apply_payment_update", {
        p_payment_id: payment.id,
        p_status: null,
        p_failure_reason: null,
        p_paid_at: null,
        p_payload_patch: {
          paystack_reconcile: tx,
          reconciliation_attempts: attemptsBefore + 1,
          last_verified_at: nowIso,
        },
        p_only_if_statuses: null,
      });
      stillPendingCount += 1;
      continue;
    }

    // Statut Paystack clairement négatif (failed, abandoned, reversed...) :
    // on répercute ce statut réel, jamais un statut inventé, et toujours
    // sous la même garde p_only_if_statuses.
    const { error: failUpdateError } = await supabase.rpc("billing_apply_payment_update", {
      p_payment_id: payment.id,
      p_status: paystackStatus,
      p_failure_reason: paystackStatus,
      p_paid_at: null,
      p_payload_patch: {
        paystack_reconcile: tx,
        confirmation_path: "scheduled_reconciliation",
        reconciliation_attempts: attemptsBefore + 1,
        last_verified_at: nowIso,
      },
      p_only_if_statuses: NON_FINAL_STATUSES,
    });
    if (failUpdateError) {
      errors.push({ payment_id: payment.id, error: failUpdateError.message });
    } else {
      resolvedFailedCount += 1;
    }
  }

  return json(200, {
    ok: true,
    dry_run: false,
    candidates_found: allCandidates.length,
    checked_count: checkedCount,
    resolved_paid_count: resolvedPaidCount,
    resolved_failed_count: resolvedFailedCount,
    still_pending_count: stillPendingCount,
    capped_no_resolution: cappedCount,
    max_age_hours: maxAgeHours,
    max_attempts: maxAttempts,
    limit,
    errors,
  });
});
