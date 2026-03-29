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
export const PRICING_SECTION_TITLE = "Choisis le pass qui correspond à ton rythme";
export const PRICING_SECTION_SUBTITLE =
  "Active ton accès complet à JobRadar avec une tarification claire et un paiement sécurisé.";
export const PRICING_ACCESS_MESSAGE =
  "Accès complet à JobRadar pendant toute la durée choisie.";
export const PRICING_PRICE_NOTE = "Paiement unique, sans renouvellement automatique";
export const PRICING_MODEL_TITLE = "Une tarification claire, pensée pour durer";
export const PRICING_MODEL_TEXT =
  "Choisis la durée qui correspond à ton rythme : l’accès est complet dès l’activation, avec paiement sécurisé et sans renouvellement automatique.";
export const PRICING_BILLING_MESSAGE = "Montants facturés en FCFA (XOF).";
export const PRICING_INDICATIVE_MESSAGE =
  "Les équivalents en € et $ sont affichés à titre indicatif selon le taux de change.";
export const PRICING_CONVERSION_MESSAGE =
  "La conversion finale est appliquée automatiquement par votre banque ou votre moyen de paiement, si nécessaire.";

export const PRICING_REASSURANCE_POINTS = [
  "Paiement sécurisé par carte et Mobile Money",
  "Accès activé dès confirmation du paiement",
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
    description: "Idéal pour découvrir JobRadar et lancer une recherche ciblée sur une semaine.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: "Une formule souple pour tester la plateforme avec un accès complet pendant 7 jours.",
    ctaLabel: "Activer mon pass",
  },
  pass_30d: {
    title: "Pass Mensuel",
    durationLabel: "30 jours",
    description: "Le bon équilibre pour suivre les offres et candidater avec régularité.",
    badge: "Recommandé",
    badgeTone: "featured",
    launchNote: "Le format le plus équilibré pour garder un vrai rythme sur un mois complet.",
    ctaLabel: "Activer mon pass",
  },
  pass_90d: {
    title: "Pass Avantage",
    durationLabel: "90 jours",
    description: "La solution la plus avantageuse pour installer une recherche durable.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: "Idéal pour rester constant, affiner ton ciblage et multiplier les opportunités.",
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
