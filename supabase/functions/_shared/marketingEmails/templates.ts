export type MarketingEmailKey =
  | "payment_attempt_no_success_email_1"
  | "interested_no_payment_attempt_email_1"
  | "buyer_feedback_email_1";

export type MarketingEmailVariables = {
  email?: string | null;
  poste_recherche?: string | null;
  unsubscribe_url?: string | null;
  app_url?: string | null;
  pricing_url?: string | null;
  feed_url?: string | null;
};

export type RenderedMarketingEmail = {
  email_key: MarketingEmailKey;
  template_version: string;
  subject: string;
  html: string;
  text: string;
};

type TemplateDefinition = {
  email_key: MarketingEmailKey;
  template_version: string;
  subject: string;
  render: (variables: NormalizedMarketingEmailVariables) => {
    html: string;
    text: string;
  };
};

type NormalizedMarketingEmailVariables = {
  email: string;
  poste_recherche: string;
  unsubscribe_url: string;
  app_url: string;
  pricing_url: string;
  feed_url: string;
};

const TEMPLATE_VERSION = "2026-05-02.v1";
const DEFAULT_APP_URL = "https://jobradar.go4jobapp.com";

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeBaseUrl(value: string | null | undefined) {
  const cleaned = cleanText(value) || DEFAULT_APP_URL;
  return cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function normalizeVariables(input: MarketingEmailVariables): NormalizedMarketingEmailVariables {
  const appUrl = normalizeBaseUrl(input.app_url);
  return {
    email: cleanText(input.email),
    poste_recherche: cleanText(input.poste_recherche),
    unsubscribe_url: cleanText(input.unsubscribe_url) ||
      `${appUrl}/unsubscribe?source=marketing_preview`,
    app_url: appUrl,
    pricing_url: cleanText(input.pricing_url) || `${appUrl}/pricing`,
    feed_url: cleanText(input.feed_url) || `${appUrl}/jobradar/feed`,
  };
}

function renderLayout(params: {
  preheader: string;
  title: string;
  introHtml: string;
  bodyHtml: string;
  primaryHref: string;
  primaryLabel: string;
  postCtaHtml?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  unsubscribeUrl: string;
  brandSubtitle?: string;
  headerLogoUrl?: string;
  secondaryLinkOnly?: boolean;
  hideUnsubscribeUrlInHtml?: boolean;
}) {
  const secondary = params.secondaryHref && params.secondaryLabel
    ? `
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#4b5563;">
        <a href="${escapeAttr(params.secondaryHref)}" style="color:#0f5f7a;text-decoration:underline;font-weight:600;">${escapeHtml(params.secondaryLabel)}</a>${params.secondaryLinkOnly ? "" : ` : ${escapeHtml(params.secondaryHref)}`}
      </p>`
    : "";
  const brandSubtitle = params.brandSubtitle
    ? `<span style="font-size:13px;line-height:1.4;font-weight:600;color:#64748b;">${escapeHtml(params.brandSubtitle)}</span>`
    : "";
  const unsubscribeLink = params.hideUnsubscribeUrlInHtml
    ? `<a href="${escapeAttr(params.unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Se désinscrire</a>`
    : `Se désinscrire :
                <a href="${escapeAttr(params.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">${escapeHtml(params.unsubscribeUrl)}</a>`;
  const modernVisual = Boolean(params.brandSubtitle || params.headerLogoUrl);
  const pageBg = modernVisual ? "#eef5f7" : "#f4f7fb";
  const outerPadding = modernVisual ? "34px 14px" : "28px 14px";
  const headerCellStyle = modernVisual
    ? "padding:0 6px 18px;"
    : "padding:0 0 14px;font-size:18px;line-height:1.3;font-weight:700;color:#0b1420;";
  const headerContent = modernVisual
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="54" valign="middle" style="width:54px;padding:0 12px 0 0;">
                      <img src="${escapeAttr(params.headerLogoUrl ?? "")}" width="48" height="48" alt="Go4Job" style="display:block;width:48px;height:48px;border:0;outline:none;text-decoration:none;border-radius:9px;">
                    </td>
                    <td valign="middle" style="padding:0;">
                      <div style="font-size:24px;line-height:1.15;font-weight:800;color:#0b1420;letter-spacing:0;">
                        JobRadar
                      </div>
                      ${brandSubtitle}
                    </td>
                  </tr>
                </table>`
    : "Go4Job / JobRadar";
  const cardStyle = modernVisual
    ? "background:#ffffff;border:1px solid #dce8ed;border-radius:14px;padding:32px;box-shadow:0 10px 28px rgba(15,95,122,0.08);"
    : "background:#ffffff;border:1px solid #e5eaf2;border-radius:12px;padding:28px;";
  const titleStyle = modernVisual
    ? "margin:0 0 18px;font-size:24px;line-height:1.25;color:#0b1420;font-weight:800;letter-spacing:0;"
    : "margin:0 0 16px;font-size:22px;line-height:1.3;color:#0b1420;font-weight:700;";
  const footerStyle = modernVisual
    ? "padding:18px 6px 0;font-size:12px;line-height:1.6;color:#64748b;"
    : "padding:16px 4px 0;font-size:12px;line-height:1.6;color:#6b7280;";

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(params.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${pageBg};color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(params.preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${pageBg};margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:${outerPadding};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="${headerCellStyle}">
                ${headerContent}
              </td>
            </tr>
            <tr>
              <td style="${cardStyle}">
                <h1 style="${titleStyle}">
                  ${escapeHtml(params.title)}
                </h1>
                ${params.introHtml}
                ${params.bodyHtml}
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;">
                  <tr>
                    <td style="background:#0b5ed7;border-radius:8px;">
                      <a href="${escapeAttr(params.primaryHref)}" style="display:inline-block;padding:13px 18px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:1.2;">
                        ${escapeHtml(params.primaryLabel)}
                      </a>
                    </td>
                  </tr>
                </table>
                ${secondary}
                ${params.postCtaHtml ?? ""}
              </td>
            </tr>
            <tr>
              <td style="${footerStyle}">
                Tu ne souhaites plus recevoir d'emails de JobRadar ?<br>
                ${unsubscribeLink}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paymentAttemptNoSuccess(variables: NormalizedMarketingEmailVariables) {
  const roleLine = variables.poste_recherche
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;background:#f8fbfc;border:1px solid #dce8ed;border-radius:12px;">
        <tr>
          <td style="padding:15px 16px;">
            <p style="margin:0;font-size:15px;line-height:1.6;color:#25313b;">
              Tu avais indiqué rechercher : <strong style="color:#0b1420;">${escapeHtml(variables.poste_recherche)}</strong>.
            </p>
          </td>
        </tr>
      </table>`
    : "";

  const html = renderLayout({
    preheader: "Tu peux reprendre ton activation JobRadar en quelques secondes.",
    title: "Ton accès JobRadar n'a pas semblé se finaliser",
    introHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Bonjour,</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">
        Tu avais commencé à activer ton accès JobRadar, mais l'activation ne semble pas être allée au bout.
        Rien n'est bloqué : tu peux reprendre tranquillement si c'est toujours utile pour ta recherche.
      </p>`,
    bodyHtml: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;background:#f3faf8;border:1px solid #cfe7df;border-radius:12px;">
        <tr>
          <td style="padding:17px 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:0 0 8px;font-size:15px;line-height:1.5;color:#1f2937;font-weight:700;">Offres mises à jour en continu</td>
              </tr>
              <tr>
                <td style="padding:0 0 8px;font-size:14px;line-height:1.5;color:#374151;">Filtrées selon ton profil</td>
              </tr>
              <tr>
                <td style="padding:0;font-size:14px;line-height:1.5;color:#374151;">Moins de recherche, plus de candidatures</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      ${roleLine}
      `,
    postCtaHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
        Si tu as rencontré un problème ou si quelque chose n'était pas clair, tu peux simplement répondre à cet email.
        Ton retour nous aidera vraiment à améliorer JobRadar.
      </p>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
        L'équipe Go4Job / JobRadar
      </p>`,
    primaryHref: variables.pricing_url,
    primaryLabel: "Reprendre mon accès",
    secondaryHref: variables.feed_url,
    secondaryLabel: "Voir les offres disponibles",
    unsubscribeUrl: variables.unsubscribe_url,
    brandSubtitle: "par Go4Job",
    headerLogoUrl: "https://jobradar.go4jobapp.com/go4job-logo-email.png",
    secondaryLinkOnly: true,
    hideUnsubscribeUrlInHtml: true,
  });

  const roleText = variables.poste_recherche
    ? `\nTu avais indiqué rechercher : ${variables.poste_recherche}.\n`
    : "";

  const text = `Bonjour,

Tu avais commencé à activer ton accès JobRadar, mais l'activation ne semble pas être allée au bout.
Offres mises à jour en continu
Filtrées selon ton profil
Moins de recherche, plus de candidatures
${roleText}
Tu peux reprendre ici :
${variables.pricing_url}

Voir les offres disponibles :
${variables.feed_url}

Si tu as rencontré un problème ou si quelque chose n'était pas clair, tu peux simplement répondre à cet email. Ton retour nous aidera vraiment à améliorer JobRadar.

L'équipe Go4Job / JobRadar

Tu ne souhaites plus recevoir d'emails de JobRadar ?
Se désinscrire : ${variables.unsubscribe_url}`;

  return { html, text };
}

function interestedNoPaymentAttempt(variables: NormalizedMarketingEmailVariables) {
  const role = variables.poste_recherche ? ` pour ${variables.poste_recherche}` : "";
  const html = renderLayout({
    preheader: "JobRadar peut t'aider à repérer les offres utiles plus vite.",
    title: "Tes recherches JobRadar peuvent reprendre quand tu veux",
    introHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Bonjour,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
        Tu avais montré de l'intérêt pour JobRadar${escapeHtml(role)}.
      </p>`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
        JobRadar filtre pour toi : moins de recherche, plus d'offres utiles.
        Le flux est mis à jour en continu, selon ton profil et tes critères.
      </p>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
        Tu peux revenir explorer les offres ou activer un accès quand ce sera le bon moment.
      </p>`,
    primaryHref: variables.feed_url,
    primaryLabel: "Voir les offres",
    secondaryHref: variables.pricing_url,
    secondaryLabel: "Voir les pass JobRadar",
    unsubscribeUrl: variables.unsubscribe_url,
  });

  const text = `Bonjour,

Tu avais montré de l'intérêt pour JobRadar${role}.

JobRadar filtre pour toi : moins de recherche, plus d'offres utiles.
Le flux est mis à jour en continu, selon ton profil et tes critères.

Tu peux revenir explorer les offres ici :
${variables.feed_url}

Voir les pass JobRadar :
${variables.pricing_url}

Tu ne souhaites plus recevoir d'emails de JobRadar ?
Se désinscrire : ${variables.unsubscribe_url}`;

  return { html, text };
}

function buyerFeedback(variables: NormalizedMarketingEmailVariables) {
  const html = renderLayout({
    preheader: "Ton retour peut nous aider à améliorer JobRadar.",
    title: "Petit retour sur ton expérience JobRadar ?",
    introHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Bonjour,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
        Tu as utilisé JobRadar et ton retour nous serait très utile.
      </p>`,
    bodyHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
        Qu'est-ce qui t'a aidé ? Qu'est-ce qui devrait être plus clair ou plus simple ?
      </p>
      <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
        Tu peux simplement répondre à cet email quand tu as deux minutes.
      </p>`,
    primaryHref: variables.app_url,
    primaryLabel: "Ouvrir JobRadar",
    unsubscribeUrl: variables.unsubscribe_url,
  });

  const text = `Bonjour,

Tu as utilisé JobRadar et ton retour nous serait très utile.

Qu'est-ce qui t'a aidé ? Qu'est-ce qui devrait être plus clair ou plus simple ?

Tu peux simplement répondre à cet email quand tu as deux minutes.

Ouvrir JobRadar :
${variables.app_url}

Tu ne souhaites plus recevoir d'emails de JobRadar ?
Se désinscrire : ${variables.unsubscribe_url}`;

  return { html, text };
}

const TEMPLATES: Record<MarketingEmailKey, TemplateDefinition> = {
  payment_attempt_no_success_email_1: {
    email_key: "payment_attempt_no_success_email_1",
    template_version: TEMPLATE_VERSION,
    subject: "Ton accès JobRadar n'a pas semblé se finaliser",
    render: paymentAttemptNoSuccess,
  },
  interested_no_payment_attempt_email_1: {
    email_key: "interested_no_payment_attempt_email_1",
    template_version: TEMPLATE_VERSION,
    subject: "Tes recherches JobRadar peuvent reprendre quand tu veux",
    render: interestedNoPaymentAttempt,
  },
  buyer_feedback_email_1: {
    email_key: "buyer_feedback_email_1",
    template_version: TEMPLATE_VERSION,
    subject: "Petit retour sur ton expérience JobRadar ?",
    render: buyerFeedback,
  },
};

export function isMarketingEmailKey(value: string): value is MarketingEmailKey {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value);
}

export function listMarketingEmailKeys(): MarketingEmailKey[] {
  return Object.keys(TEMPLATES) as MarketingEmailKey[];
}

export function renderMarketingEmail(
  emailKey: string,
  variables: MarketingEmailVariables = {},
): RenderedMarketingEmail {
  if (!isMarketingEmailKey(emailKey)) {
    throw new Error(`unknown_email_key:${emailKey}`);
  }

  const template = TEMPLATES[emailKey];
  const normalizedVariables = normalizeVariables(variables);
  const rendered = template.render(normalizedVariables);

  return {
    email_key: template.email_key,
    template_version: template.template_version,
    subject: template.subject,
    html: rendered.html,
    text: rendered.text,
  };
}

