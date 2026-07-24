import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearPartnerReferral, readPartnerReferral } from "./lib/partnerReferral";
import { usePaymentMarket } from "./lib/paymentMarket";
import { supabase } from "./lib/supabaseClient";
import { trackMetaEvent } from "./lib/metaPixel";
import {
  trackBeginCheckout,
  trackPassSelected,
  trackPaymentConfirmed,
  trackPaymentFailed,
  trackPaymentPending,
  trackPaymentRecoveredAfterReminder,
  trackPricingViewed,
  trackPurchase,
} from "./lib/analytics";
import { useSession } from "./lib/useSession";
import { buildJobRadarOnboardingHref } from "./lib/jobradarOnboarding";
import { useJobRadarOnboarding } from "./lib/useJobRadarOnboarding";
import { usePass } from "./lib/usePass";
import {
  FEATURED_PLAN_CODE,
  PRICING_CURRENCY_MESSAGE,
  PRICING_PRICE_NOTE,
  PRICING_REASSURANCE_MESSAGE,
  formatAmount,
  getPlanMarketing,
} from "./lib/pricingHelpers";
import { formatCheckoutXof, getPremiumDisplayPrice } from "./lib/premiumPricing";
import "./PricingPage.css";

type BillingSettings = {
  payments_enabled: boolean;
  maintenance_message: string | null;
};

type BillingPlanPrice = {
  id: string;
  currency: string;
  amount_minor: number;
  country_group: string | null;
  payment_method_type: string | null;
  is_active: boolean;
};

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  duration_days: number;
  is_active: boolean;
  sort_order: number;
  billing_plan_prices?: BillingPlanPrice[];
};

type CurrentPass = {
  id: string;
  plan_code: string;
  plan_name: string;
  status: string;
  ends_at: string;
  days_remaining: number;
};

type PaymentRow = {
  id: string;
  status: string;
  amount_minor: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  plan?: { name?: string | null; code?: string | null } | null;
};

const GENERIC_SERVER_ERROR = "Une erreur temporaire est survenue. Réessaie dans quelques instants.";
const GENERIC_PAYMENT_ERROR =
  "Le paiement n’a pas pu être finalisé. Aucun montant n’a été débité. Réessaie ou contacte le support.";
// Ajustement 7 (écran d'attente) : un statut "pending"/"ongoing" renvoyé par
// paystack_verify ne veut pas dire que le paiement a échoué — fréquent en
// mobile money, où la confirmation se fait sur le téléphone et peut prendre
// un moment. Avant ce correctif, ce cas déclenchait le même message
// d'échec générique que ci-dessus (potentiellement faux) et effaçait la
// référence de session, rendant toute reprise automatique impossible.
const STILL_RESOLVING_STATUSES = new Set(["pending", "ongoing", "queued"]);
const PENDING_MESSAGE =
  "Ton paiement est en cours de confirmation (fréquent en mobile money : confirme sur ton téléphone si ce n'est pas déjà fait). Nous vérifions automatiquement — tu peux aussi fermer cette page, l'activation se fera dès la confirmation.";
const PENDING_TIMEOUT_MESSAGE =
  "Ton paiement est toujours en cours de confirmation. Rien n'a échoué : reviens sur cette page dans quelques minutes, la vérification reprendra automatiquement.";
// Bornes du polling actif pendant que l'utilisateur reste sur la page :
// ~8 tentatives espacées de 8s (~1min) avant de laisser reposer, suspendu
// pendant que l'onglet n'est pas visible, et jamais au-delà de 5 minutes
// d'horloge murale même si l'onglet reste visible en continu.
const POLL_DELAY_MS = 8000;
const MAX_POLL_ATTEMPTS = 8;
const MAX_POLL_WALL_CLOCK_MS = 5 * 60 * 1000;

