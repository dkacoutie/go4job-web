import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import { usePass } from "./lib/usePass";
import { PLAN_BENEFITS, PRICING_CURRENCIES, formatAmount, formatPaymentMethod } from "./lib/pricingHelpers";
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

export default function PricingPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const { refreshPass } = usePass();

  const paystackPublicKey = (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY ?? "").trim();
  const paystackEnabled = Boolean(paystackPublicKey);
  const isPaystackTest = paystackPublicKey.startsWith("pk_test_");

  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [currentPass, setCurrentPass] = useState<CurrentPass | null>(null);
  const [currency, setCurrency] = useState<"XOF" | "USD" | "EUR">("XOF");
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

      const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: recentTestPayment } = await supabase
        .from("billing_payments")
        .select("id, updated_at")
        .eq("user_id", session.user.id)
        .eq("provider_code", "paystack")
        .eq("status", "paid_test")
        .gte("updated_at", recentCutoff)
        .order("updated_at", { ascending: false })
        .maybeSingle();
      setHasRecentTestPayment(Boolean(recentTestPayment?.id));
    } else {
      setCurrentPass(null);
      setHasRecentTestPayment(false);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
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
      setInfoMsg("Verification du paiement en cours...");
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
        if (data?.status === "paid_test" || data?.activated === false) {
          setInfoMsg("Paiement test confirme. Aucun acces n'a ete active.");
        } else {
          setInfoMsg("Paiement confirme. Ton pass est actif.");
          setShowPostCheckout(true);
          await loadData();
          await refreshPass();
        }
      } else {
        setErrorMsg("Paiement non confirme. Aucun debit effectue.");
      }

      setIsVerifying(false);
      sessionStorage.removeItem("paystack_ref");
    };

    runVerify();
  }, [session?.user?.id]);

  const paymentsEnabled = settings?.payments_enabled !== false;
  const maintenanceMessage =
    settings?.maintenance_message || "Paiements temporairement indisponibles.";

  const currencyOptions = PRICING_CURRENCIES;

  const onBuy = async (plan: BillingPlan, price: BillingPlanPrice | null) => {
    if (!session?.user) {
      navigate("/auth", { state: { from: "/pricing" } });
      return;
    }
    if (isSubmittingRef.current || isBusy || busyCode) return;
    if (!price) return;
    if (!paystackEnabled) {
      setErrorMsg("Paystack n'est pas configure sur le front.");
      return;
    }

    if (currentPass && currentPass.status === "active") {
      setInfoMsg(
        `Ton accès JobRadar est déjà actif jusqu’au ${formatDate(currentPass.ends_at)}.`
      );
      setShowPostCheckout(true);
      return;
    }

    if (hasRecentTestPayment) {
      setInfoMsg("Un paiement test recent existe deja. Attends quelques minutes avant de recommencer.");
      setShowPostCheckout(false);
      return;
    }

    const pendingRef = sessionStorage.getItem("paystack_ref");
    if (pendingRef) {
      setInfoMsg("Un paiement est deja en cours. Termine-le avant d'en demarrer un autre.");
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
      const { data, error } = await supabase.functions.invoke("paystack_initialize", {
        body: {
          plan_code: plan.code,
          currency: price.currency,
          payment_method_type: price.payment_method_type ?? "any",
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

  const passStatus = currentPass ? formatPassStatus(currentPass.status) : null;
  const hasActivePass = Boolean(currentPass && currentPass.status === "active");
  const isBusy = isCheckingOut || isVerifying;

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

        {isPaystackTest && (
          <div className="pricing-info">
            <strong>Mode test actif. Aucun débit réel.</strong>
          </div>
        )}
        {!paystackEnabled && (
          <div className="pricing-error">Paiement Paystack non configure.</div>
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
              onClick={() => navigate("/me/subscription")}
            >
              Voir mon abonnement
            </button>
          </div>
        )}

        {hasActivePass && currentPass && (
          <div className="pricing-info">
            Ton accès JobRadar est déjà actif jusqu’au <strong>{formatDate(currentPass.ends_at)}</strong>.
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
              const canBuy =
                paymentsEnabled &&
                planActive &&
                priceActive &&
                !hasActivePass &&
                !hasRecentTestPayment &&
                paystackEnabled;

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
                    disabled={!canBuy || busyCode === plan.code || isBusy}
                    onClick={() => onBuy(plan, price)}
                  >
                    {busyCode === plan.code || isBusy
                      ? "Traitement en cours..."
                      : "Payer"}
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

