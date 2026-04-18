import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

export type PaymentMarket = "eur" | "xof";

export type PaymentMarketResolutionSource =
  | "payment_preference"
  | "last_successful_payment"
  | "country_code"
  | "geoip_locale"
  | "xof_default";

export type PaymentMarketResolution = {
  market: PaymentMarket;
  currency: "EUR" | "XOF";
  source: PaymentMarketResolutionSource;
  signals: {
    payment_preference: PaymentMarket | null;
    last_successful_payment_currency: string | null;
    profile_country_code: string | null;
    geo_country_code: string | null;
    locale: string | null;
    locale_region: string | null;
  };
  checkout: {
    active_market: "xof";
    active_currency: "XOF";
    active_provider_code: "paystack";
    eur_provider_status: "ready" | "planned";
  };
};

const SESSION_KEY_PREFIX = "jobradar.payment-market.v1";

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

function getCacheKey(userId: string | null | undefined) {
  return `${SESSION_KEY_PREFIX}:${userId ?? "guest"}`;
}

function extractLocaleRegion(locale: string | null | undefined): string | null {
  const normalized = (locale ?? "").trim();
  if (!normalized) return null;

  const match = normalized.match(/[-_]([A-Za-z]{2,3})/);
  if (!match?.[1]) return null;

  return match[1].slice(0, 2).toUpperCase();
}

function isEuropeMarketCountry(countryCode: string | null): boolean {
  return Boolean(countryCode && EUROPE_MARKET_COUNTRY_CODES.has(countryCode));
}

function getBrowserLocales() {
  if (typeof window === "undefined") {
    return { locale: null, locales: [] as string[] };
  }

  const languages = Array.isArray(window.navigator.languages)
    ? window.navigator.languages.filter(Boolean)
    : [];
  const locale = languages[0] ?? window.navigator.language ?? null;

  return {
    locale: locale ?? null,
    locales: locale ? [locale, ...languages.filter((entry) => entry !== locale)] : languages,
  };
}

function buildResolution(
  market: PaymentMarket,
  source: PaymentMarketResolutionSource,
  locale: string | null,
): PaymentMarketResolution {
  return {
    market,
    currency: market === "eur" ? "EUR" : "XOF",
    source,
    signals: {
      payment_preference: source === "payment_preference" ? market : null,
      last_successful_payment_currency: null,
      profile_country_code: null,
      geo_country_code: null,
      locale,
      locale_region: extractLocaleRegion(locale),
    },
    checkout: {
      active_market: "xof",
      active_currency: "XOF",
      active_provider_code: "paystack",
      eur_provider_status: "planned",
    },
  };
}

function buildGuestResolution(preferredMarket?: PaymentMarket | null): PaymentMarketResolution {
  const { locale } = getBrowserLocales();
  if (preferredMarket) {
    return buildResolution(preferredMarket, "payment_preference", locale);
  }

  const localeRegion = extractLocaleRegion(locale);
  if (isEuropeMarketCountry(localeRegion)) {
    return buildResolution("eur", "geoip_locale", locale);
  }

  return buildResolution("xof", "xof_default", locale);
}

function readSessionResolution(userId: string | null | undefined): PaymentMarketResolution | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(getCacheKey(userId ?? null));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PaymentMarketResolution | null;
    return parsed?.market ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionResolution(
  userId: string | null | undefined,
  resolution: PaymentMarketResolution,
) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(getCacheKey(userId ?? null), JSON.stringify(resolution));
  } catch {
    // Ignore session cache failures.
  }
}

function extractInvokeMessage(error: { message?: string; context?: { body?: { message?: string } } }) {
  return error.context?.body?.message || error.message || "Une erreur est survenue.";
}

export function usePaymentMarket(userId: string | null | undefined) {
  const initialResolution = useMemo(
    () => readSessionResolution(userId) ?? buildGuestResolution(),
    [userId],
  );

  const [resolution, setResolution] = useState<PaymentMarketResolution>(initialResolution);
  const [loading, setLoading] = useState(Boolean(userId));
  const [savingPreference, setSavingPreference] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const cached = readSessionResolution(userId);
    if (cached) {
      setResolution(cached);
    }

    if (!userId) {
      const guestResolution = cached ?? buildGuestResolution();
      setResolution(guestResolution);
      writeSessionResolution(userId, guestResolution);
      setLoading(false);
      return guestResolution;
    }

    setLoading(true);
    setError(null);

    const { locale, locales } = getBrowserLocales();
    const { data, error: invokeError } = await supabase.functions.invoke("payment_market_resolve", {
      body: { locale, locales },
    });

    if (invokeError) {
      const fallbackResolution = cached ?? buildGuestResolution();
      setResolution(fallbackResolution);
      writeSessionResolution(userId, fallbackResolution);
      setError(extractInvokeMessage(invokeError));
      setLoading(false);
      return fallbackResolution;
    }

    const nextResolution = (data?.resolution ?? null) as PaymentMarketResolution | null;
    if (nextResolution?.market) {
      setResolution(nextResolution);
      writeSessionResolution(userId, nextResolution);
    }

    setLoading(false);
    return nextResolution ?? cached ?? buildGuestResolution();
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPreference = useCallback(
    async (market: PaymentMarket) => {
      setError(null);

      if (!userId) {
        const nextResolution = buildGuestResolution(market);
        setResolution(nextResolution);
        writeSessionResolution(userId, nextResolution);
        return nextResolution;
      }

      setSavingPreference(true);
      const { locale, locales } = getBrowserLocales();

      try {
        const { data, error: invokeError } = await supabase.functions.invoke("payment_preference_set", {
          body: {
            payment_preference: market,
            locale,
            locales,
          },
        });

        if (invokeError) {
          throw new Error(extractInvokeMessage(invokeError));
        }

        const nextResolution = (data?.resolution ?? null) as PaymentMarketResolution | null;
        if (!nextResolution?.market) {
          throw new Error("Resolution paiement indisponible.");
        }

        setResolution(nextResolution);
        writeSessionResolution(userId, nextResolution);
        return nextResolution;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Impossible d'enregistrer la preference.";
        setError(message);
        throw err;
      } finally {
        setSavingPreference(false);
      }
    },
    [userId],
  );

  return {
    resolution,
    loading,
    savingPreference,
    error,
    refresh,
    setPreference,
    canPersistPreference: Boolean(userId),
  };
}
