import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import PricingPlansBlock from "./components/PricingPlansBlock";
import "./SubscriptionPage.css";

type CurrentPass = {
  id: string;
  plan_code: string;
  plan_name: string;
  status: string;
  starts_at: string | null;
  activated_at: string | null;
  ends_at: string;
  days_remaining: number;
};

type PaymentRow = {
  id: string;
  status: string;
  amount_minor: number;
  currency: string;
  provider_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  plan?: { name?: string | null } | null;
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

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
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
      return { label: "Payé", tone: "success" };
    case "pending":
      return { label: "En attente", tone: "pending" };
    case "failed":
      return { label: "Échoué", tone: "danger" };
    case "cancelled":
      return { label: "Annulé", tone: "danger" };
    default:
      return { label: status ?? "Inconnu", tone: "neutral" };
  }
}

export default function SubscriptionPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  const [currentPass, setCurrentPass] = useState<CurrentPass | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) {
      navigate("/auth", { replace: true, state: { from: "/me/subscription" } });
    }
  }, [loading, session, navigate]);

  const loadData = async () => {
    if (!session?.user) {
      setCurrentPass(null);
      setPayments([]);
      setPageLoading(false);
      return;
    }

    setPageLoading(true);
    setErrorMsg(null);

    const { data: passData, error: passErr } = await supabase
      .from("current_user_pass")
      .select("id, plan_code, plan_name, status, starts_at, activated_at, ends_at, days_remaining")
      .maybeSingle();

    if (passErr) setErrorMsg(passErr.message);
    setCurrentPass((passData as CurrentPass) ?? null);

    const { data: paymentsData, error: paymentsErr } = await supabase
      .from("billing_payments")
      .select(
        "id, status, amount_minor, currency, provider_payment_id, paid_at, created_at, plan:billing_plans(name)"
      )
      .order("created_at", { ascending: false })
      .limit(6);

    if (paymentsErr) setErrorMsg((m) => m ?? paymentsErr.message);
    setPayments((paymentsData as PaymentRow[]) ?? []);

    setPageLoading(false);
  };

  useEffect(() => {
    if (!loading) loadData();
  }, [loading, session?.user?.id]);

  const passStatus = currentPass ? formatPassStatus(currentPass.status) : null;
  const hasActivePass = Boolean(currentPass && currentPass.status === "active");

  const primaryCta = useMemo(
    () =>
      hasActivePass
        ? { label: "Voir mes offres", to: "/jobradar/feed" }
        : { label: "Voir les pass", to: "/pricing" },
    [hasActivePass]
  );

  return (
    <div className="subscription-shell">
      <header className="subscription-hero">
        <div className="subscription-hero__inner">
          <div className="subscription-hero__kicker">JOBRADAR</div>
          <h1>Mon abonnement</h1>
          <p>Retrouve ton pass actif, les dates clés et tes paiements récents.</p>
          <button
            type="button"
            className="btn btnPrimary subscription-hero__cta"
            onClick={() => navigate(primaryCta.to)}
          >
            {primaryCta.label}
          </button>
        </div>
      </header>

      <main className="subscription-main">
        {errorMsg && <div className="subscription-error">Erreur : {errorMsg}</div>}

        <section className="subscription-card">
          <div className="subscription-card__head">
            <div>
              <h2>Mon pass actuel</h2>
              <p className="subscription-card__sub">Accès JobRadar en cours ou dernier pass actif.</p>
            </div>
            {passStatus && (
              <span className={`subscription-pill subscription-pill--${passStatus.tone}`}>
                {passStatus.label}
              </span>
            )}
          </div>

          {pageLoading ? (
            <div className="subscription-loading">Chargement…</div>
          ) : !currentPass ? (
            <div className="subscription-empty">
              <div className="subscription-empty__title">Aucun pass actif</div>
              <div className="subscription-empty__text">
                Choisis un pass pour activer l'accès complet à JobRadar.
              </div>
              <div className="subscription-plans">
                <PricingPlansBlock
                  title="Choisis ton pass"
                  subtitle="Les trois durées donnent accès à JobRadar. Sélectionne celle qui te convient."
                />
              </div>
            </div>
          ) : (
            <div className="subscription-pass">
              <div className="subscription-pass__title">{currentPass.plan_name}</div>
              <div className="subscription-pass__grid">
                <div className="subscription-pass__item">
                  <span>Statut</span>
                  <strong>{passStatus?.label ?? "Actif"}</strong>
                </div>
                <div className="subscription-pass__item">
                  <span>Date d'activation</span>
                  <strong>{formatDate(currentPass.activated_at || currentPass.starts_at)}</strong>
                </div>
                <div className="subscription-pass__item">
                  <span>Date d'expiration</span>
                  <strong>{formatDate(currentPass.ends_at)}</strong>
                </div>
                <div className="subscription-pass__item">
                  <span>Jours restants</span>
                  <strong>{Math.max(0, currentPass.days_remaining)}</strong>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="subscription-card">
          <div className="subscription-card__head">
            <div>
              <h2>Mes paiements récents</h2>
              <p className="subscription-card__sub">
                Historique simplifié des derniers paiements et activations.
              </p>
            </div>
          </div>

          {pageLoading ? (
            <div className="subscription-loading">Chargement…</div>
          ) : payments.length === 0 ? (
            <div className="subscription-empty">
              <div className="subscription-empty__title">Aucun paiement enregistré</div>
              <div className="subscription-empty__text">
                Tes futurs paiements apparaîtront ici dès qu'un pass sera activé.
              </div>
            </div>
          ) : (
            <div className="subscription-payments">
              <div className="subscription-payments__head">
                <span>Date</span>
                <span>Pass</span>
                <span>Montant</span>
                <span>Statut</span>
                <span>Référence</span>
              </div>

              {payments.map((payment) => {
                const paymentStatus = formatPaymentStatus(payment.status);
                const paymentDate = payment.paid_at || payment.created_at;
                const planName = payment.plan?.name || "Pass JobRadar";
                const paymentRef = payment.provider_payment_id || payment.id;

                return (
                  <div className="subscription-payments__row" key={payment.id}>
                    <div className="subscription-payments__cell">
                      <span className="subscription-payments__label">Date</span>
                      <span className="subscription-payments__value">
                        {formatDate(paymentDate)}
                      </span>
                    </div>
                    <div className="subscription-payments__cell">
                      <span className="subscription-payments__label">Pass</span>
                      <span className="subscription-payments__value">{planName}</span>
                    </div>
                    <div className="subscription-payments__cell">
                      <span className="subscription-payments__label">Montant</span>
                      <span className="subscription-payments__value">
                        {formatAmount(payment.amount_minor, payment.currency)}
                        <span className="subscription-payments__currency">{payment.currency}</span>
                      </span>
                    </div>
                    <div className="subscription-payments__cell">
                      <span className="subscription-payments__label">Statut</span>
                      <span
                        className={`subscription-status subscription-status--${paymentStatus.tone}`}
                      >
                        {paymentStatus.label}
                      </span>
                    </div>
                    <div className="subscription-payments__cell">
                      <span className="subscription-payments__label">Référence</span>
                      <span className="subscription-payments__value subscription-payments__ref">
                        {paymentRef}
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






