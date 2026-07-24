// Consentement cookies / mesure d'audience pour JobRadar.
//
// Une seule catégorie non essentielle est gérée ici : "mesure d'audience et
// publicité" (GA4 + Meta Pixel). Les cookies strictement nécessaires au
// fonctionnement du service (session d'authentification Supabase, stockée en
// localStorage — pas un cookie soumis au consentement) restent toujours
// actifs et ne sont pas concernés par ce module.
//
// Tant qu'aucun choix n'a été fait, ou en cas de refus, GA4 et Meta Pixel ne
// s'initialisent jamais (voir analytics.ts et metaPixel.ts, qui appellent
// hasAnalyticsConsent() avant tout script ou tout envoi d'événement).

const CONSENT_STORAGE_KEY = "jr_cookie_consent_v1";
export const CONSENT_CHANGE_EVENT = "jr:consent-changed";
export const OPEN_CONSENT_BANNER_EVENT = "jr:open-consent-banner";

export type ConsentChoice = "accepted" | "rejected";

type StoredConsent = {
  analytics: ConsentChoice;
  ts: string;
};

function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === "accepted" || value === "rejected";
}

export function getStoredConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (!isConsentChoice(parsed.analytics)) return null;
    return { analytics: parsed.analytics, ts: typeof parsed.ts === "string" ? parsed.ts : "" };
  } catch {
    return null;
  }
}

/** true seulement si un choix a déjà été fait (accepté ou refusé) — sert à savoir si la bannière doit s'afficher. */
export function hasConsentChoice(): boolean {
  return getStoredConsent() !== null;
}

/** true seulement si l'utilisateur a explicitement accepté la mesure d'audience. */
export function hasAnalyticsConsent(): boolean {
  return getStoredConsent()?.analytics === "accepted";
}

export function setAnalyticsConsent(choice: ConsentChoice) {
  try {
    const value: StoredConsent = { analytics: choice, ts: new Date().toISOString() };
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée, quota...) : la bannière
    // réapparaîtra à la prochaine visite, pas bloquant pour l'app.
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: { analytics: choice } }));
  } catch {
    // no-op
  }
}

/** Permet de rouvrir le bandeau pour changer d'avis (lien "Gérer les cookies" en pied de page). */
export function requestOpenConsentBanner() {
  try {
    window.dispatchEvent(new Event(OPEN_CONSENT_BANNER_EVENT));
  } catch {
    // no-op
  }
}
