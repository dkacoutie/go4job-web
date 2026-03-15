const GA_MEASUREMENT_ID = "G-EET5B96SX7";
export const LANDING_PATH = "/landing";

function getLandingPageUrl(pathname: string, search: string) {
  const pagePath = `${pathname}${search}`;

  return {
    pagePath,
    pageLocation: `${window.location.origin}${pagePath}`,
  };
}

export function trackLandingPageView(pathname: string, search: string) {
  if (pathname !== LANDING_PATH) return;
  if (typeof window === "undefined") return;
  if (typeof window.gtag !== "function") return;

  const { pagePath, pageLocation } = getLandingPageUrl(pathname, search);

  window.gtag("event", "page_view", {
    send_to: GA_MEASUREMENT_ID,
    page_path: pagePath,
    page_location: pageLocation,
    page_title: document.title,
  });
}
