import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha512Hex(secret: string, payload: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const paystackSecret = cleanSecret(Deno.env.get("PAYSTACK_SECRET_KEY"));
  const webhookUrl = clean(Deno.env.get("PAYSTACK_WEBHOOK_URL"));
  const isTestMode = paystackSecret.startsWith("sk_test_");

  if (!supabaseUrl || !serviceKey || !paystackSecret) {
    return new Response("server_misconfigured", { status: 500 });
  }
  if (!webhookUrl) {
    console.warn("paystack_webhook: missing PAYSTACK_WEBHOOK_URL");
  }

  const signature = clean(req.headers.get("x-paystack-signature"));
  const rawBody = await req.text();

  if (!signature) {
    return new Response("missing_signature", { status: 400 });
  }

  const expected = await hmacSha512Hex(paystackSecret, rawBody);
  if (!timingSafeEqual(signature, expected)) {
    console.warn("paystack_webhook: invalid signature");
    return new Response("invalid_signature", { status: 400 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid_json", { status: 400 });
  }

  const event = payload?.event || "";
  const data = payload?.data || {};
  const reference = data?.reference || "";

  if (!reference) {
    return new Response("no_reference", { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: payment, error: payErr } = await admin
    .from("billing_payments")
    .select("id, status, amount_minor, currency, provider_payload")
    .eq("provider_code", "paystack")
    .eq("provider_payment_id", reference)
    .maybeSingle();

  if (payErr || !payment) {
    console.warn("paystack_webhook: payment not found", reference);
    await admin.from("billing_events").insert({
      event_type: "paystack_webhook_unknown_reference",
      payload: { reference, event },
    });
    return new Response("ok", { status: 200 });
  }

  if (payment.status === "paid" || payment.status === "paid_test") {
    return new Response("ok", { status: 200 });
  }

  const paystackStatus = (data?.status || "").toString().toLowerCase();
  const amount = typeof data?.amount === "number" ? data.amount : null;
  const currency = (data?.currency || "").toString();

  if (amount !== null && amount !== payment.amount_minor) {
    await admin
      .from("billing_payments")
      .update({
        status: "failed",
        failure_reason: "amount_mismatch",
        updated_at: new Date().toISOString(),
        provider_payload: { ...(payment.provider_payload ?? {}), paystack_webhook: data },
      })
      .eq("id", payment.id);
    return new Response("amount_mismatch", { status: 200 });
  }

  if (currency && currency.toUpperCase() !== payment.currency.toUpperCase()) {
    await admin
      .from("billing_payments")
      .update({
        status: "failed",
        failure_reason: "currency_mismatch",
        updated_at: new Date().toISOString(),
        provider_payload: { ...(payment.provider_payload ?? {}), paystack_webhook: data },
      })
      .eq("id", payment.id);
    return new Response("currency_mismatch", { status: 200 });
  }

  if (event !== "charge.success" || paystackStatus !== "success") {
    await admin
      .from("billing_payments")
      .update({
        status: paystackStatus || "failed",
        failure_reason: paystackStatus || "payment_not_successful",
        updated_at: new Date().toISOString(),
        provider_payload: { ...(payment.provider_payload ?? {}), paystack_webhook: data },
      })
      .eq("id", payment.id);

    await admin.from("billing_events").insert({
      event_type: "paystack_webhook_ignored",
      payload: { reference, event, status: paystackStatus },
    });

    return new Response("ok", { status: 200 });
  }

  const paidAt = data?.paid_at ?? null;

  if (isTestMode) {
    await admin
      .from("billing_payments")
      .update({
        status: "paid_test",
        paid_at: paidAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        provider_payload: { ...(payment.provider_payload ?? {}), paystack_webhook: data, test_mode: true },
      })
      .eq("id", payment.id);

    await admin.from("billing_events").insert({
      event_type: "paystack_webhook_paid_test",
      payload: { reference, event },
    });

    return new Response("ok", { status: 200 });
  }

  await admin
    .from("billing_payments")
    .update({
      status: "paid",
      paid_at: paidAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provider_payload: { ...(payment.provider_payload ?? {}), paystack_webhook: data },
    })
    .eq("id", payment.id);

  const { error: subErr } = await admin.rpc("activate_pass_from_payment", {
    p_payment_id: payment.id,
  });

  if (subErr) {
    console.error("paystack_webhook: activate failed", subErr.message);
    return new Response("activate_failed", { status: 500 });
  }

  await admin.from("billing_events").insert({
    event_type: "paystack_webhook_paid",
    payload: { reference, event },
  });

  return new Response("ok", { status: 200 });
});
