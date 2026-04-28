import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PaymentMarketPanel from "./PaymentMarketPanel";
import { clearPartnerReferral, readPartnerReferral } from "../lib/partnerReferral";
import { usePaymentMarket } from "../lib/paymentMarket";
import { supabase } from "../lib/supabaseClient";
import { trackMetaEvent } from "../lib/metaPixel";
import { useSession } from "../lib/useSession";
import { buildJobRadarOnboardingHref } from "../lib/jobradarOnboarding";
import { useJobRadarOnboarding } from "../lib/useJobRadarOnboarding";
import { usePass } from "../lib/usePass";
import {
  FEATURED_PLAN_CODE,
  PRICING_ACCESS_MESSAGE,
  PRICING_BILLING_MESSAGE,
  PRICING_CONVERSION_MESSAGE,
  PRICING_INDICATIVE_MESSAGE,
  PRICING_PRICE_NOTE,
  PRICING_SECTION_SUBTITLE,
  PRICING_SECTION_TITLE,
  formatPlanDisplayPrices,
  getPlanMarketing,
} from "../lib/pricingHelpers";
import "../PricingPage.css";
import "./PricingPlansBlock.css";

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

type PricingPlansBlockProps = {
  title?: string;
  subtitle?: string;
  showActions?: boolean;
  postCheckoutPrimaryTo?: string;
  postCheckoutSecondaryTo?: string;
  postCheckoutPrimaryLabel?: string;
};