const PLAN_CARD_DETAILS: Record<string, { benefit: string; bullets: string[] }> = {
  pass_7d: {
    benefit: "7 jours pour découvrir JobRadar et repérer tes premières opportunités.",
    bullets: [
      "Accès complet aux offres débloquées",
      "Alertes ciblées selon ton profil",
      "Paiement unique, sans abonnement",
    ],
  },
  pass_30d: {
    benefit: "30 jours pour laisser JobRadar surveiller les offres pendant ta recherche.",
    bullets: [
      "Offres triées selon ton profil",
      "Alertes ciblées pendant 30 jours",
      "Idéal pour une recherche active",
    ],
  },
  pass_90d: {
    benefit: "90 jours pour suivre tes opportunités plus longtemps, au meilleur rapport durée/prix.",
    bullets: [
      "Tout l’accès JobRadar pendant 90 jours",
      "Plus de temps pour suivre les bonnes offres",
      "Meilleur rapport durée/prix",
    ],
  },
};

const FAQ_ITEMS = [
  {
    question: "Qu’est-ce qui est gratuit sur JobRadar ?",
    answer:
      "Tu peux créer ton compte, lancer une recherche et voir un aperçu de 4 offres, avec une alerte active par email, sans carte bancaire. Un pass débloque l’accès aux offres complètes, le lien de candidature, la sauvegarde d’offres et plusieurs alertes actives en parallèle.",
  },
  {
    question: "Que débloque un pass JobRadar ?",
    answer:
      "Un pass te donne accès aux offres complètes et aux fonctionnalités prévues pendant la durée choisie. Tu peux consulter, suivre et organiser plus facilement les opportunités qui correspondent à ta recherche.",
  },
  {
    question: "Quand mon accès est-il activé ?",
    answer: "Après confirmation du paiement. Tu recevras aussi un e-mail de confirmation.",
  },
  {
    question: "Y a-t-il un renouvellement automatique ?",
    answer:
      "Non. Chaque pass est un paiement unique à durée fixe. Tu choisis toi-même de renouveler si tu veux continuer.",
  },
  {
    question: "JobRadar postule-t-il à ma place ?",
    answer:
      "Non. JobRadar t’aide à repérer et organiser les bonnes opportunités. Tu restes libre de choisir les offres à ouvrir, sauvegarder ou suivre.",
  },
  {
    question: "Quels moyens de paiement sont acceptés ?",
    answer: "Carte bancaire et Mobile Money, selon les moyens disponibles au moment du paiement.",
  },
];

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function formatPassStatus(status?: string | null) {
  switch (status) {
    case "active":
      return { label: "Actif", tone: "active" };
    case "expired":
      return { label: "Expiré", tone: "expired" };
    case "cancelled":
      return { label: "Annulé", tone: "expired" };
    default:
      return { label: status ?? "Inconnu", tone: "neutral" };
  }
}

function formatPaymentStatus(status?: string | null) {
  switch (status) {
    case "paid":
    case "paid_test":
    case "active":
    case "succeeded":
      return { label: "Actif", tone: "success" };
    case "expired":
      return { label: "Expiré", tone: "expired" };
    case "pending":
    case "initialized":
    case "processing":
      return { label: "En attente", tone: "pending" };
    case "failed":
    case "cancelled":
    case "canceled":
      return { label: "Échoué", tone: "danger" };
    default:
      return { label: "En attente", tone: "pending" };
  }
}

function formatPaymentAmount(amountMinor: number, currency: string) {
  return currency === "XOF" ? formatCheckoutXof(amountMinor) : formatAmount(amountMinor, currency);
}

