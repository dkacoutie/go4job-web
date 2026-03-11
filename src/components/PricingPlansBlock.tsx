import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { usePass } from "../lib/usePass";
import { PLAN_BENEFITS, PRICING_CURRENCIES, formatAmount, formatPaymentMethod } from "../lib/pricingHelpers";
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
};

export default function PricingPlansBlock({ title, subtitle, showActions = true }: PricingPlansBlockProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  const { refreshPass, hasActivePass } = usePass();

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [currency, setCurrency] = useState<"XOF" | "USD" | "EUR">("XOF");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [showPostCheckout, setShowPostCheckout] = useState(false);

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
    if (pErr) setErrorMsg((m) => m ?? pErr.message);
    setPlans((pData as BillingPlan[]) ?? []);

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const paymentsEnabled = settings?.payments_enabled !== false;
  const maintenanceMessage = settings?.maintenance_message || "Paiements temporairement indisponibles.";

  const currencyOptions = useMemo(() => PRICING_CURRENCIES, []);

  const onBuy = async (plan: BillingPlan, price: BillingPlanPrice | null) => {
    if (!session?.user) {
      navigate("/auth", { state: { from: location.pathname } });
      return;
    }
    if (!price) return;

    if (hasActivePass) {
      setInfoMsg("Ton accès JobRadar est déjà actif. Tu peux l'utiliser maintenant.");
      setShowPostCheckout(true);
      return;
    }

    setBusyCode(plan.code);
    setIsCheckingOut(true);
    setInfoMsg(null);
    setErrorMsg(null);
    setShowPostCheckout(false);

    const { data, error } = await supabase.functions.invoke("billing_dev_checkout", {
      body: {
        plan_code: plan.code,
        currency: price.currency,
        payment_method_type: price.payment_method_type ?? "any",
        mode: "manual_dev",
      },
    });

    if (error) {
      const ctxMsg =
        (error as { context?: { body?: { message?: string } } })?.context?.body?.message;
      setErrorMsg(ctxMsg || error.message);
    } else if (data?.ok) {
      setInfoMsg("Paiement validé. Ton pass est actif.");
      setShowPostCheckout(true);
      await refreshPass();
    } else {
      setErrorMsg("Impossible de valider le paiement.");
    }

    setBusyCode(null);
    setIsCheckingOut(false);
  };

  return (
    <section className="pricing-embed" aria-label="Plans JobRadar">
      {(title || subtitle) && (
        <header className="pricing-embed__head">
          {title && <div className="pricing-embed__title">{title}</div>}
          {subtitle && <div className="pricing-embed__sub">{subtitle}</div>}
        </header>
      )}

      {settings && !paymentsEnabled && (
        <div className="pricing-banner">{maintenanceMessage}</div>
      )}

      {errorMsg && <div className="pricing-error">Erreur : {errorMsg}</div>}
      {infoMsg && <div className="pricing-info">{infoMsg}</div>}

      {showPostCheckout && showActions && (
        <div className="pricing-success-actions" aria-label="Suite apres achat">
          <button
            type="button"
            className="pricing-success-actions__primary"
            onClick={() => navigate("/jobradar/feed")}
          >
            Voir mes offres
          </button>
          <button
            type="button"
            className="pricing-success-actions__secondary"
            onClick={() => navigate("/me/subscription")}
          >
            Voir mon abonnement
          </button>
        </div>
      )}

      <section className="pricing-currency" aria-label="Sélection de devise">
        {currencyOptions.map((c) => (
          <button
            key={c.code}
            type="button"
            className={`pill ${currency === c.code ? "is-active" : ""}`}
            aria-pressed={currency === c.code}
            onClick={() => setCurrency(c.code)}
          >
            {c.label}
          </button>
        ))}
      </section>

      {loading ? (
        <div className="pricing-loading">Chargement...</div>
      ) : (
        <section className="pricing-grid">
          {plans.map((plan) => {
            const prices = plan.billing_plan_prices ?? [];
            const price = prices.find((p) => p.currency === currency) ?? null;

            const planActive = plan.is_active;
            const priceActive = price?.is_active ?? false;
            const canBuy = paymentsEnabled && planActive && priceActive && !hasActivePass;

            let availability = "Disponible";
            let availabilityTone = "available";
            if (!paymentsEnabled) {
              availability = "Indisponible temporairement";
              availabilityTone = "paused";
            } else if (!planActive || !priceActive) {
              availability = "Bientôt disponible";
              availabilityTone = "soon";
            }

            const isFeatured = plan.code === "pass_90d";
            const benefit = PLAN_BENEFITS[plan.code] ?? "Le bon équilibre";

            return (
              <div
                key={plan.id}
                className={`pricing-card ${isFeatured ? "is-featured" : ""}`}
                data-disabled={!canBuy}
              >
                <div className="pricing-card__top">
                  <div className={`pricing-card__status pricing-card__status--${availabilityTone}`}>
                    {availability}
                  </div>
                  {isFeatured && <div className="pricing-card__badge">Meilleure valeur</div>}
                </div>
                <div className="pricing-card__title">{plan.name}</div>
                <div className="pricing-card__benefit">{benefit}</div>
                <div className="pricing-card__access">
                  Accès complet à JobRadar pendant toute la durée choisie.
                </div>
                <div className="pricing-card__price">
                  {price ? formatAmount(price.amount_minor, price.currency) : "—"}
                </div>
                <div className="pricing-card__details">
                  <div className="pricing-card__detail">
                    <span>Durée</span>
                    <strong>{plan.duration_days} jours</strong>
                  </div>
                  {price?.payment_method_type && (
                    <div className="pricing-card__detail">
                      <span>Paiement</span>
                      <strong>{formatPaymentMethod(price.payment_method_type)}</strong>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="pricing-card__cta"
                  disabled={!canBuy || busyCode === plan.code || isCheckingOut}
                  onClick={() => onBuy(plan, price)}
                >
                  {busyCode === plan.code || isCheckingOut ? "Traitement en cours…" : "Choisir ce pass"}
                </button>
              </div>
            );
          })}
        </section>
      )}
    </section>
  );
}

