import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type ContactPayload = {
  name?: string | null;
  email?: string | null;
  subject?: string | null;
  message?: string | null;
  honey?: string | null;
};

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://go4jobapp.com",
  "https://jobradar.go4jobapp.com",
]);

const SUBJECT_LABELS: Record<string, string> = {
  support: "Support / Problème technique",
  feedback: "Feedback / Suggestion",
  partnership: "Partenariat",
  other: "Autre",
};

function getCorsHeaders(origin: string | null) {
  const o = origin && allowedOrigins.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(status: number, body: Record<string, unknown>, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
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

function sanitizeText(input: unknown) {
  if (typeof input !== "string") return "";
  return input
    .replace(/\uFEFF/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function isValidEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-client-ip")
  );
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" }, corsHeaders);
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, { ok: false, error: "server_misconfigured" }, corsHeaders);
  }

  let body: ContactPayload;
  try {
    body = (await req.json()) as ContactPayload;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" }, corsHeaders);
  }

  const honey = sanitizeText(body?.honey);
  if (honey) {
    return jsonResponse(400, { ok: false, error: "spam_detected" }, corsHeaders);
  }

  const name = sanitizeText(body?.name);
  const email = sanitizeText(body?.email);
  const subjectRaw = sanitizeText(body?.subject);
  const subjectValue = SUBJECT_LABELS[subjectRaw] ? subjectRaw : "other";
  const subjectLabel = SUBJECT_LABELS[subjectValue] || "Autre";
  const message = sanitizeText(body?.message);

  if (!email || !isValidEmail(email)) {
    return jsonResponse(400, { ok: false, error: "invalid_email" }, corsHeaders);
  }
  if (!subjectRaw) {
    return jsonResponse(400, { ok: false, error: "subject_required" }, corsHeaders);
  }
  if (!message || message.length < 10 || message.length > 4000) {
    return jsonResponse(400, { ok: false, error: "invalid_message" }, corsHeaders);
  }

  const ip = getClientIp(req);
  const userAgent = (req.headers.get("user-agent") || "").slice(0, 500);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (ip) {
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);

    if (error) {
      return jsonResponse(500, { ok: false, error: "rate_limit_check_failed" }, corsHeaders);
    }
    if ((count ?? 0) >= 3) {
      return jsonResponse(429, { ok: false, error: "rate_limited" }, corsHeaders);
    }
  }

  const insertPayload = {
    name: name || null,
    email,
    subject: subjectLabel,
    message,
    status: "received",
    ip: ip ?? null,
    user_agent: userAgent || null,
    meta: {
      ip,
      user_agent: userAgent,
      honeypot: false,
      subject_value: subjectValue,
    },
  };

  const { data: insertRow, error: insertError } = await supabase
    .from("contact_messages")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) {
    return jsonResponse(500, { ok: false, error: "db_insert_failed" }, corsHeaders);
  }

  const rowId = insertRow?.id ?? null;
  const supportEmail = cleanSecret(Deno.env.get("CONTACT_EMAIL")) || "contact@go4jobapp.com";
  const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
  const from = cleanSecret(Deno.env.get("RESEND_FROM"));
  const replyTo = email;
  let emailSent = false;

  if (resendKey && from) {
    const emailSubject = `Go4Job · Contact (${subjectLabel})`;
    const safeName = name ? escapeHtml(name) : "Non renseigné";
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br/>");
    const safeIp = escapeHtml(ip || "n/a");
    const safeUa = escapeHtml(userAgent || "n/a");

    const html = `
      <div style="font-family: Arial, sans-serif; line-height:1.6; color:#0b1220;">
        <h2>Nouveau message de contact</h2>
        <p><strong>Nom :</strong> ${safeName}</p>
        <p><strong>Email :</strong> ${safeEmail}</p>
        <p><strong>Sujet :</strong> ${escapeHtml(subjectLabel)}</p>
        <p><strong>Message :</strong><br/>${safeMessage}</p>
        <hr/>
        <p style="font-size:12px;color:#5b677a;">IP: ${safeIp} · UA: ${safeUa}</p>
      </div>
    `;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: supportEmail,
        subject: emailSubject,
        html,
        reply_to: replyTo,
        tags: [{ name: "tag", value: "contact" }],
      }),
    });

    if (resp.ok) {
      emailSent = true;
      await supabase.from("contact_messages").update({ status: "sent" }).eq("id", rowId);
    } else {
      await supabase
        .from("contact_messages")
        .update({ status: "failed", meta: { ...insertPayload.meta, email_error: "resend_failed" } })
        .eq("id", rowId);
    }
  }

  return jsonResponse(
    200,
    {
      ok: true,
      id: rowId,
      email_sent: emailSent,
      message: emailSent ? "message_sent" : "message_received",
    },
    corsHeaders,
  );
});
