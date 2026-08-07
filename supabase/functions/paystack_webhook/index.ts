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

function paystackAmount(amountMinor: number, currency: string) {
  const upper = (currency || "").toUpperCase();
  if (upper === "XOF" || upper === "XAF") return amountMinor * 100;
  return amountMinor;
}

// ---------------------------------------------------------------------------
// BUSINESS (guides numeriques) - branche ajoutee pour router les paiements
// dont la reference commence par "biz_", sans toucher au chemin JobRadar
// existant plus bas (billing_payments / activate_pass_from_payment).
// ---------------------------------------------------------------------------

async function generateAccessToken(): Promise<{ raw: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hash };
}

async function handleBusinessPayment(
  admin: ReturnType<typeof createClient>,
  event: string,
  data: any,
  reference: string,
) {
  const { data: order, error: orderErr } = await admin
    .from("biz_orders")
    .select("id, customer_id, product_id, amount, currency, status")
    .eq("reference", reference)
    .maybeSingle();

  if (orderErr || !order) {
    console.warn("paystack_webhook[biz]: order not found", reference);
    return new Response("ok", { status: 200 });
  }

  // JR-0063 (07/08/2026) : re-verifie qu'un entitlement existe deja avant
  // de traiter ce paiement comme termine, pas seulement le statut. Avant ce
  // correctif, un webhook retente apres un statut "paid" mais un insert
  // d'entitlement en echec ne retentait jamais la creation d'entitlement.
  if (order.status === "paid") {
    const { data: existingEnt } = await admin
      .from("biz_entitlements")
      .select("id")
      .eq("order_id", order.id)
      .maybeSingle();
    if (existingEnt?.id) {
      return new Response("ok", { status: 200 });
    }
    // Paiement deja marque paye mais entitlement manquant : on retente sa
    // creation plutot que de court-circuiter silencieusement.
    const { data: product } = await admin
      .from("biz_products")
      .select("current_version")
      .eq("id", order.product_id)
      .maybeSingle();

    const { raw: accessTokenRaw, hash: accessTokenHash } = await generateAccessToken();
    const { error: entErr } = await admin.from("biz_entitlements").insert({
      order_id: order.id,
      customer_id: order.customer_id,
      product_id: order.product_id,
      product_version_at_purchase: product?.current_version ?? "v1",
      access_token_hash: accessTokenHash,
      status: "active",
    });
    if (entErr) {
      console.error("paystack_webhook[biz]: entitlement retry insert failed", entErr.message);
      return new Response("entitlement_failed", { status: 500 });
    }
    console.log("paystack_webhook[biz]: entitlement created on retry", { reference });
    return new Response("ok", { status: 200 });
  }

  const paystackStatus = (data?.status || "").toString().toLowerCase();
  const amount = typeof data?.amount === "number" ? data.amount : null;
  const currency = (data?.currency || "").toString();
  const expectedAmount = paystackAmount(order.amount, order.currency);

  if (amount !== null && amount !== expectedAmount) {
    await admin.from("biz_orders").update({ status: "failed" }).eq("id", order.id);
    return new Response("amount_mismatch", { status: 200 });
  }
  if (currency && currency.toUpperCase() !== order.currency.toUpperCase()) {
    await admin.from("biz_orders").update({ status: "failed" }).eq("id", order.id);
    return new Response("currency_mismatch", { status: 200 });
  }
  if (event !== "charge.success" || paystackStatus !== "success") {
    await admin.from("biz_orders").update({ status: "failed" }).eq("id", order.id);
    return new Response("ok", { status: 200 });
  }

  const paidAt = data?.paid_at ?? new Date().toISOString();
  await admin
    .from("biz_orders")
    .update({
      status: "paid",
      paid_at: paidAt,
      paystack_transaction_id: data?.id ? String(data.id) : null,
    })
    .eq("id", order.id);

  const { data: product } = await admin
    .from("biz_products")
    .select("current_version")
    .eq("id", order.product_id)
    .maybeSingle();

  const { raw: accessTokenRaw, hash: accessTokenHash } = await generateAccessToken();

  const { error: entErr } = await admin.from("biz_entitlements").insert({
    order_id: order.id,
    customer_id: order.customer_id,
    product_id: order.product_id,
    product_version_at_purchase: product?.current_version ?? "v1",
    access_token_hash: accessTokenHash,
    status: "active",
  });

  if (entErr) {
    console.error("paystack_webhook[biz]: entitlement insert failed", entErr.message);
    return new Response("entitlement_failed", { status: 500 });
  }

  // Prochaine etape (pas encore construite) : envoyer l'email de livraison
  // avec accessTokenRaw. Pour l'instant, l'entitlement existe en base mais
  // aucun email n'est envoye automatiquement.
  console.log("paystack_webhook[biz]: entitlement created", { reference });

  return new Response("ok", { status: 200 });
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

  if (reference.startsWith("biz_")) {
    return await handleBusinessPayment(admin, event, data, reference);
  }

  const { data: payment, error: payErr } = await admin
    .from("billing_payments")
    .select("id, user_id, status, amount_minor, currency, provider_payload")
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

  // JR-0063 (07/08/2026) : l'ancien garde-fou d'idempotence testait
  // uniquement payment.status === 'paid'/'paid_test' puis retournait "ok"
  // immediatement. Si activate_pass_from_payment echouait APRES que le
  // statut soit passe a "paid" (mais avant son propre succes), un retry du
  // webhook Paystack ne relancait plus jamais l'activation : le paiement
  // restait "paid" en base sans pass actif, invisible aussi pour
  // paystack_reconcile_pending (qui ne regarde que pending/ongoing).
  // Nouveau garde-fou : le seul etat "vraiment termine" est l'existence
  // d'une billing_subscriptions.source_payment_id pour ce paiement.
  const { data: existingSub } = await admin
    .from("billing_subscriptions")
    .select("id")
    .eq("source_payment_id", payment.id)
    .maybeSingle();

  if (existingSub?.id) {
    return new Response("ok", { status: 200 });
  }

  // Paiement deja marque paye (par un webhook precedent ou par
  // paystack_reconcile_pending) mais pass jamais active : on retente
  // uniquement l'activation, idempotente par construction (verifie
  // source_payment_id avant d'inserer), sans revalider montant/devise qui
  // l'ont deja ete pour passer ce paiement a "paid".
  if (payment.status === "paid" || payment.status === "paid_test") {
    const { error: subErr } = await admin.rpc("activate_pass_from_payment", {
      p_payment_id: payment.id,
    });
    if (subErr) {
      console.error("paystack_webhook: activate retry failed", subErr.message);
      // JR-0065 (07/08/2026) : paiement confirme paye mais pass jamais
      // active, y compris apres retry - le seul vrai cas "argent recu,
      // rien livre". Alerte critique, relayee par jobradar_monitor_alert_email.
      await admin.from("jobradar_health_events").insert({
        level: "critical",
        code: "paystack_pass_activation_failed",
        details: { payment_id: payment.id, reference, error: subErr.message, retry: true },
      });
      return new Response("activate_failed", { status: 500 });
    }
    return new Response("ok", { status: 200 });
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

  const paystackStatus = (data?.status || "").toString().toLowerCase();
  const amount = typeof data?.amount === "number" ? data.amount : null;
  const currency = (data?.currency || "").toString();

  const expectedAmount = paystackAmount(payment.amount_minor, payment.currency);
  if (amount !== null && amount !== expectedAmount) {
    await admin.rpc("billing_apply_payment_update", {
      p_payment_id: payment.id,
      p_status: "failed",
      p_failure_reason: "amount_mismatch",
      p_paid_at: null,
      p_payload_patch: { paystack_webhook: data },
      p_only_if_statuses: ["pending", "ongoing"],
    });
    return new Response("amount_mismatch", { status: 200 });
  }

  if (currency && currency.toUpperCase() !== payment.currency.toUpperCase()) {
    await admin.rpc("billing_apply_payment_update", {
      p_payment_id: payment.id,
      p_status: "failed",
      p_failure_reason: "currency_mismatch",
      p_paid_at: null,
      p_payload_patch: { paystack_webhook: data },
      p_only_if_statuses: ["pending", "ongoing"],
    });
    return new Response("currency_mismatch", { status: 200 });
  }

  if (event !== "charge.success" || paystackStatus !== "success") {
    await admin.rpc("billing_apply_payment_update", {
      p_payment_id: payment.id,
      p_status: paystackStatus || "failed",
      p_failure_reason: paystackStatus || "payment_not_successful",
      p_paid_at: null,
      p_payload_patch: { paystack_webhook: data },
      p_only_if_statuses: ["pending", "ongoing"],
    });

    await admin.from("billing_events").insert({
      event_type: "paystack_webhook_ignored",
      payload: { reference, event, status: paystackStatus },
    });

    return new Response("ok", { status: 200 });
  }

  const paidAt = data?.paid_at ?? null;
  const targetStatus = isTestMode ? "paid_test" : "paid";

  const { data: updatedPayment, error: updateErr } = await admin.rpc("billing_apply_payment_update", {
    p_payment_id: payment.id,
    p_status: targetStatus,
    p_failure_reason: null,
    p_paid_at: paidAt || new Date().toISOString(),
    p_payload_patch: { paystack_webhook: data, ...(isTestMode ? { test_mode: true } : {}) },
    p_only_if_statuses: ["pending", "ongoing"],
  });

  if (updateErr) {
    console.error("paystack_webhook: payment update failed", updateErr.message);
    return new Response("update_failed", { status: 500 });
  }

  // p_only_if_statuses protege billing_payments contre une double
  // transition concurrente (verrou "for update" dans la RPC) : si un
  // webhook concurrent ou paystack_reconcile_pending a deja resolu ce
  // paiement entre notre lecture et cet appel, updatedPayment reflete
  // simplement l'etat deja ecrit par l'autre appelant, sans erreur.
  if (hasActivePass) {
    await admin.from("billing_events").insert({
      user_id: payment.user_id,
      event_type:
        targetStatus === "paid_test"
          ? "paystack_webhook_paid_test_existing_pass"
          : "paystack_webhook_paid_existing_pass",
      payload: { reference, event },
    });
    return new Response("ok", { status: 200 });
  }

  const { error: subErr } = await admin.rpc("activate_pass_from_payment", {
    p_payment_id: payment.id,
  });

  if (subErr) {
    console.error("paystack_webhook: activate failed", subErr.message);
    // JR-0065 (07/08/2026) : meme alerte que le cas retry ci-dessus - le
    // paiement vient d'etre confirme paye, l'activation echoue immediatement.
    await admin.from("jobradar_health_events").insert({
      level: "critical",
      code: "paystack_pass_activation_failed",
      details: { payment_id: payment.id, reference, error: subErr.message, retry: false },
    });
    return new Response("activate_failed", { status: 500 });
  }

  await admin.from("billing_events").insert({
    event_type: targetStatus === "paid_test" ? "paystack_webhook_paid_test" : "paystack_webhook_paid",
    payload: { reference, event },
  });

  return new Response("ok", { status: 200 });
});
