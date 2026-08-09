import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type WelcomeEmailBody = {
    user_id?: string | null;
    to?: string | null;
    full_name?: string | null;
    account_email?: string | null;
};

function json(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json; charset=utf-8" },
    });
}

function clean(value: string | null | undefined) {
    return (value ?? "").trim();
}

function cleanSecret(value: string | undefined | null): string {
    let v = (value ?? "").trim();
    v = v.replace(/^['"]|['"]$/g, "");
    if (v.toLowerCase().startsWith("bearer ")) {
          v = v.slice(7).trim();
    }
    return v;
}

function escapeHtml(input: string) {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
}

function pickFirstName(...candidates: Array<string | null | undefined>) {
    for (const candidate of candidates) {
          const trimmed = clean(candidate);
          if (!trimmed) continue;
          return trimmed.split(/\s+/)[0];
    }
    return "";
}

function formatFirstName(value: string) {
    const trimmed = clean(value);
    if (!trimmed) return "";
    const lower = trimmed.toLocaleLowerCase("fr-FR");
    return lower.charAt(0).toLocaleUpperCase("fr-FR") + lower.slice(1);
}

function normalizeBaseUrl(value: string) {
    const trimmed = clean(value);
    if (!trimmed) return "";
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function buildWelcomeEmail(body: WelcomeEmailBody) {
    const appBaseUrl = normalizeBaseUrl(
          clean(Deno.env.get("APP_BASE_URL")) || "https://jobradar.go4jobapp.com"
        );
    const supportEmail = clean(Deno.env.get("CONTACT_EMAIL")) || "contact@go4jobapp.com";

  const primaryUrl = `${appBaseUrl}/jobradar/feed`;
    const secondaryUrl = `${appBaseUrl}/jobradar/profile`;

  const rawFirstName = pickFirstName(body.full_name, body.account_email, body.to);
    const firstName = formatFirstName(rawFirstName);
    const greeting = firstName ? `Bonjour ${escapeHtml(firstName)},` : "Bonjour,";

  const subject = "Bienvenue sur JobRadar";
    const html = `
      <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#0b1420;">
          <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e6ebf2;padding:24px;">
                <div style="font-size:12px;letter-spacing:2px;font-weight:700;color:#0b5ed7;">JOBRADAR</div>
                      <h1 style="margin:12px 0 8px;font-size:22px;line-height:1.3;">Bienvenue sur JobRadar</h1>
                            <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">${greeting}</p>
                                  <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">
                                          Ton compte JobRadar est pret. JobRadar t'aide a decouvrir des offres pertinentes,
                                                  suivre tes opportunites et recevoir des recommandations adaptees a ton profil.
                                                        </p>
                                                              <p style="margin:0 0 18px;font-size:14.5px;line-height:1.7;color:#4b5563;">
                                                                      Tu peux commencer des maintenant.
                                                                            </p>
                                                                                  <div style="margin-bottom:10px;">
                                                                                          <a href="${primaryUrl}"
                                                                                                     style="display:inline-block;background:#0b5ed7;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
                                                                                                               Voir mes offres
                                                                                                                       </a>
                                                                                                                             </div>
                                                                                                                                   <div style="margin-bottom:18px;">
                                                                                                                                           <a href="${secondaryUrl}" style="color:#0b5ed7;text-decoration:none;font-size:14px;">
                                                                                                                                                     Completer mon profil
                                                                                                                                                             </a>
                                                                                                                                                                   </div>
                                                                                                                                                                         <div style="font-size:13px;color:#5b6877;line-height:1.6;border-top:1px solid #eef2f8;padding-top:16px;">
                                                                                                                                                                                 <div><strong>Compte :</strong> ${escapeHtml(body.account_email || body.to || "-")}</div>
                                                                                                                                                                                         <div style="margin-top:10px;">Besoin d'aide ? Contacte-nous a ${escapeHtml(supportEmail)}.</div>
                                                                                                                                                                                                 <div style="margin-top:12px;">L'equipe JobRadar by Go4Job</div>
                                                                                                                                                                                                       </div>
                                                                                                                                                                                                           </div>
                                                                                                                                                                                                             </div>
                                                                                                                                                                                                               `;

  const text = [
        "Bienvenue sur JobRadar",
        "",
        firstName ? `Bonjour ${firstName},` : "Bonjour,",
        "",
        "Ton compte JobRadar est pret.",
        "JobRadar t'aide a decouvrir des offres pertinentes, suivre tes opportunites et recevoir des recommandations adaptees a ton profil.",
        "",
        "Voir mes offres : " + primaryUrl,
        "Completer mon profil : " + secondaryUrl,
        "",
        "Compte : " + (body.account_email || body.to || "-"),
        "Besoin d'aide ? Contacte-nous a " + supportEmail + ".",
        "",
        "L'equipe JobRadar by Go4Job",
      ].join("\n");

  return { subject, html, text };
}

async function updateWelcomeStatus(userId: string, patch: Record<string, unknown>) {
    const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
    const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!supabaseUrl || !serviceKey) return;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    await admin.from("user_welcome_emails").update(patch).eq("user_id", userId);
}

Deno.serve(async (req) => {
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

             const cronSecret = cleanSecret(Deno.env.get("CRON_SECRET"));
    if (!cronSecret) return json(500, { ok: false, error: "server_misconfigured" });

             const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
          : null;
    const cronHeader = (req.headers.get("x-cron-secret") || "").trim();

             if (!((bearer && bearer === cronSecret) || (cronHeader && cronHeader === cronSecret))) {
                   return json(401, { ok: false, error: "unauthorized" });
             }

             let body: WelcomeEmailBody;
    try {
          body = (await req.json()) as WelcomeEmailBody;
    } catch {
          return json(400, { ok: false, error: "invalid_json" });
    }

             const to = clean(body.to);
    if (!to) return json(400, { ok: false, error: "missing_to" });

             const { subject, html, text } = buildWelcomeEmail(body);

             const resendKey = cleanSecret(Deno.env.get("RESEND_API_KEY"));
    const from = cleanSecret(Deno.env.get("RESEND_FROM"));
    const replyTo = cleanSecret(Deno.env.get("RESEND_REPLY_TO"));

             if (!resendKey || !from) {
                   if (body.user_id) {
                           await updateWelcomeStatus(body.user_id, {
                                     status: "failed",
                                     error: "missing_resend_config",
                           });
                   }
                   return json(500, { ok: false, error: "missing_resend_config" });
             }

             const payload: Record<string, unknown> = {
                   from,
                   to,
                   subject,
                   html,
                   text,
             };

             if (replyTo) payload.reply_to = replyTo;
    payload.tags = [{ name: "tag", value: "welcome" }];

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
                   if (body.user_id) {
                           await updateWelcomeStatus(body.user_id, {
                                     status: "failed",
                                     error: data?.message || "resend_error",
                           });
                   }
                   return json(500, { ok: false, error: "resend_error" });
             }

             if (body.user_id) {
                   await updateWelcomeStatus(body.user_id, {
                           status: "sent",
                           provider_id: data?.id || null,
                           sent_at: new Date().toISOString(),
                   });
             }

             return json(200, { ok: true, id: data?.id || null });
});
