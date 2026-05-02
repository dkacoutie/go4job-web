import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  listMarketingEmailKeys,
  renderMarketingEmail,
  type MarketingEmailVariables,
} from "../_shared/marketingEmails/templates.ts";

type PreviewMarketingEmailBody = MarketingEmailVariables & {
  email_key?: string | null;
  dry_run?: boolean | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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
  const secret = cleanSecret(Deno.env.get("CRON_SECRET"));
  if (!secret) return { ok: false, status: 500, error: "server_misconfigured" };

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();

  if (bearer === secret || cronHeader === secret) {
    return { ok: true, status: 200, error: null };
  }

  return { ok: false, status: 401, error: "unauthorized" };
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

  let body: PreviewMarketingEmailBody;
  try {
    body = (await req.json()) as PreviewMarketingEmailBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (body.dry_run !== true) {
    return json(400, {
      ok: false,
      error: "dry_run_required",
      message: "preview_marketing_email only renders previews and requires dry_run=true.",
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

  try {
    const rendered = renderMarketingEmail(emailKey, {
      email: body.email ?? null,
      poste_recherche: body.poste_recherche ?? null,
      unsubscribe_url: body.unsubscribe_url ?? null,
      app_url: body.app_url ?? null,
      pricing_url: body.pricing_url ?? null,
      feed_url: body.feed_url ?? null,
    });

    return json(200, {
      ok: true,
      email_key: rendered.email_key,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template_version: rendered.template_version,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "template_render_failed";
    if (message.startsWith("unknown_email_key:")) {
      return json(404, {
        ok: false,
        error: "unknown_email_key",
        allowed_email_keys: listMarketingEmailKeys(),
      });
    }

    return json(500, {
      ok: false,
      error: "template_render_failed",
      message,
    });
  }
});
