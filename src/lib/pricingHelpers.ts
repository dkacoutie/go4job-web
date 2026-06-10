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
export const PRICING_SECTION_TITLE = "Choisissez le Pass qui correspond à votre rythme";
export const PRICING_SECTION_SUBTITLE =
  "Activez votre accès complet à JobRadar avec une tarification claire et un paiement sécurisé.";
export const PRICING_ACCESS_MESSAGE =
  "Accès complet à JobRadar pendant toute la durée choisie.";
export const PRICING_PRICE_NOTE = "Sans renouvellement automatique";
export const PRICING_MODEL_TITLE = "Une tarification claire, pensée pour durer";
export const PRICING_MODEL_TEXT =
  "Choisissez la durée qui correspond à votre rythme : l'accès est complet après confirmation du paiement, avec paiement sécurisé et sans renouvellement automatique.";
export const PRICING_BILLING_MESSAGE =
  "Prix affichés selon votre région. Le montant final est affiché avant confirmation du paiement.";
export const PRICING_INDICATIVE_MESSAGE =
  "Pour les utilisateurs européens, les prix EUR sont des prix d'affichage marketing.";
export const PRICING_CONVERSION_MESSAGE = "Carte bancaire et Mobile Money acceptés via Paystack.";

export const PRICING_REASSURANCE_POINTS = [
  "Paiement sécurisé par carte ou Mobile Money",
  "Votre Pass est activé après confirmation du paiement",
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
    shortLine: "Pour vous faire votre propre avis",
    headline: "7 jours pour explorer JobRadar sans engagement.",
    description:
      "Accès complet aux offres et alertes. Idéal pour découvrir le service avant de vous décider.",
    badge: "Disponible",
    badgeTone: "available",
    launchNote: PRICING_PRICE_NOTE,
    ctaLabel: "Essayer 7 jours",
  },
  pass_30d: {
    title: "Pass Mensuel",
    durationLabel: "30 jours",
    shortLine: "Pour une recherche active et organisée",
    headline: "30 jours pour suivre vos opportunités plus facilement.",
    description: "Recevez des alertes ciblées selon votre profil et votre zone de recherche.",
    badge: "Le plus choisi",
    badgeTone: "featured",
    launchNote: PRICING_PRICE_NOTE,
    ctaLabel: "Activer 30 jours",
  },
  pass_90d: {
    title: "Pass Avantage",
    durationLabel: "90 jours",
    shortLine: "Pour suivre votre recherche sur la durée",
    headline: "90 jours au meilleur rapport durée/prix.",
    description: "Suivez les opportunités pendant plusieurs semaines, sans devoir renouveler trop souvent.",
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
      shortLine: "Pour avancer dans votre recherche",
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