function PricingPostCheckoutActions() {
  const navigate = useNavigate();
  const onboarding = useJobRadarOnboarding();
  const primaryTo = onboarding.isOnboarded ? "/jobradar/feed" : buildJobRadarOnboardingHref("complete-profile");
  const primaryLabel = "Voir les offres pour moi";

  return (
    <div className="pricing-success-actions" aria-label="Suite après achat">
      <button
        type="button"
        className="pricing-success-actions__primary"
        onClick={() => navigate(primaryTo)}
      >
        {primaryLabel}
      </button>
      <button
        type="button"
        className="pricing-success-actions__secondary"
        onClick={() => navigate("/me/subscription")}
      >
        Gérer mon accès JobRadar
      </button>
    </div>
  );
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const paymentMarket = usePaymentMarket(session?.user?.id);
  const { refreshPass } = usePass();
  const cardsLogoSrc = `${import.meta.env.BASE_URL}logo-visa-mastercard.png`;
  const mobileMoneyLogoSrc = `${import.meta.env.BASE_URL}mobile-money-operateurs.png`;

  const paystackPublicKey = (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY ?? "").trim();
  const paystackEnabled = Boolean(paystackPublicKey);
  const isPaystackTest = paystackPublicKey.startsWith("pk_test_");

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [currentPass, setCurrentPass] = useState<CurrentPass | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [showPostCheckout, setShowPostCheckout] = useState(false);
  const [hasRecentTestPayment, setHasRecentTestPayment] = useState(false);
  const [isTestPass, setIsTestPass] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const lastVerifiedRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);

  const loadPricingData = useCallback(async () => {
    setLoading(true);

    try {
      const [settingsRes, plansRes] = await Promise.all([
        supabase.from("billing_settings").select("payments_enabled, maintenance_message").maybeSingle(),
        supabase
          .from("billing_plans")
          .select(
            "id, code, name, duration_days, is_active, sort_order, billing_plan_prices(id, currency, amount_minor, country_group, payment_method_type, is_active)"
          )
          .order("sort_order", { ascending: true }),
      ]);

      const { data: sData, error: sErr } = settingsRes;
      const { data: pData, error: pErr } = plansRes;

      if (sErr) setErrorMsg(GENERIC_SERVER_ERROR);
      if (pErr) setErrorMsg((prev) => prev ?? GENERIC_SERVER_ERROR);

      setSettings((sData as BillingSettings) ?? null);
      setPlans((pData as BillingPlan[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAccountData = useCallback(async () => {
    if (!session?.user) {
      setCurrentPass(null);
      setHasRecentTestPayment(false);
      setIsTestPass(false);
      setPayments([]);
      setAccountLoading(false);
      return;
    }

    setAccountLoading(true);

    try {
      const nowIso = new Date().toISOString();
      const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      const [passRes, subRes, recentTestRes, paymentsRes] = await Promise.all([
        supabase
          .from("current_user_pass")
          .select("id, plan_code, plan_name, status, ends_at, days_remaining")
          .maybeSingle(),
        supabase
          .from("billing_subscriptions")
          .select("id, ends_at, source_payment:billing_payments(status, provider_payload)")
          .eq("user_id", session.user.id)
          .eq("status", "active")
          .gt("ends_at", nowIso)
          .maybeSingle(),
        supabase
          .from("billing_payments")
          .select("id, updated_at")
          .eq("user_id", session.user.id)
          .eq("provider_code", "paystack")
          .eq("status", "paid_test")
          .gte("updated_at", recentCutoff)
          .order("updated_at", { ascending: false })
          .maybeSingle(),
        supabase
          .from("billing_payments")
          .select("id, status, amount_minor, currency, paid_at, created_at, plan:billing_plans(name, code)")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      if (passRes.error) setErrorMsg((prev) => prev ?? GENERIC_SERVER_ERROR);
      if (subRes.error) setErrorMsg((prev) => prev ?? GENERIC_SERVER_ERROR);
      if (recentTestRes.error) setErrorMsg((prev) => prev ?? GENERIC_SERVER_ERROR);
      if (paymentsRes.error) setErrorMsg((prev) => prev ?? GENERIC_SERVER_ERROR);

      setCurrentPass((passRes.data as CurrentPass) ?? null);
      setPayments((paymentsRes.data as PaymentRow[]) ?? []);

      const subData = subRes.data;
      const testFlag =
        (subData as { source_payment?: { status?: string; provider_payload?: { test_mode?: boolean } } })
          ?.source_payment?.status === "paid_test" ||
        Boolean(
          (subData as { source_payment?: { provider_payload?: { test_mode?: boolean } } })?.source_payment
            ?.provider_payload?.test_mode
        );

      setIsTestPass(Boolean(subData?.id) && testFlag);
      setHasRecentTestPayment(Boolean(recentTestRes.data?.id));
    } finally {
      setAccountLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    trackPricingViewed();
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setErrorMsg(null);
      void loadPricingData();
    });
  }, [loadPricingData]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAccountData();
    });
  }, [loadAccountData]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const params = new URLSearchParams(window.location.search);
    const refFromUrl = params.get("reference") || params.get("trxref");
    const refFromStorage = sessionStorage.getItem("paystack_ref");
    const reference = refFromUrl || refFromStorage;
    // Capturé avant le replaceState ci-dessous (qui vide la query string) :
    // permet de savoir, une fois le paiement confirmé, si l'utilisateur
    // revient depuis une relance email (Ajustement 8) plutôt que du retour
    // Paystack normal.
    const utmCampaign = params.get("utm_campaign") || "";

    if (!reference) return;
    if (lastVerifiedRef.current === reference) return;

    lastVerifiedRef.current = reference;
    if (refFromUrl) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    let cancelled = false;
    let pollTimeoutId: number | null = null;
    const startedAt = Date.now();
    let pendingTracked = false;

    const clearScheduledPoll = () => {
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
    };

    // Ajustement 7 : un statut encore en attente n'est ni un succès ni un
    // échec. On reprogramme une nouvelle vérification tant qu'on est dans
    // les bornes (nombre de tentatives, durée totale, onglet visible), sans
    // jamais effacer la référence de session — c'est justement ce qui
    // permettait, avant ce correctif, de perdre toute possibilité de reprise
    // dès que paystack_verify répondait autre chose qu'un succès immédiat.
    const scheduleNextPoll = (attempt: number) => {
      const elapsed = Date.now() - startedAt;
      if (cancelled || attempt >= MAX_POLL_ATTEMPTS || elapsed >= MAX_POLL_WALL_CLOCK_MS) {
        setIsVerifying(false);
        setInfoMsg(PENDING_TIMEOUT_MESSAGE);
        return;
      }
      const schedule = () => {
        if (cancelled) return;
        pollTimeoutId = window.setTimeout(() => void runVerify(attempt + 1), POLL_DELAY_MS);
      };
      if (document.visibilityState === "visible") {
        schedule();
      } else {
        // Onglet masqué : on attend qu'il redevienne visible plutôt que de
        // consommer une tentative dans le vide.
        const onVisible = () => {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", onVisible);
          schedule();
        };
        document.addEventListener("visibilitychange", onVisible);
      }
    };

    const runVerify = async (attempt = 1) => {
      if (cancelled) return;
      setIsVerifying(true);
      setInfoMsg(attempt === 1 ? "Vérification du paiement en cours..." : PENDING_MESSAGE);
      setErrorMsg(null);
      setShowPostCheckout(false);

      const { data, error } = await supabase.functions.invoke("paystack_verify", {
        body: { reference },
      });

      if (cancelled) return;

      if (error) {
        // Erreur d'appel (réseau, timeout...) : pas une confirmation
        // d'échec du paiement lui-même — on retente dans les mêmes bornes
        // plutôt que d'afficher un faux échec et d'effacer la référence.
        scheduleNextPoll(attempt);
        return;
      }

      if (data?.ok) {
        clearScheduledPoll();
        trackPaymentConfirmed({ path: "user_return" });
        if (utmCampaign.startsWith("jobradar_payment_reminder")) {
          trackPaymentRecoveredAfterReminder({});
        }
        setInfoMsg(
          data?.status === "paid_test"
            ? "Ton pass est actif (test). Ton accès JobRadar est maintenant activé. Tu peux consulter les offres recommandées et configurer tes alertes."
            : "Ton pass est actif. Ton accès JobRadar est maintenant activé. Tu peux consulter les offres recommandées et configurer tes alertes. Aucun renouvellement automatique."
        );
        setShowPostCheckout(true);
        clearPartnerReferral();
        await loadAccountData();
        await refreshPass();

        // purchase n'est envoyé qu'ici, après confirmation serveur réelle du
        // paiement par paystack_verify (jamais depuis la simple présence du
        // paramètre ?reference= dans l'URL). Dédupliqué par référence dans
        // trackPurchase, donc un rafraîchissement de page ou un second appel
        // sur la même référence ne compte jamais deux fois.
        const { data: paidRow } = await supabase
          .from("billing_payments")
          .select("id, amount_minor, currency, plan:billing_plans(code, name)")
          .eq("provider_payment_id", reference)
          .maybeSingle();

        if (paidRow) {
          const planRow = paidRow.plan as { code?: string; name?: string } | null;
          const isXof = paidRow.currency === "XOF" || paidRow.currency === "XAF";
          trackPurchase({
            transactionId: reference,
            planId: planRow?.code ?? "unknown",
            planName: planRow?.name ?? "unknown",
            value: isXof ? paidRow.amount_minor : paidRow.amount_minor / 100,
            currency: paidRow.currency,
            testMode: data?.status === "paid_test",
          });
        }

        setIsVerifying(false);
        sessionStorage.removeItem("paystack_ref");
        return;
      }

      const status = typeof data?.status === "string" ? data.status : "";
      if (STILL_RESOLVING_STATUSES.has(status)) {
        if (!pendingTracked) {
          pendingTracked = true;
          trackPaymentPending({});
        }
        // Toujours en attente : on NE touche PAS à sessionStorage.paystack_ref
        // ici. Le filet serveur (paystack_reconcile_pending, Ajustement 6)
        // prendra le relais même si l'utilisateur quitte la page avant que
        // le polling ci-dessous n'aboutisse.
        scheduleNextPoll(attempt);
        return;
      }

      // Statut réellement négatif (failed, abandoned, cancelled, mismatch...).
      setErrorMsg(GENERIC_PAYMENT_ERROR);
      trackPaymentFailed({ reason: status || "verify_not_ok" });
      setIsVerifying(false);
      sessionStorage.removeItem("paystack_ref");
    };

    void runVerify();

    return () => {
      cancelled = true;
      clearScheduledPoll();
    };
  }, [session?.user?.id, loadAccountData, refreshPass]);

  const paymentsEnabled = settings?.payments_enabled !== false;
  const maintenanceMessage =
    settings?.maintenance_message || "Paiements temporairement indisponibles.";
  const passStatus = currentPass ? formatPassStatus(currentPass.status) : null;
  const passStatusDisplay =
    isTestPass && passStatus?.label === "Actif" ? "Actif (test)" : passStatus?.label;
  const hasActivePass = Boolean(currentPass && currentPass.status === "active");
  const isBusy = isCheckingOut || isVerifying;
  const isAccountPending = Boolean(session?.user) && accountLoading;
  const displayMarket = paymentMarket.resolution.market;
  const accessSummary = isAccountPending
    ? "Vérification en cours…"
    : hasActivePass && currentPass
      ? `Actif jusqu'au ${formatDate(currentPass.ends_at)}`
      : "Aucun Pass actif";

  const handleSelectPaymentMarket = async (market: "eur" | "xof") => {
    try {
      await paymentMarket.setPreference(market);
      setInfoMsg(
        market === "eur"
          ? "Ton choix EUR est enregistré. Le paiement reste traité en francs CFA (FCFA)."
          : "Ton choix XOF est enregistré."
      );
      setErrorMsg(null);
    } catch (error) {
      console.error("[JobRadar] payment preference save failed", error);
      setErrorMsg("Une erreur temporaire est survenue. Tu peux continuer et réessayer plus tard.");
    }
  };

  const onBuy = async (plan: BillingPlan, price: BillingPlanPrice | null) => {
    trackPassSelected({ planId: plan.code, planName: plan.name });
    if (!session?.user) {
      navigate("/auth", { state: { from: "/pricing" } });
      return;
    }
    if (isSubmittingRef.current || isBusy || busyCode) return;
    if (!price) return;
    if (!paystackEnabled) {
      setErrorMsg("Le paiement est temporairement indisponible. Réessaie dans quelques instants.");
      return;
    }

    if (currentPass && currentPass.status === "active") {
      setInfoMsg(
        `Ton pass est déjà actif${isTestPass ? " (test)" : ""} jusqu’au ${formatDate(
          currentPass.ends_at
        )}.`
      );
      setShowPostCheckout(true);
      return;
    }

    if (hasRecentTestPayment) {
      setInfoMsg("Un paiement test récent existe déjà. Attends quelques minutes avant de recommencer.");
      setShowPostCheckout(false);
      return;
    }

    const pendingRef = sessionStorage.getItem("paystack_ref");
    if (pendingRef) {
      setInfoMsg("Un paiement est déjà en cours. Termine-le avant d’en démarrer un autre.");
      setShowPostCheckout(false);
      return;
    }

    isSubmittingRef.current = true;
    setBusyCode(plan.code);
    setIsCheckingOut(true);
    setInfoMsg(null);
    setErrorMsg(null);
    setShowPostCheckout(false);

    try {
      const partnerReferral = readPartnerReferral();

      trackMetaEvent("Subscribe", {
        value: price.currency === "XOF" || price.currency === "XAF" ? price.amount_minor : price.amount_minor / 100,
        currency: price.currency,
        content_name: plan.name,
        content_ids: [plan.code],
      });
      trackBeginCheckout({
        planId: plan.code,
        planName: plan.name,
        value: price.currency === "XOF" || price.currency === "XAF" ? price.amount_minor : price.amount_minor / 100,
        currency: price.currency,
      });

      const { data, error } = await supabase.functions.invoke("paystack_initialize", {
        body: {
          plan_code: plan.code,
          currency: price.currency,
          payment_method_type: price.payment_method_type ?? "any",
          partner_referral_code: partnerReferral?.code ?? null,
          partner_referral_captured_at: partnerReferral?.capturedAt ?? null,
          partner_referral_source_path: partnerReferral?.sourcePath ?? null,
        },
      });

      if (error) {
        setErrorMsg(GENERIC_PAYMENT_ERROR);
        trackPaymentFailed({ reason: "initialize_invoke_error", planId: plan.code });
      } else if (data?.ok && data?.authorization_url) {
        if (data?.reference) {
          sessionStorage.setItem("paystack_ref", data.reference as string);
        }
        setInfoMsg("Ouverture du paiement sécurisé…");
        window.location.assign(data.authorization_url as string);
      } else {
        setErrorMsg(GENERIC_PAYMENT_ERROR);
        trackPaymentFailed({ reason: "initialize_not_ok", planId: plan.code });
      }
    } finally {
      setBusyCode(null);
      setIsCheckingOut(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="pricing-shell">
      <header className="pricing-hero">
        <div className="pricing-hero__inner">
          <div className="pricing-hero__brand">PASS JOBRADAR</div>
          <h1>Débloque plus d’opportunités pendant que JobRadar surveille pour toi.</h1>
          <p>
            Choisis la durée qui correspond à ton rythme de recherche. Tu paies une fois, tu accèdes
            aux offres débloquées et aux alertes ciblées, sans renouvellement automatique.
          </p>
        </div>
      </header>

      <main className="pricing-main">
        <section className="pricing-access-bar" aria-label="Accès actuel">
          <div className="pricing-access-bar__status">
            <span
              className={`pricing-access-bar__dot ${
                hasActivePass && currentPass ? "pricing-access-bar__dot--active" : ""
              }`}
              aria-hidden="true"
            />
            <span>{accessSummary}</span>
            {passStatusDisplay && <span className={`pass-pill pass-pill--${passStatus?.tone}`}>{passStatusDisplay}</span>}
          </div>
          <a className="pricing-access-bar__link" href="#payment-history">
            Voir l'historique ↓
          </a>
        </section>

        {settings && !paymentsEnabled && <div className="pricing-banner">{maintenanceMessage}</div>}

        {isPaystackTest && (
          <div className="pricing-info">
            <strong>Mode test actif.</strong> Aucun débit réel n'est effectué.
          </div>
        )}
        {!paystackEnabled && (
          <div className="pricing-error">Le paiement est temporairement indisponible. Réessaie dans quelques instants.</div>
        )}
        {errorMsg && <div className="pricing-error">Erreur : {errorMsg}</div>}
        {infoMsg && <div className="pricing-info">{infoMsg}</div>}

        {showPostCheckout && <PricingPostCheckoutActions />}

        {hasActivePass && currentPass && (
          <div className="pricing-info">
            {"Ton pass est déjà actif"}
            {isTestPass ? " (test)" : ""} jusqu’au{" "}
            <strong>{formatDate(currentPass.ends_at)}</strong>.
          </div>
        )}

        <section className="pricing-plans" aria-label="Pass JobRadar">
          <div className="pricing-plan-intro">
            Choisis le pass adapté à ton rythme de recherche
          </div>

          <section className="pricing-currency-panel" aria-label="Devise d'affichage">
            <div className="pricing-currency-panel__copy">
              <div className="pricing-currency-panel__label">Afficher les prix en</div>
              <p>{PRICING_CURRENCY_MESSAGE}</p>
            </div>
            <div className="pricing-currency-panel__choices" role="group" aria-label="Afficher les prix en">
              <button
                type="button"
                className={`pricing-currency-panel__choice ${
                  paymentMarket.resolution.market === "eur" ? "is-active" : ""
                }`}
                onClick={() => void handleSelectPaymentMarket("eur")}
                disabled={paymentMarket.loading || paymentMarket.savingPreference}
              >
                EUR
              </button>
              <button
                type="button"
                className={`pricing-currency-panel__choice ${
                  paymentMarket.resolution.market === "xof" ? "is-active" : ""
                }`}
                onClick={() => void handleSelectPaymentMarket("xof")}
                disabled={paymentMarket.loading || paymentMarket.savingPreference}
              >
                XOF
              </button>
            </div>
            {!paymentMarket.canPersistPreference && (
              <p className="pricing-currency-panel__session">
                Ton choix est gardé pour cette session. Connecte-toi pour l’enregistrer.
              </p>
            )}
            {paymentMarket.error && (
              <div className="pricing-error">
                Une erreur temporaire est survenue. Tu peux continuer et réessayer plus tard.
              </div>
            )}
          </section>

          {loading ? (
            <div className="pricing-loading">Chargement...</div>
          ) : (
            <section className="pricing-grid">
              <div className="pricing-card" data-disabled="false">
                <div className="pricing-card__top" />
                <div className="pricing-card__meta">Sans engagement</div>
                <div className="pricing-card__title">Gratuit</div>
                <div className="pricing-card__short">Pour découvrir JobRadar</div>

                <div className="pricing-card__priceWrap">
                  <div className="pricing-card__price">Gratuit</div>
                </div>

                <div className="pricing-card__benefit">
                  Découvre JobRadar sans engagement avant de choisir un pass.
                </div>
                <ul className="pricing-card__bullets">
                  <li>Aperçu de 4 offres par recherche</li>
                  <li>1 alerte active par email</li>
                  <li>Aucune carte bancaire requise</li>
                </ul>

                <button type="button" className="pricing-card__cta" disabled>
                  Inclus dans ton compte
                </button>
              </div>

              {plans.map((plan) => {
                const prices = plan.billing_plan_prices ?? [];
                const price = prices.find((entry) => entry.currency === "XOF") ?? null;
                const marketing = getPlanMarketing(plan.code, plan.name, plan.duration_days);
                const planDetails = PLAN_CARD_DETAILS[plan.code] ?? {
                  benefit: marketing.headline,
                  bullets: [marketing.description, "Sans engagement", PRICING_PRICE_NOTE],
                };
                const displayPrice = price
                  ? getPremiumDisplayPrice(plan.code, price.amount_minor, displayMarket)
                  : null;

                const planActive = plan.is_active;
                const priceActive = Boolean(price?.is_active);
                const canBuy =
                  paymentsEnabled &&
                  planActive &&
                  priceActive &&
                  !isAccountPending &&
                  !hasActivePass &&
                  !hasRecentTestPayment &&
                  paystackEnabled;

                let statusLabel = marketing.badge;
                let statusTone = marketing.badgeTone;
                if (!paymentsEnabled) {
                  statusLabel = "Indisponible temporairement";
                  statusTone = "paused";
                } else if (!planActive || !priceActive) {
                  statusLabel = "Bientôt disponible";
                  statusTone = "soon";
                }

                const isFeatured = plan.code === FEATURED_PLAN_CODE;

                return (
                  <div
                    key={plan.id}
                    className={`pricing-card ${isFeatured ? "is-featured" : ""}`}
                    data-disabled={!canBuy}
                  >
                    <div className="pricing-card__top">
                      {isFeatured || statusTone !== "available" ? (
                        <div className={`pricing-card__status pricing-card__status--${statusTone}`}>
                          {statusLabel}
                        </div>
                      ) : null}
                    </div>

                    <div className="pricing-card__meta">{marketing.durationLabel}</div>
                    <div className="pricing-card__title">{marketing.title}</div>
                    <div className="pricing-card__short">{marketing.shortLine}</div>

                    <div className="pricing-card__priceWrap">
                      <div className="pricing-card__price">{displayPrice?.primaryLabel ?? "--"}</div>
                    </div>

                    <div className="pricing-card__benefit">{planDetails.benefit}</div>
                    <ul className="pricing-card__bullets">
                      {planDetails.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      className="pricing-card__cta"
                      disabled={!canBuy || busyCode === plan.code || isBusy}
                      onClick={() => onBuy(plan, price)}
                    >
                      {isAccountPending
                        ? "Vérification..."
                        : busyCode === plan.code || isBusy
                          ? "Traitement en cours..."
                          : displayPrice?.ctaLabel ?? marketing.ctaLabel}
                    </button>

                    <div className="pricing-card__footnote">{PRICING_REASSURANCE_MESSAGE}</div>
                    <div className="pricing-card__footnote">{PRICING_CURRENCY_MESSAGE}</div>
                  </div>
                );
              })}
            </section>
          )}
        </section>

        <section className="pricing-trust-strip" aria-label="Confiance paiement">
          <span>Paiement unique</span>
          <span>Carte ou Mobile Money</span>
          <span>Accès activé après paiement</span>
          <span>Aucun renouvellement automatique</span>
        </section>

        <section className="pricing-payments" aria-label="Moyens de paiement acceptés">
          <div className="pricing-payments__head">
            <div className="pricing-payments__title">Comment payer ?</div>
            <div className="pricing-payments__sub">
              Carte bancaire et Mobile Money acceptés. Paiement sécurisé.
            </div>
          </div>
          <div className="pricing-payments__logos">
            <div className="pricing-payments__logoCard">
              <img
                className="pricing-payments__logo pricing-payments__logo--cards"
                src={cardsLogoSrc}
                alt="Visa et Mastercard"
                width="188"
                height="36"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="pricing-payments__logoCard">
              <img
                className="pricing-payments__logo pricing-payments__logo--mobile"
                src={mobileMoneyLogoSrc}
                alt="Orange Money, MTN Mobile Money, Moov Money et Wave"
                width="250"
                height="52"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </section>

        <section className="pricing-faq" aria-label="Questions fréquentes">
          <div className="pricing-section-heading">
            <h2>Questions fréquentes</h2>
          </div>
          <div className="pricing-faq__grid">
            {FAQ_ITEMS.map((item) => (
              <article className="pricing-faq__item" key={item.question}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pricing-history" id="payment-history">
          <div className="pricing-pass__header">
            <div>
              <h2>Mes paiements</h2>
              <p className="pricing-pass__sub">Dernières activations et état de ton accès</p>
            </div>
          </div>

          {accountLoading ? (
            <div className="pricing-loading">Chargement...</div>
          ) : payments.length === 0 ? (
            <div className="pass-empty">
              <p>Aucun paiement pour le moment.</p>
            </div>
          ) : (
            <div className="pricing-history__table" role="table" aria-label="Historique des paiements">
              <div className="pricing-history__head" role="row">
                <span>Date</span>
                <span>Pass</span>
                <span>Montant</span>
                <span>Statut</span>
              </div>
              {payments.map((payment) => {
                const paymentStatus = formatPaymentStatus(payment.status);
                const paymentDate = payment.paid_at || payment.created_at;
                const planName =
                  (payment.plan?.code
                    ? getPlanMarketing(payment.plan.code, payment.plan.name ?? "Pass JobRadar", 0).title
                    : payment.plan?.name) || "Pass JobRadar";

                return (
                  <div className="pricing-history__row" key={payment.id} role="row">
                    <div className="pricing-history__cell">
                      <span className="pricing-history__label">Date</span>
                      <span>{formatDate(paymentDate)}</span>
                    </div>
                    <div className="pricing-history__cell">
                      <span className="pricing-history__label">Pass</span>
                      <span>{planName}</span>
                    </div>
                    <div className="pricing-history__cell">
                      <span className="pricing-history__label">Montant</span>
                      <span>{formatPaymentAmount(payment.amount_minor, payment.currency)}</span>
                    </div>
                    <div className="pricing-history__cell">
                      <span className="pricing-history__label">Statut</span>
                      <span className={`pricing-payment-status pricing-payment-status--${paymentStatus.tone}`}>
                        {paymentStatus.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}