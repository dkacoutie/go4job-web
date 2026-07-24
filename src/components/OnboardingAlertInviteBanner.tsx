import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useJobRadarOnboarding } from "../lib/useJobRadarOnboarding";
import { activateOnboardingAlert } from "../lib/onboardingAlert";
import {
  trackAlertCreated,
  trackAlertReactivationBannerClicked,
  trackAlertReactivationBannerShown,
} from "../lib/analytics";
import "./OnboardingAlertInviteBanner.css";

const DISMISS_STORAGE_PREFIX = "jr_alert_reactivation_dismissed_";

function readDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(DISMISS_STORAGE_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(userId: string) {
  try {
    localStorage.setItem(DISMISS_STORAGE_PREFIX + userId, "1");
  } catch {
    // stockage indisponible : pas bloquant, la bannière peut réapparaître,
    // ce qui reste sans risque (non bloquant, jamais de création silencieuse).
  }
}

/**
 * Ajustement 3 (spec activation/paiement du 24/07/2026) : invitation non
 * bloquante pour les comptes créés avant l'Ajustement 1 (consentement en
 * onboarding), qui ont donc pu atteindre l'aperçu ou l'écran de déverrouillage
 * sans jamais avoir eu l'occasion de créer une alerte. Ne crée l'alerte
 * qu'après un clic explicite sur cette bannière. Ne s'affiche jamais pour un
 * compte qui a déjà une alerte, qui s'est désabonné des emails, ou qui n'a
 * aucun critère exploitable (aucun rôle recherché renseigné).
 */
export default function OnboardingAlertInviteBanner() {
  const { session } = useSession();
  const onboarding = useJobRadarOnboarding();
  const [unsubscribed, setUnsubscribed] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shownTracked, setShownTracked] = useState(false);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    setDismissed(readDismissed(userId));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setUnsubscribed(null);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from("notification_prefs")
          .select("unsubscribed_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        setUnsubscribed(Boolean(data?.unsubscribed_at));
      } catch {
        // En cas d'erreur, on ne devine pas un statut "désabonné" : on
        // considère prudemment que ce n'est pas le cas plutôt que de ne
        // jamais afficher la bannière à cause d'un souci réseau ponctuel.
        if (!cancelled) setUnsubscribed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const desiredRole = onboarding.onboarding.profile?.desiredRole?.trim() ?? "";
  const hasUsableCriteria =
    desiredRole.length > 0 || (onboarding.onboarding.preferences?.alertDrafts?.length ?? 0) > 0;
  // Ne concerne que les comptes déjà allés au bout de l'ancien parcours
  // (aperçu vu) : un utilisateur en cours d'onboarding tout neuf passe par
  // le consentement de l'étape Preferences (Ajustement 1), jamais par ici.
  const alreadyWentThroughFunnel = Boolean(onboarding.onboarding.previewSeenAt);

  const eligible =
    !onboarding.loading &&
    unsubscribed === false &&
    !dismissed &&
    onboarding.alertsCount === 0 &&
    hasUsableCriteria &&
    alreadyWentThroughFunnel;

  useEffect(() => {
    if (eligible && !shownTracked) {
      trackAlertReactivationBannerShown();
      setShownTracked(true);
    }
  }, [eligible, shownTracked]);

  if (!eligible) return null;

  const dismiss = () => {
    if (userId) writeDismissed(userId);
    setDismissed(true);
  };

  const activate = async () => {
    setBusy(true);
    trackAlertReactivationBannerClicked();
    const result = await activateOnboardingAlert({
      desiredRole,
      countryCodes: onboarding.onboarding.profile?.countryCodes ?? [],
      alertDrafts: onboarding.onboarding.preferences?.alertDrafts ?? [],
    });
    setBusy(false);
    if (result) {
      trackAlertCreated({
        hasCountryFilter: Boolean(result.countries && result.countries.length > 0),
        frequency: result.frequency,
        source: "reactivation_banner",
      });
      if (userId) writeDismissed(userId);
      setDismissed(true);
      await onboarding.refresh();
    }
  };

  return (
    <div className="jr-reactivationBanner" role="region" aria-label="Activer mon alerte gratuite">
      <div className="jr-reactivationBanner__text">
        <strong>Ta recherche est prête.</strong>
        <span>Active gratuitement ta première alerte : tu recevras par email les offres qui correspondent.</span>
      </div>
      <div className="jr-reactivationBanner__actions">
        <button className="jrBtn jrBtnPrimary" type="button" onClick={activate} disabled={busy}>
          {busy ? "Activation…" : "Activer mon alerte gratuite"}
        </button>
        <button className="jrBtn jrBtnGhost" type="button" onClick={dismiss} disabled={busy}>
          Plus tard
        </button>
      </div>
    </div>
  );
}
