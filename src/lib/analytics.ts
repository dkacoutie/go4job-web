// Google Analytics 4 pour JobRadar.
//
// Principes appliqués (audit du 24/07/2026 : l'ID GA4 existait déjà dans le
// code mais initGoogleAnalytics() n'était jamais appelée nulle part, donc
// aucune donnée n'a jamais été collectée) :
//
// - Une seule initialisation du script gtag, jamais en développement ni sur
//   un domaine de preview — uniquement sur le vrai domaine de production
//   (voir PRODUCTION_HOSTNAMES), pour ne jamais polluer les données réelles
//   avec du trafic de test.
// - send_page_view: false côté config gtag + un unique point de tracking des
//   page_view géré ici (SPA), dédupliqué par clé pathname+search comme le
//   fait déjà MetaPixelTracker pour Meta Pixel — donc pas de double comptage
//   entre le page_view automatique de gtag.js et notre tracking manuel.
// - Aucune donnée personnelle envoyée : allowlist stricte des clés de
//   paramètres autorisées, et filtre de sécurité (motif email / téléphone)
//   appliqué à toute valeur texte avant envoi, y compris les termes de
//   recherche libres tapés par l'utilisateur.
// - L'événement purchase est déclenché uniquement après confirmation serveur
//   réelle d'un paiement (jamais depuis une simple présence de paramètre
//   d'URL), et déduplique de façon persistante (localStorage, par référence
//   de transaction) pour ne jamais être compté deux fois après un
//   rafraîchissement de page.
// - Toute erreur d'un appel gtag est avalée : Analytics ne doit jamais faire
//   planter l'application.

import { hasAnalyticsConsent } from "./consent";

const GA_MEASUREMENT_ID = "G-EET5B96SX7";

// Domaine réel de production, vérifié le 24/07/2026 (voir rapport d'audit) :
// go4jobapp.com redirige vers jobradar.go4jobapp.com, qui sert l'application.
// go4job.org (autre domaine) ne fait pas partie du produit.
const PRODUCTION_HOSTNAMES = new Set(["jobradar.go4jobapp.com", "go4jobapp.com"]);

const PURCHASE_DEDUPE_STORAGE_KEY = "jr_ga_tracked_purchases";
const PURCHASE_DEDUPE_MAX = 50;

type Gtag = {
  (command: "js", date: Date): void;
  (command: "config", targetId: string, config?: Record<string, unknown>): void;
  (command: "event", eventName: string, eventParams?: Record<string, unknown>): void;
  (command: "consent", action: "default" | "update", consentParams: Record<string, "granted" | "denied">): void;
};

type PendingGaEvent = {
  eventName: string;
  eventParams?: Record<string, unknown>;
};

type AnalyticsWindow = Window & {
  dataLayer?: unknown[][];
  gtag?: Gtag;
  __jrGaInitialized?: boolean;
  __jrPendingGaEvents?: PendingGaEvent[];
  __jrLastGaPageView?: string;
};

function getWin() {
  return window as AnalyticsWindow;
}

function isProductionHost(): boolean {
  if (typeof window === "undefined") return false;
  return PRODUCTION_HOSTNAMES.has(window.location.hostname);
}

// import.meta.env.PROD est false en dev (`npm run dev`) et true pour tout
// build de production — y compris un éventuel déploiement de preview sur un
// autre nom de domaine, d'où la vérification supplémentaire du hostname réel
// pour distinguer prod / dev / tests internes.
function analyticsHostEnabled(): boolean {
  return Boolean(import.meta.env?.PROD) && isProductionHost();
}

function analyticsEnabled(): boolean {
  // hasAnalyticsConsent() vérifie que l'utilisateur a explicitement accepté
  // la mesure d'audience dans le bandeau cookies (voir consent.ts /
  // ConsentBanner) — sans ça, aucun événement n'est jamais envoyé. Le script
  // gtag.js et le signal "consentement par défaut : refusé", eux, sont
  // amorcés dès l'arrivée sur le site indépendamment de ce choix, depuis
  // index.html (voir JR-GA4-03 là-bas) : c'est ce que Consent Mode attend
  // pour fonctionner.
  return analyticsHostEnabled() && hasAnalyticsConsent();
}

