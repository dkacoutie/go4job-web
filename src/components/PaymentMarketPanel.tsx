import { type PaymentMarket, type PaymentMarketResolution } from "../lib/paymentMarket";

const PAYMENT_PREFERENCE_ERROR_MESSAGE =
  "Impossible d'enregistrer votre préférence pour l'instant. Vous pouvez continuer.";

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
      return "choix enregistré";
    case "last_successful_payment":
      return "dernier paiement confirmé";
    case "country_code":
      return "pays de profil";
    case "geoip_locale":
      return "localisation";
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

  return (
    <section className="payment-market-panel" aria-label="Devise d'affichage">
      <div className="payment-market-panel__head">
        <div>
          <div className="payment-market-panel__eyebrow">Afficher les prix en</div>
          <div className="payment-market-panel__title">{resolution.market === "eur" ? "EUR" : "XOF"}</div>
        </div>
        <div className="payment-market-panel__source">{sourceLabel(resolution.source)}</div>
      </div>

      <div className="payment-market-panel__choices" role="group" aria-label="Afficher les prix en">
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
          ? "Les prix sont affichés en euros. Le montant final est affiché avant confirmation du paiement."
          : "Les prix sont affichés en francs CFA. Le montant final est affiché avant confirmation du paiement."}
      </p>

      {!canPersistPreference && (
        <p className="payment-market-panel__note">
          Votre sélection est gardée pour cette session. Connectez-vous pour l'enregistrer sur votre profil.
        </p>
      )}

      {error && <div className="pricing-error">{PAYMENT_PREFERENCE_ERROR_MESSAGE}</div>}
    </section>
  );
}
