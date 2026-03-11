import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type CheckoutBody = {
  plan_code?: string | null;
  currency?: string | null;
  payment_method_type?: string | null;
  mode?: "manual_dev" | "pending_only" | null;
};

type ReceiptEmailPayload = {
  to: string;
  fullName?: string | null;
  planName: string;
  amountMinor: number;
  currency: string;
  paidAt?: string | null;
  activatedAt?: string | null;
  endsAt?: string | null;
  paymentRef?: string | null;
  accountEmail?: string | null;
  durationDays?: number | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ZERO_DECIMAL_CURRENCIES = new Set(["XOF", "XAF", "JPY", "KRW"]);

function currencyDecimals(code: string) {
  return ZERO_DECIMAL_CURRENCIES.has(code.toUpperCase()) ? 0 : 2;
}

function formatAmount(amountMinor: number, currency: string) {
  const decimals = currencyDecimals(currency);
  const amount = amountMinor / 10 ** decimals;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

function pickFirstName(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const trimmed = clean(candidate);
    if (!trimmed) continue;
    return trimmed.split(/\s+/)[0];
  }
  return "";
}

function formatFirstName(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  const lower = trimmed.toLocaleLowerCase("fr-FR");
  return lower.charAt(0).toLocaleUpperCase("fr-FR") + lower.slice(1);
}

function normalizeBaseUrl(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function buildReceiptEmail(payload: ReceiptEmailPayload) {
  const appBaseUrl = normalizeBaseUrl(
    clean(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com"
  );
  const supportEmail = clean(Deno.env.get("CONTACT_EMAIL")) || "contact@go4jobapp.com";
  const primaryUrl = `${appBaseUrl}/jobradar/feed`;
  const secondaryUrl = `${appBaseUrl}/pricing`;

  const rawFirstName = pickFirstName(payload.fullName, payload.accountEmail);
  const firstName = formatFirstName(rawFirstName);
  const greeting = firstName ? `Bonjour ${escapeHtml(firstName)},` : "Bonjour,";

  const amountLabel = formatAmount(payload.amountMinor, payload.currency);
  const currency = payload.currency.toUpperCase();
  const paidAt = formatDate(payload.paidAt);
  const activatedAt = formatDate(payload.activatedAt);
  const endsAt = formatDate(payload.endsAt);
  const paymentRef = payload.paymentRef || "—";
  const accountEmail = payload.accountEmail || "—";
  const durationLine = payload.durationDays
    ? `<div style="margin-bottom:6px;"><strong>Durée :</strong> ${payload.durationDays} jours</div>`
    : "";

  const subject = "Ton paiement JobRadar a été confirmé";
  const html = `
  <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#0b1420;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e6ebf2;padding:24px;">
      <div style="font-size:12px;letter-spacing:2px;font-weight:700;color:#0b5ed7;">JOBRADAR</div>
      <h1 style="margin:12px 0 8px;font-size:22px;line-height:1.3;">Ton paiement JobRadar a été confirmé</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">${greeting}</p>
      <p style="margin:0 0 10px;font-size:15px;line-height:1.7;">
        Nous confirmons la réception de ton paiement pour JobRadar. Ton pass est maintenant actif.
      </p>
      <p style="margin:0 0 16px;font-size:14.5px;line-height:1.7;color:#4b5563;">
        Cet email fait office de confirmation de paiement.
      </p>
      <div style="background:#f6f8fd;border-radius:12px;padding:16px;border:1px solid #eef2f8;">
        <div style="margin-bottom:6px;"><strong>Pass actif :</strong> ${escapeHtml(payload.planName)}</div>
        <div style="margin-bottom:6px;"><strong>Montant :</strong> ${amountLabel} ${escapeHtml(currency)}</div>
        <div style="margin-bottom:6px;"><strong>Date de paiement :</strong> ${escapeHtml(paidAt)}</div>
        <div style="margin-bottom:6px;"><strong>Date d'activation :</strong> ${escapeHtml(activatedAt)}</div>
        <div style="margin-bottom:6px;"><strong>Date d'expiration :</strong> ${escapeHtml(endsAt)}</div>
        ${durationLine}
        <div style="margin-bottom:6px;"><strong>Statut :</strong> Actif</div>
        <div><strong>Référence :</strong> ${escapeHtml(paymentRef)}</div>
      </div>
      <p style="margin:16px 0 18px;font-size:15px;line-height:1.7;">
        Tu peux maintenant accéder à toutes les fonctionnalités de JobRadar pendant la durée choisie.
      </p>
      <div style="margin-bottom:10px;">
        <a href="${primaryUrl}"
           style="display:inline-block;background:#0b5ed7;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          Voir mes offres
        </a>
      </div>
      <div style="margin-bottom:18px;">
        <a href="${secondaryUrl}" style="color:#0b5ed7;text-decoration:none;font-size:14px;">
          Voir mon abonnement
        </a>
      </div>
      <div style="font-size:13px;color:#5b6877;line-height:1.6;border-top:1px solid #eef2f8;padding-top:16px;">
        <div><strong>Référence de paiement :</strong> ${escapeHtml(paymentRef)}</div>
        <div><strong>Compte :</strong> ${escapeHtml(accountEmail)}</div>
        <div style="margin-top:10px;">Besoin d'aide ? Contacte-nous à ${escapeHtml(supportEmail)}.</div>
        <div style="margin-top:12px;">L'équipe Go4Job</div>
      </div>
    </div>
  </div>
  `;

  const textLines = [
    "Ton paiement JobRadar a été confirmé",
    "",
    firstName ? `Bonjour ${firstName},` : "Bonjour,",
    "",
    "Nous confirmons la réception de ton paiement pour JobRadar. Ton pass est maintenant actif.",
    "Cet email fait office de confirmation de paiement.",
    "",
    "Récapitulatif",
    `Pass actif : ${payload.planName}`,
    `Montant : ${amountLabel} ${currency}`,
    `Date de paiement : ${paidAt}`,
    `Date d'activation : ${activatedAt}`,
    `Date d'expiration : ${endsAt}`,
    ...(payload.durationDays ? [`Durée : ${payload.durationDays} jours`] : []),
    "Statut : Actif",
    `Référence : ${paymentRef}`,
    "",
    "Tu peux maintenant accéder à toutes les fonctionnalités de JobRadar pendant la durée choisie.",
    "",
    `Voir mes offres : ${primaryUrl}`,
    `Voir mon abonnement : ${secondaryUrl}`,
    "",
    `Référence de paiement : ${paymentRef}`,
    `Compte : ${accountEmail}`,
    `Besoin d'aide ? Contacte-nous à ${supportEmail}.`,
    "",
    "L'équipe Go4Job",
  ];

  const text = textLines.join("\n");

  return { subject, html, text, tag: "billing_receipt" };
}

async function sendReceiptEmail(payload: ReceiptEmailPayload) {
  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) return { ok: false, error: "missing_cron_secret" };

  if (!payload.to) return { ok: false, error: "missing_to" };

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  if (!supabaseUrl) return { ok: false, error: "missing_supabase_url" };

  const functionsBase =
    normalizeBaseUrl(clean(Deno.env.get("PUBLIC_FUNCTIONS_BASE"))) ||
    `${normalizeBaseUrl(supabaseUrl)}/functions/v1`;

  const { subject, html, text, tag } = buildReceiptEmail(payload);
  const resp = await fetch(`${functionsBase}/send_email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ to: payload.to, subject, html, text, tag }),
  });

  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok) {
    return { ok: false, error: data?.error || "send_email_failed", status: resp.status };
  }

  return { ok: true, provider_id: data?.id || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "missing_supabase_env" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json(401, { ok: false, error: "missing_auth" });

  let body: CheckoutBody = {};
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    // body optional
  }

  const planCode = clean(body.plan_code);
  const currency = clean(body.currency || "XOF").toUpperCase();
  const paymentMethod = clean(body.payment_method_type || "any");
  const mode = body.mode ?? "manual_dev";

  if (!planCode) return json(400, { ok: false, error: "missing_plan_code" });

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { ok: false, error: "invalid_user" });
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: settings } = await admin
    .from("billing_settings")
    .select("payments_enabled, maintenance_message")
    .maybeSingle();

  if (settings && settings.payments_enabled === false) {
    return json(403, {
      ok: false,
      error: "payments_disabled",
      message: settings.maintenance_message || "Paiements temporairement indisponibles.",
    });
  }

  const { data: plan, error: planErr } = await admin
    .from("billing_plans")
    .select("id, code, name, duration_days, is_active")
    .eq("code", planCode)
    .maybeSingle();

  if (planErr || !plan) return json(404, { ok: false, error: "plan_not_found" });
  if (plan.is_active === false) return json(400, { ok: false, error: "plan_inactive" });

  const { data: price, error: priceErr } = await admin
    .from("billing_plan_prices")
    .select("id, amount_minor, currency, is_active, payment_method_type, country_group")
    .eq("plan_id", plan.id)
    .eq("currency", currency)
    .eq("is_active", true)
    .maybeSingle();

  if (priceErr || !price) return json(404, { ok: false, error: "price_not_found" });

  const nowIso = new Date().toISOString();
  const { data: activePass } = await admin
    .from("billing_subscriptions")
    .select("id, ends_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("ends_at", nowIso)
    .maybeSingle();

  if (activePass?.id) {
    return json(409, {
      ok: false,
      error: "pass_already_active",
      message: "Ton accès JobRadar est déjà actif.",
      ends_at: activePass.ends_at,
    });
  }

  const paymentStatus = mode === "pending_only" ? "pending" : "paid";
  const paidAt = paymentStatus === "paid" ? nowIso : null;

  const { data: payment, error: payErr } = await admin
    .from("billing_payments")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      amount_minor: price.amount_minor,
      currency: price.currency,
      provider_code: "manual_dev",
      provider_payment_id: null,
      payment_method_type: paymentMethod || price.payment_method_type || "any",
      status: paymentStatus,
      provider_payload: {
        mode,
        plan_code: plan.code,
        price_id: price.id,
        country_group: price.country_group,
      },
      paid_at: paidAt,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, status, amount_minor, currency, paid_at, provider_payment_id")
    .single();

  if (payErr || !payment) {
    return json(500, { ok: false, error: "payment_create_failed", message: payErr?.message });
  }

  if (payment.status !== "paid") {
    return json(200, { ok: true, status: "payment_pending", payment_id: payment.id });
  }

  const { data: sub, error: subErr } = await admin.rpc("activate_pass_from_payment", {
    p_payment_id: payment.id,
  });

  if (subErr) {
    return json(500, { ok: false, error: "activate_failed", message: subErr.message });
  }

  let emailStatus: string | null = null;
  let emailError: string | null = null;
  let emailProviderId: string | null = null;

  const { data: alreadySent } = await admin
    .from("billing_events")
    .select("id")
    .eq("event_type", "payment_receipt_email_sent")
    .eq("payload->>payment_id", payment.id)
    .maybeSingle();

  const receiptEmailsEnabled = false;

  if (!alreadySent && receiptEmailsEnabled) {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();

    const receipt = await sendReceiptEmail({
      to: userData.user.email ?? "",
      fullName: profile?.full_name ?? (userData.user.user_metadata as any)?.full_name ?? null,
      planName: plan.name,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
      paidAt: payment.paid_at,
      activatedAt: sub?.activated_at ?? sub?.starts_at ?? null,
      endsAt: sub?.ends_at ?? null,
      paymentRef: payment.provider_payment_id ?? payment.id,
      accountEmail: userData.user.email ?? null,
      durationDays: plan.duration_days ?? null,
    });

    if (receipt.ok) {
      emailStatus = "sent";
      emailProviderId = receipt.provider_id || null;
      await admin.from("billing_events").insert({
        user_id: userId,
        event_type: "payment_receipt_email_sent",
        payload: {
          payment_id: payment.id,
          provider_id: emailProviderId,
          to: userData.user.email ?? null,
        },
      });
    } else {
      emailStatus = "failed";
      emailError = receipt.error || "send_failed";
      await admin.from("billing_events").insert({
        user_id: userId,
        event_type: "payment_receipt_email_failed",
        payload: {
          payment_id: payment.id,
          error: emailError,
          to: userData.user.email ?? null,
        },
      });
    }
  } else {
    emailStatus = alreadySent ? "skipped" : "disabled";
  }

  return json(200, {
    ok: true,
    status: "activated",
    payment_id: payment.id,
    subscription: sub,
    email: { status: emailStatus, error: emailError, provider_id: emailProviderId },
  });
});
