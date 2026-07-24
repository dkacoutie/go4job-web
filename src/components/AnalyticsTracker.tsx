import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { initGoogleAnalytics, trackPageView } from "../lib/analytics";

/**
 * Monté une seule fois à la racine de l'app (voir App.tsx). Initialise GA4
 * une seule fois (initGoogleAnalytics est elle-même idempotente et n'envoie
 * rien hors du vrai domaine de production), puis envoie un page_view à
 * chaque changement réel de route de la SPA — y compris le premier chargement,
 * puisque send_page_view est désactivé côté config gtag pour éviter tout
 * double comptage avec le page_view automatique.
 *
 * Anciennement limité à /landing (LandingAnalyticsTracker) : l'audit du
 * 24/07/2026 a montré que la fonction d'initialisation GA4 n'était jamais
 * appelée nulle part, donc aucune donnée de navigation n'a jamais été
 * collectée. Ce composant remplace l'ancien tracker et couvre toutes les
 * routes.
 */
export default function AnalyticsTracker() {
  const location = useLocation();

  useEffect(() => {
    initGoogleAnalytics();
    trackPageView(location.pathname, location.search);
  }, [location.pathname, location.search]);

  return null;
}
