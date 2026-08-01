export type BeforeInstallPromptEvent = Event & {
  platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallPromptListener = () => void;

let initialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const installPromptListeners = new Set<InstallPromptListener>();

function notifyInstallPromptListeners() {
  for (const listener of installPromptListeners) {
    listener();
  }
}

export function getDeferredInstallPrompt() {
  return deferredInstallPrompt;
}

export function clearDeferredInstallPrompt() {
  deferredInstallPrompt = null;
  notifyInstallPromptListeners();
}

export function subscribeInstallPrompt(listener: InstallPromptListener) {
  installPromptListeners.add(listener);
  return () => {
    installPromptListeners.delete(listener);
  };
}

export function isPwaStandalone() {
  if (typeof window === "undefined") return false;

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

export function isIosDevice() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in window.navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    window.navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("[pwa] service worker registration failed", error);
    });
  });
}

export function initPwa() {
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifyInstallPromptListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    notifyInstallPromptListeners();
  });

  registerServiceWorker();
}