export default function PricingPlansBlock({
  title = PRICING_SECTION_TITLE,
  subtitle = PRICING_SECTION_SUBTITLE,
  showActions = true,
  postCheckoutPrimaryTo,
  postCheckoutSecondaryTo = "/me/subscription",
  postCheckoutPrimaryLabel,
}: PricingPlansBlockProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  const paymentMarket = usePaymentMarket(session?.user?.id);
  const { refreshPass, hasActivePass } = usePass();
  const onboarding = useJobRadarOnboarding();
  const cardsLogoSrc = `${import.meta.env.BASE_URL}logo-visa-mastercard.png`;
  const mobileMoneyLogoSrc = `${import.meta.env.BASE_URL}mobile-money-operateurs.png`;

  const paystackPublicKey = (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY ?? "").trim();
  const paystackEnabled = Boolean(paystackPublicKey);
  const isPaystackTest = paystackPublicKey.startsWith("pk_test_");

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [showPostCheckout, setShowPostCheckout] = useState(false);
  const [hasRecentTestPayment, setHasRecentTestPayment] = useState(false);
  const lastVerifiedRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);

    const { data: sData, error: sErr } = await supabase
      .from("billing_settings")
      .select("payments_enabled, maintenance_message")
      .maybeSingle();
    if (sErr) setErrorMsg(sErr.message);
    setSettings((sData as BillingSettings) ?? null);

    const { data: pData, error: pErr } = await supabase
      .from("billing_plans")
      .select(
        "id, code, name, duration_days, is_active, sort_order, billing_plan_prices(id, currency, amount_minor, country_group, payment_method_type, is_active)"
      )
      .order("sort_order", { ascending: true });
    if (pErr) setErrorMsg((prev) => prev ?? pErr.message);
    setPlans((pData as BillingPlan[]) ?? []);

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setHasRecentTestPayment(false);
      return;
    }

    const loadRecentTest = async () => {
      const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("billing_payments")
        .select("id, updated_at")
        .eq("user_id", session.user.id)
        .eq("provider_code", "paystack")
        .eq("status", "paid_test")
        .gte("updated_at", recentCutoff)
        .order("updated_at", { ascending: false })
        .maybeSingle();
      if (error) {
        setHasRecentTestPayment(false);
        return;
      }
      setHasRecentTestPayment(Boolean(data?.id));
    };

    loadRecentTest();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return;

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
      setInfoMsg("V\u00e9rification du paiement en cours...");
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
            ? "Paiement test confirm\u00e9. Ton pass est actif (test)."
            : "Paiement confirm\u00e9. Ton pass est actif."
        );
        setShowPostCheckout(true);
        clearPartnerReferral();
        await refreshPass();
      } else {
        setErrorMsg("Paiement non confirm\u00e9. Aucun d\u00e9bit effectu\u00e9.");
      }

      setIsVerifying(false);
      sessionStorage.removeItem("paystack_ref");
    };

    runVerify();
  }, [session?.user?.id, refreshPass]);

  const paymentsEnabled = settings?.payments_enabled !== false;
  const maintenanceMessage =
    settings?.maintenance_message || "Paiements temporairement indisponibles.";
  const isBusy = isCheckingOut || isVerifying;
  const checkoutPrimaryTo =
    postCheckoutPrimaryTo ??
    (onboarding.isOnboarded ? "/jobradar/feed" : buildJobRadarOnboardingHref("complete-profile"));
  const checkoutPrimaryLabelResolved =
    postCheckoutPrimaryLabel ?? (onboarding.isOnboarded ? "Voir mes offres" : "Continuer mon parcours");

  const handleSelectPaymentMarket = async (market: "eur" | "xof") => {
    try {
      await paymentMarket.setPreference(market);
      setInfoMsg(
        market === "eur"
          ? "Ton choix EUR est enregistré pour l'affichage. Le paiement en ligne reste facturé en FCFA (XOF)."
          : "Ton choix XOF est enregistré."
      );
      setErrorMsg(null);
    } catch (error) {
      console.error("[JobRadar] payment preference save failed", error);
      setErrorMsg(
        "Impossible d'enregistrer ta préférence pour l'instant. Tu peux continuer : le paiement reste en FCFA (XOF)."
      );
    }
  };

  const onBuy = async (plan: BillingPlan, price: BillingPlanPrice | null) => {
    if (!session?.user) {
      navigate("/auth", { state: { from: location.pathname } });
      return;
    }
    if (isSubmittingRef.current || isBusy || busyCode) return;
    if (!price) return;
    if (!paystackEnabled) {
      setErrorMsg("Paystack n'est pas configur\u00e9.");
      return;
    }

    if (hasActivePass) {
      setInfoMsg("Ton acc\u00e8s JobRadar est d\u00e9j\u00e0 actif. Tu peux l'utiliser maintenant.");
      setShowPostCheckout(true);
      return;
    }

    if (hasRecentTestPayment) {
      setInfoMsg("Un paiement test r\u00e9cent existe d\u00e9j\u00e0. Attends quelques minutes avant de recommencer.");
      setShowPostCheckout(false);
      return;
    }

    const pendingRef = sessionStorage.getItem("paystack_ref");
    if (pendingRef) {
      setInfoMsg("Un paiement est d\u00e9j\u00e0 en cours. Termine-le avant d'en d\u00e9marrer un autre.");
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
    <section className="pricing-embed" aria-label="Plans JobRadar">
      {(title || subtitle) && (
        <header className="pricing-embed__head">
          {title && <div className="pricing-embed__title">{title}</div>}
          {subtitle && <div className="pricing-embed__sub">{subtitle}</div>}
        </header>
      )}

      {settings && !paymentsEnabled && <div className="pricing-banner">{maintenanceMessage}</div>}

      {isPaystackTest && (
        <div className="pricing-info">
          <strong>Mode test actif.</strong> Aucun d\u00e9bit r\u00e9el n'est effectu\u00e9.
        </div>
      )}
      {!paystackEnabled && <div className="pricing-error">Paiement Paystack non configur\u00e9.</div>}
      {errorMsg && <div className="pricing-error">Erreur : {errorMsg}</div>}
      {infoMsg && <div className="pricing-info">{infoMsg}</div>}

      <PaymentMarketPanel
        resolution={paymentMarket.resolution}
        loading={paymentMarket.loading}
        savingPreference={paymentMarket.savingPreference}
        error={paymentMarket.error}
        canPersistPreference={paymentMarket.canPersistPreference}
        onSelect={handleSelectPaymentMarket}
      />

      {showPostCheckout && showActions && (
        <div className="pricing-success-actions" aria-label="Suite apres achat">
          <button
            type="button"
            className="pricing-success-actions__primary"
            onClick={() => navigate(checkoutPrimaryTo)}
          >
            {checkoutPrimaryLabelResolved}
          </button>
          <button
            type="button"
            className="pricing-success-actions__secondary"
            onClick={() => navigate(postCheckoutSecondaryTo)}
          >
            {"Voir mon acc\u00e8s"}
          </button>
        </div>
      )}

      <section className="pricing-transparency" aria-label="Transparence tarifaire">
        <p className="pricing-transparency__title">{PRICING_BILLING_MESSAGE}</p>
        <p className="pricing-transparency__body">{PRICING_INDICATIVE_MESSAGE}</p>
        <p className="pricing-transparency__fine">{PRICING_CONVERSION_MESSAGE}</p>
      </section>

      {loading ? (
        <div className="pricing-loading">Chargement...</div>
      ) : (
        <>
          <section className="pricing-grid">
            {plans.map((plan) => {
              const prices = plan.billing_plan_prices ?? [];
              const price = prices.find((entry) => entry.currency === "XOF") ?? null;
              const marketing = getPlanMarketing(plan.code, plan.name, plan.duration_days);
              const displayPrices = price ? formatPlanDisplayPrices(price.amount_minor) : null;

              const planActive = plan.is_active;
              const priceActive = Boolean(price?.is_active);
              const canBuy =
                paymentsEnabled &&
                planActive &&
                priceActive &&
                !hasActivePass &&
                !hasRecentTestPayment &&
                paystackEnabled;

              let statusLabel = marketing.badge;
              let statusTone = marketing.badgeTone;
              if (!paymentsEnabled) {
                statusLabel = "Indisponible temporairement";
                statusTone = "paused";
              } else if (!planActive || !priceActive) {
                statusLabel = "Bient\u00f4t disponible";
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
                  <div className="pricing-card__benefit">{marketing.description}</div>
                  <div className="pricing-card__access">{PRICING_ACCESS_MESSAGE}</div>

                  <div className="pricing-card__priceWrap">
                    <div className="pricing-card__price">{displayPrices?.xofLabel ?? "--"}</div>
                    {displayPrices && (
                      <div className="pricing-card__fx" aria-label="Equivalent indicatif en euro et dollar">
                        {displayPrices.combinedLabel}
                      </div>
                    )}
                    <div className="pricing-card__priceNote">{PRICING_PRICE_NOTE}</div>
                  </div>

                  <div className="pricing-card__details">
                    <div className="pricing-card__detail">
                      <span>{"Dur\u00e9e"}</span>
                      <strong>{plan.duration_days} jours</strong>
                    </div>
                    <div className="pricing-card__detail">
                      <span>{"Acc\u00e8s"}</span>
                      <strong>Complet</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="pricing-card__cta"
                    disabled={!canBuy || busyCode === plan.code || isBusy}
                    onClick={() => onBuy(plan, price)}
                  >
                    {busyCode === plan.code || isBusy ? "Traitement en cours..." : marketing.ctaLabel}
                  </button>

                  <div className="pricing-card__footnote">{marketing.launchNote}</div>
                </div>
              );
            })}
          </section>

          <section className="pricing-payments" aria-label={"Moyens de paiement accept\u00e9s"}>
            <div className="pricing-payments__head">
              <div className="pricing-payments__title">{"Moyens de paiement accept\u00e9s"}</div>
              <div className="pricing-payments__sub">
                Paiement s\u00e9curis\u00e9 par carte bancaire et Mobile Money via notre passerelle.
              </div>
            </div>
            <div className="pricing-payments__logos">
                <div className="pricing-payments__logoCard">
                  <img
                    className="pricing-payments__logo pricing-payments__logo--cards"
                    src={cardsLogoSrc}
                    alt="Visa et Mastercard"
                    loading="lazy"
                  />
              </div>
              <div className="pricing-payments__logoCard">
                <img
                  className="pricing-payments__logo pricing-payments__logo--mobile"
                  src={mobileMoneyLogoSrc}
                  alt="Orange Money, MTN Mobile Money, Moov Money et Wave"
                  loading="lazy"
                />
              </div>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