function flushPendingEvents() {
  const win = getWin();
  const pending = win.__jrPendingGaEvents ?? [];
  if (pending.length === 0 || typeof win.gtag !== "function") return;

  pending.forEach(({ eventName, eventParams }) => {
    win.gtag?.("event", eventName, eventParams);
  });
  win.__jrPendingGaEvents = [];
}

/**
 * Correctif du 17/08/2026 (JR-GA4-03) : le chargement du script gtag.js et
 * l'envoi du signal Consent Mode par défaut ont été déplacés dans
 * index.html, en <script> inline synchrone, tout en haut du <head> — voir le
 * commentaire détaillé là-bas pour le pourquoi.
 *
 * Contexte : le correctif précédent (JR-GA4-02, même jour) avait déjà
 * corrigé l'ORDRE des commandes (default avant update) mais les envoyait
 * toujours depuis un useEffect React, donc après hydratation. Revérifié en
 * direct : même avec le bon ordre, gtag.js restait bloqué en état de
 * consentement "implicite" pour toujours (y compris face à un
 * gtag('consent','update',...) déclenché en direct dans la console, bien
 * après le chargement complet du script) et n'envoyait jamais aucun hit, même
 * en debug_mode (vérifié via DebugView). La documentation officielle Google
 * est explicite : "Don't set default consent states asynchronously" — le
 * signal doit être synchrone, avant tout autre script, ce qu'un useEffect ne
 * peut pas garantir.
 *
 * Cette fonction, appelée au montage de l'application (voir
 * AnalyticsTracker) et sur tout changement de route en production, ne fait
 * donc plus qu'une chose : rattraper le cas d'un visiteur dont le
 * consentement est déjà connu (retour d'un visiteur ayant déjà accepté), en
 * informant gtag.js immédiatement plutôt que d'attendre un nouveau clic. Le
 * script et le "default" sont déjà en place depuis index.html à ce stade.
 * Conservée sous ce nom (measurementId gardé en paramètre) pour ne pas casser
 * les appelants existants (AnalyticsTracker, ConsentBanner).
 */
export function initGoogleAnalytics(_measurementId = GA_MEASUREMENT_ID) {
  try {
    if (typeof window === "undefined") return;
    if (!analyticsHostEnabled()) return;

    if (hasAnalyticsConsent()) updateAnalyticsConsent(true);
    flushPendingEvents();
  } catch {
    // Analytics ne doit jamais faire planter l'app.
  }
}

/**
 * Informe gtag.js d'un changement réel de consentement (clic "Accepter" ou
 * "Refuser" sur le bandeau — voir ConsentBanner). Sans effet si le script
 * n'existe pas (hors production, ou script index.html non exécuté).
 */
export function updateAnalyticsConsent(granted: boolean) {
  try {
    const win = getWin();
    if (typeof win.gtag !== "function") return;

    const state = granted ? "granted" : "denied";
    win.gtag("consent", "update", {
      ad_storage: state,
      analytics_storage: state,
      ad_user_data: state,
      ad_personalization: state,
    });

    if (granted) flushPendingEvents();
  } catch {
    // no-op
  }
}

// ---------------------------------------------------------------------
// Garde anti-données-personnelles
// ---------------------------------------------------------------------

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
const MAX_STRING_LEN = 80;
// page_location est une URL complète (avec query string) : peut légitimement
// dépasser 80 caractères sans que ce soit du texte libre à risque.
const MAX_URL_PARAM_LEN = 300;
const LONG_PARAM_KEYS = new Set(["page_location"]);

function looksLikePii(value: string): boolean {
  return EMAIL_RE.test(value) || PHONE_RE.test(value);
}

/**
 * À utiliser explicitement pour tout texte saisi librement par l'utilisateur
 * (ex: terme de recherche) avant de l'inclure dans un événement. Retourne
 * undefined si le texte ressemble à un email/téléphone plutôt que de
 * l'envoyer tronqué — mieux vaut perdre la donnée que risquer une fuite.
 */
export function sanitizeFreeText(raw: string | null | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return undefined;
  if (looksLikePii(trimmed)) return undefined;
  return trimmed.slice(0, MAX_STRING_LEN);
}

