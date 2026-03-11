export type CurrencyOption = { code: "XOF" | "USD" | "EUR"; label: string };

export const PRICING_CURRENCIES: CurrencyOption[] = [
  { code: "XOF", label: "Afrique de l'Ouest (XOF)" },
  { code: "USD", label: "International (USD)" },
  { code: "EUR", label: "International (EUR)" },
];

export const PLAN_BENEFITS: Record<string, string> = {
  pass_7d: "Idéal pour découvrir JobRadar rapidement",
  pass_30d: "Le plus équilibré pour une recherche active",
  pass_90d: "Le meilleur format pour maximiser tes opportunités",
};

export function formatAmount(amountMinor: number, currency: string) {
  const frac = currency === "XOF" ? 0 : 2;
  const amount = frac === 0 ? amountMinor : amountMinor / 100;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatPaymentMethod(method?: string | null) {
  if (!method) return "Tous moyens";
  switch (method) {
    case "mobile_money":
      return "Mobile Money";
    case "card":
      return "Carte";
    case "wallet":
      return "Wallet";
    case "bank_transfer":
      return "Virement";
    default:
      return method.replaceAll("_", " ");
  }
}
