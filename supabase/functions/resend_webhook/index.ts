import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { Webhook } from "https://esm.sh/svix@1.42.0";

// Future Resend webhook URL:
// https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/resend_webhook
//
// Configure these Resend events:
// email.bounced, email.complained, email.suppressed, email.failed
//
// Required Supabase Function secret:
// RESEND_WEBHOOK_SECRET

type ResendWebhookPayload = {
  id?: string;
  type?: string;
  event?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProcessingResult = {
  suppressed: boolean;
  reason: string | null;
  processingStatus: "processed" | "ignored" | "failed";
  errorMessage: string | null;
};

const SUPPRESSION_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);

const FAILED_SUPPRESSION_HINTS = [
  "invalid",
  "rejected",
  "permanent",
  "hard bounce",
  "hard_bounce",
  "bounce",
  "blocked",
  "complaint",
  "complained",
  "suppress",
  "suppressed",
  "unsubscribed",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function firstEmailFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0] ?? null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const email = firstEmailFromValue(item);
      if (email) return email;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["email", "recipient", "address"]) {
      const email = firstEmailFromValue(record[key]);
      if (email) return email;
    }
  }

  return null;
}

function extractEmail(payload: ResendWebhookPayload): string | null {
  const data = payload.data ?? {};
  for (const key of ["email", "to", "recipient", "recipients", "bounced_email"]) {
    const email = firstEmailFromValue(data[key]);
    if (email) return email;
  }

  return firstEmailFromValue(payload);
}

function extractResendEmailId(payload: ResendWebhookPayload): string | null {
  const data = payload.data ?? {};
  for (const key of ["email_id", "emailId", "id", "message_id", "messageId"]) {
    const value = stringValue(data[key]);
    if (value) return value;
  }
  return null;
}

function eventType(payload: ResendWebhookPayload): string {
  return stringValue(payload.type) ?? stringValue(payload.event) ?? "unknown";
}

function suppressionReason(type: string, payload: ResendWebhookPayload): string | null {
  if (type === "email.bounced") return "hard_bounce";
  if (type === "email.complained") return "spam_complaint";
  if (type === "email.suppressed") return "manual_exclusion";

  if (type !== "email.failed") return null;

  const data = payload.data ?? {};
  const failureText = [
    data.reason,
    data.error,
    data.message,
    data.status,
    data.type,
    data.name,
    payload.reason,
    payload.error,
  ]
    .map((value) => typeof value === "string" ? value : JSON.stringify(value ?? ""))
    .join(" ")
    .toLowerCase();

  if (FAILED_SUPPRESSION_HINTS.some((hint) => failureText.includes(hint))) {
    return "hard_bounce";
  }

  return null;
}

function safeHeaders(req: Request) {
  return {
    "svix-id": req.headers.get("svix-id"),
    "svix-timestamp": req.headers.get("svix-timestamp"),
    "svix-signature": req.headers.get("svix-signature"),
    "user-agent": req.headers.get("user-agent"),
  };
}

function verifyWebhook(rawBody: string, req: Request, secret: string) {
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  if (!headers["svix-id"] || !headers["svix-timestamp"] || !headers["svix-signature"]) {
    throw new Error("missing_signature_headers");
  }

  return new Webhook(secret).verify(rawBody, headers) as ResendWebhookPayload;
}

async function insertWebhookEvent(
  supabase: SupabaseClient,
  payload: ResendWebhookPayload,
  req: Request,
  details: {
    eventId: string;
    type: string;
    email: string | null;
    resendEmailId: string | null;
    processingStatus: ProcessingResult["processingStatus"];
    errorMessage: string | null;
  },
) {
  const { error } = await supabase.from("resend_webhook_events").insert({
    provider: "resend",
    event_id: details.eventId,
    event_type: details.type,
    email: details.email,
    resend_email_id: details.resendEmailId,
    raw_payload: payload,
    headers: safeHeaders(req),
    processed_at: new Date().toISOString(),
    processing_status: details.processingStatus,
    error_message: details.errorMessage,
  });

  if (!error) return { duplicate: false };
  if (error.code === "23505") return { duplicate: true };

  throw new Error(`webhook_event_insert_failed: ${error.message}`);
}

