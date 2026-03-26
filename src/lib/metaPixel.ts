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
  if (typeof window === "undefined") return;

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