// Allowlist stricte : toute clé de paramètre absente de cette liste est
// retirée avant envoi, même fournie par erreur par un appelant. Complète
// volontairement au fil des événements réellement utilisés ci-dessous.
const ALLOWED_PARAM_KEYS = new Set([
  "page_path",
  "page_location",
  "page_title",
  "search_term",
  "country",
  "contract_type",
  "work_mode",
  "results_count",
  "content_type",
  "item_id",
  "method",
  "plan_id",
  "plan_name",
  "value",
  "currency",
  "transaction_id",
  "test_mode",
  "reason",
  "has_country_filter",
  "frequency",
  "channel",
  "page_type",
  "source",
  "step",
  "exact_match",
  "results_offered",
  "confirmation_path",
  "reminder_step",
  "hours_since_pending",
  "context",
  "browser",
  "os",
  "outcome",
  "available",
]);

// Seuls les champs de texte réellement libres (saisis par l'utilisateur)
// passent par le filtre complet email + téléphone. Les identifiants
// structurés (UUID d'offre, référence de transaction Paystack, chemin
// d'URL...) contiennent souvent de longues suites de chiffres séparées par
// des tirets ou des points qui déclenchaient à tort le motif "téléphone" —
// un premier test sur le vrai domaine a confirmé le problème (page_path,
// page_location et item_id disparaissaient des événements réels). Ces
// champs structurés ne sont filtrés que sur le motif email, qui ne peut pas
// avoir de faux positif sur un UUID ou une URL interne.
const FREE_TEXT_PARAM_KEYS = new Set(["search_term"]);

function sanitizeParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === "string") {
      if (!value) continue;
      const isPii = FREE_TEXT_PARAM_KEYS.has(key) ? looksLikePii(value) : EMAIL_RE.test(value);
      if (isPii) continue; // on retire ce champ précis, pas tout l'événement
      const maxLen = LONG_PARAM_KEYS.has(key) ? MAX_URL_PARAM_LEN : MAX_STRING_LEN;
      out[key] = value.slice(0, maxLen);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
    // tout autre type (objet, tableau...) est ignoré par prudence
  }
  return out;
}

function sendEvent(eventName: string, params?: Record<string, unknown>) {
  try {
    if (!analyticsEnabled()) return;

    const safeParams = sanitizeParams(params);
    const win = getWin();

    if (win.__jrGaInitialized && typeof win.gtag === "function") {
      win.gtag("event", eventName, safeParams);
      return;
    }

    win.__jrPendingGaEvents = win.__jrPendingGaEvents ?? [];
    win.__jrPendingGaEvents.push({ eventName, eventParams: safeParams });
  } catch {
    // jamais bloquant pour l'app
  }
}

// ---------------------------------------------------------------------
// page_view (SPA) — un seul par navigation réelle, jamais de doublon
// ---------------------------------------------------------------------

export function trackPageView(pathname: string, search: string) {
  try {
    if (!analyticsEnabled()) return;

    const win = getWin();
    const pageKey = `${pathname}${search}`;
    if (win.__jrLastGaPageView === pageKey) return;
    win.__jrLastGaPageView = pageKey;

    sendEvent("page_view", {
      page_path: pathname,
      page_location: `${window.location.origin}${pathname}${search}`,
      page_title: document.title,
    });
  } catch {
    // no-op
  }
}

/** Conservé pour compatibilité avec l'appelant existant (LandingAnalyticsTracker). */
export function trackLandingPageView(pathname: string, search: string) {
  trackPageView(pathname, search);
}

// ---------------------------------------------------------------------
// Déduplication persistante (purchase) — survit à un rechargement de page
// ---------------------------------------------------------------------

