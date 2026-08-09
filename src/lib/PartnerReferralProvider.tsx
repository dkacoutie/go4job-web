import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  capturePartnerReferralFromSearch,
  clearPartnerReferral,
  getPartnerReferralCode,
  hasPartnerReferral,
  readPartnerReferral,
  writePartnerReferral,
  type StoredPartnerReferral,
  PARTNER_REFERRAL_STORAGE_KEY,
} from "./partnerReferral";
import { PartnerReferralContext, type PartnerReferralContextValue } from "./partnerReferralContext";

export function PartnerReferralProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [referral, setReferral] = useState<StoredPartnerReferral | null>(() => readPartnerReferral());

  const refreshReferral = useCallback(() => {
    setReferral(readPartnerReferral());
  }, []);

  useEffect(() => {
    const result = capturePartnerReferralFromSearch(location.search, location.pathname, location.hash);

    if (result.didReplace && result.cleanedRelativeUrl && typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", result.cleanedRelativeUrl);
    }

    if (result.didCapture || result.didReplace || result.hasQueryParam) {
      setReferral(readPartnerReferral());
    }
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (event: StorageEvent) => {
      if (event.key === PARTNER_REFERRAL_STORAGE_KEY) {
        setReferral(readPartnerReferral());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setReferralCode = useCallback((code: string, sourcePath?: string | null) => {
    writePartnerReferral(code, sourcePath);
    setReferral(readPartnerReferral());
  }, []);

  const clearReferralValue = useCallback(() => {
    clearPartnerReferral();
    setReferral(null);
  }, []);

  const value = useMemo<PartnerReferralContextValue>(
    () => ({
      referral,
      referralCode: referral?.code ?? getPartnerReferralCode(),
      hasReferral: referral ? true : hasPartnerReferral(),
      setReferralCode,
      clearReferral: clearReferralValue,
      refreshReferral,
    }),
    [clearReferralValue, referral, refreshReferral, setReferralCode]
  );

  return <PartnerReferralContext.Provider value={value}>{children}</PartnerReferralContext.Provider>;
}
