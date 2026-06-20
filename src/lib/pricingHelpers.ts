export type PlanMarketing = {
  title: string;
  durationLabel: string;
  shortLine: string;
  headline: string;
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

export const FEATURED_PLAN_CODE = "pass_30d";
export const PRICING_SECTION_EYEBROW = "Plans JobRadar";
export const PRICING_SECTION_TITLE = "Choisis le pass qui correspond à ton rythme";
export const PRICING_SECTION_SUBTITLE =
  "Tu paies une fois et tu accèdes à JobRadar pendant la durée choisie, sans renouvellement automatique.";
export const PRICING_ACCESS_MESSAGE =
  "Accès complet à JobRadar pendant toute la durée choisie.";
export const PRICING_PRICE_NOTE = "Sans renouvellement automatique";
export const PRICING_REASSURANCE_MESSAGE =
  "Paiement unique · Carte ou Mobile Money · Aucun renouvellement automatique";
export const PRICING_CURRENCY_MESSAGE =
  "Le paiement est traité en francs CFA (FCFA). Montant exact affiché avant confirmation.";
export const PRICING_MODEL_TITLE = "Une tarification claire, pensée pour durer";
export const PRICING_MODEL_TEXT =
  "Choisis la durée qui correspond à ton rythme : ton accès est activé après confirmation du paiement, sans renouvellement automatique.";
export const PRICING_BILLING_MESSAGE =
  PRICING_CURRENCY_MESSAGE;
export const PRICING_INDICATIVE_MESSAGE =
  "L’équivalent en euros est indicatif. Le paiement est effectué en francs CFA.";
export const PRICING_CONVERSION_MESSAGE = PRICING_REASSURANCE_MESSAGE;

export const PRICING_REASSURANCE_POINTS = [
  "Paiement sécurisé par carte ou Mobile Money",
  "Ton pass est activé après confirmation du paiement",
  "Paiement unique, sans renouvellement automatique",
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
    title: "Pass Découverte",
    durationLabel: "7 jours",
    shortLine: "Pour te faire ton propre avis",
    headline: "7 jours pour explorer JobRadar sans engagement.",
    description:
      "Accès complet aux offres et alertes. Idéal pour découvrir le service avant de te décider.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: PRICING_PRICE_NOTE,
    ctaLabel: "Activer 7 jours",
  },
  pass_30d: {
    title: "Pass Actif",
    durationLabel: "30 jours",
    shortLine: "Pour une recherche active et organisée",
    headline: "30 jours pour suivre tes opportunités plus facilement.",
    description: "Reçois des alertes ciblées selon ton profil et ta zone de recherche.",
    badge: "Le plus choisi",
    badgeTone: "featured",
    launchNote: PRICING_PRICE_NOTE,
    ctaLabel: "Activer 30 jours",
  },
  pass_90d: {
    title: "Pass Avantage",
    durationLabel: "90 jours",
    shortLine: "Pour suivre ta recherche sur la durée",
    headline: "90 jours au meilleur rapport durée/prix.",
    description: "Suis les opportunités pendant plusieurs semaines, sans devoir renouveler trop souvent.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: PRICING_PRICE_NOTE,
    ctaLabel: "Activer 90 jours",
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
      shortLine: "Pour avancer dans ta recherche",
      headline: PRICING_ACCESS_MESSAGE,
      description: PRICING_ACCESS_MESSAGE,
      badge: "Disponible",
      badgeTone: "available",
      launchNote: PRICING_PRICE_NOTE,
      ctaLabel: "Activer ce Pass",
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
