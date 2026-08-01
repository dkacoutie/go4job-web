import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearDeferredInstallPrompt,
  detectPwaPlatform,
  getDeferredInstallPrompt,
  isPwaStandalone,
  subscribeInstallPrompt,
  type BeforeInstallPromptEvent,
  type PwaPlatform,
} from "../lib/pwa";
import {
  trackPwaCtaClicked,
  trackPwaCtaShown,
  trackPwaFallbackShown,
  trackPwaPromptAvailable,
  trackPwaPromptOutcome,
} from "../lib/analytics";
import "./PwaInstallCard.css";

const DISMISSED_UNTIL_KEY = "jobradar:pwa_install_dismissed_until";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const CONTEXT = "alerts_page";

type GuideStep = {
  icon: string;
  title: string;
  text: string;
};

type InstallGuide = {
  title: string;
  intro: string;
  steps: GuideStep[];
  note?: string;
  copyLink?: boolean;
};

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

function getOs(platform: PwaPlatform) {
  if (platform.includes("ios")) return "ios";
  if (platform.includes("android")) return "android";
  if (platform === "in-app-browser") return /iphone|ipad|ipod/i.test(window.navigator.userAgent) ? "ios" : "android";
  return "desktop";
}

function getGuide(platform: PwaPlatform): InstallGuide {
  if (platform === "ios-safari") {
    return {
      title: "Ajouter depuis Safari",
      intro: "Sur iPhone, l'ajout se fait depuis le menu de partage de Safari.",
      steps: [
        { icon: "1", title: "Ouvre Partager", text: "Touche l'icône de partage en bas de Safari." },
        { icon: "2", title: "Choisis l'écran d'accueil", text: "Fais défiler puis touche Sur l'écran d'accueil." },
        { icon: "3", title: "Confirme", text: "Touche Ajouter en haut à droite." },
      ],
    };
  }

  if (platform === "ios-other-browser") {
    return {
      title: "Passe par Safari",
      intro: "Sur iPhone, l'ajout à l'écran d'accueil se fait depuis Safari.",
      copyLink: true,
      steps: [
        { icon: "1", title: "Copie le lien", text: "Copie l'adresse de JobRadar." },
        { icon: "2", title: "Ouvre Safari", text: "Colle le lien dans Safari." },
        { icon: "3", title: "Ajoute JobRadar", text: "Touche Partager, puis Sur l'écran d'accueil." },
      ],
    };
  }

  if (platform === "samsung-internet") {
    return {
      title: "Ajouter depuis Samsung Internet",
      intro: "Samsung Internet utilise son menu en bas de l'écran.",
      steps: [
        { icon: "1", title: "Ouvre le menu", text: "Touche le menu en bas à droite." },
        { icon: "2", title: "Ajoute la page", text: "Choisis Ajouter la page à, puis Écran d'accueil." },
        { icon: "3", title: "Confirme", text: "Touche Ajouter." },
      ],
    };
  }

  if (platform === "in-app-browser") {
    return {
      title: "Ouvre JobRadar dans le navigateur",
      intro: "Les navigateurs intégrés à WhatsApp, Facebook ou Instagram ne permettent généralement pas l'installation.",
      copyLink: true,
      steps: [
        { icon: "1", title: "Copie le lien", text: "Copie l'adresse de cette page." },
        { icon: "2", title: "Ouvre Chrome ou Safari", text: "Colle le lien dans ton navigateur principal." },
        { icon: "3", title: "Installe JobRadar", text: "Reviens sur Mes alertes puis touche Ajouter à l'écran d'accueil." },
      ],
    };
  }

  if (platform === "firefox-android") {
    return {
      title: "Ajouter depuis Firefox",
      intro: "Firefox peut proposer l'ajout depuis son menu.",
      steps: [
        { icon: "1", title: "Ouvre le menu", text: "Touche le menu du navigateur." },
        { icon: "2", title: "Cherche Installer", text: "Choisis Installer ou Ajouter à l'écran d'accueil." },
        { icon: "3", title: "Confirme", text: "Valide l'ajout de JobRadar." },
      ],
    };
  }

  return {
    title: "Ajouter depuis Chrome",
    intro: "Si la fenêtre automatique ne s'affiche pas, passe par le menu du navigateur.",
    steps: [
      { icon: "1", title: "Ouvre le menu", text: "Touche les trois points en haut à droite." },
      { icon: "2", title: "Choisis Installer", text: "Touche Installer l'application ou Ajouter à l'écran d'accueil." },
      { icon: "3", title: "Confirme", text: "Touche Installer ou Ajouter." },
    ],
  };
}

function canShowCard(platform: PwaPlatform, installPrompt: BeforeInstallPromptEvent | null) {
  if (platform === "desktop") return Boolean(installPrompt);
  return platform !== "unsupported";
}

