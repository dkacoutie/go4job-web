import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { initGoogleAnalytics, trackPageView, updateAnalyticsConsent } from "../lib/analytics";
import { initMetaPixel, trackMetaPageView } from "../lib/metaPixel";
import {
  CONSENT_CHANGE_EVENT,
  OPEN_CONSENT_BANNER_EVENT,
  hasConsentChoice,
  setAnalyticsConsent,
} from "../lib/consent";
import "./ConsentBanner.css";

/**
 * Bandeau de consentement cookies. Une seule catégorie non essentielle :
 * mesure d'audience et publicité (GA4 + Meta Pixel). Les deux boutons
 * (accepter / refuser) sont au même niveau visuel, comme l'exige la CNIL —
 * refuser doit être aussi simple qu'accepter.
 *
 * GA4 et Meta Pixel restent bloqués (voir analytics.ts / metaPixel.ts, qui
 * vérifient hasAnalyticsConsent() avant tout script ou tout événement) tant
 * qu'aucun choix n'a été fait ou en cas de refus. En cas d'acceptation, on
 * les active immédiatement ici, sans attendre un changement de route.
 */
export default function ConsentBanner() {
  const [visible, setVisible] = useState(() => !hasConsentChoice());

  useEffect(() => {
    const openHandler = () => setVisible(true);
    window.addEventListener(OPEN_CONSENT_BANNER_EVENT, openHandler);
    return () => window.removeEventListener(OPEN_CONSENT_BANNER_EVENT, openHandler);
  }, []);

  function activateAnalytics() {
    // initGoogleAnalytics() est idempotente : si le script est déjà amorcé
    // (cas normal, voir AnalyticsTracker monté au démarrage de l'app), cet
    // appel se contente d'informer gtag.js du consentement désormais accordé
    // (voir updateAnalyticsConsent dans analytics.ts) ; sinon il charge le
    // script maintenant, avec le consentement déjà accordé.
    initGoogleAnalytics();
    trackPageView(window.location.pathname, window.location.search);
    initMetaPixel();
    trackMetaPageView(window.location.pathname, window.location.search);
  }

  function accept() {
    setAnalyticsConsent("accepted");
    window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    activateAnalytics();
    setVisible(false);
  }

  function reject() {
    setAnalyticsConsent("rejected");
    // Explicite même si le script était déjà en état "refusé" par défaut :
    // couvre le cas d'un changement d'avis après une acceptation précédente
    // (lien "Gérer les cookies" en pied de page).
    updateAnalyticsConsent(false);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="consentBanner" role="dialog" aria-live="polite" aria-label="Préférences cookies">
      <div className="consentBanner__inner">
        <p className="consentBanner__text">
          JobRadar utilise des cookies strictement nécessaires au fonctionnement du service, et,
          seulement avec ton accord, des outils de mesure d'audience et de publicité (Google Analytics,
          Meta Pixel) pour comprendre l'usage du site. En savoir plus dans notre{" "}
          <Link to="/privacy">politique de confidentialité</Link>.
        </p>
        <div className="consentBanner__actions">
          <button type="button" className="btn btnGhost" onClick={reject}>
            Refuser
          </button>
          <button type="button" className="btn btnPrimary" onClick={accept}>
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
