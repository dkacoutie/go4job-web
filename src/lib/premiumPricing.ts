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
  "Paiement sécurisé par Paystack. Le montant final est traité en XOF. Des frais de conversion peuvent être appliqués par votre banque.";
export const XOF_PAYSTACK_NOTICE = "Paiement sécurisé par Paystack.";

export function formatCheckoutXof(amountXof: number) {
  return formatAmount(amountXof, "XOF").replace(/\s?F\s?CFA$/i, " FCFA");
}

export function getPremiumDisplayPrice(planCode: string, checkoutXof: number, market: "eur" | "xof") {
  const eurPrice = PREMIUM_DISPLAY_PRICES[planCode];
  const xofLabel = formatCheckoutXof(checkoutXof);
  const primaryLabel = market === "eur" && eurPrice ? eurPrice.eurLabel : xofLabel;

  return {
    primaryLabel,
    ctaLabel: `Continuer — ${primaryLabel}`,
    xofLabel,
    eurLabel: eurPrice?.eurLabel ?? null,
    paystackNotice: market === "eur" ? EUROPE_PAYSTACK_NOTICE : XOF_PAYSTACK_NOTICE,
  };
}

export function getStartingPremiumLabel(market: "eur" | "xof") {
  return market === "eur" ? "2,99 €" : "1 500 FCFA";
}