function InstallGuideSheet({
  platform,
  onClose,
}: {
  platform: PwaPlatform;
  onClose: () => void;
}) {
  const guide = getGuide(platform);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await window.navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="pwaGuideOverlay" role="presentation" onClick={onClose}>
      <section className="pwaGuideSheet" role="dialog" aria-modal="true" aria-labelledby="pwa-guide-title" onClick={(event) => event.stopPropagation()}>
        <div className="pwaGuideSheet__handle" aria-hidden="true" />
        <div className="pwaGuideSheet__header">
          <div>
            <div className="pwaGuideSheet__eyebrow">Installation</div>
            <h2 id="pwa-guide-title">{guide.title}</h2>
          </div>
          <button className="pwaGuideSheet__close" type="button" aria-label="Fermer" onClick={onClose}>
            x
          </button>
        </div>
        <p className="pwaGuideSheet__intro">{guide.intro}</p>
        <ol className="pwaGuideSteps">
          {guide.steps.map((step) => (
            <li className="pwaGuideStep" key={step.title}>
              <span className="pwaGuideStep__icon" aria-hidden="true">
                {step.icon}
              </span>
              <span>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
        {guide.note ? <p className="pwaGuideSheet__note">{guide.note}</p> : null}
        <div className="pwaGuideSheet__actions">
          {guide.copyLink ? (
            <button className="btn btnGhost" type="button" onClick={copyLink}>
              {copied ? "Lien copié" : "Copier le lien"}
            </button>
          ) : null}
          <button className="btn btnPrimary" type="button" onClick={onClose}>
            J'ai compris
          </button>
        </div>
      </section>
    </div>
  );
}

export default function PwaInstallCard() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => getDeferredInstallPrompt());
  const [standalone, setStandalone] = useState(() => isPwaStandalone());
  const [hidden, setHidden] = useState(() => readDismissedUntil() > Date.now());
  const [guideOpen, setGuideOpen] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);
  const platform = useMemo(() => detectPwaPlatform(), []);
  const os = useMemo(() => getOs(platform), [platform]);
  const shownTrackedRef = useRef(false);

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

  const shouldShow = !standalone && !hidden && canShowCard(platform, installPrompt);

  useEffect(() => {
    if (!shouldShow || shownTrackedRef.current) return;
    shownTrackedRef.current = true;
    trackPwaCtaShown({
      context: CONTEXT,
      browser: platform,
      os,
      reason: installPrompt ? "native_prompt_available" : "manual_guide_available",
    });
  }, [installPrompt, os, platform, shouldShow]);

  if (!shouldShow) {
    return null;
  }

  function openGuide() {
    trackPwaFallbackShown({ context: CONTEXT, browser: platform, os });
    setGuideOpen(true);
  }

  async function installApp() {
    trackPwaCtaClicked({ context: CONTEXT, browser: platform, os });
    trackPwaPromptAvailable({ available: Boolean(installPrompt), browser: platform, os });

    if (!installPrompt || platform === "ios-safari" || platform === "ios-other-browser" || platform === "in-app-browser") {
      openGuide();
      return;
    }

    setIsPrompting(true);

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      trackPwaPromptOutcome({ outcome: choice.outcome, browser: platform, os });

      clearDeferredInstallPrompt();
      setInstallPrompt(null);

      if (choice.outcome === "accepted") {
        setStandalone(true);
        return;
      }

      openGuide();
    } finally {
      setIsPrompting(false);
    }
  }

  function dismiss() {
    snoozeInstallCard();
    setHidden(true);
  }

  const primaryLabel = installPrompt && platform !== "ios-safari" && platform !== "ios-other-browser" ? "Installer JobRadar" : "Voir les étapes";

  return (
    <>
      <section className="pwaInstallCard" aria-label="Accès rapide JobRadar">
        <div className="pwaInstallCard__icon" aria-hidden="true">
          JR
        </div>
        <div className="pwaInstallCard__body">
          <div className="pwaInstallCard__eyebrow">Accès rapide</div>
          <div className="pwaInstallCard__title">Ajoute JobRadar à ton écran d'accueil</div>
          <p>Retrouve tes alertes et tes offres en un geste, sans chercher le site dans ton navigateur.</p>
        </div>
        <div className="pwaInstallCard__actions">
          <button className="btn btnPrimary" type="button" onClick={installApp} disabled={isPrompting}>
            {isPrompting ? "Ouverture..." : primaryLabel}
          </button>
          <button className="btn btnGhost" type="button" onClick={dismiss}>
            Plus tard
          </button>
        </div>
      </section>
      {guideOpen ? <InstallGuideSheet platform={platform} onClose={() => setGuideOpen(false)} /> : null}
    </>
  );
}
