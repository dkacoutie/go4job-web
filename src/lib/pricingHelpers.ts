export type PlanMarketing = {
  title: string;
  durationLabel: string;
  description: string;
  badge: string;
  badgeTone: "available" | "featured" | "paused" | "soon";
  launchNote: string;
  ctaLabel: string;
};

export type PaymentMethodBadge = {
  label: string;
  tone: "card" | "orange" | "mtn" | "moov" | "wave";
};

export type PlanDisplayPrices = {
  xofLabel: string;
  eurLabel: string;
  usdLabel: string;
  combinedLabel: string;
};

export const FEATURED_PLAN_CODE = "pass_30d";
export const EUR_XOF = 655.957;
export const USD_XOF = 570.94;
export const PRICING_SECTION_EYEBROW = "Plans JobRadar";
export const PRICING_SECTION_TITLE = "Choisis le pass qui correspond \u00e0 ton rythme";
export const PRICING_SECTION_SUBTITLE =
  "Active ton acc\u00e8s complet \u00e0 JobRadar avec une tarification claire et un paiement s\u00e9curis\u00e9.";
export const PRICING_ACCESS_MESSAGE =
  "Acc\u00e8s complet \u00e0 JobRadar pendant toute la dur\u00e9e choisie.";
export const PRICING_PRICE_NOTE = "Paiement unique, sans renouvellement automatique";
export const PRICING_MODEL_TITLE = "Une tarification claire, pens\u00e9e pour durer";
export const PRICING_MODEL_TEXT =
  "Choisis la dur\u00e9e qui correspond \u00e0 ton rythme : l'acc\u00e8s est complet d\u00e8s l'activation, avec paiement s\u00e9curis\u00e9 et sans renouvellement automatique.";
export const PRICING_BILLING_MESSAGE = "Montants factur\u00e9s en FCFA (XOF).";
export const PRICING_INDICATIVE_MESSAGE =
  "Les \u00e9quivalents en \u20ac et $ sont affich\u00e9s \u00e0 titre indicatif selon le taux de change.";
export const PRICING_CONVERSION_MESSAGE =
  "La conversion finale est appliqu\u00e9e automatiquement par votre banque ou votre moyen de paiement, si n\u00e9cessaire.";

export const PRICING_REASSURANCE_POINTS = [
  "Paiement s\u00e9curis\u00e9 par carte et Mobile Money",
  "Acc\u00e8s activ\u00e9 d\u00e8s confirmation du paiement",
  "Tarification claire, sans renouvellement automatique",
];

export const ACCEPTED_PAYMENT_METHODS: PaymentMethodBadge[] = [
  { label: "Visa", tone: "card" },
  { label: "Mastercard", tone: "card" },
  { label: "Orange Money", tone: "orange" },
  { label: "MTN Mobile Money", tone: "mtn" },
  { label: "Moov Money", tone: "moov" },
  { label: "Wave", tone: "wave" },
];

export const PLAN_MARKETING: Record<string, PlanMarketing> = {
  pass_7d: {
    title: "Pass D\u00e9couverte",
    durationLabel: "7 jours",
    description: "Id\u00e9al pour d\u00e9couvrir JobRadar et lancer une recherche cibl\u00e9e sur une semaine.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: "Une formule souple pour tester la plateforme avec un acc\u00e8s complet pendant 7 jours.",
    ctaLabel: "Activer mon pass",
  },
  pass_30d: {
    title: "Pass Mensuel",
    durationLabel: "30 jours",
    description: "Le bon \u00e9quilibre pour suivre les offres et candidater avec r\u00e9gularit\u00e9.",
    badge: "Recommand\u00e9",
    badgeTone: "featured",
    launchNote: "Le format le plus \u00e9quilibr\u00e9 pour garder un vrai rythme sur un mois complet.",
    ctaLabel: "Activer mon pass",
  },
  pass_90d: {
    title: "Pass Avantage",
    durationLabel: "90 jours",
    description: "La solution la plus avantageuse pour installer une recherche durable.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: "Id\u00e9al pour rester constant, affiner ton ciblage et multiplier les opportunit\u00e9s.",
    ctaLabel: "Activer mon pass",
  },
};

export function getPlanMarketing(
  planCode: string,
  fallbackName: string,
  durationDays: number
): PlanMarketing {
  return (
    PLAN_MARKETING[planCode] ?? {
      title: fallbackName,
      durationLabel: `${durationDays} jours`,
      description: PRICING_ACCESS_MESSAGE,
      badge: "Disponible",
      badgeTone: "available",
      launchNote: PRICING_ACCESS_MESSAGE,
      ctaLabel: "Activer mon pass",
    }
  );
}

export function formatAmount(amountMinor: number, currency: string) {
  const frac = currency === "XOF" ? 0 : 2;
  const amount = frac === 0 ? amountMinor : amountMinor / 100;
  const digits = frac === 0 ? 0 : Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    if (currency === "USD") {
      return `${amount.toFixed(digits)} $US`;
    }
    if (currency === "EUR") {
      return `${amount.toFixed(digits)} EUR`;
    }
    return `${amount} ${currency}`;
  }
}

function formatIndicativeAmount(amount: number, symbol: string) {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const label = rounded.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${label}`;
}

export function formatPlanDisplayPrices(amountXof: number): PlanDisplayPrices {
  const eurLabel = formatIndicativeAmount(amountXof / EUR_XOF, "\u20ac");
  const usdLabel = formatIndicativeAmount(amountXof / USD_XOF, "$");

  return {
    xofLabel: formatAmount(amountXof, "XOF"),
    eurLabel,
    usdLabel,
    combinedLabel: `\u2248 ${eurLabel} / ${usdLabel}`,
  };
}
