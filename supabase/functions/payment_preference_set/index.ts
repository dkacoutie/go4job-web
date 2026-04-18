import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractLocaleRegion,
  extractLocalesFromHeader,
  normalizePaymentMarket,
  resolveGeoCountryCode,
  resolvePaymentMarket,
} from "../_shared/paymentMarket.ts";

type PreferenceBody = {
  payment_preference?: string | null;
  locale?: string | null;
  locales?: string[] | null;
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

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function firstLocale(body: PreferenceBody, req: Request): string | null {
  const directLocale = clean(body.locale);
  if (directLocale) return directLocale;

  const preferredLocales = (body.locales ?? []).map((entry) => clean(entry)).filter(Boolean);
  if (preferredLocales.length > 0) return preferredLocales[0];

  return extractLocalesFromHeader(req.headers.get("accept-language"))[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!supabaseUrl || !anonKey) {
    return json(500, { ok: false, error: "missing_supabase_env" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json(401, { ok: false, error: "missing_auth" });

  let body: PreferenceBody = {};
  try {
    body = (await req.json()) as PreferenceBody;
  } catch {
    body = {};
  }

  const paymentPreference = normalizePaymentMarket(body.payment_preference);
  if (!paymentPreference) {
    return json(400, { ok: false, error: "invalid_payment_preference" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { ok: false, error: "invalid_user" });
  }

  const { error: rpcError } = await userClient.rpc("set_payment_preference", {
    pref: paymentPreference,
  });

  if (rpcError) {
    return json(500, {
      ok: false,
      error: "set_payment_preference_failed",
      message: rpcError.message,
    });
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("payment_preference, country_code")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return json(500, {
      ok: false,
      error: "profile_read_failed",
      message: profileError.message,
    });
  }

  const { data: lastPayment, error: lastPaymentError } = await userClient
    .from("billing_payments")
    .select("currency, status, paid_at, created_at")
    .in("status", ["paid", "paid_test"])
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastPaymentError) {
    return json(500, {
      ok: false,
      error: "billing_payments_read_failed",
      message: lastPaymentError.message,
    });
  }

  const locale = firstLocale(body, req);
  const resolution = resolvePaymentMarket({
    paymentPreference: profile?.payment_preference ?? paymentPreference,
    lastSuccessfulPaymentCurrency: lastPayment?.currency ?? null,
    profileCountryCode: profile?.country_code ?? null,
    geoCountryCode: resolveGeoCountryCode(req),
    locale,
    localeRegion: extractLocaleRegion(locale),
  });

  return json(200, { ok: true, resolution });
});