async function upsertSuppression(
  supabase: SupabaseClient,
  details: {
    email: string;
    reason: string;
    eventType: string;
    resendEmailId: string | null;
    payload: ResendWebhookPayload;
  },
) {
  const normalizedEmail = normalizeEmail(details.email);

  const { error } = await supabase
    .from("email_suppressions")
    .upsert(
      {
        email: details.email.trim(),
        email_normalized: normalizedEmail,
        reason: details.reason,
        source: "resend",
        metadata: {
          provider: "resend",
          event_type: details.eventType,
          resend_email_id: details.resendEmailId,
          last_seen_at: new Date().toISOString(),
          raw_payload: details.payload,
        },
      },
      { onConflict: "email_normalized" },
    );

  if (error) {
    throw new Error(`suppression_upsert_failed: ${error.message}`);
  }
}

async function processEvent(
  supabase: SupabaseClient,
  payload: ResendWebhookPayload,
  type: string,
  email: string | null,
  resendEmailId: string | null,
): Promise<ProcessingResult> {
  const reason = suppressionReason(type, payload);

  if (!SUPPRESSION_EVENTS.has(type) && !reason) {
    return {
      suppressed: false,
      reason: null,
      processingStatus: "ignored",
      errorMessage: null,
    };
  }

  if (!email) {
    return {
      suppressed: false,
      reason,
      processingStatus: "processed",
      errorMessage: "no_email_found",
    };
  }

  if (reason) {
    await upsertSuppression(supabase, {
      email,
      reason,
      eventType: type,
      resendEmailId,
      payload,
    });
  }

  return {
    suppressed: Boolean(reason),
    reason,
    processingStatus: "processed",
    errorMessage: null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const rawBody = await req.text();
  const webhookSecret = cleanSecret(Deno.env.get("RESEND_WEBHOOK_SECRET"));

  if (!webhookSecret) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = verifyWebhook(rawBody, req, webhookSecret);
  } catch {
    return json(401, { ok: false, error: "invalid_signature" });
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const idFromPayload = stringValue(payload.id);
  const eventId = req.headers.get("svix-id") ?? idFromPayload ?? "";
  const type = eventType(payload);
  const email = extractEmail(payload);
  const resendEmailId = extractResendEmailId(payload);

  try {
    const existing = await supabase
      .from("resend_webhook_events")
      .select("id, processing_status")
      .eq("provider", "resend")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing.error) {
      return json(500, {
        ok: false,
        error: "webhook_event_lookup_failed",
      });
    }

    if (existing.data) {
      return json(200, {
        ok: true,
        event_type: type,
        suppressed: false,
        duplicate: true,
      });
    }

    const result = await processEvent(supabase, payload, type, email, resendEmailId);
    const inserted = await insertWebhookEvent(supabase, payload, req, {
      eventId,
      type,
      email: email ? normalizeEmail(email) : null,
      resendEmailId,
      processingStatus: result.processingStatus,
      errorMessage: result.errorMessage,
    });

    return json(200, {
      ok: true,
      event_type: type,
      suppressed: result.suppressed,
      duplicate: inserted.duplicate,
    });
  } catch (error) {
    try {
      await insertWebhookEvent(supabase, payload, req, {
        eventId,
        type,
        email: email ? normalizeEmail(email) : null,
        resendEmailId,
        processingStatus: "failed",
        errorMessage: error instanceof Error ? error.message : "unknown_error",
      });
    } catch {
      // Keep the response generic and avoid exposing internals after a verified webhook fails.
    }

    return json(500, {
      ok: false,
      error: "webhook_processing_failed",
    });
  }
});
