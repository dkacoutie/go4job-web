import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import { usePass } from "./lib/usePass";
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

const planBenefits: Record<string, string> = {
  pass_7d: "Idéal pour découvrir JobRadar rapidement",
  pass_30d: "Le plus équilibré pour une recherche active",
  pass_90d: "Le meilleur format pour maximiser tes opportunités",
};

function formatAmount(amountMinor: number, currency: string) {
  const frac = currency === "XOF" ? 0 : 2;
  const amount = frac === 0 ? amountMinor : amountMinor / 100;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function formatPaymentMethod(method?: string | null) {
  if (!method) return "Tous moyens";
  switch (method) {
    case "mobile_money":
      return "Mobile Money";
    case "card":
      return "Carte";
    case "wallet":
      return "Wallet";
    case "bank_transfer":
      return "Virement";
    default:
      return method.replaceAll("_", " ");
  }
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

export default function PricingPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const { refreshPass } = usePass();

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [currentPass, setCurrentPass] = useState<CurrentPass | null>(null);
  const [currency, setCurrency] = useState<"XOF" | "USD" | "EUR">("XOF");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [showPostCheckout, setShowPostCheckout] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    // keep infoMsg so success feedback survives the reload

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

    if (session?.user) {
      const { data: passData } = await supabase
        .from("current_user_pass")
        .select("id, plan_code, plan_name, status, ends_at, days_remaining")
        .maybeSingle();
      setCurrentPass((passData as CurrentPass) ?? null);
    } else {
      setCurrentPass(null);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [session?.user?.id]);

  const paymentsEnabled = settings?.payments_enabled !== false;
  const maintenanceMessage =
    settings?.maintenance_message || "Paiements temporairement indisponibles.";

  const currencyOptions = useMemo(
    () => [
      { code: "XOF", label: "Afrique de l'Ouest (XOF)" },
      { code: "USD", label: "International (USD)" },
      { code: "EUR", label: "International (EUR)" },
    ],
    []
  );

  const onBuy = async (plan: BillingPlan, price: BillingPlanPrice | null) => {
    if (!session?.user) {
      navigate("/auth", { state: { from: "/pricing" } });
      return;
    }
    if (!price) return;

    setBusyCode(plan.code);
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
      await loadData();
      await refreshPass();
    } else {
      setErrorMsg("Impossible de valider le paiement.");
    }

    setBusyCode(null);
  };

  const passStatus = currentPass ? formatPassStatus(currentPass.status) : null;

  return (
    <div className="pricing-shell">
      <header className="pricing-hero">
        <div className="pricing-hero__inner">
          <div className="pricing-hero__brand">GO4JOB - JOBRADAR</div>
          <h1>Active ton accès JobRadar</h1>
          <p>
            Accède à plus d’offres pertinentes, suis les meilleures opportunités et choisis
            librement ta durée. Sans renouvellement automatique.
          </p>
        </div>
      </header>

      <main className="pricing-main">
        {settings && !paymentsEnabled && (
          <div className="pricing-banner">{maintenanceMessage}</div>
        )}

        {errorMsg && <div className="pricing-error">Erreur : {errorMsg}</div>}
        {infoMsg && <div className="pricing-info">{infoMsg}</div>}
        {showPostCheckout && (
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
              onClick={() => navigate("/")}
            >
              Aller au dashboard
            </button>
          </div>
        )}

        <section className="pricing-model" aria-label="Modèle des passes">
          <div className="pricing-model__title">Un seul accès, trois durées.</div>
          <p className="pricing-model__text">
            Tous les passes donnent accès à JobRadar. Seule la durée change : 7, 30 ou 90 jours,
            selon ton rythme. Sans renouvellement automatique.
          </p>
        </section>

        <section className="pricing-currency" aria-label="Sélection de devise">
          {currencyOptions.map((c) => (
            <button
              key={c.code}
              type="button"
              className={`pill ${currency === c.code ? "is-active" : ""}`}
              aria-pressed={currency === c.code}
              onClick={() => setCurrency(c.code as "XOF" | "USD" | "EUR")}
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
              const canBuy = paymentsEnabled && planActive && priceActive;

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
              const benefit = planBenefits[plan.code] ?? "Le bon équilibre";

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
                    disabled={!canBuy || busyCode === plan.code}
                    onClick={() => onBuy(plan, price)}
                  >
                    Choisir ce pass
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <section className="pricing-reassurance">
          <div className="reassurance-item">
            <div className="reassurance-icon">⚡</div>
            <div>
              <div className="reassurance-title">Activation immédiate</div>
              <div className="reassurance-text">Ton pass s’active dès validation.</div>
            </div>
          </div>
          <div className="reassurance-item">
            <div className="reassurance-icon">🔒</div>
            <div>
              <div className="reassurance-title">Paiement sécurisé</div>
              <div className="reassurance-text">Transactions protégées et vérifiées.</div>
            </div>
          </div>
          <div className="reassurance-item">
            <div className="reassurance-icon">✅</div>
            <div>
              <div className="reassurance-title">Sans renouvellement automatique</div>
              <div className="reassurance-text">Tu maîtrises la durée et le budget.</div>
            </div>
          </div>
        </section>

        <section className="pricing-pass">
          <div className="pricing-pass__header">
            <h2>Mon pass actuel</h2>
            {passStatus && (
              <span className={`pass-pill pass-pill--${passStatus.tone}`}>
                {passStatus.label}
              </span>
            )}
          </div>
          {!session?.user && (
            <div className="pass-empty">
              <p>Connecte-toi pour activer ton pass en un clic.</p>
              <button
                type="button"
                className="pass-cta"
                onClick={() => navigate("/auth", { state: { from: "/pricing" } })}
              >
                Se connecter
              </button>
            </div>
          )}
          {session?.user && !currentPass && (
            <div className="pass-empty">
              <p>Aucun pass actif pour le moment.</p>
              <span>Choisis un pass pour démarrer.</span>
            </div>
          )}
          {session?.user && currentPass && (
            <div className="pass-card">
              <div className="pass-card__title">{currentPass.plan_name}</div>
              <div className="pass-card__detail">
                <span>Expire le</span>
                <strong>{formatDate(currentPass.ends_at)}</strong>
              </div>
              <div className="pass-card__detail">
                <span>Jours restants</span>
                <strong>{Math.max(0, currentPass.days_remaining)}</strong>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
