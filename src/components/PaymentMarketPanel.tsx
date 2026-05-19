import { type PaymentMarket, type PaymentMarketResolution } from "../lib/paymentMarket";

const PAYMENT_PREFERENCE_ERROR_MESSAGE =
  "Impossible d'enregistrer ta préférence pour l'instant. Tu peux continuer : le paiement reste en FCFA (XOF).";

type PaymentMarketPanelProps = {
  resolution: PaymentMarketResolution;
  loading: boolean;
  savingPreference: boolean;
  error: string | null;
  canPersistPreference: boolean;
  onSelect: (market: PaymentMarket) => Promise<unknown>;
};

function sourceLabel(source: PaymentMarketResolution["source"]) {
  switch (source) {
    case "payment_preference":
      return "selon ton choix enregistré";
    case "last_successful_payment":
      return "selon ton dernier paiement confirmé";
    case "country_code":
      return "selon ton pays de profil";
    case "geoip_locale":
      return "selon ta localisation et la langue du navigateur";
    case "xof_default":
    default:
      return "par défaut";
  }
}

export default function PaymentMarketPanel({
  resolution,
  loading,
  savingPreference,
  error,
  canPersistPreference,
  onSelect,
}: PaymentMarketPanelProps) {
  const isBusy = loading || savingPreference;
  const titleLabel =
    resolution.market === "eur" ? "Affichage préféré : EUR" : "Affichage préféré : XOF";

  return (
    <section className="payment-market-panel" aria-label="Devise préférée">
      <div className="payment-market-panel__head">
        <div>
          <div className="payment-market-panel__eyebrow">Devise préférée</div>
          <div className="payment-market-panel__title">{titleLabel}</div>
        </div>
        <div className="payment-market-panel__source">{sourceLabel(resolution.source)}</div>
      </div>

      <p className="payment-market-panel__body">
        Prix affichés en EUR pour les utilisateurs européens. Le paiement final est traité en{" "}
        <strong>XOF</strong> via Paystack.
      </p>

      <div className="payment-market-panel__choices" role="group" aria-label="Choisir une devise d'affichage">
        <button
          type="button"
          className={`payment-market-panel__choice ${resolution.market === "eur" ? "is-active" : ""}`}
          onClick={() => void onSelect("eur")}
          disabled={isBusy}
        >
          EUR
        </button>
        <button
          type="button"
          className={`payment-market-panel__choice ${resolution.market === "xof" ? "is-active" : ""}`}
          onClick={() => void onSelect("xof")}
          disabled={isBusy}
        >
          XOF
        </button>
      </div>

      <p className="payment-market-panel__note">
        {resolution.market === "eur"
          ? "Ton choix EUR est enregistré pour l'affichage."
          : "Ton affichage reste aligné sur le paiement en FCFA (XOF)."}
      </p>

      {!canPersistPreference && (
        <p className="payment-market-panel__note">
          Ta sélection est gardée pour cette session. Connecte-toi pour l'enregistrer sur ton profil.
        </p>
      )}

      {error && <div className="pricing-error">{PAYMENT_PREFERENCE_ERROR_MESSAGE}</div>}
    </section>
  );
}
