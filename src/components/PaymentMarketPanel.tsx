import { type PaymentMarket, type PaymentMarketResolution } from "../lib/paymentMarket";

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
      return "selon ta preference enregistree";
    case "last_successful_payment":
      return "selon ton dernier paiement confirme";
    case "country_code":
      return "selon ton pays de profil";
    case "geoip_locale":
      return "selon ta localisation et la langue du navigateur";
    case "xof_default":
    default:
      return "par defaut";
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
  const recommendedLabel = resolution.market === "eur" ? "EUR recommande" : "XOF recommande";

  return (
    <section className="payment-market-panel" aria-label="Marche paiement">
      <div className="payment-market-panel__head">
        <div>
          <div className="payment-market-panel__eyebrow">Marche paiement</div>
          <div className="payment-market-panel__title">{recommendedLabel}</div>
        </div>
        <div className="payment-market-panel__source">{sourceLabel(resolution.source)}</div>
      </div>

      <p className="payment-market-panel__body">
        JobRadar prepare un routing multi-marche. Le checkout actif reste aujourd'hui disponible en{" "}
        <strong>{resolution.checkout.active_currency}</strong> via{" "}
        <strong>{resolution.checkout.active_provider_code}</strong>.
      </p>

      <div className="payment-market-panel__choices" role="group" aria-label="Choisir un marche">
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
          ? "Ta preference EUR est bien prise en compte pour le futur checkout Europe-friendly. En attendant, le paiement en ligne reste en XOF."
          : "Le checkout actuel reste aligne sur le parcours XOF existant."}
      </p>

      {!canPersistPreference && (
        <p className="payment-market-panel__note">
          Ta selection est gardee pour cette session. Connecte-toi pour l'enregistrer sur ton profil.
        </p>
      )}

      {error && <div className="pricing-error">Erreur : {error}</div>}
    </section>
  );
}
