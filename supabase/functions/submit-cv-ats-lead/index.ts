import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type SubmitLeadBody = {
  first_name?: string | null;
  email?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  meta_fbp?: string | null;
  meta_fbc?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
};

type LeadRow = {
  id: string;
  submit_count: number;
};

type ResendResult = {
  ok: boolean;
  id: string | null;
  status: number | null;
  message: string;
};

const SOURCE = "cv_ats_landing";
const MAX_TEXT_LENGTH = 500;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function sanitizeText(input: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (typeof input !== "string") return "";
  return input
    .replace(/\uFEFF/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attribution(body: SubmitLeadBody) {
  return {
    utm_source: sanitizeText(body.utm_source) || null,
    utm_medium: sanitizeText(body.utm_medium) || null,
    utm_campaign: sanitizeText(body.utm_campaign) || null,
    utm_content: sanitizeText(body.utm_content) || null,
    utm_term: sanitizeText(body.utm_term) || null,
    meta_fbp: sanitizeText(body.meta_fbp) || null,
    meta_fbc: sanitizeText(body.meta_fbc) || null,
    referrer: sanitizeText(body.referrer, 1000) || null,
    user_agent: sanitizeText(body.user_agent, 1000) || null,
  };
}

async function sendGuideEmail(params: {
  to: string;
  firstName: string;
  guideUrl: string;
  resendKey: string;
  from: string;
  replyTo: string;
}): Promise<ResendResult> {
  const safeFirstName = escapeHtml(params.firstName);
  const safeGuideUrl = escapeHtml(params.guideUrl);
  const subject = "Votre guide CV gratuit est prêt";
  const text = [
    `Bonjour ${params.firstName},`,
    "",
    "Merci pour votre inscription.",
    "",
    "Voici votre guide gratuit : \"Votre CV mérite d'être lu\".",
    `Télécharger le guide : ${params.guideUrl}`,
    "",
    "Prenez quelques minutes pour le lire avant votre prochaine candidature. Vous y trouverez des conseils simples pour rendre votre CV plus clair, plus lisible et plus convaincant.",
    "",
    "L'équipe Go4Job",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0b1220;">
      <p>Bonjour ${safeFirstName},</p>
      <p>Merci pour votre inscription.</p>
      <p>Voici votre guide gratuit : <strong>"Votre CV mérite d'être lu"</strong>.</p>
      <p>
        <a href="${safeGuideUrl}" style="display:inline-block;padding:12px 18px;background:#0d6fde;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">
          Télécharger le guide
        </a>
      </p>
      <p>Prenez quelques minutes pour le lire avant votre prochaine candidature. Vous y trouverez des conseils simples pour rendre votre CV plus clair, plus lisible et plus convaincant.</p>
      <p>L'équipe Go4Job</p>
    </div>
  `;

  try {
    const payload: Record<string, unknown> = {
      from: params.from,
      to: params.to,
      subject,
      html,
      text,
      tags: [{ name: "source", value: SOURCE }],
    };

    if (params.replyTo) {
      payload.reply_to = params.replyTo;
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let data: Record<string, unknown> = {};
    try {
      data = await resp.json();
    } catch {
      data = {};
    }

    return {
      ok: resp.ok,
      id: typeof data.id === "string" ? data.id : null,
      status: resp.status,
      message: typeof data.message === "string" ? data.message : `resend_status_${resp.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      id: null,
      status: null,
      message: error instanceof Error ? error.message : "resend_request_failed",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  let body: SubmitLeadBody;
  try {
    body = (await req.json()) as SubmitLeadBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const firstName = sanitizeText(body.first_name, 80);
  const email = sanitizeText(body.email, 320);
  const emailNormalized = normalizeEmail(email);

  if (!firstName) return json(400, { ok: false, error: "first_name_required" });
  if (!emailNormalized || !isValidEmail(emailNormalized)) {
    return json(400, { ok: false, error: "invalid_email" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const leadPayload = {
    first_name: firstName,
    email: emailNormalized,
    source: SOURCE,
    status: "captured",
    last_submitted_at: now,
    guide_email_error: null,
    ...attribution(body),
  };

  let alreadyExists = false;
  let leadId: string | null = null;

  const { data: inserted, error: insertError } = await supabase
    .from("cv_ats_leads")
    .insert(leadPayload)
    .select("id, submit_count")
    .single<LeadRow>();

  if (!insertError && inserted?.id) {
    leadId = inserted.id;
  } else if (insertError?.code === "23505") {
    alreadyExists = true;
    const { data: existing, error: existingError } = await supabase
      .from("cv_ats_leads")
      .select("id, submit_count")
      .eq("email_normalized", emailNormalized)
      .eq("source", SOURCE)
      .single<LeadRow>();

    if (existingError || !existing?.id) {
      return json(500, { ok: false, error: "duplicate_lookup_failed" });
    }

    leadId = existing.id;
    const { error: updateError } = await supabase
      .from("cv_ats_leads")
      .update({
        first_name: firstName,
        last_submitted_at: now,
        submit_count: (existing.submit_count || 1) + 1,
        guide_email_error: null,
        updated_at: now,
        ...attribution(body),
      })
      .eq("id", leadId);

    if (updateError) {
      return json(500, { ok: false, error: "duplicate_update_failed" });
    }
  } else {
    return json(500, { ok: false, error: "lead_insert_failed" });
  }

  const guideUrl = cleanSecret(Deno.env.get("CV_ATS_GUIDE_URL"));
  const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
  const from = cleanSecret(Deno.env.get("MARKETING_FROM_EMAIL")) ||
    cleanSecret(Deno.env.get("RESEND_FROM_EMAIL")) ||
    cleanSecret(Deno.env.get("RESEND_FROM"));
  const replyTo = cleanSecret(Deno.env.get("MARKETING_REPLY_TO_EMAIL")) ||
    cleanSecret(Deno.env.get("RESEND_REPLY_TO"));

  let emailSent = false;
  let emailError: string | null = null;

  if (!guideUrl || !resendKey || !from) {
    emailError = "missing_email_config";
  } else {
    const result = await sendGuideEmail({
      to: emailNormalized,
      firstName,
      guideUrl,
      resendKey,
      from,
      replyTo,
    });
    emailSent = result.ok;
    if (!result.ok) {
      emailError = result.message;
    }
  }

  if (leadId) {
    const emailUpdate: Record<string, unknown> = {
      guide_email_error: emailError,
      updated_at: new Date().toISOString(),
    };

    if (emailSent) {
      emailUpdate.guide_email_sent_at = new Date().toISOString();
    }

    const { error: emailStateError } = await supabase
      .from("cv_ats_leads")
      .update(emailUpdate)
      .eq("id", leadId);

    if (emailStateError && !emailError) {
      emailError = "email_state_update_failed";
    }
  }

  return json(200, {
    ok: true,
    lead_id: leadId,
    already_exists: alreadyExists,
    email_sent: emailSent,
  });
});
