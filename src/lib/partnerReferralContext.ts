import { createContext } from "react";
import type { StoredPartnerReferral } from "./partnerReferral";

export type PartnerReferralContextValue = {
  referral: StoredPartnerReferral | null;
  referralCode: string | null;
  hasReferral: boolean;
  setReferralCode: (code: string, sourcePath?: string | null) => void;
  clearReferral: () => void;
  refreshReferral: () => void;
};

export const PartnerReferralContext = createContext<PartnerReferralContextValue | null>(null);
