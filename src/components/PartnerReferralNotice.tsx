import { useMemo } from "react";
import { usePartnerReferral } from "../lib/usePartnerReferral";
import "./PartnerReferralNotice.css";

type PartnerReferralNoticeProps = {
  compact?: boolean;
};

export default function PartnerReferralNotice({ compact = false }: PartnerReferralNoticeProps) {
  const { referral, clearReferral } = usePartnerReferral();

  const summary = useMemo(() => {
    if (!referral) return null;

    return {
      code: referral.code,
      sourcePath: referral.sourcePath,
    };
  }, [referral]);

  if (!summary) return null;

  return (
    <div className={`partnerReferralNotice${compact ? " partnerReferralNotice--compact" : ""}`} aria-live="polite">
      <div className="partnerReferralNotice__body">
        <span className="partnerReferralNotice__label">Code partenaire applique</span>
        <strong className="partnerReferralNotice__code">{summary.code}</strong>
        {!compact ? (
          <span className="partnerReferralNotice__text">
            Il sera conserve pour la suite du parcours et pourra etre reutilise au moment du paiement.
          </span>
        ) : null}
      </div>

      <button type="button" className="partnerReferralNotice__clear" onClick={clearReferral}>
        Retirer
      </button>
    </div>
  );
}
