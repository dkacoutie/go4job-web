import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PaymentMarketPanel from "./components/PaymentMarketPanel";
import { clearPartnerReferral, readPartnerReferral } from "./lib/partnerReferral";
import { usePaymentMarket } from "./lib/paymentMarket";
import { supabase } from "./lib/supabaseClient";
import { trackMetaEvent } from "./lib/metaPixel";
import { useSession } from "./lib/useSession";
import { buildJobRadarOnboardingHref } from "./lib/jobradarOnboarding";
import { useJobRadarOnboarding } from "./lib/useJobRadarOnboarding";
import { usePass } from "./lib/usePass";
import {
  FEATURED_PLAN_CODE,
  PRICING_PRICE_NOTE,
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

const PRODUCT_PROOF_ITEMS = [
  {
    value: "Plus de 100 000",
    label: "offres actives",
  },
  {
    value: "3 grandes zones",
    label: "Europe, Afrique de l'Ouest, États-Unis",
  },
  {
    value: "Alertes ciblées",
    label: "selon votre profil et votre zone de recherche",
  },
];

const FAQ_ITEMS = [
  {
    question: "Quand mon accès est-il activé ?",
    answer: "Après confirmation du paiement. Vous recevrez aussi un e-mail de confirmation.",
  },
  {
    question: "Y a-t-il un renouvellement automatique ?",
    answer:
      "Non. Chaque Pass est à durée fixe. Vous choisissez de renouveler quand vous le souhaitez.",
  },
  {
    question: "Puis-je choisir un autre Pass ensuite ?",
    answer:
      "Oui. À la fin de votre période en cours, vous pouvez choisir le Pass qui correspond à votre besoin.",
  },
  {
    question: "Quels moyens de paiement sont acceptés ?",
    answer: "Carte bancaire et Mobile Money, avec paiement sécurisé via Paystack.",
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

function getCurrencyNote(market: "eur" | "xof") {
  return market === "eur"
    ? "Les prix sont affichés en euros. Le montant final est affiché avant confirmation du paiement."
    : "Les prix sont affichés en francs CFA. Le montant final est affiché avant confirmation du paiement.";
}

function PricingPostCheckoutActions() {
  const navigate = useNavigate();
  const onboarding = useJobRadarOnboarding();
  const primaryTo = onboarding.isOnboarded ? "/jobradar/feed" : buildJobRadarOnboardingHref("complete-profile");
  const primaryLabel = onboarding.isOnboarded ? "Voir mes offres" : "Continuer mon onboarding";

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
        {"Voir mon accès"}
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

      if (sErr) setErrorMsg(sErr.message);
      if (pErr) setErrorMsg((prev) => prev ?? pErr.message);

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

      if (passRes.error) setErrorMsg((prev) => prev ?? passRes.error?.message ?? null);
      if (subRes.error) setErrorMsg((prev) => prev ?? subRes.error?.message ?? null);
      if (recentTestRes.error) setErrorMsg((prev) => prev ?? recentTestRes.error?.message ?? null);
      if (paymentsRes.error) setErrorMsg((prev) => prev ?? paymentsRes.error?.message ?? null);

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

    if (!reference) return;
    if (lastVerifiedRef.current === reference) return;

    lastVerifiedRef.current = reference;
    if (refFromUrl) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    const runVerify = async () => {
      setIsVerifying(true);
      setInfoMsg("Vérification du paiement en cours...");
      setErrorMsg(null);
      setShowPostCheckout(false);

      const { data, error } = await supabase.functions.invoke("paystack_verify", {
        body: { reference },
      });

      if (error) {
        const ctxMsg =
          (error as { context?: { body?: { message?: string } } })?.context?.body?.message;
        setErrorMsg(ctxMsg || error.message);
      } else if (data?.ok) {
        setInfoMsg(
          data?.status === "paid_test"
            ? "Paiement test confirmé. Votre Pass est actif (test)."
            : "Paiement confirmé. Votre Pass est actif."
        );
        setShowPostCheckout(true);
        clearPartnerReferral();
        await loadAccountData();
        await refreshPass();
      } else {
        setErrorMsg("Paiement non confirmé. Aucun débit effectué.");
      }

      setIsVerifying(false);
      sessionStorage.removeItem("paystack_ref");
    };

    runVerify();
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
    ? "Accès actuel · Vérification en cours…"
    : hasActivePass && currentPass
      ? `Votre accès JobRadar est actif jusqu'au ${formatDate(currentPass.ends_at)}`
      : "Accès actuel · Aucun Pass actif";

  const handleSelectPaymentMarket = async (market: "eur" | "xof") => {
    try {
      await paymentMarket.setPreference(market);
      setInfoMsg(
        market === "eur"
          ? "Votre choix EUR est enregistré pour l'affichage."
          : "Votre choix XOF est enregistré."
      );
      setErrorMsg(null);
    } catch (error) {
      console.error("[JobRadar] payment preference save failed", error);
      setErrorMsg("Impossible d'enregistrer votre préférence pour l'instant. Vous pouvez continuer.");
    }
  };

  const onBuy = async (plan: BillingPlan, price: BillingPlanPrice | null) => {
    if (!session?.user) {
      navigate("/auth", { state: { from: "/pricing" } });
      return;
    }
    if (isSubmittingRef.current || isBusy || busyCode) return;
    if (!price) return;
    if (!paystackEnabled) {
      setErrorMsg("Paystack n'est pas configuré sur le front.");
      return;
    }

    if (currentPass && currentPass.status === "active") {
      setInfoMsg(
        `Votre accès JobRadar est déjà actif${isTestPass ? " (test)" : ""} jusqu'au ${formatDate(
          currentPass.ends_at
        )}.`
      );
      setShowPostCheckout(true);
      return;
    }

    if (hasRecentTestPayment) {
      setInfoMsg("Un paiement test récent existe déjà. Attendez quelques minutes avant de recommencer.");
      setShowPostCheckout(false);
      return;
    }

    const pendingRef = sessionStorage.getItem("paystack_ref");
    if (pendingRef) {
      setInfoMsg("Un paiement est déjà en cours. Terminez-le avant d'en démarrer un autre.");
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
        const ctxMsg =
          (error as { context?: { body?: { message?: string } } })?.context?.body?.message;
        setErrorMsg(ctxMsg || error.message);
      } else if (data?.ok && data?.authorization_url) {
        if (data?.reference) {
          sessionStorage.setItem("paystack_ref", data.reference as string);
        }
        setInfoMsg("Redirection vers Paystack...");
        window.location.assign(data.authorization_url as string);
      } else {
        setErrorMsg("Impossible d'initialiser le paiement Paystack.");
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
          <div className="pricing-hero__brand">GO4JOB · JOBRADAR</div>
          <h1>Mon espace JobRadar</h1>
          <p>Choisissez votre Pass, suivez votre accès et retrouvez vos paiements en un seul endroit.</p>
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
        {!paystackEnabled && <div className="pricing-error">Paiement Paystack non configuré.</div>}
        {errorMsg && <div className="pricing-error">Erreur : {errorMsg}</div>}
        {infoMsg && <div className="pricing-info">{infoMsg}</div>}

        {showPostCheckout && <PricingPostCheckoutActions />}

        {hasActivePass && currentPass && (
          <div className="pricing-info">
            {"Votre accès JobRadar est déjà actif"}
            {isTestPass ? " (test)" : ""} jusqu'au{" "}
            <strong>{formatDate(currentPass.ends_at)}</strong>.
          </div>
        )}

        <section className="pricing-proof" aria-label="Preuve produit JobRadar">
          <div className="pricing-section-heading">
            <h2>JobRadar cherche pour vous. Vous choisissez. Vous postulez.</h2>
            <p className="pricing-proof__compact">
              Plus de 100 000 offres actives — Europe, Afrique de l'Ouest et États-Unis
            </p>
            <p>Alertes ciblées selon votre profil et votre zone de recherche.</p>
          </div>
          <div className="pricing-proof__cards">
            {PRODUCT_PROOF_ITEMS.map((item) => (
              <div className="pricing-proof__card" key={item.value}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="pricing-plans" aria-label="Pass JobRadar">
          <div className="pricing-section-heading">
            <h2>Votre accès à toutes les opportunités</h2>
            <p>Tarifs clairs, sans renouvellement automatique. Vous décidez.</p>
          </div>

          <PaymentMarketPanel
            resolution={paymentMarket.resolution}
            loading={paymentMarket.loading}
            savingPreference={paymentMarket.savingPreference}
            error={paymentMarket.error}
            canPersistPreference={paymentMarket.canPersistPreference}
            onSelect={handleSelectPaymentMarket}
          />

          {loading ? (
            <div className="pricing-loading">Chargement...</div>
          ) : (
            <section className="pricing-grid">
              {plans.map((plan) => {
                const prices = plan.billing_plan_prices ?? [];
                const price = prices.find((entry) => entry.currency === "XOF") ?? null;
                const marketing = getPlanMarketing(plan.code, plan.name, plan.duration_days);
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
                      <div className={`pricing-card__status pricing-card__status--${statusTone}`}>
                        {statusLabel}
                      </div>
                    </div>

                    <div className="pricing-card__meta">{marketing.durationLabel}</div>
                    <div className="pricing-card__title">{marketing.title}</div>
                    <div className="pricing-card__short">{marketing.shortLine}</div>
                    <div className="pricing-card__headline">{marketing.headline}</div>
                    <div className="pricing-card__benefit">{marketing.description}</div>

                    <div className="pricing-card__priceWrap">
                      <div className="pricing-card__price">{displayPrice?.primaryLabel ?? "--"}</div>
                    </div>

                    <div className="pricing-card__details">
                      <div className="pricing-card__detail">
                        <span>Durée</span>
                        <strong>{plan.duration_days} jours</strong>
                      </div>
                      <div className="pricing-card__detail">
                        <span>Accès</span>
                        <strong>Complet</strong>
                      </div>
                    </div>

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
                          : marketing.ctaLabel}
                    </button>

                    <div className="pricing-card__footnote">{PRICING_PRICE_NOTE}</div>
                  </div>
                );
              })}
            </section>
          )}
        </section>

        <section className="pricing-trust-strip" aria-label="Confiance paiement">
          <span>Paiement sécurisé</span>
          <span>Confirmation par e-mail</span>
          <span>Accès activé après confirmation du paiement</span>
        </section>

        <section className="pricing-currency-note" aria-label="Note devise et paiement">
          {getCurrencyNote(displayMarket)}
        </section>

        <section className="pricing-payments" aria-label="Moyens de paiement acceptés">
          <div className="pricing-payments__head">
            <div className="pricing-payments__title">Comment payer ?</div>
            <div className="pricing-payments__sub">Carte bancaire et Mobile Money acceptés.</div>
            <div className="pricing-payments__signal">Paiement sécurisé via Paystack.</div>
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
              <p className="pricing-pass__sub">Dernières activations et état de votre accès</p>
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
