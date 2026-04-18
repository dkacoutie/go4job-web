export type PaymentMarket = "eur" | "xof";

export type PaymentMarketResolutionSource =
  | "payment_preference"
  | "last_successful_payment"
  | "country_code"
  | "geoip_locale"
  | "xof_default";

export type PaymentMarketCheckoutStatus = "ready" | "planned";

export type PaymentMarketSignals = {
  payment_preference: PaymentMarket | null;
  last_successful_payment_currency: string | null;
  profile_country_code: string | null;
  geo_country_code: string | null;
  locale: string | null;
  locale_region: string | null;
};

export type PaymentMarketResolution = {
  market: PaymentMarket;
  currency: "EUR" | "XOF";
  source: PaymentMarketResolutionSource;
  signals: PaymentMarketSignals;
  checkout: {
    active_market: "xof";
    active_currency: "XOF";
    active_provider_code: "paystack";
    eur_provider_status: PaymentMarketCheckoutStatus;
  };
};

type ResolvePaymentMarketArgs = {
  paymentPreference?: string | null;
  lastSuccessfulPaymentCurrency?: string | null;
  profileCountryCode?: string | null;
  geoCountryCode?: string | null;
  locale?: string | null;
  localeRegion?: string | null;
};

const EUROPE_MARKET_COUNTRY_CODES = new Set([
  "AD",
  "AL",
  "AT",
  "AX",
  "BA",
  "BE",
  "BG",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FO",
  "FR",
  "GB",
  "GG",
  "GI",
  "GR",
  "HR",
  "HU",
  "IE",
  "IM",
  "IS",
  "IT",
  "JE",
  "LI",
  "LT",
  "LU",
  "LV",
  "MC",
  "MD",
  "ME",
  "MK",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "RS",
  "SE",
  "SI",
  "SK",
  "SM",
  "UA",
  "VA",
]);

const GEO_HEADER_NAMES = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-country-code",
  "x-client-geo-country",
  "x-geo-country",
];

export function normalizePaymentMarket(value: string | null | undefined): PaymentMarket | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "eur" || normalized === "xof") return normalized;
  return null;
}

export function normalizeCurrency(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || null;
}

export function normalizeCountryCode(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.length !== 2) return null;
  return normalized;
}

export function extractLocaleRegion(locale: string | null | undefined): string | null {
  const normalized = (locale ?? "").trim();
  if (!normalized) return null;

  const match = normalized.match(/[-_](\p{Letter}{2}|\p{Letter}{3})/u);
  if (!match?.[1]) return null;

  return match[1].slice(0, 2).toUpperCase();
}

export function extractLocalesFromHeader(headerValue: string | null): string[] {
  if (!headerValue) return [];

  return headerValue
    .split(",")
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter(Boolean);
}

export function resolveGeoCountryCode(req: Request): string | null {
  for (const headerName of GEO_HEADER_NAMES) {
    const raw = req.headers.get(headerName);
    const countryCode = normalizeCountryCode(raw);
    if (countryCode) return countryCode;
  }

  const netlifyGeo = req.headers.get("x-nf-geo");
  if (!netlifyGeo) return null;

  try {
    const parsed = JSON.parse(netlifyGeo) as
      | { country?: { code?: string | null } | null; country_code?: string | null }
      | null;

    return (
      normalizeCountryCode(parsed?.country?.code) ??
      normalizeCountryCode(parsed?.country_code) ??
      null
    );
  } catch {
    return null;
  }
}

function isEuropeMarketCountry(countryCode: string | null): boolean {
  return Boolean(countryCode && EUROPE_MARKET_COUNTRY_CODES.has(countryCode));
}

function currencyToMarket(currency: string | null): PaymentMarket | null {
  if (!currency) return null;
  if (currency === "EUR") return "eur";
  if (currency === "XOF") return "xof";
  return null;
}

export function resolvePaymentMarket(args: ResolvePaymentMarketArgs): PaymentMarketResolution {
  const paymentPreference = normalizePaymentMarket(args.paymentPreference);
  const lastSuccessfulPaymentCurrency = normalizeCurrency(args.lastSuccessfulPaymentCurrency);
  const profileCountryCode = normalizeCountryCode(args.profileCountryCode);
  const geoCountryCode = normalizeCountryCode(args.geoCountryCode);
  const locale = (args.locale ?? "").trim() || null;
  const localeRegion = normalizeCountryCode(args.localeRegion ?? extractLocaleRegion(locale));

  const signals: PaymentMarketSignals = {
    payment_preference: paymentPreference,
    last_successful_payment_currency: lastSuccessfulPaymentCurrency,
    profile_country_code: profileCountryCode,
    geo_country_code: geoCountryCode,
    locale,
    locale_region: localeRegion,
  };

  if (paymentPreference) {
    return buildResolution("payment_preference", paymentPreference, signals);
  }

  const lastPaymentMarket = currencyToMarket(lastSuccessfulPaymentCurrency);
  if (lastPaymentMarket) {
    return buildResolution("last_successful_payment", lastPaymentMarket, signals);
  }

  if (profileCountryCode) {
    return buildResolution(
      "country_code",
      isEuropeMarketCountry(profileCountryCode) ? "eur" : "xof",
      signals,
    );
  }

  if (geoCountryCode || localeRegion) {
    const geoMarket = isEuropeMarketCountry(geoCountryCode) ? "eur" : geoCountryCode ? "xof" : null;
    const localeMarket = isEuropeMarketCountry(localeRegion) ? "eur" : localeRegion ? "xof" : null;
    const combinedMarket = geoMarket ?? localeMarket ?? "xof";

    return buildResolution("geoip_locale", combinedMarket, signals);
  }

  return buildResolution("xof_default", "xof", signals);
}

function buildResolution(
  source: PaymentMarketResolutionSource,
  market: PaymentMarket,
  signals: PaymentMarketSignals,
): PaymentMarketResolution {
  return {
    market,
    currency: market === "eur" ? "EUR" : "XOF",
    source,
    signals,
    checkout: {
      active_market: "xof",
      active_currency: "XOF",
      active_provider_code: "paystack",
      eur_provider_status: "planned",
    },
  };
}