function readIdSet(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(storageKey: string, ids: Set<string>, max: number) {
  try {
    const arr = Array.from(ids).slice(-max);
    localStorage.setItem(storageKey, JSON.stringify(arr));
  } catch {
    // stockage indisponible (navigation privée, quota...) : pas bloquant
  }
}

// ---------------------------------------------------------------------
// Événements recommandés GA4
// ---------------------------------------------------------------------

export function trackSearch(params: {
  searchTerm?: string | null;
  country?: string | null;
  contractType?: string | null;
  workMode?: string | null;
  resultsCount?: number;
}) {
  sendEvent("search", {
    search_term: sanitizeFreeText(params.searchTerm),
    country: params.country || undefined,
    contract_type: params.contractType || undefined,
    work_mode: params.workMode || undefined,
    results_count: params.resultsCount,
  });
}

export function trackSelectContent(params: { itemId: string }) {
  sendEvent("select_content", { content_type: "job", item_id: params.itemId });
}

export function trackSignUp(params: { method: "email" | "google" }) {
  sendEvent("sign_up", { method: params.method });
}

export function trackLogin(params: { method: "email" | "google" }) {
  sendEvent("login", { method: params.method });
}

export function trackTutorialBegin() {
  sendEvent("tutorial_begin");
}

export function trackTutorialComplete() {
  sendEvent("tutorial_complete");
}

export function trackBeginCheckout(params: {
  planId: string;
  planName: string;
  value: number;
  currency: string;
}) {
  sendEvent("begin_checkout", {
    plan_id: params.planId,
    plan_name: params.planName,
    value: params.value,
    currency: params.currency,
  });
}

/**
 * Ne doit être appelée qu'après confirmation serveur réelle du paiement
 * (statut renvoyé par l'edge function paystack_verify), jamais depuis une
 * simple page de retour. Déduplique par transactionId (référence Paystack) :
 * un même paiement ne peut jamais être compté deux fois, même après
 * rafraîchissement de la page ou nouvel appel de vérification.
 */
export function trackPurchase(params: {
  transactionId: string;
  planId: string;
  planName: string;
  value: number;
  currency: string;
  testMode?: boolean;
}) {
  if (!params.transactionId) return;

  const tracked = readIdSet(PURCHASE_DEDUPE_STORAGE_KEY);
  if (tracked.has(params.transactionId)) return;
  tracked.add(params.transactionId);
  writeIdSet(PURCHASE_DEDUPE_STORAGE_KEY, tracked, PURCHASE_DEDUPE_MAX);

  sendEvent("purchase", {
    transaction_id: params.transactionId,
    plan_id: params.planId,
    plan_name: params.planName,
    value: params.value,
    currency: params.currency,
    test_mode: Boolean(params.testMode),
  });
}

// ---------------------------------------------------------------------
// Événements personnalisés (spécifiques au funnel JobRadar)
// ---------------------------------------------------------------------

export function trackProfileCompleted() {
  sendEvent("profile_completed");
}

export function trackAlertCreated(params: {
  hasCountryFilter: boolean;
  frequency?: string;
  channel?: string;
  source?: "manual" | "onboarding" | "reactivation_banner";
}) {
  sendEvent("alert_created", {
    has_country_filter: params.hasCountryFilter,
    frequency: params.frequency,
    source: params.source ?? "manual",
    channel: params.channel,
  });
}

// Ajustement 3 (comptes existants sans alerte) : mesure du taux de clic et
// du taux d'activation de la bannière d'invitation non bloquante, séparément
// de l'événement alert_created générique ci-dessus (qui, lui, confirme la
// création effective — utile pour calculer le taux de clic -> activation).
export function trackAlertReactivationBannerShown() {
  sendEvent("alert_reactivation_banner_shown");
}

export function trackAlertReactivationBannerClicked() {
  sendEvent("alert_reactivation_banner_clicked");
}

export function trackApplicationStarted(params: { jobId: string }) {
  sendEvent("application_started", { item_id: params.jobId });
}

export function trackPricingViewed() {
  sendEvent("pricing_viewed", { page_type: "pricing" });
}

export function trackPaymentFailed(params: { reason?: string; planId?: string }) {
  sendEvent("payment_failed", { reason: params.reason, plan_id: params.planId });
}

// ---------------------------------------------------------------------
// Ajustement 9 (instrumentation du nouveau funnel, spec du 24/07/2026) :
// liste des événements demandés, sans aucune donnée personnelle (pas
// d'email, de téléphone, de texte libre sensible, ni de référence de
// paiement brute — transaction_id existe déjà, réservé à la dédup de
// purchase, jamais exposé comme identifiant utilisateur).
//
// "onboarding_started" et "checkout_started" / "pass_selected" (partie
// paiement) réutilisent des événements déjà câblés ailleurs
// (trackTutorialBegin, trackBeginCheckout) plutôt que d'en dupliquer un
// nouveau au nom identique.
//
// Les événements liés au cycle de vie du paiement
// (payment_pending / confirmed_* / reminder_sent /
// payment_recovered_after_reminder / pass_activated) sont définis ici,
// prêts à l'emploi, mais pas encore appelés nulle part : les mécanismes
// correspondants (Ajustements 6, 7, 8 — rapprochement Paystack, écran
// d'attente, relances) ne sont pas encore implémentés au moment de cet
// ajout. Même chose pour les 3 événements liés à l'élargissement de
// recherche (Ajustement 5).
// ---------------------------------------------------------------------

export function trackPreferencesValidated(params: { skipped: boolean }) {
  sendEvent("preferences_validated", { reason: params.skipped ? "skipped" : "filled" });
}

export function trackAlertConsentGiven() {
  sendEvent("alert_consent_given");
}

export function trackPreviewShown(params: { exactMatch: boolean; resultsCount: number }) {
  sendEvent("preview_shown", {
    exact_match: params.exactMatch,
    results_count: params.resultsCount,
  });
}

export function trackPreviewNoExactMatch(params: { resultsCount: number }) {
  sendEvent("preview_no_exact_match", { results_count: params.resultsCount });
}

export function trackUpgradeScreenShown() {
  sendEvent("upgrade_screen_shown");
}

export function trackContinuedFree() {
  sendEvent("continued_free");
}

export function trackPassSelected(params: { planId: string; planName: string }) {
  sendEvent("pass_selected", { plan_id: params.planId, plan_name: params.planName });
}

// Élargissement de recherche (Ajustement 5, pas encore implémenté) — les
// résultats élargis ne doivent jamais remplacer silencieusement les
// critères de l'alerte ; ces événements mesureront à quel point les
// utilisateurs acceptent réellement l'élargissement proposé.
export function trackWidenedResultsOffered(params: { resultsOffered: number }) {
  sendEvent("widened_results_offered", { results_offered: params.resultsOffered });
}

export function trackWidenedResultsAccepted() {
  sendEvent("widened_results_accepted");
}

export function trackWidenedResultsDeclined() {
  sendEvent("widened_results_declined");
}

// Cycle de vie du paiement (Ajustements 6/7/8, pas encore implémentés).
export function trackPaymentPending(params: { planId?: string }) {
  sendEvent("payment_pending", { plan_id: params.planId });
}

export type PaymentConfirmationPath = "webhook" | "user_return" | "scheduled_reconciliation";

export function trackPaymentConfirmed(params: { path: PaymentConfirmationPath; planId?: string }) {
  sendEvent("payment_confirmed", { confirmation_path: params.path, plan_id: params.planId });
}

export function trackReminderSent(params: { step: "first" | "second" }) {
  sendEvent("reminder_sent", { reminder_step: params.step });
}

export function trackPaymentRecoveredAfterReminder(params: { hoursSincePending?: number }) {
  sendEvent("payment_recovered_after_reminder", { hours_since_pending: params.hoursSincePending });
}

export function trackPassActivated(params: { planId?: string }) {
  sendEvent("pass_activated", { plan_id: params.planId });
}

export function trackPwaCtaShown(params: { context: string; browser?: string; os?: string; reason?: string }) {
  sendEvent("pwa_cta_shown", {
    context: params.context,
    browser: params.browser,
    os: params.os,
    reason: params.reason,
  });
}

export function trackPwaCtaClicked(params: { context: string; browser?: string; os?: string }) {
  sendEvent("pwa_cta_clicked", {
    context: params.context,
    browser: params.browser,
    os: params.os,
  });
}

export function trackPwaPromptAvailable(params: { available: boolean; browser?: string; os?: string }) {
  sendEvent("pwa_prompt_available", {
    available: params.available,
    browser: params.browser,
    os: params.os,
  });
}

export function trackPwaPromptOutcome(params: { outcome: "accepted" | "dismissed"; browser?: string; os?: string }) {
  sendEvent("pwa_prompt_outcome", {
    outcome: params.outcome,
    browser: params.browser,
    os: params.os,
  });
}

export function trackPwaFallbackShown(params: { context: string; browser?: string; os?: string }) {
  sendEvent("pwa_fallback_shown", {
    context: params.context,
    browser: params.browser,
    os: params.os,
  });
}

export function trackPwaAppInstalled(params?: { browser?: string; os?: string }) {
  sendEvent("pwa_appinstalled", {
    browser: params?.browser,
    os: params?.os,
  });
}
