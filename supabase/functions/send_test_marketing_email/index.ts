import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  listMarketingEmailKeys,
  renderMarketingEmail,
  type MarketingEmailKey,
} from "../_shared/marketingEmails/templates.ts";

type SendTestMarketingEmailBody = {
  email_key?: string | null;
  to?: string | null;
  poste_recherche?: string | null;
  allow_send?: boolean | null;
};

type InsertedUnsubscribeToken = {
  token: string;
};

type EmailLogPayload = {
  email: string;
  email_normalized: string;
  segment: string;
  email_key: string;
  template_version: string;
  subject: string;
  dry_run: boolean;
  status: "sent" | "failed";
  resend_message_id: string | null;
  sent_at?: string;
  metadata: Record<string, unknown>;
};

const ALLOWED_INTERNAL_RECIPIENTS = new Set([
  "infos.go4job@gmail.com",
  "d.kacoutie@gmail.com",
]);

const EMAIL_KEY_TO_SEGMENT: Record<MarketingEmailKey, string> = {
  payment_attempt_no_success_email_1: "payment_attempt_no_success",
  interested_no_payment_attempt_email_1: "interested_no_payment_attempt",
  buyer_feedback_email_1: "buyer_feedback",
};

const UNSUBSCRIBE_BASE_URL =
  "https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/email_unsubscribe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function isAuthorized(req: Request) {
  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) {
    return { ok: false, status: 500, error: "server_misconfigured" };
  }

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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isMarketingEmailKey(value: string): value is MarketingEmailKey {
  return listMarketingEmailKeys().includes(value as MarketingEmailKey);
}

async function insertEmailLog(
  supabase: SupabaseClient,
  payload: EmailLogPayload,
) {
  const { error } = await supabase.from("email_logs").insert(payload);

  if (error && error.code === "23505") {
    await supabase
      .from("email_logs")
      .update(payload)
      .eq("email_normalized", payload.email_normalized)
      .eq("email_key", payload.email_key);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const auth = isAuthorized(req);
  if (!auth.ok) {
    return json(auth.status, { ok: false, error: auth.error });
  }

  let body: SendTestMarketingEmailBody;
  try {
    body = (await req.json()) as SendTestMarketingEmailBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (body.allow_send !== true) {
    return json(400, {
      ok: false,
      error: "allow_send_required",
      message: "Internal test sends require allow_send=true.",
    });
  }

  const to = (body.to ?? "").trim();
  if (!to) {
    return json(400, { ok: false, error: "missing_to" });
  }

  if (!ALLOWED_INTERNAL_RECIPIENTS.has(to)) {
    return json(403, {
      ok: false,
      error: "recipient_not_allowed",
      message:
        "send_test_marketing_email can only send to authorized internal test addresses.",
      allowed_recipients: Array.from(ALLOWED_INTERNAL_RECIPIENTS),
    });
  }

  const emailKey = (body.email_key ?? "").trim();
  if (!emailKey) {
    return json(400, {
      ok: false,
      error: "missing_email_key",
      allowed_email_keys: listMarketingEmailKeys(),
    });
  }

  if (!isMarketingEmailKey(emailKey)) {
    return json(404, {
      ok: false,
      error: "unknown_email_key",
      allowed_email_keys: listMarketingEmailKeys(),
    });
  }

  const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
  const resendFrom = cleanSecret(Deno.env.get("RESEND_FROM"));
  const resendReplyTo = cleanSecret(Deno.env.get("RESEND_REPLY_TO"));

  if (!resendKey || !resendFrom) {
    return json(500, {
      ok: false,
      error: "needs_resend_from_config",
      message: "RESEND_API_KEY and RESEND_FROM must be configured before sending.",
    });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const emailNormalized = normalizeEmail(to);
  const segment = EMAIL_KEY_TO_SEGMENT[emailKey];

  const { data: unsubscribeToken, error: tokenError } = await supabase
    .from("email_unsubscribe_tokens")
    .insert({
      email: to,
      email_normalized: emailNormalized,
      email_key: emailKey,
      segment,
    })
    .select("token")
    .single<InsertedUnsubscribeToken>();

  if (tokenError || !unsubscribeToken?.token) {
    return json(500, {
      ok: false,
      error: "unsubscribe_token_insert_failed",
      message: tokenError?.message ?? "missing_generated_token",
    });
  }

  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}?token=${encodeURIComponent(
    unsubscribeToken.token,
  )}`;

  const rendered = renderMarketingEmail(emailKey, {
    email: to,
    poste_recherche: body.poste_recherche ?? null,
    unsubscribe_url: unsubscribeUrl,
  });

  const resendPayload: Record<string, unknown> = {
    from: resendFrom,
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: [
      { name: "source", value: "send_test_marketing_email" },
      { name: "email_key", value: rendered.email_key },
    ],
  };

  if (resendReplyTo) {
    resendPayload.reply_to = resendReplyTo;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendPayload),
  });

  let resendData: Record<string, unknown> = {};
  try {
    resendData = await resp.json();
  } catch {
    resendData = {};
  }

  const resendMessageId = typeof resendData.id === "string" ? resendData.id : null;
  const now = new Date().toISOString();

  if (!resp.ok) {
    await insertEmailLog(supabase, {
      email: to,
      email_normalized: emailNormalized,
      segment,
      email_key: rendered.email_key,
      template_version: rendered.template_version,
      subject: rendered.subject,
      dry_run: false,
      status: "failed",
      resend_message_id: resendMessageId,
      metadata: {
        internal_test: true,
        provider: "resend",
        resend_status: resp.status,
        resend_error: resendData,
      },
    });

    return json(502, {
      ok: false,
      error: "resend_error",
      status: resp.status,
      message: typeof resendData.message === "string" ? resendData.message : "unknown_error",
    });
  }

  await insertEmailLog(supabase, {
    email: to,
    email_normalized: emailNormalized,
    segment,
    email_key: rendered.email_key,
    template_version: rendered.template_version,
    subject: rendered.subject,
    dry_run: false,
    status: "sent",
    resend_message_id: resendMessageId,
    sent_at: now,
    metadata: {
      internal_test: true,
      provider: "resend",
      unsubscribe_url: unsubscribeUrl,
    },
  });

  return json(200, {
    ok: true,
    to,
    email_key: rendered.email_key,
    subject: rendered.subject,
    template_version: rendered.template_version,
    resend_message_id: resendMessageId,
    unsubscribe_url: unsubscribeUrl,
  });
});
