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
  const titleLabel =
    resolution.market === "eur" ? "Preference de paiement : EUR" : "XOF recommande";

  return (
    <section className="payment-market-panel" aria-label="Marche paiement">
      <div className="payment-market-panel__head">
        <div>
          <div className="payment-market-panel__eyebrow">Marche paiement</div>
          <div className="payment-market-panel__title">{titleLabel}</div>
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
          ? "Votre preference EUR est enregistree. Pour le moment, le paiement en ligne reste facture en FCFA via notre checkout actuel."
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
