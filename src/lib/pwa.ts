import { trackPwaAppInstalled } from "./analytics";

export type BeforeInstallPromptEvent = Event & {
  platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type PwaPlatform =
  | "chrome-android"
  | "samsung-internet"
  | "edge-android"
  | "firefox-android"
  | "ios-safari"
  | "ios-other-browser"
  | "in-app-browser"
  | "desktop"
  | "unsupported";

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
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

export function isIosDevice() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function detectPwaPlatform(userAgent = typeof window === "undefined" ? "" : window.navigator.userAgent): PwaPlatform {
  const isIos = /iphone|ipad|ipod/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);

  if (/FBAN|FBAV|Instagram|Line\/|WhatsApp/i.test(userAgent)) return "in-app-browser";

  if (isIos) {
    return /CriOS|FxiOS|EdgiOS/i.test(userAgent) ? "ios-other-browser" : "ios-safari";
  }

  if (isAndroid) {
    if (/SamsungBrowser/i.test(userAgent)) return "samsung-internet";
    if (/EdgA/i.test(userAgent)) return "edge-android";
    if (/Firefox/i.test(userAgent)) return "firefox-android";
    if (/Chrome/i.test(userAgent)) return "chrome-android";
    return "unsupported";
  }

  if (/Windows|Macintosh|Linux/i.test(userAgent)) return "desktop";

  return "unsupported";
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
    const platform = detectPwaPlatform();
    trackPwaAppInstalled({ browser: platform, os: platform.includes("ios") ? "ios" : platform.includes("android") ? "android" : "desktop" });
    deferredInstallPrompt = null;
    notifyInstallPromptListeners();
  });

  registerServiceWorker();
}
