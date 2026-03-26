import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type InitBody = {
  plan_code?: string | null;
  currency?: string | null;
  payment_method_type?: string | null;
  partner_referral_code?: string | null;
  partner_referral_captured_at?: string | null;
  partner_referral_source_path?: string | null;
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

function normalizeBaseUrl(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function normalizePartnerReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = raw.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().trim();
  if (!normalized) return null;
  if (normalized.length < 4 || normalized.length > 32) return null;

  return normalized;
}

function buildReference(planCode: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `g4j_${planCode}_${suffix}`;
}

function paystackAmount(amountMinor: number, currency: string) {
  const upper = (currency || "").toUpperCase();
  if (upper === "XOF" || upper === "XAF") return amountMinor * 100;
  return amountMinor;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const paystackSecret = cleanSecret(Deno.env.get("PAYSTACK_SECRET_KEY"));
  const callbackUrl = normalizeBaseUrl(clean(Deno.env.get("PAYSTACK_CALLBACK_URL")));
  const webhookUrl = normalizeBaseUrl(clean(Deno.env.get("PAYSTACK_WEBHOOK_URL")));
  const currencyDefault = clean(Deno.env.get("PAYSTACK_CURRENCY")) || "XOF";
  const isTestMode = paystackSecret.startsWith("sk_test_");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "missing_supabase_env" });
  }
  if (!paystackSecret || !callbackUrl) {
    return json(500, { ok: false, error: "missing_paystack_env" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json(401, { ok: false, error: "missing_auth" });

  let body: InitBody = {};
  try {
    body = (await req.json()) as InitBody;
  } catch {
    body = {};
  }

  const planCode = clean(body.plan_code);
  const currency = clean(body.currency || currencyDefault).toUpperCase();
  const paymentMethod = clean(body.payment_method_type || "any");
  const partnerReferralCode = normalizePartnerReferralCode(body.partner_referral_code);
  const partnerReferralCapturedAt = clean(body.partner_referral_captured_at) || null;
  const partnerReferralSourcePath = clean(body.partner_referral_source_path) || null;

  if (!planCode) return json(400, { ok: false, error: "missing_plan_code" });

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { ok: false, error: "invalid_user" });
  const userId = userData.user.id;
  const userEmail = (userData.user.email ?? "").trim();
  if (!userEmail) return json(400, { ok: false, error: "missing_user_email" });

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
      message: "Ton acces JobRadar est deja actif.",
      ends_at: activePass.ends_at,
    });
  }

  const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: pendingPayment } = await admin
    .from("billing_payments")
    .select("id, provider_payment_id, provider_payload, created_at")
    .eq("user_id", userId)
    .eq("provider_code", "paystack")
    .eq("status", "pending")
    .gte("created_at", recentCutoff)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (pendingPayment?.id) {
    const existingAuthUrl =
      (pendingPayment.provider_payload as { paystack_init?: { authorization_url?: string } } | null)
        ?.paystack_init?.authorization_url ?? null;
    return json(409, {
      ok: false,
      error: "payment_pending",
      message: "Un paiement Paystack est deja en cours. Termine-le avant d'en demarrer un autre.",
      reference: pendingPayment.provider_payment_id ?? null,
      authorization_url: existingAuthUrl,
    });
  }

  const { data: recentTestPayment } = await admin
    .from("billing_payments")
    .select("id, provider_payment_id, updated_at")
    .eq("user_id", userId)
    .eq("provider_code", "paystack")
    .eq("status", "paid_test")
    .gte("updated_at", recentCutoff)
    .order("updated_at", { ascending: false })
    .maybeSingle();

  if (recentTestPayment?.id) {
    return json(409, {
      ok: false,
      error: "test_payment_recent",
      message: "Un paiement test recent existe deja. Attends quelques minutes avant de recommencer.",
      reference: recentTestPayment.provider_payment_id ?? null,
    });
  }

  const reference = buildReference(plan.code);
  if (!webhookUrl) {
    console.warn("paystack_initialize: missing PAYSTACK_WEBHOOK_URL");
  }

  const partnerReferral =
    partnerReferralCode
      ? {
          code: partnerReferralCode,
          captured_at: partnerReferralCapturedAt,
          source_path: partnerReferralSourcePath,
          source: "frontend_capture",
        }
      : null;

  const basePayload = {
    plan_code: plan.code,
    plan_name: plan.name,
    price_id: price.id,
    country_group: price.country_group,
    reference,
    callback_url: callbackUrl,
    webhook_url: webhookUrl || null,
    test_mode: isTestMode,
    partner_referral: partnerReferral,
  };

  const { data: payment, error: payErr } = await admin
    .from("billing_payments")
    .insert({
      user_id: userId,
      plan_id: plan.id,
      amount_minor: price.amount_minor,
      currency: price.currency,
      provider_code: "paystack",
      provider_payment_id: reference,
      payment_method_type: paymentMethod || price.payment_method_type || "any",
      status: "pending",
      provider_payload: basePayload,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, amount_minor, currency")
    .single();

  if (payErr || !payment) {
    return json(500, { ok: false, error: "payment_create_failed", message: payErr?.message });
  }

  const initPayload = {
    email: userEmail,
    amount: paystackAmount(payment.amount_minor, payment.currency),
    currency: payment.currency,
    reference,
    callback_url: callbackUrl,
    metadata: {
      user_id: userId,
      payment_id: payment.id,
      plan_code: plan.code,
      plan_name: plan.name,
      price_id: price.id,
      source: "jobradar",
      partner_referral_code: partnerReferralCode,
      partner_referral_source_path: partnerReferralSourcePath,
    },
  };

  const resp = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(initPayload),
  });

  let initData: any = {};
  try {
    initData = await resp.json();
  } catch {
    initData = {};
  }

  if (!resp.ok || !initData?.status) {
    await admin
      .from("billing_payments")
      .update({
        status: "failed",
        failure_reason: initData?.message || "paystack_init_failed",
        updated_at: new Date().toISOString(),
        provider_payload: { ...basePayload, paystack_init_error: initData },
      })
      .eq("id", payment.id);

    return json(502, {
      ok: false,
      error: "paystack_init_failed",
      message: initData?.message || "Paystack initialization failed.",
    });
  }

  const paystackData = initData?.data ?? {};

  await admin
    .from("billing_payments")
    .update({
      provider_payload: {
        ...basePayload,
        paystack_init: {
          authorization_url: paystackData?.authorization_url || null,
          access_code: paystackData?.access_code || null,
          reference: paystackData?.reference || reference,
          metadata: initPayload.metadata,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  return json(200, {
    ok: true,
    reference: paystackData?.reference || reference,
    authorization_url: paystackData?.authorization_url || null,
    access_code: paystackData?.access_code || null,
    payment_id: payment.id,
  });
});
