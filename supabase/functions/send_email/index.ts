import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type SendEmailBody = {
  to: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  tag?: string;
  replyTo?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeToList(to: string | string[]): string[] {
  if (Array.isArray(to)) return to.map((s) => String(s).trim()).filter(Boolean);
  return [String(to).trim()].filter(Boolean);
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!cronSecret) return json(500, { ok: false, error: "server_misconfigured" });

  const authHeader = req.headers.get("authorization") || "";
  const bearer =
    authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
  const cronHeader = (req.headers.get("x-cron-secret") || "").trim();

  if (!((bearer && bearer === cronSecret) || (cronHeader && cronHeader === cronSecret))) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let body: SendEmailBody;
  try {
    body = (await req.json()) as SendEmailBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const toList = normalizeToList(body.to);
  if (toList.length === 0) return json(400, { ok: false, error: "missing_to" });

  const rawSubject = (body.subject || "").trim();
  const rawHtml = (body.html || "").trim();
  const rawText = (body.text || "").trim();
  const testMode = !rawSubject && !rawHtml && !rawText;

  let subject = rawSubject;
  let html = rawHtml;
  let text = rawText;

  if (testMode) {
    const appBaseUrl = cleanSecret(Deno.env.get("APP_BASE_URL")) || "https://example.com";
    subject = "Test JobRadar";
    html = `
      <div style="font-family: Arial, sans-serif; line-height:1.6;">
        <h2>Test JobRadar</h2>
        <p>Votre envoi email fonctionne.</p>
        <a href="${appBaseUrl}"
           style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">
          Ouvrir JobRadar
        </a>
      </div>
    `;
    text = `Test JobRadar\nOuvrir JobRadar: ${appBaseUrl}`;
  } else {
    if (!subject || !html) return json(400, { ok: false, error: "missing_subject_or_html" });
  }

  const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
  const from = cleanSecret(Deno.env.get("RESEND_FROM"));
  const replyTo = (body.replyTo || "").trim() || cleanSecret(Deno.env.get("RESEND_REPLY_TO"));

  if (!resendKey || !from) return json(500, { ok: false, error: "missing_resend_config" });

  const payload: Record<string, unknown> = {
    from,
    to: toList.length === 1 ? toList[0] : toList,
    subject,
    html,
  };

  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (body.tag) payload.tags = [{ name: "tag", value: String(body.tag) }];

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data: any = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok) {
    return json(500, {
      ok: false,
      error: "resend_error",
      status: resp.status,
      message: data?.message || "unknown_error",
    });
  }

  return json(200, { ok: true, id: data?.id || null });
});
