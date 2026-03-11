import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type VerifyBody = {
  reference?: string | null;
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

function normalizeStatus(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (!s) return "unknown";
  return s;
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
  const isTestMode = paystackSecret.startsWith("sk_test_");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "missing_supabase_env" });
  }
  if (!paystackSecret) {
    return json(500, { ok: false, error: "missing_paystack_env" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json(401, { ok: false, error: "missing_auth" });

  let body: VerifyBody = {};
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    body = {};
  }

  const reference = clean(body.reference);
  if (!reference) return json(400, { ok: false, error: "missing_reference" });

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { ok: false, error: "invalid_user" });
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: payment, error: payErr } = await admin
    .from("billing_payments")
    .select("id, user_id, status, amount_minor, currency, provider_payment_id, provider_payload")
    .eq("provider_code", "paystack")
    .eq("provider_payment_id", reference)
    .maybeSingle();

  if (payErr || !payment) {
    return json(404, { ok: false, error: "payment_not_found" });
  }
  if (payment.user_id !== userId) {
    return json(403, { ok: false, error: "payment_forbidden" });
  }

  const nowIso = new Date().toISOString();
  const { data: activePass } = await admin
    .from("billing_subscriptions")
    .select("id, ends_at")
    .eq("user_id", payment.user_id)
    .eq("status", "active")
    .gt("ends_at", nowIso)
    .maybeSingle();
  const hasActivePass = Boolean(activePass?.id);

  if (payment.status === "paid") {
    if (hasActivePass) {
      return json(200, { ok: true, status: "already_active", activated: false });
    }
    const { data: sub } = await admin.rpc("activate_pass_from_payment", {
      p_payment_id: payment.id,
    });
    return json(200, { ok: true, status: "already_paid", subscription: sub || null });
  }
  if (payment.status === "paid_test") {
    return json(200, { ok: true, status: "paid_test", activated: false });
  }

  const resp = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    },
  );

  let verifyData: any = {};
  try {
    verifyData = await resp.json();
  } catch {
    verifyData = {};
  }

  if (!resp.ok || !verifyData?.status) {
    return json(502, { ok: false, error: "paystack_verify_failed", message: verifyData?.message });
  }

  const tx = verifyData?.data ?? {};
  const paystackStatus = normalizeStatus(tx?.status);
  const amount = typeof tx?.amount === "number" ? tx.amount : null;
  const currency = (tx?.currency ?? "").toString();

  const expectedAmount = paystackAmount(payment.amount_minor, payment.currency);
  if (amount !== null && amount !== expectedAmount) {
    await admin
      .from("billing_payments")
      .update({
        status: "failed",
        failure_reason: "amount_mismatch",
        updated_at: new Date().toISOString(),
        provider_payload: {
          ...(payment.provider_payload ?? {}),
          paystack_verify: tx,
        },
      })
      .eq("id", payment.id);

    return json(400, { ok: false, error: "amount_mismatch" });
  }

  if (currency && currency.toUpperCase() !== payment.currency.toUpperCase()) {
    await admin
      .from("billing_payments")
      .update({
        status: "failed",
        failure_reason: "currency_mismatch",
        updated_at: new Date().toISOString(),
        provider_payload: {
          ...(payment.provider_payload ?? {}),
          paystack_verify: tx,
        },
      })
      .eq("id", payment.id);

    return json(400, { ok: false, error: "currency_mismatch" });
  }

  if (paystackStatus !== "success") {
    await admin
      .from("billing_payments")
      .update({
        status: paystackStatus || "failed",
        failure_reason: paystackStatus || "payment_not_successful",
        updated_at: new Date().toISOString(),
        provider_payload: {
          ...(payment.provider_payload ?? {}),
          paystack_verify: tx,
        },
      })
      .eq("id", payment.id);

    return json(200, { ok: false, status: paystackStatus || "failed" });
  }

  const paidAt = tx?.paid_at ?? null;

  if (isTestMode) {
    await admin
      .from("billing_payments")
      .update({
        status: "paid_test",
        paid_at: paidAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        provider_payload: {
          ...(payment.provider_payload ?? {}),
          paystack_verify: tx,
          test_mode: true,
        },
      })
      .eq("id", payment.id);

    return json(200, { ok: true, status: "paid_test", activated: false });
  }

  await admin
    .from("billing_payments")
    .update({
      status: "paid",
      paid_at: paidAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provider_payload: {
        ...(payment.provider_payload ?? {}),
        paystack_verify: tx,
      },
    })
    .eq("id", payment.id);

  if (hasActivePass) {
    await admin.from("billing_events").insert({
      user_id: payment.user_id,
      event_type: "paystack_paid_existing_pass",
      payload: { reference, payment_id: payment.id },
    });
    return json(200, { ok: true, status: "already_active", activated: false });
  }

  const { data: sub, error: subErr } = await admin.rpc("activate_pass_from_payment", {
    p_payment_id: payment.id,
  });

  if (subErr) {
    return json(500, { ok: false, error: "activate_failed", message: subErr.message });
  }

  return json(200, { ok: true, status: "activated", subscription: sub });
});
