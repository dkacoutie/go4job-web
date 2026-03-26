const GA_MEASUREMENT_ID = "G-EET5B96SX7";
const GA_SCRIPT_ID = "google-analytics";

type GtagConfigParams = Record<string, unknown>;

type Gtag = {
  (command: "js", date: Date): void;
  (command: "config", targetId: string, config?: GtagConfigParams): void;
  (command: "event", eventName: string, eventParams?: GtagConfigParams): void;
};

export const LANDING_PATH = "/landing";

type PendingGaEvent = {
  eventName: string;
  eventParams?: GtagConfigParams;
};

type AnalyticsWindow = Window & {
  __jrGaInitialized?: boolean;
  __jrPendingGaEvents?: PendingGaEvent[];
};

function getAnalyticsWindow() {
  return window as AnalyticsWindow;
}

function ensureGtagStub() {
  const win = getAnalyticsWindow();

  win.dataLayer = Array.isArray(win.dataLayer) ? win.dataLayer : [];

  if (typeof win.gtag !== "function") {
    win.gtag = ((...args: unknown[]) => {
      win.dataLayer.push(args);
    }) as Gtag;
  }
}

function getLandingPageUrl(pathname: string, search: string) {
  const pagePath = `${pathname}${search}`;

  return {
    pagePath,
    pageLocation: `${window.location.origin}${pagePath}`,
  };
}

function flushPendingGaEvents() {
  const win = getAnalyticsWindow();
  const pendingEvents = win.__jrPendingGaEvents ?? [];

  if (pendingEvents.length === 0 || typeof win.gtag !== "function") return;

  pendingEvents.forEach(({ eventName, eventParams }) => {
    win.gtag?.("event", eventName, eventParams);
  });

  win.__jrPendingGaEvents = [];
}

export function initGoogleAnalytics(measurementId = GA_MEASUREMENT_ID) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!measurementId) return;

  const win = getAnalyticsWindow();
  if (win.__jrGaInitialized) return;

  ensureGtagStub();

  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.async = true;
    script.id = GA_SCRIPT_ID;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
  }

  win.gtag?.("js", new Date());
  win.gtag?.("config", measurementId, { send_page_view: false });

  win.__jrGaInitialized = true;
  flushPendingGaEvents();
}

export function trackLandingPageView(pathname: string, search: string) {
  if (pathname !== LANDING_PATH) return;
  if (typeof window === "undefined") return;

  const { pagePath, pageLocation } = getLandingPageUrl(pathname, search);
  const eventParams: GtagConfigParams = {
    send_to: GA_MEASUREMENT_ID,
    page_path: pagePath,
    page_location: pageLocation,
    page_title: document.title,
  };

  const win = getAnalyticsWindow();

  if (win.__jrGaInitialized && typeof win.gtag === "function") {
    win.gtag("event", "page_view", eventParams);
    return;
  }

  win.__jrPendingGaEvents = win.__jrPendingGaEvents ?? [];
  win.__jrPendingGaEvents.push({ eventName: "page_view", eventParams });
}
