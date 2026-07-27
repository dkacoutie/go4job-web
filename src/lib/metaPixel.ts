import { hasAnalyticsConsent } from "./consent";

const DEFAULT_META_PIXEL_ID = "1476894420492038";
const META_PIXEL_SCRIPT_ID = "meta-pixel";

type MetaPixelMethod = "init" | "track" | "trackCustom";
type MetaPixelTrackMethod = "track" | "trackCustom";
type MetaPixelParams = Record<string, unknown>;
type MetaPixelCall = [MetaPixelMethod, string, MetaPixelParams?];
type LocalFbq = {
  (...args: MetaPixelCall): void;
  callMethod?: (...args: MetaPixelCall) => void;
  queue?: unknown[][];
  push?: LocalFbq;
  loaded?: boolean;
  version?: string;
};
type PendingMetaEvent = {
  method: MetaPixelTrackMethod;
  eventName: string;
  eventParams?: MetaPixelParams;
};
type MetaPixelWindow = Window & {
  fbq?: LocalFbq;
  _fbq?: LocalFbq;
  __jrMetaPixelInitialized?: boolean;
  __jrPendingMetaEvents?: PendingMetaEvent[];
  __jrLastMetaPageView?: string;
};

type QueuedMetaEvent = {
  method: MetaPixelTrackMethod;
  eventName: string;
  eventParams?: MetaPixelParams;
};

function getMetaPixelId() {
  return (import.meta.env.VITE_META_PIXEL_ID ?? DEFAULT_META_PIXEL_ID).trim();
}

function hasMetaPixelId() {
  return Boolean(getMetaPixelId());
}

// Aucun script Meta Pixel, aucune init, aucun événement (page_view compris)
// tant que l'utilisateur n'a pas explicitement accepté la mesure d'audience
// dans le bandeau cookies (voir consent.ts / ConsentBanner).
function metaPixelEnabled() {
  return hasMetaPixelId() && hasAnalyticsConsent();
}

function getMetaWindow() {
  return window as MetaPixelWindow;
}

function ensureFbqStub() {
  const win = getMetaWindow();

  if (typeof win.fbq === "function") return;

  const fbqStub = ((...args: unknown[]) => {
    if (typeof fbqStub.callMethod === "function") {
      fbqStub.callMethod(...(args as MetaPixelCall));
      return;
    }

    fbqStub.queue = fbqStub.queue || [];
    fbqStub.queue.push(args);
  }) as LocalFbq;

  fbqStub.push = fbqStub;
  fbqStub.loaded = true;
  fbqStub.version = "2.0";
  fbqStub.queue = [];

  win.fbq = fbqStub;
  if (!win._fbq) {
    win._fbq = fbqStub;
  }
}

function flushPendingMetaEvents() {
  const win = getMetaWindow();
  const pendingEvents = win.__jrPendingMetaEvents ?? [];

  if (pendingEvents.length === 0 || typeof win.fbq !== "function") return;

  pendingEvents.forEach(({ method, eventName, eventParams }) => {
    if (method === "trackCustom") {
      win.fbq?.("trackCustom", eventName, eventParams);
    } else {
      win.fbq?.("track", eventName, eventParams);
    }
  });

  win.__jrPendingMetaEvents = [];
}

function queueMetaEvent(method: MetaPixelTrackMethod, eventName: string, eventParams?: MetaPixelParams) {
  if (!metaPixelEnabled()) return;

  const win = getMetaWindow();

  if (win.__jrMetaPixelInitialized && typeof win.fbq === "function") {
    if (method === "trackCustom") {
      win.fbq("trackCustom", eventName, eventParams);
    } else {
      win.fbq("track", eventName, eventParams);
    }
    return;
  }

  win.__jrPendingMetaEvents = win.__jrPendingMetaEvents ?? [];
  win.__jrPendingMetaEvents.push({ method, eventName, eventParams } as QueuedMetaEvent);
}

export function initMetaPixel(pixelId = getMetaPixelId()) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!pixelId) return;
  if (!hasAnalyticsConsent()) return;

  const win = getMetaWindow();
  if (win.__jrMetaPixelInitialized) return;

  ensureFbqStub();

  if (!document.getElementById(META_PIXEL_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.async = true;
    script.id = META_PIXEL_SCRIPT_ID;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";

    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }

  win.fbq?.("init", pixelId);
  win.__jrMetaPixelInitialized = true;
  flushPendingMetaEvents();
}

export function trackMetaPageView(pathname: string, search: string) {
  if (typeof window === "undefined" || !metaPixelEnabled()) return;

  const pageKey = `${pathname}${search}`;
  const win = getMetaWindow();

  if (win.__jrLastMetaPageView === pageKey) return;
  win.__jrLastMetaPageView = pageKey;

  queueMetaEvent("track", "PageView");
}

export function trackMetaEvent(eventName: string, eventParams?: MetaPixelParams) {
  queueMetaEvent("track", eventName, eventParams);
}

export function trackMetaCustomEvent(eventName: string, eventParams?: MetaPixelParams) {
  queueMetaEvent("trackCustom", eventName, eventParams);
}

// ---------------------------------------------------------------------
// Purchase (Meta) — même principe de déduplication persistante que
// trackPurchase côté GA4 (analytics.ts) : le bloc appelant peut se
// ré-exécuter après un rafraîchissement de page pour la même référence de
// paiement (paystack_verify peut être rappelé), donc sans ce garde-fou
// l'événement partirait en double vers Meta à chaque F5 post-paiement.
// ---------------------------------------------------------------------

const META_PURCHASE_DEDUPE_STORAGE_KEY = "jr_meta_tracked_purchases";
const META_PURCHASE_DEDUPE_MAX = 50;

function readMetaIdSet(): Set<string> {
  try {
    const raw = localStorage.getItem(META_PURCHASE_DEDUPE_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeMetaIdSet(ids: Set<string>) {
  try {
    const arr = Array.from(ids).slice(-META_PURCHASE_DEDUPE_MAX);
    localStorage.setItem(META_PURCHASE_DEDUPE_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // stockage indisponible (navigation privée, quota...) : pas bloquant
  }
}

/**
 * À appeler uniquement après confirmation serveur réelle du paiement (même
 * point d'appel que trackPurchase côté GA4), jamais depuis la simple
 * présence d'un paramètre d'URL. Déduplique par transactionId (référence
 * Paystack), indépendamment de la déduplication GA4 (stockage séparé).
 */
export function trackMetaPurchase(params: {
  transactionId: string;
  planId: string;
  planName: string;
  value: number;
  currency: string;
}) {
  if (!params.transactionId) return;

  const tracked = readMetaIdSet();
  if (tracked.has(params.transactionId)) return;
  tracked.add(params.transactionId);
  writeMetaIdSet(tracked);

  queueMetaEvent("track", "Purchase", {
    value: params.value,
    currency: params.currency,
    content_name: params.planName,
    content_ids: [params.planId],
  });
}
