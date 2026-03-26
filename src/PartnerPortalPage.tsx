import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "./components/ToastCenter";
import { formatAmount } from "./lib/pricingHelpers";
import { fetchPartnerPortalSnapshot, type PartnerDashboardSummaryRow } from "./lib/partnerPortalApi";
import { useSession } from "./lib/useSession";
import type {
  PartnerAccountRow,
  PartnerCommissionRow,
  PartnerConversionRow,
  PartnerPayoutRow,
} from "./lib/adminPartnersApi";
import "./PartnerPortalPage.css";

type ActivityItem = {
  id: string;
  kind: "conversion" | "commission" | "payout";
  at: string;
  title: string;
  detail: string;
  tone: "blue" | "green" | "yellow" | "gray" | "red";
};

const PARTNER_REFERRAL_BASE_URL = "https://jobradar.go4jobapp.com/?ref=";
const PARTNER_CONTACT_EMAIL = "contact@go4jobapp.com";

function normalizeCurrencyTotals(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, number>;

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((acc, [currency, amount]) => {
    const parsed = Number(amount);
    if (Number.isFinite(parsed)) acc[currency.toUpperCase()] = parsed;
    return acc;
  }, {});
}

function formatCurrencyTotals(value: unknown) {
  const totals = normalizeCurrencyTotals(value);
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "0";
  return entries.map(([currency, amount]) => formatAmount(amount, currency)).join(" | ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

function statusBadgeClass(status: string) {
  if (status === "active" || status === "paid") return "badge badge--green";
  if (status === "approved" || status === "pending") return "badge badge--yellow";
  if (status === "paused" || status === "cancelled") return "badge badge--gray";
  if (status === "voided" || status === "failed" || status === "inactive") return "badge badge--red";
  return "badge badge--blue";
}

function activationMessageForStatus(status: PartnerAccountRow["status"]) {
  if (status === "pending") {
    return {
      title: "Ton compte partenaire doit etre regularise",
      body:
        "Ce compte provient d'un ancien flux et n'est pas aligne avec le programme actuel. Contacte l'equipe pour faire le point sur sa reprise.",
    };
  }

  if (status === "paused") {
    return {
      title: "Ton espace partenaire est temporairement en pause",
      body:
        "L'equipe JobRadar a mis ce compte partenaire en pause. Tu peux nous contacter pour verifier la situation et reprendre l'activite si besoin.",
    };
  }

  return {
    title: "Ton espace partenaire est desactive",
    body:
      "Ce compte partenaire est desactive. Contacte l'equipe JobRadar si une reactivation doit etre envisagee.",
  };
}

function buildFallbackSummary(partner: PartnerAccountRow): PartnerDashboardSummaryRow {
  return {
    partner_id: partner.id,
    user_id: partner.user_id,
    display_name: partner.display_name,
    referral_code: partner.referral_code,
    partner_status: partner.status,
    total_subscriptions_sold: 0,
    total_commissionable_sales: 0,
    sold_7d_count: 0,
    sold_30d_count: 0,
    sold_90d_count: 0,
    commissions_pending_by_currency: {},
    commissions_approved_by_currency: {},
    commissions_paid_by_currency: {},
    commissions_total_earned_by_currency: {},
    last_conversion_at: null,
    created_at: partner.created_at,
    updated_at: partner.updated_at,
  };
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "absolute";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export default function PartnerPortalPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const { pushToast } = useToast();

  const [pageLoading, setPageLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [partner, setPartner] = useState<PartnerAccountRow | null>(null);
  const [summary, setSummary] = useState<PartnerDashboardSummaryRow | null>(null);
  const [conversions, setConversions] = useState<PartnerConversionRow[]>([]);
  const [commissions, setCommissions] = useState<PartnerCommissionRow[]>([]);
  const [payouts, setPayouts] = useState<PartnerPayoutRow[]>([]);

  useEffect(() => {
    if (!loading && !session) {
      navigate("/auth", { replace: true, state: { from: "/me/partner" } });
    }
  }, [loading, navigate, session]);

  const loadData = useCallback(async () => {
    if (!session?.user?.id) {
      setPartner(null);
      setSummary(null);
      setConversions([]);
      setCommissions([]);
      setPayouts([]);
      setPageLoading(false);
      return;
    }

    setPageLoading(true);
    setErrorMsg(null);

    try {
      const snapshot = await fetchPartnerPortalSnapshot(session.user.id);
      setPartner(snapshot.partner);
      setSummary(snapshot.summary);
      setConversions(snapshot.conversions);
      setCommissions(snapshot.commissions);
      setPayouts(snapshot.payouts);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Impossible de charger ton espace partenaire.");
    } finally {
      setPageLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!loading && session?.user?.id) {
      void loadData();
    }
  }, [loadData, loading, session?.user?.id]);

  const effectivePartner = partner;
  const effectiveSummary = useMemo(() => {
    if (!effectivePartner) return null;
    return summary ?? buildFallbackSummary(effectivePartner);
  }, [effectivePartner, summary]);

  const referralLink = useMemo(() => {
    const code = effectiveSummary?.referral_code?.trim();
    if (!code) return "";
    return `${PARTNER_REFERRAL_BASE_URL}${encodeURIComponent(code)}`;
  }, [effectiveSummary?.referral_code]);

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const conversionItems = conversions.map((conversion) => ({
      id: `conversion-${conversion.id}`,
      kind: "conversion" as const,
      at: conversion.converted_at,
      tone: conversion.status === "attributed" ? ("green" as const) : ("gray" as const),
      title: conversion.status === "attributed" ? "Vente attribuee" : "Vente non commissionable",
      detail:
        conversion.status === "attributed"
          ? `Code ${conversion.referral_code_used} | premier abonnement paye du client`
          : `Code ${conversion.referral_code_used} | ${conversion.disqualification_reason ?? "non eligible"}`,
    }));

    const commissionItems = commissions.map((commission) => {
      const when =
        commission.status === "paid"
          ? commission.paid_at ?? commission.approved_at ?? commission.calculated_at
          : commission.status === "approved"
          ? commission.approved_at ?? commission.calculated_at
          : commission.calculated_at;

      const tone =
        commission.status === "paid"
          ? ("green" as const)
          : commission.status === "approved"
          ? ("blue" as const)
          : commission.status === "voided"
          ? ("red" as const)
          : ("yellow" as const);

      const title =
        commission.status === "paid"
          ? "Commission payee"
          : commission.status === "approved"
          ? "Commission approuvee"
          : commission.status === "voided"
          ? "Commission annulee"
          : "Commission en attente";

      return {
        id: `commission-${commission.id}`,
        kind: "commission" as const,
        at: when,
        tone,
        title,
        detail: `${formatAmount(commission.commission_amount_minor, commission.currency)} | vente #${commission.sale_sequence_number}`,
      };
    });

    const payoutItems = payouts.map((payout) => ({
      id: `payout-${payout.id}`,
      kind: "payout" as const,
      at: payout.paid_at ?? payout.approved_at ?? payout.created_at,
      tone:
        payout.status === "paid"
          ? ("green" as const)
          : payout.status === "approved"
          ? ("blue" as const)
          : payout.status === "failed"
          ? ("red" as const)
          : ("gray" as const),
      title: payout.status === "paid" ? "Paiement effectue" : `Paiement ${payout.status}`,
      detail: `${formatAmount(payout.amount_minor, payout.currency)} | ${payout.payment_method ?? "reglement manuel"}`,
    }));

    return [...conversionItems, ...commissionItems, ...payoutItems]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 10);
  }, [commissions, conversions, payouts]);

  const copyReferralCode = useCallback(async () => {
    if (!effectiveSummary?.referral_code) return;

    try {
      await copyText(effectiveSummary.referral_code);
      pushToast({
        kind: "success",
        title: "Code partenaire copie",
        message: "Tu peux maintenant le partager facilement.",
      });
    } catch {
      pushToast({
        kind: "error",
        title: "Copie impossible",
        message: "Ton navigateur a bloque la copie du code. Tu peux le selectionner manuellement.",
      });
    }
  }, [effectiveSummary?.referral_code, pushToast]);

  const copyReferralLink = useCallback(async () => {
    if (!referralLink) return;

    try {
      await copyText(referralLink);
      pushToast({
        kind: "success",
        title: "Lien partenaire copie",
        message: "Ton lien personnel est pret a etre partage.",
      });
    } catch {
      pushToast({
        kind: "error",
        title: "Copie impossible",
        message: "Ton navigateur a bloque la copie du lien. Tu peux le selectionner manuellement.",
      });
    }
  }, [pushToast, referralLink]);

  if (pageLoading || loading) {
    return (
      <div className="partnerPortal">
        <div className="partnerPortal__state card">
          <h1>Espace partenaire</h1>
          <p className="subtitle">Chargement de ton dashboard partenaire...</p>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="partnerPortal">
        <div className="partnerPortal__state card">
          <span className="badge badge--red">Erreur</span>
          <h1>Impossible de charger ton espace partenaire</h1>
          <p className="subtitle">{errorMsg}</p>
          <div className="partnerPortal__heroActions">
            <button type="button" className="btn btn--primary" onClick={() => void loadData()}>
              Reessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!effectivePartner) {
    return (
      <div className="partnerPortal">
        <section className="partnerPortal__state card">
          <span className="badge badge--blue">Programme partenaires</span>
          <h1>Aucun compte partenaire rattache a ce profil</h1>
          <p className="subtitle">
            Si tu as recu le lien partenaire de notre equipe, tu peux creer et activer ton compte depuis l'entree
            dediee. Sinon, contacte-nous pour verifier ton acces au programme.
          </p>
          <div className="partnerPortal__contactBox">
            <div>
              <span>Contact</span>
              <strong>{PARTNER_CONTACT_EMAIL}</strong>
            </div>
            <div>
              <span>Acces actuel</span>
              <strong>Aucun compte partenaire</strong>
            </div>
          </div>
          <div className="partnerPortal__heroActions">
            <Link className="btn btn--primary" to="/devenir-partenaire">
              Devenir partenaire
            </Link>
            <a className="btn" href={`mailto:${PARTNER_CONTACT_EMAIL}?subject=Programme%20partenaires`}>
              Contacter l'equipe
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (effectivePartner.status !== "active") {
    const activationMessage = activationMessageForStatus(effectivePartner.status);

    return (
      <div className="partnerPortal">
        <section className="partnerPortal__state card">
          <span className={statusBadgeClass(effectivePartner.status)}>{effectivePartner.status}</span>
          <h1>{activationMessage.title}</h1>
          <p className="subtitle">{activationMessage.body}</p>

          <div className="partnerPortal__contactBox">
            <div>
              <span>Code partenaire</span>
              <strong className="mono">{effectivePartner.referral_code}</strong>
            </div>
            <div>
              <span>Contact</span>
              <strong>{effectivePartner.contact_email ?? PARTNER_CONTACT_EMAIL}</strong>
            </div>
          </div>

          <div className="partnerPortal__heroActions">
            <button type="button" className="btn" onClick={() => void copyReferralCode()}>
              Copier mon code
            </button>
            <a className="btn btn--primary" href={`mailto:${PARTNER_CONTACT_EMAIL}?subject=Suivi%20compte%20partenaire`}>
              Contacter l'equipe
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (!effectiveSummary) {
    return null;
  }

  return (
    <div className="partnerPortal">
      <section className="partnerPortal__hero">
        <div className="partnerPortal__heroContent">
          <div className="chips">
            <span className="chip">Programme partenaires</span>
            <span className="chip">JobRadar</span>
          </div>

          <div className="partnerPortal__heroTop">
            <div>
              <h1>Mon espace partenaire</h1>
              <p className="subtitle">
                Suis tes ventes, tes commissions et tes paiements au meme endroit. Ce dashboard est connecte a ton
                compte partenaire et n'affiche que tes donnees.
              </p>
            </div>
            <span className={statusBadgeClass(effectiveSummary.partner_status)}>{effectiveSummary.partner_status}</span>
          </div>

          <div className="partnerPortal__heroMeta">
            <div className="partnerPortal__infoPill">
              <span>Code partenaire</span>
              <strong className="mono">{effectiveSummary.referral_code}</strong>
            </div>
            <div className="partnerPortal__infoPill">
              <span>Derniere vente</span>
              <strong>{formatDateTime(effectiveSummary.last_conversion_at)}</strong>
            </div>
            <div className="partnerPortal__infoPill">
              <span>Total gagne</span>
              <strong>{formatCurrencyTotals(effectiveSummary.commissions_total_earned_by_currency)}</strong>
            </div>
          </div>
        </div>

        <div className="partnerPortal__shareCard">
          <div className="partnerPortal__shareHeader">
            <h2>Ton lien personnel</h2>
            <p>Utilise ce lien pour partager JobRadar avec ton code partenaire integre.</p>
          </div>

          <div className="partnerPortal__shareBox">
            <span>Lien public recommande</span>
            <strong className="mono">{referralLink}</strong>
          </div>

          <div className="partnerPortal__shareActions">
            <button type="button" className="btn btn--primary" onClick={() => void copyReferralLink()}>
              Copier mon lien
            </button>
            <button type="button" className="btn" onClick={() => void copyReferralCode()}>
              Copier mon code
            </button>
          </div>

          <div className="partnerPortal__shareNote">
            Lien affiche pour cette etape: <strong>{PARTNER_REFERRAL_BASE_URL}CODE_PARTENAIRE</strong>
          </div>
        </div>
      </section>

      <section className="partnerPortal__metrics">
        <article className="card partnerPortal__metric">
          <span>Total abonnements vendus</span>
          <strong>{effectiveSummary.total_subscriptions_sold}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Abonnements 7 jours vendus</span>
          <strong>{effectiveSummary.sold_7d_count}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Abonnements 30 jours vendus</span>
          <strong>{effectiveSummary.sold_30d_count}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Abonnements 90 jours vendus</span>
          <strong>{effectiveSummary.sold_90d_count}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Commissions en attente</span>
          <strong>{formatCurrencyTotals(effectiveSummary.commissions_pending_by_currency)}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Commissions approuvees</span>
          <strong>{formatCurrencyTotals(effectiveSummary.commissions_approved_by_currency)}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Commissions payees</span>
          <strong>{formatCurrencyTotals(effectiveSummary.commissions_paid_by_currency)}</strong>
        </article>
        <article className="card partnerPortal__metric">
          <span>Total gagne</span>
          <strong>{formatCurrencyTotals(effectiveSummary.commissions_total_earned_by_currency)}</strong>
        </article>
      </section>

      <section className="partnerPortal__grid">
        <article className="card">
          <div className="card__titleRow">
            <h2>Historique recent</h2>
            <span className="badge badge--blue">Derniers evenements</span>
          </div>

          {recentActivity.length === 0 ? (
            <div className="empty">Ton historique apparaitra ici des que des ventes ou commissions seront enregistrees.</div>
          ) : (
            <div className="partnerPortal__activityList">
              {recentActivity.map((item) => (
                <div key={item.id} className="partnerPortal__activityItem">
                  <span className={`badge badge--${item.tone}`}>{item.kind}</span>
                  <div className="partnerPortal__activityBody">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <div className="muted">{formatDateTime(item.at)}</div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <div className="card__titleRow">
            <h2>Lecture rapide</h2>
            <span className="badge badge--gray">MVP</span>
          </div>

          <div className="partnerPortal__summaryList">
            <div>
              <span>Ventes commissionables</span>
              <strong>{effectiveSummary.total_commissionable_sales}</strong>
            </div>
            <div>
              <span>Commissions en attente</span>
              <strong>{commissions.filter((item) => item.status === "pending").length}</strong>
            </div>
            <div>
              <span>Commissions approuvees</span>
              <strong>{commissions.filter((item) => item.status === "approved").length}</strong>
            </div>
            <div>
              <span>Paiements recenses</span>
              <strong>{payouts.length}</strong>
            </div>
          </div>

          <div className="partnerPortal__hint">
            Les commissions sont calculees sur le premier abonnement paye du client uniquement. Les renouvellements ne
            sont pas commissionnes.
          </div>
        </article>
      </section>

      <section className="partnerPortal__lists">
        <article className="card">
          <div className="card__titleRow">
            <h2>Mes commissions</h2>
            <span className="badge badge--yellow">{commissions.length}</span>
          </div>

          {commissions.length === 0 ? (
            <div className="empty">Aucune commission enregistree pour le moment.</div>
          ) : (
            <div className="partnerPortal__rows">
              {commissions.map((commission) => (
                <div key={commission.id} className="partnerPortal__row">
                  <div className="partnerPortal__rowMain">
                    <strong>{formatAmount(commission.commission_amount_minor, commission.currency)}</strong>
                    <span>
                      Vente #{commission.sale_sequence_number} | taux {Number(commission.commission_rate_percent).toFixed(2)}%
                    </span>
                  </div>
                  <div className="partnerPortal__rowMeta">
                    <span className={statusBadgeClass(commission.status)}>{commission.status}</span>
                    <span>{formatDate(commission.paid_at ?? commission.approved_at ?? commission.calculated_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <div className="card__titleRow">
            <h2>Mes paiements</h2>
            <span className="badge badge--green">{payouts.length}</span>
          </div>

          {payouts.length === 0 ? (
            <div className="empty">Aucun paiement partenaire n'a encore ete effectue.</div>
          ) : (
            <div className="partnerPortal__rows">
              {payouts.map((payout) => (
                <div key={payout.id} className="partnerPortal__row">
                  <div className="partnerPortal__rowMain">
                    <strong>{formatAmount(payout.amount_minor, payout.currency)}</strong>
                    <span>{payout.payment_method ?? "Paiement manuel"} | {payout.payment_reference ?? "Sans reference"}</span>
                  </div>
                  <div className="partnerPortal__rowMeta">
                    <span className={statusBadgeClass(payout.status)}>{payout.status}</span>
                    <span>{formatDate(payout.paid_at ?? payout.approved_at ?? payout.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
