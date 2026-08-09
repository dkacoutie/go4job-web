import { useContext } from "react";
import { PartnerReferralContext } from "./partnerReferralContext";

export function usePartnerReferral() {
  const context = useContext(PartnerReferralContext);
  if (!context) {
    throw new Error("usePartnerReferral must be used within PartnerReferralProvider");
  }
  return context;
}
