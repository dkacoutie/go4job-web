import { useEffect, useMemo, useState } from "react";
import {
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
  isIosDevice,
  isPwaStandalone,
  subscribeInstallPrompt,
  type BeforeInstallPromptEvent,
} from "../lib/pwa";
import "./PwaInstallCard.css";

const DISMISSED_UNTIL_KEY = "jobradar:pwa_install_dismissed_until";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function readDismissedUntil() {
  try {
    const value = window.localStorage.getItem(DISMISSED_UNTIL_KEY);
    const timestamp = value ? Number(value) : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
}

function snoozeInstallCard() {
  try {
    window.localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // ignore
  }
}

export default function PwaInstallCard() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getDeferredInstallPrompt());
  const [standalone, setStandalone] = useState(() => isPwaStandalone());
  const [hidden, setHidden] = useState(() => readDismissedUntil() > Date.now());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const isIos = useMemo(() => isIosDevice(), []);

  useEffect(() => {
    return subscribeInstallPrompt(() => {
      setInstallPrompt(getDeferredInstallPrompt());
      setStandalone(isPwaStandalone());
    });
  }, []);

  useEffect(() => {
    const onDisplayModeChange = () => setStandalone(isPwaStandalone());
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", onDisplayModeChange);
    return () => media.removeEventListener("change", onDisplayModeChange);
  }, []);

  if (standalone || hidden || (!installPrompt && !isIos)) {
    return null;
  }

  async function installApp() {
    if (!installPrompt) {
      setShowIosHelp(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    clearDeferredInstallPrompt();
    setInstallPrompt(null);

    if (choice.outcome === "accepted") {
      setStandalone(true);
      return;
    }

    snoozeInstallCard();
    setHidden(true);
  }

  function dismiss() {
    snoozeInstallCard();
    setHidden(true);
  }

  return (
    <section className="pwaInstallCard" aria-label="Accès rapide JobRadar">
      <div className="pwaInstallCard__icon" aria-hidden="true">
        JR
      </div>
      <div className="pwaInstallCard__body">
        <div className="pwaInstallCard__eyebrow">Accès rapide</div>
        <div className="pwaInstallCard__title">Ajoute JobRadar à ton écran d’accueil</div>
        <p>Ouvre tes alertes et tes offres ciblées en un geste, sans passer par ta boîte mail.</p>
        {showIosHelp ? (
          <p className="pwaInstallCard__hint">Sur iPhone, ouvre le menu Partager, puis choisis Sur l’écran d’accueil.</p>
        ) : null}
      </div>
      <div className="pwaInstallCard__actions">
        <button className="btn btnPrimary" type="button" onClick={installApp}>
          {installPrompt ? "Ajouter" : "Voir comment"}
        </button>
        <button className="btn btnGhost" type="button" onClick={dismiss}>
          Plus tard
        </button>
      </div>
    </section>
  );
}
