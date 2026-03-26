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
export const PRICING_BILLING_MESSAGE = "Facturation en FCFA (XOF).";
export const PRICING_INDICATIVE_MESSAGE =
  "Les montants en \u20ac et $ sont donn\u00e9s \u00e0 titre indicatif selon le taux de change.";
export const PRICING_CONVERSION_MESSAGE =
  "La conversion finale est appliqu\u00e9e automatiquement par votre banque ou votre moyen de paiement, si n\u00e9cessaire.";

export const LAUNCH_REASSURANCE_POINTS = [
  "Paiement simple par Mobile Money",
  "Acc\u00e8s imm\u00e9diat apr\u00e8s paiement",
  "Tarif de lancement susceptible d'\u00e9voluer",
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
    description: "Id\u00e9al pour d\u00e9couvrir JobRadar rapidement.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: "Un format simple pour tester le service sans engagement long.",
    ctaLabel: "Activer mon pass",
  },
  pass_30d: {
    title: "Pass Mensuel",
    durationLabel: "30 jours",
    description: "Le plus \u00e9quilibr\u00e9 pour une recherche active.",
    badge: "Le plus choisi",
    badgeTone: "featured",
    launchNote: "La meilleure option pour garder un vrai rythme et avancer avec r\u00e9gularit\u00e9.",
    ctaLabel: "Activer mon pass",
  },
  pass_90d: {
    title: "Pass Avantage",
    durationLabel: "90 jours",
    description: "Le meilleur format pour maximiser tes opportunit\u00e9s.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: "Une option confortable pour rester constant sur une recherche plus longue.",
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
      description: "Acc\u00e8s complet \u00e0 JobRadar pendant toute la dur\u00e9e choisie.",
      badge: "Disponible",
      badgeTone: "available",
      launchNote: "Tarif de lancement.",
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
