import { formatAmount } from "./pricingHelpers";

type PremiumDisplayPrice = {
  displayEur: number;
  eurLabel: string;
};

export const PREMIUM_DISPLAY_PRICES: Record<string, PremiumDisplayPrice> = {
  pass_7d: {
    displayEur: 2.99,
    eurLabel: "2,99 €",
  },
  pass_30d: {
    displayEur: 6.99,
    eurLabel: "6,99 €",
  },
  pass_90d: {
    displayEur: 14.99,
    eurLabel: "14,99 €",
  },
};

export const EUROPE_PAYSTACK_NOTICE =
  "Le paiement est traité en francs CFA (FCFA). Montant exact affiché avant confirmation.";
export const XOF_PAYSTACK_NOTICE =
  "Le paiement est traité en francs CFA (FCFA). Montant exact affiché avant confirmation.";

export function formatCheckoutXof(amountXof: number) {
  return formatAmount(amountXof, "XOF").replace(/\s?F\s?CFA$/i, " FCFA");
}

export function getPremiumDisplayPrice(planCode: string, amountXof: number, market: "eur" | "xof") {
  const eurPrice = PREMIUM_DISPLAY_PRICES[planCode];
  const xofLabel = formatCheckoutXof(amountXof);
  const primaryLabel = market === "eur" && eurPrice ? eurPrice.eurLabel : xofLabel;
  const durationLabel =
    planCode === "pass_7d" ? "7 jours" : planCode === "pass_30d" ? "30 jours" : planCode === "pass_90d" ? "90 jours" : null;

  return {
    primaryLabel,
    ctaLabel: durationLabel ? `Activer ${durationLabel} — ${xofLabel}` : `Activer ce pass — ${xofLabel}`,
    xofLabel,
    eurLabel: eurPrice?.eurLabel ?? null,
    paystackNotice: market === "eur" ? EUROPE_PAYSTACK_NOTICE : XOF_PAYSTACK_NOTICE,
  };
}

export function getStartingPremiumLabel(market: "eur" | "xof") {
  return market === "eur" ? "2,99 €" : "1 500 FCFA";
}
