import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { useToast } from "./components/ToastCenter";
import {
  approvePartnerCommission,
  attachCommissionsToPayout,
  createPartnerPayout,
  fetchAdminPartnerSnapshot,
  markPartnerPayoutPaid,
  type AdminPartnerSummaryRow,
  type CurrencyTotals,
  type PartnerAccountRow,
  type PartnerAccountStatus,
  type PartnerCommissionRow,
  type PartnerPayoutRow,
  type PartnerConversionRow,
  upsertPartnerAccount,
  voidPartnerCommission,
} from "./lib/adminPartnersApi";
import "./AdminPartnersPage.css";

type AdminTab = "overview" | "partners" | "commissions" | "payouts";
type CommissionFilter = "all" | "pending" | "approved" | "paid" | "voided";

type PartnerFormState = {
  partnerId: string | null;
  displayName: string;
  contactName: string;
  contactEmail: string;
  userId: string;
  status: PartnerAccountStatus;
  referralCode: string;
  notes: string;
};

type CommissionActionState = {
  mode: "approve" | "void";
  commissionId: string;
  notes: string;
};

type PayoutComposerState = {
  isOpen: boolean;
  payoutId: string | null;
  partnerId: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  notes: string;
  selectedCommissionIds: string[];
};

type ActivityItem = {
  id: string;
  kind: "conversion" | "commission" | "payout";
  at: string;
  title: string;
  detail: string;
};

const PARTNER_STATUSES: PartnerAccountStatus[] = ["pending", "active", "paused", "inactive"];
const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "partners", label: "Partenaires" },
  { id: "commissions", label: "Commissions" },
  { id: "payouts", label: "Paiements" },
];

const EMPTY_PARTNER_FORM: PartnerFormState = {
  partnerId: null,
  displayName: "",
  contactName: "",
  contactEmail: "",
  userId: "",
  status: "pending",
  referralCode: "",
  notes: "",
};

const EMPTY_PAYOUT_COMPOSER: PayoutComposerState = {
  isOpen: false,
  payoutId: null,
  partnerId: "",
  currency: "XOF",
  paymentMethod: "",
  paymentReference: "",
  notes: "",
  selectedCommissionIds: [],
};

function normalizeCurrencyTotals(value: unknown): CurrencyTotals {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<CurrencyTotals>((acc, [currency, amount]) => {
    const parsed = Number(amount);
    if (Number.isFinite(parsed)) acc[currency.toUpperCase()] = parsed;
    return acc;
  }, {});
}

function combineCurrencyTotals(...items: Array<CurrencyTotals | null | undefined>): CurrencyTotals {
  return items.reduce<CurrencyTotals>((acc, current) => {
    const safe = normalizeCurrencyTotals(current);
    for (const [currency, amount] of Object.entries(safe)) {
      acc[currency] = (acc[currency] ?? 0) + amount;
    }
    return acc;
  }, {});
}

function currencyUsesDecimals(currency: string) {
  return !["XOF", "XAF"].includes(currency.toUpperCase());
}

function formatMinorAmount(currency: string, amountMinor: number) {
  const safeCurrency = currency.toUpperCase();
  const divisor = currencyUsesDecimals(safeCurrency) ? 100 : 1;
  const amount = amountMinor / divisor;

  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: currencyUsesDecimals(safeCurrency) ? 2 : 0,
      maximumFractionDigits: currencyUsesDecimals(safeCurrency) ? 2 : 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("fr-FR")} ${safeCurrency}`;
  }
}

function formatCurrencyTotals(value: CurrencyTotals | null | undefined) {
  const safe = normalizeCurrencyTotals(value);
  const entries = Object.entries(safe).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "0";
  return entries.map(([currency, amount]) => formatMinorAmount(currency, amount)).join(" | ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function statusBadgeClass(status: string) {
  if (status === "active" || status === "paid") return "badge badge--green";
  if (status === "pending" || status === "approved" || status === "draft") return "badge badge--yellow";
  if (status === "voided" || status === "failed" || status === "inactive") return "badge badge--red";
  if (status === "paused" || status === "cancelled") return "badge badge--gray";
  return "badge badge--blue";
}

function buildPartnerFormState(partner: PartnerAccountRow | null): PartnerFormState {
  if (!partner) return { ...EMPTY_PARTNER_FORM };

  return {
    partnerId: partner.id,
    displayName: partner.display_name ?? "",
    contactName: partner.contact_name ?? "",
    contactEmail: partner.contact_email ?? "",
    userId: partner.user_id ?? "",
    status: partner.status,
    referralCode: partner.referral_code ?? "",
    notes: partner.notes ?? "",
  };
}

export default function AdminPartnersPage() {
  const { pushToast } = useToast();

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summaries, setSummaries] = useState<AdminPartnerSummaryRow[]>([]);
  const [partners, setPartners] = useState<PartnerAccountRow[]>([]);
  const [commissions, setCommissions] = useState<PartnerCommissionRow[]>([]);
  const [payouts, setPayouts] = useState<PartnerPayoutRow[]>([]);
  const [conversions, setConversions] = useState<PartnerConversionRow[]>([]);

  const [partnerSearch, setPartnerSearch] = useState("");
  const [commissionFilter, setCommissionFilter] = useState<CommissionFilter>("all");
  const [commissionSearch, setCommissionSearch] = useState("");
  const [payoutSearch, setPayoutSearch] = useState("");

  const [partnerFormOpen, setPartnerFormOpen] = useState(false);
  const [partnerForm, setPartnerForm] = useState<PartnerFormState>({ ...EMPTY_PARTNER_FORM });
  const [isSavingPartner, setIsSavingPartner] = useState(false);

  const [commissionAction, setCommissionAction] = useState<CommissionActionState | null>(null);
  const [isSavingCommissionAction, setIsSavingCommissionAction] = useState(false);

  const [payoutComposer, setPayoutComposer] = useState<PayoutComposerState>({ ...EMPTY_PAYOUT_COMPOSER });
  const [isSavingPayout, setIsSavingPayout] = useState(false);
  const [isAttachingCommissions, setIsAttachingCommissions] = useState(false);
  const [isMarkingPayoutPaid, setIsMarkingPayoutPaid] = useState(false);

  const currentPayout = useMemo(
    () => payouts.find((item) => item.id === payoutComposer.payoutId) ?? null,
    [payoutComposer.payoutId, payouts]
  );

  const partnerById = useMemo(() => {
    return partners.reduce<Record<string, PartnerAccountRow>>((acc, partner) => {
      acc[partner.id] = partner;
      return acc;
    }, {});
  }, [partners]);

  const summaryById = useMemo(() => {
    return summaries.reduce<Record<string, AdminPartnerSummaryRow>>((acc, row) => {
      acc[row.partner_id] = row;
      return acc;
    }, {});
  }, [summaries]);

  const payoutCommissionCount = useMemo(() => {
    return commissions.reduce<Record<string, number>>((acc, commission) => {
      if (!commission.payout_id) return acc;
      acc[commission.payout_id] = (acc[commission.payout_id] ?? 0) + 1;
      return acc;
    }, {});
  }, [commissions]);

  const getPartnerLabel = useCallback(
    (partnerId: string) => {
      const summary = summaryById[partnerId];
      if (summary?.display_name) return summary.display_name;
      const partner = partnerById[partnerId];
      if (partner?.display_name) return partner.display_name;
      return "Partenaire";
    },
    [partnerById, summaryById]
  );

  const getPartnerEmail = useCallback(
    (partnerId: string) => {
      return summaryById[partnerId]?.contact_email ?? partnerById[partnerId]?.contact_email ?? "-";
    },
    [partnerById, summaryById]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = await fetchAdminPartnerSnapshot();
      setSummaries(snapshot.summaries);
      setPartners(snapshot.partners);
      setCommissions(snapshot.commissions);
      setPayouts(snapshot.payouts);
      setConversions(snapshot.conversions);
    } catch (err: any) {
      setError(err?.message ?? "Impossible de charger l'admin partenaires.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setAuthLoading(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      const user = userData?.user;

      if (cancelled) return;

      if (userError || !user) {
        setIsAdmin(false);
        setAuthLoading(false);
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      setIsAdmin(!profileError && !!profileData?.is_admin);
      setAuthLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authLoading && isAdmin) {
      void loadData();
    }
  }, [authLoading, isAdmin, loadData]);

  useEffect(() => {
    if (!payoutComposer.isOpen) return;

    const nextPayout = payouts.find((item) => item.id === payoutComposer.payoutId);
    if (!nextPayout && payoutComposer.payoutId) {
      setPayoutComposer((prev) => ({ ...prev, payoutId: null, selectedCommissionIds: [] }));
      return;
    }

    if (!nextPayout) return;

    const attachedApproved = commissions
      .filter((commission) => commission.payout_id === nextPayout.id && commission.status === "approved")
      .map((commission) => commission.id);

    setPayoutComposer((prev) => ({
      ...prev,
      partnerId: nextPayout.partner_id,
      currency: nextPayout.currency,
      paymentMethod: nextPayout.payment_method ?? prev.paymentMethod,
      paymentReference: nextPayout.payment_reference ?? prev.paymentReference,
      notes: nextPayout.notes ?? prev.notes,
      selectedCommissionIds: Array.from(new Set([...attachedApproved, ...prev.selectedCommissionIds])),
    }));
  }, [commissions, payoutComposer.isOpen, payoutComposer.payoutId, payouts]);

  const overviewMetrics = useMemo(() => {
    const totals = summaries.reduce(
      (acc, row) => {
        acc.totalPartners += 1;
        if (row.partner_status === "active") acc.activePartners += 1;
        acc.totalSubscriptionsSold += row.total_subscriptions_sold ?? 0;
        acc.pendingCommissions = combineCurrencyTotals(acc.pendingCommissions, row.commissions_pending_by_currency);
        acc.approvedCommissions = combineCurrencyTotals(acc.approvedCommissions, row.commissions_approved_by_currency);
        acc.paidCommissions = combineCurrencyTotals(acc.paidCommissions, row.commissions_paid_by_currency);
        return acc;
      },
      {
        totalPartners: 0,
        activePartners: 0,
        totalSubscriptionsSold: 0,
        pendingCommissions: {} as CurrencyTotals,
        approvedCommissions: {} as CurrencyTotals,
        paidCommissions: {} as CurrencyTotals,
      }
    );

    return totals;
  }, [summaries]);

  const topPartners = useMemo(() => {
    return [...summaries]
      .sort((a, b) => {
        if (b.total_subscriptions_sold !== a.total_subscriptions_sold) {
          return b.total_subscriptions_sold - a.total_subscriptions_sold;
        }
        return b.total_commissionable_sales - a.total_commissionable_sales;
      })
      .slice(0, 6);
  }, [summaries]);

  const recentActivity = useMemo<ActivityItem[]>(() => {
    const conversionItems = conversions.map((conversion) => ({
      id: `conversion-${conversion.id}`,
      kind: "conversion" as const,
      at: conversion.converted_at,
      title:
        conversion.status === "attributed"
          ? `${getPartnerLabel(conversion.partner_id)} | Vente attribuee`
          : `${getPartnerLabel(conversion.partner_id)} | Vente disqualifiee`,
      detail:
        conversion.status === "attributed"
          ? `Code ${conversion.referral_code_used} | premier abonnement valide`
          : `Code ${conversion.referral_code_used} | ${conversion.disqualification_reason ?? "non eligible"}`,
    }));

    const commissionItems = commissions.flatMap((commission) => {
      const items: ActivityItem[] = [];
      if (commission.approved_at) {
        items.push({
          id: `commission-approved-${commission.id}`,
          kind: "commission",
          at: commission.approved_at,
          title: `${getPartnerLabel(commission.partner_id)} | Commission approuvee`,
          detail: `${formatMinorAmount(commission.currency, commission.commission_amount_minor)} | palier #${commission.sale_sequence_number}`,
        });
      }

      if (commission.paid_at) {
        items.push({
          id: `commission-paid-${commission.id}`,
          kind: "commission",
          at: commission.paid_at,
          title: `${getPartnerLabel(commission.partner_id)} | Commission payee`,
          detail: `${formatMinorAmount(commission.currency, commission.commission_amount_minor)} | payout`,
        });
      }

      return items;
    });

    const payoutItems = payouts.flatMap((payout) => {
      const items: ActivityItem[] = [];
      if (payout.created_at) {
        items.push({
          id: `payout-created-${payout.id}`,
          kind: "payout",
          at: payout.created_at,
          title: `${getPartnerLabel(payout.partner_id)} | Payout cree`,
          detail: `${formatMinorAmount(payout.currency, payout.amount_minor)} | ${payout.status}`,
        });
      }

      if (payout.paid_at) {
        items.push({
          id: `payout-paid-${payout.id}`,
          kind: "payout",
          at: payout.paid_at,
          title: `${getPartnerLabel(payout.partner_id)} | Payout paye`,
          detail: `${formatMinorAmount(payout.currency, payout.amount_minor)} | ${payout.payment_reference ?? "sans reference"}`,
        });
      }

      return items;
    });

    return [...conversionItems, ...commissionItems, ...payoutItems]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 10);
  }, [commissions, conversions, getPartnerLabel, payouts]);

  const filteredPartners = useMemo(() => {
    const search = partnerSearch.trim().toLowerCase();
    if (!search) return summaries;

    return summaries.filter((row) => {
      return [row.display_name, row.contact_email ?? "", row.referral_code].some((value) =>
        value.toLowerCase().includes(search)
      );
    });
  }, [partnerSearch, summaries]);

  const filteredCommissions = useMemo(() => {
    const search = commissionSearch.trim().toLowerCase();

    return commissions.filter((commission) => {
      const matchesStatus = commissionFilter === "all" || commission.status === commissionFilter;
      if (!matchesStatus) return false;

      if (!search) return true;

      const partnerLabel = getPartnerLabel(commission.partner_id).toLowerCase();
      return (
        partnerLabel.includes(search) ||
        commission.currency.toLowerCase().includes(search) ||
        commission.status.toLowerCase().includes(search)
      );
    });
  }, [commissionFilter, commissionSearch, commissions, getPartnerLabel]);

  const filteredPayouts = useMemo(() => {
    const search = payoutSearch.trim().toLowerCase();
    if (!search) return payouts;

    return payouts.filter((payout) => {
      const partnerLabel = getPartnerLabel(payout.partner_id).toLowerCase();
      const paymentMethod = (payout.payment_method ?? "").toLowerCase();
      const paymentReference = (payout.payment_reference ?? "").toLowerCase();
      return (
        partnerLabel.includes(search) ||
        payout.currency.toLowerCase().includes(search) ||
        payout.status.toLowerCase().includes(search) ||
        paymentMethod.includes(search) ||
        paymentReference.includes(search)
      );
    });
  }, [getPartnerLabel, payoutSearch, payouts]);

  const availablePayoutCurrencies = useMemo(() => {
    const values = commissions
      .filter((commission) => commission.status === "approved")
      .map((commission) => commission.currency.toUpperCase());

    return Array.from(new Set(values)).sort();
  }, [commissions]);

  const payoutCandidates = useMemo(() => {
    const partnerId = payoutComposer.partnerId || currentPayout?.partner_id;
    const currency = (payoutComposer.currency || currentPayout?.currency || "").toUpperCase();
    const payoutId = currentPayout?.id ?? payoutComposer.payoutId;

    if (!partnerId || !currency) return [];

    return commissions.filter((commission) => {
      if (commission.partner_id !== partnerId) return false;
      if (commission.currency.toUpperCase() !== currency) return false;
      if (commission.status !== "approved") return false;
      return commission.payout_id === null || commission.payout_id === payoutId;
    });
  }, [commissions, currentPayout, payoutComposer.currency, payoutComposer.partnerId, payoutComposer.payoutId]);

  const attachedPayoutCommissions = useMemo(() => {
    if (!currentPayout) return [];
    return commissions.filter((commission) => commission.payout_id === currentPayout.id);
  }, [commissions, currentPayout]);

  const openCreatePartner = () => {
    setPartnerForm({ ...EMPTY_PARTNER_FORM });
    setPartnerFormOpen(true);
  };

  const openEditPartner = (partnerId: string) => {
    const partner = partnerById[partnerId] ?? null;
    setPartnerForm(buildPartnerFormState(partner));
    setPartnerFormOpen(true);
  };

  const closePartnerForm = () => {
    if (isSavingPartner) return;
    setPartnerFormOpen(false);
    setPartnerForm({ ...EMPTY_PARTNER_FORM });
  };

  const handlePartnerSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!partnerForm.displayName.trim()) {
      pushToast({
        kind: "error",
        title: "Nom du partenaire requis",
        message: "Renseigne au minimum le display name.",
      });
      return;
    }

    setIsSavingPartner(true);
    try {
      await upsertPartnerAccount({
        partnerId: partnerForm.partnerId,
        userId: partnerForm.userId.trim() || null,
        status: partnerForm.status,
        displayName: partnerForm.displayName.trim(),
        contactName: partnerForm.contactName.trim() || null,
        contactEmail: partnerForm.contactEmail.trim() || null,
        referralCode: partnerForm.referralCode.trim() || null,
        notes: partnerForm.notes.trim() || null,
      });

      pushToast({
        kind: "success",
        title: partnerForm.partnerId ? "Partenaire mis a jour" : "Partenaire cree",
        message: "Les informations sont enregistrees.",
      });

      closePartnerForm();
      await loadData();
    } catch (err: any) {
      pushToast({
        kind: "error",
        title: "Enregistrement impossible",
        message: err?.message ?? "Une erreur est survenue.",
      });
    } finally {
      setIsSavingPartner(false);
    }
  };

  const selectedCommission = useMemo(
    () => commissions.find((item) => item.id === commissionAction?.commissionId) ?? null,
    [commissionAction?.commissionId, commissions]
  );

  const handleCommissionActionSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!commissionAction || !selectedCommission) return;

    setIsSavingCommissionAction(true);

    try {
      if (commissionAction.mode === "approve") {
        await approvePartnerCommission(selectedCommission.id, commissionAction.notes.trim() || null);
      } else {
        await voidPartnerCommission(selectedCommission.id, commissionAction.notes.trim() || null);
      }

      pushToast({
        kind: "success",
        title: commissionAction.mode === "approve" ? "Commission approuvee" : "Commission annulee",
        message: `${getPartnerLabel(selectedCommission.partner_id)} mis a jour.`,
      });

      setCommissionAction(null);
      await loadData();
    } catch (err: any) {
      pushToast({
        kind: "error",
        title: "Action impossible",
        message: err?.message ?? "La mise a jour a echoue.",
      });
    } finally {
      setIsSavingCommissionAction(false);
    }
  };

  const openCreatePayout = () => {
    setPayoutComposer({
      ...EMPTY_PAYOUT_COMPOSER,
      isOpen: true,
      currency: availablePayoutCurrencies[0] ?? "XOF",
    });
  };

  const openExistingPayout = (payout: PartnerPayoutRow) => {
    setPayoutComposer({
      isOpen: true,
      payoutId: payout.id,
      partnerId: payout.partner_id,
      currency: payout.currency,
      paymentMethod: payout.payment_method ?? "",
      paymentReference: payout.payment_reference ?? "",
      notes: payout.notes ?? "",
      selectedCommissionIds: commissions
        .filter((commission) => commission.payout_id === payout.id)
        .map((commission) => commission.id),
    });
  };

  const closePayoutComposer = () => {
    if (isSavingPayout || isAttachingCommissions || isMarkingPayoutPaid) return;
    setPayoutComposer({ ...EMPTY_PAYOUT_COMPOSER });
  };

  const handleCreatePayout = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!payoutComposer.partnerId || !payoutComposer.currency) {
      pushToast({
        kind: "error",
        title: "Payout incomplet",
        message: "Choisis un partenaire et une devise.",
      });
      return;
    }

    setIsSavingPayout(true);
    try {
      const payout = await createPartnerPayout({
        partnerId: payoutComposer.partnerId,
        currency: payoutComposer.currency,
        paymentMethod: payoutComposer.paymentMethod.trim() || null,
        paymentReference: payoutComposer.paymentReference.trim() || null,
        notes: payoutComposer.notes.trim() || null,
      });

      pushToast({
        kind: "success",
        title: "Payout cree",
        message: `Draft ouvert pour ${getPartnerLabel(payout.partner_id)}.`,
      });

      await loadData();
      setPayoutComposer((prev) => ({
        ...prev,
        payoutId: payout.id,
        selectedCommissionIds: [],
      }));
    } catch (err: any) {
      pushToast({
        kind: "error",
        title: "Creation impossible",
        message: err?.message ?? "Le payout n'a pas pu etre cree.",
      });
    } finally {
      setIsSavingPayout(false);
    }
  };

  const handleAttachCommissions = async () => {
    if (!currentPayout || !payoutComposer.selectedCommissionIds.length) {
      pushToast({
        kind: "error",
        title: "Selection requise",
        message: "Choisis au moins une commission approuvee.",
      });
      return;
    }

    setIsAttachingCommissions(true);
    try {
      const result = await attachCommissionsToPayout(currentPayout.id, payoutComposer.selectedCommissionIds);

      pushToast({
        kind: "success",
        title: "Commissions rattachees",
        message: `${result.attached_commission_count} commission(s) dans le payout.`,
      });

      await loadData();
    } catch (err: any) {
      pushToast({
        kind: "error",
        title: "Rattachement impossible",
        message: err?.message ?? "Les commissions n'ont pas ete rattachees.",
      });
    } finally {
      setIsAttachingCommissions(false);
    }
  };

  const handleMarkPayoutPaid = async () => {
    if (!currentPayout) return;

    setIsMarkingPayoutPaid(true);
    try {
      await markPartnerPayoutPaid(
        currentPayout.id,
        payoutComposer.paymentReference.trim() || null,
        payoutComposer.notes.trim() || null
      );

      pushToast({
        kind: "success",
        title: "Payout marque paye",
        message: `${getPartnerLabel(currentPayout.partner_id)} a bien ete traite.`,
      });

      await loadData();
    } catch (err: any) {
      pushToast({
        kind: "error",
        title: "Mise a jour impossible",
        message: err?.message ?? "Le payout n'a pas pu etre marque comme paye.",
      });
    } finally {
      setIsMarkingPayoutPaid(false);
    }
  };

  const toggleCommissionSelection = (commissionId: string) => {
    setPayoutComposer((prev) => {
      const exists = prev.selectedCommissionIds.includes(commissionId);
      return {
        ...prev,
        selectedCommissionIds: exists
          ? prev.selectedCommissionIds.filter((id) => id !== commissionId)
          : [...prev.selectedCommissionIds, commissionId],
      };
    });
  };

  const isEmpty = !loading && !error && !summaries.length && !partners.length && !commissions.length && !payouts.length;

  if (authLoading) {
    return (
      <div className="adminPartners">
        <div className="adminPartners__loading">Verification des droits admin...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="adminPartners">
        <div className="adminPartners__gate card">
          <span className="badge badge--red">Acces refuse</span>
          <h1>Admin partenaires reserve a l'equipe interne</h1>
          <p className="subtitle">Cette zone est protegee et disponible uniquement pour les administrateurs JobRadar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPartners">
      <section className="adminPartners__hero">
        <div>
          <div className="chips">
            <span className="chip">Admin interne</span>
            <span className="chip">Programme partenaires</span>
          </div>
          <h1>Admin partenaires JobRadar</h1>
          <p className="subtitle">
            Une console unique pour piloter les partenaires, suivre les performances, traiter les commissions et gerer
            les paiements sans quitter l'environnement JobRadar.
          </p>
        </div>

        <div className="adminPartners__heroActions">
          <button type="button" className="btn" onClick={() => void loadData()} disabled={loading}>
            {loading ? "Actualisation..." : "Actualiser"}
          </button>
          <button type="button" className="btn btn--primary" onClick={openCreatePartner}>
            Creer un partenaire
          </button>
        </div>
      </section>

      <div className="adminPartners__tabs" role="tablist" aria-label="Sections admin partenaires">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`adminPartners__tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {isEmpty ? (
        <div className="card adminPartners__empty">
          <h2>Aucune donnee partenaire pour le moment</h2>
          <p className="subtitle">Creer le premier partenaire permettra de lancer la gestion admin du programme.</p>
          <button type="button" className="btn btn--primary" onClick={openCreatePartner}>
            Ajouter un premier partenaire
          </button>
        </div>
      ) : null}

      {activeTab === "overview" && !isEmpty && (
        <section className="adminPartners__panel">
          <div className="adminPartners__kpis">
            <article className="adminPartners__kpi card">
              <span className="adminPartners__kpiLabel">Nombre total de partenaires</span>
              <strong>{overviewMetrics.totalPartners}</strong>
              <span className="muted">Comptes partenaires connus</span>
            </article>
            <article className="adminPartners__kpi card">
              <span className="adminPartners__kpiLabel">Partenaires actifs</span>
              <strong>{overviewMetrics.activePartners}</strong>
              <span className="muted">Eligibles pour l'attribution</span>
            </article>
            <article className="adminPartners__kpi card">
              <span className="adminPartners__kpiLabel">Total abonnements vendus</span>
              <strong>{overviewMetrics.totalSubscriptionsSold}</strong>
              <span className="muted">Tous plans confondus</span>
            </article>
            <article className="adminPartners__kpi card">
              <span className="adminPartners__kpiLabel">Commissions en attente</span>
              <strong>{formatCurrencyTotals(overviewMetrics.pendingCommissions)}</strong>
              <span className="muted">
                {commissions.filter((item) => item.status === "pending").length} commission(s) pending
              </span>
            </article>
            <article className="adminPartners__kpi card">
              <span className="adminPartners__kpiLabel">Commissions approuvees</span>
              <strong>{formatCurrencyTotals(overviewMetrics.approvedCommissions)}</strong>
              <span className="muted">
                {commissions.filter((item) => item.status === "approved").length} commission(s) approuvee(s)
              </span>
            </article>
            <article className="adminPartners__kpi card">
              <span className="adminPartners__kpiLabel">Commissions payees</span>
              <strong>{formatCurrencyTotals(overviewMetrics.paidCommissions)}</strong>
              <span className="muted">{commissions.filter((item) => item.status === "paid").length} deja reglee(s)</span>
            </article>
          </div>

          <div className="adminPartners__grid">
            <div className="card">
              <div className="card__titleRow">
                <h2>Partenaires les plus performants</h2>
                <span className="badge badge--blue">Top 6</span>
              </div>

              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Partenaire</th>
                      <th>Statut</th>
                      <th>Ventes</th>
                      <th>Plans</th>
                      <th>Total gagne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPartners.map((partner) => (
                      <tr key={partner.partner_id}>
                        <td>
                          <div className="adminPartners__tableTitle">{partner.display_name}</div>
                          <div className="muted">{partner.contact_email ?? "Sans email"}</div>
                        </td>
                        <td>
                          <span className={statusBadgeClass(partner.partner_status)}>{partner.partner_status}</span>
                        </td>
                        <td>{partner.total_subscriptions_sold}</td>
                        <td className="adminPartners__planBreakdown">
                          <span>7j {partner.sold_7d_count}</span>
                          <span>30j {partner.sold_30d_count}</span>
                          <span>90j {partner.sold_90d_count}</span>
                        </td>
                        <td>{formatCurrencyTotals(partner.commissions_total_earned_by_currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card__titleRow">
                <h2>Historique principal</h2>
                <span className="badge badge--gray">Recent</span>
              </div>

              <div className="adminPartners__activityList">
                {recentActivity.length === 0 ? (
                  <div className="empty">Aucun evenement recent.</div>
                ) : (
                  recentActivity.map((item) => (
                    <div key={item.id} className="adminPartners__activityItem">
                      <div
                        className={`badge ${
                          item.kind === "payout" ? "badge--green" : item.kind === "commission" ? "badge--blue" : "badge--yellow"
                        }`}
                      >
                        {item.kind}
                      </div>
                      <div className="adminPartners__activityBody">
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </div>
                      <div className="muted">{formatDateTime(item.at)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === "partners" && !isEmpty && (
        <section className="adminPartners__panel">
          <div className="card">
            <div className="card__titleRow">
              <h2>Partenaires</h2>
              <div className="filters">
                <input
                  className="search"
                  value={partnerSearch}
                  onChange={(event) => setPartnerSearch(event.target.value)}
                  placeholder="Rechercher nom, email ou code..."
                />
                <button type="button" className="btn btn--primary" onClick={openCreatePartner}>
                  Creer un partenaire
                </button>
              </div>
            </div>

            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Partenaire</th>
                    <th>Code</th>
                    <th>Statut</th>
                    <th>Ventes</th>
                    <th>7j / 30j / 90j</th>
                    <th>Total gagne</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={7}>
                        Aucun partenaire ne correspond a la recherche.
                      </td>
                    </tr>
                  ) : (
                    filteredPartners.map((partner) => (
                      <tr key={partner.partner_id}>
                        <td>
                          <div className="adminPartners__tableTitle">{partner.display_name}</div>
                          <div className="muted">{partner.contact_email ?? "Sans email"}</div>
                        </td>
                        <td>
                          <span className="mono">{partner.referral_code}</span>
                        </td>
                        <td>
                          <span className={statusBadgeClass(partner.partner_status)}>{partner.partner_status}</span>
                        </td>
                        <td>{partner.total_subscriptions_sold}</td>
                        <td className="adminPartners__planBreakdown">
                          <span>7j {partner.sold_7d_count}</span>
                          <span>30j {partner.sold_30d_count}</span>
                          <span>90j {partner.sold_90d_count}</span>
                        </td>
                        <td>{formatCurrencyTotals(partner.commissions_total_earned_by_currency)}</td>
                        <td className="right">
                          <button type="button" className="btn" onClick={() => openEditPartner(partner.partner_id)}>
                            Modifier
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "commissions" && !isEmpty && (
        <section className="adminPartners__panel">
          <div className="card">
            <div className="card__titleRow">
              <h2>Commissions</h2>
              <div className="filters">
                <input
                  className="search"
                  value={commissionSearch}
                  onChange={(event) => setCommissionSearch(event.target.value)}
                  placeholder="Rechercher partenaire, devise ou statut..."
                />
              </div>
            </div>

            <div className="adminPartners__filtersRow">
              {(["all", "pending", "approved", "paid", "voided"] as CommissionFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`adminPartners__filterChip${commissionFilter === filter ? " is-active" : ""}`}
                  onClick={() => setCommissionFilter(filter)}
                >
                  {filter === "all" ? "Toutes" : filter}
                </button>
              ))}
            </div>

            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Partenaire</th>
                    <th>Commission</th>
                    <th>Devise</th>
                    <th>Taux</th>
                    <th>Statut</th>
                    <th>Vente #</th>
                    <th>Date</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommissions.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={8}>
                        Aucune commission pour ces filtres.
                      </td>
                    </tr>
                  ) : (
                    filteredCommissions.map((commission) => (
                      <tr key={commission.id}>
                        <td>
                          <div className="adminPartners__tableTitle">{getPartnerLabel(commission.partner_id)}</div>
                          <div className="muted">{getPartnerEmail(commission.partner_id)}</div>
                        </td>
                        <td>{formatMinorAmount(commission.currency, commission.commission_amount_minor)}</td>
                        <td>{commission.currency}</td>
                        <td>{Number(commission.commission_rate_percent).toFixed(2)}%</td>
                        <td>
                          <span className={statusBadgeClass(commission.status)}>{commission.status}</span>
                        </td>
                        <td>{commission.sale_sequence_number}</td>
                        <td>{formatDateTime(commission.paid_at ?? commission.approved_at ?? commission.calculated_at)}</td>
                        <td className="right">
                          {commission.status === "pending" && (
                            <button
                              type="button"
                              className="btn btn--primary"
                              onClick={() => setCommissionAction({ mode: "approve", commissionId: commission.id, notes: "" })}
                            >
                              Approuver
                            </button>
                          )}
                          {commission.status !== "paid" && commission.status !== "voided" && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setCommissionAction({ mode: "void", commissionId: commission.id, notes: commission.notes ?? "" })}
                            >
                              Annuler
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "payouts" && !isEmpty && (
        <section className="adminPartners__panel">
          <div className="card">
            <div className="card__titleRow">
              <h2>Paiements partenaires</h2>
              <div className="filters">
                <input
                  className="search"
                  value={payoutSearch}
                  onChange={(event) => setPayoutSearch(event.target.value)}
                  placeholder="Rechercher partenaire, devise ou reference..."
                />
                <button type="button" className="btn btn--primary" onClick={openCreatePayout}>
                  Creer un payout
                </button>
              </div>
            </div>

            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Partenaire</th>
                    <th>Devise</th>
                    <th>Montant</th>
                    <th>Statut</th>
                    <th>Methode</th>
                    <th>Reference</th>
                    <th>Date</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayouts.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={8}>
                        Aucun payout disponible.
                      </td>
                    </tr>
                  ) : (
                    filteredPayouts.map((payout) => (
                      <tr key={payout.id}>
                        <td>
                          <div className="adminPartners__tableTitle">{getPartnerLabel(payout.partner_id)}</div>
                          <div className="muted">{payoutCommissionCount[payout.id] ?? 0} commission(s)</div>
                        </td>
                        <td>{payout.currency}</td>
                        <td>{formatMinorAmount(payout.currency, payout.amount_minor)}</td>
                        <td>
                          <span className={statusBadgeClass(payout.status)}>{payout.status}</span>
                        </td>
                        <td>{payout.payment_method ?? "-"}</td>
                        <td className="mono">{payout.payment_reference ?? "-"}</td>
                        <td>{formatDateTime(payout.paid_at ?? payout.approved_at ?? payout.created_at)}</td>
                        <td className="right">
                          <button type="button" className="btn" onClick={() => openExistingPayout(payout)}>
                            {payout.status === "paid" ? "Voir" : "Gerer"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {partnerFormOpen && (
        <div className="adminPartners__overlay" role="presentation">
          <div className="adminPartners__drawer">
            <div className="card__titleRow">
              <div>
                <h2>{partnerForm.partnerId ? "Modifier le partenaire" : "Creer un partenaire"}</h2>
                <div className="muted">Le code partenaire peut etre laisse vide pour generation automatique.</div>
              </div>
              <button type="button" className="btn" onClick={closePartnerForm} disabled={isSavingPartner}>
                Fermer
              </button>
            </div>

            <form className="adminPartners__form" onSubmit={handlePartnerSubmit}>
              <label className="adminPartners__field">
                <span>Display name</span>
                <input
                  value={partnerForm.displayName}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, displayName: event.target.value }))}
                  placeholder="Ex: Awa Traore"
                />
              </label>

              <label className="adminPartners__field">
                <span>Contact name</span>
                <input
                  value={partnerForm.contactName}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, contactName: event.target.value }))}
                  placeholder="Nom du contact"
                />
              </label>

              <label className="adminPartners__field">
                <span>Contact email</span>
                <input
                  value={partnerForm.contactEmail}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
                  placeholder="contact@exemple.com"
                />
              </label>

              <label className="adminPartners__field">
                <span>User ID Supabase</span>
                <input
                  value={partnerForm.userId}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, userId: event.target.value }))}
                  placeholder="uuid optionnel"
                />
              </label>

              <label className="adminPartners__field">
                <span>Statut</span>
                <select
                  value={partnerForm.status}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, status: event.target.value as PartnerAccountStatus }))}
                >
                  {PARTNER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="adminPartners__field">
                <span>Referral code</span>
                <input
                  value={partnerForm.referralCode}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, referralCode: event.target.value }))}
                  placeholder="Laisser vide pour generation auto"
                />
              </label>

              <label className="adminPartners__field">
                <span>Notes</span>
                <textarea
                  rows={5}
                  value={partnerForm.notes}
                  onChange={(event) => setPartnerForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Contexte commercial, canal, remarques internes..."
                />
              </label>

              <div className="adminPartners__formActions">
                <button type="button" className="btn" onClick={closePartnerForm} disabled={isSavingPartner}>
                  Annuler
                </button>
                <button type="submit" className="btn btn--primary" disabled={isSavingPartner}>
                  {isSavingPartner ? "Enregistrement..." : partnerForm.partnerId ? "Enregistrer" : "Creer le partenaire"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {commissionAction && selectedCommission && (
        <div className="adminPartners__overlay" role="presentation">
          <div className="adminPartners__modal">
            <div className="card__titleRow">
              <div>
                <h2>{commissionAction.mode === "approve" ? "Approuver la commission" : "Annuler la commission"}</h2>
                <div className="muted">
                  {getPartnerLabel(selectedCommission.partner_id)} |{" "}
                  {formatMinorAmount(selectedCommission.currency, selectedCommission.commission_amount_minor)}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setCommissionAction(null)}
                disabled={isSavingCommissionAction}
              >
                Fermer
              </button>
            </div>

            <form className="adminPartners__form" onSubmit={handleCommissionActionSubmit}>
              <label className="adminPartners__field">
                <span>Note interne</span>
                <textarea
                  rows={4}
                  value={commissionAction.notes}
                  onChange={(event) =>
                    setCommissionAction((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                  }
                  placeholder="Optionnel"
                />
              </label>

              <div className="adminPartners__formActions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCommissionAction(null)}
                  disabled={isSavingCommissionAction}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn--primary" disabled={isSavingCommissionAction}>
                  {isSavingCommissionAction
                    ? "Traitement..."
                    : commissionAction.mode === "approve"
                    ? "Confirmer l'approbation"
                    : "Confirmer l'annulation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {payoutComposer.isOpen && (
        <div className="adminPartners__overlay" role="presentation">
          <div className="adminPartners__drawer adminPartners__drawer--wide">
            <div className="card__titleRow">
              <div>
                <h2>{currentPayout ? `Payout ${currentPayout.status}` : "Creer un payout"}</h2>
                <div className="muted">
                  {currentPayout
                    ? `${getPartnerLabel(currentPayout.partner_id)} | ${formatMinorAmount(currentPayout.currency, currentPayout.amount_minor)}`
                    : "Creer le draft, rattacher les commissions approuvees, puis marquer paye."}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                onClick={closePayoutComposer}
                disabled={isSavingPayout || isAttachingCommissions || isMarkingPayoutPaid}
              >
                Fermer
              </button>
            </div>

            {!currentPayout ? (
              <form className="adminPartners__form" onSubmit={handleCreatePayout}>
                <div className="adminPartners__formGrid">
                  <label className="adminPartners__field">
                    <span>Partenaire</span>
                    <select
                      value={payoutComposer.partnerId}
                      onChange={(event) =>
                        setPayoutComposer((prev) => ({
                          ...prev,
                          partnerId: event.target.value,
                          selectedCommissionIds: [],
                        }))
                      }
                    >
                      <option value="">Choisir un partenaire</option>
                      {summaries.map((partner) => (
                        <option key={partner.partner_id} value={partner.partner_id}>
                          {partner.display_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="adminPartners__field">
                    <span>Devise</span>
                    <select
                      value={payoutComposer.currency}
                      onChange={(event) => setPayoutComposer((prev) => ({ ...prev, currency: event.target.value }))}
                    >
                      {[...new Set(["XOF", "USD", "EUR", ...availablePayoutCurrencies])].map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="adminPartners__field">
                    <span>Methode</span>
                    <input
                      value={payoutComposer.paymentMethod}
                      onChange={(event) =>
                        setPayoutComposer((prev) => ({ ...prev, paymentMethod: event.target.value }))
                      }
                      placeholder="Virement bancaire, mobile money..."
                    />
                  </label>

                  <label className="adminPartners__field">
                    <span>Reference</span>
                    <input
                      value={payoutComposer.paymentReference}
                      onChange={(event) =>
                        setPayoutComposer((prev) => ({ ...prev, paymentReference: event.target.value }))
                      }
                      placeholder="Reference interne ou banque"
                    />
                  </label>
                </div>

                <label className="adminPartners__field">
                  <span>Notes</span>
                  <textarea
                    rows={4}
                    value={payoutComposer.notes}
                    onChange={(event) => setPayoutComposer((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Commentaires internes"
                  />
                </label>

                <div className="adminPartners__formActions">
                  <button type="button" className="btn" onClick={closePayoutComposer} disabled={isSavingPayout}>
                    Annuler
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={isSavingPayout}>
                    {isSavingPayout ? "Creation..." : "Creer le payout draft"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="adminPartners__payoutWorkspace">
                <div className="adminPartners__workspaceColumn card">
                  <div className="card__titleRow">
                    <h3>Resume payout</h3>
                    <span className={statusBadgeClass(currentPayout.status)}>{currentPayout.status}</span>
                  </div>

                  <div className="adminPartners__summaryList">
                    <div>
                      <span>Partenaire</span>
                      <strong>{getPartnerLabel(currentPayout.partner_id)}</strong>
                    </div>
                    <div>
                      <span>Devise</span>
                      <strong>{currentPayout.currency}</strong>
                    </div>
                    <div>
                      <span>Montant</span>
                      <strong>{formatMinorAmount(currentPayout.currency, currentPayout.amount_minor)}</strong>
                    </div>
                    <div>
                      <span>Methode</span>
                      <strong>{currentPayout.payment_method ?? "-"}</strong>
                    </div>
                    <div>
                      <span>Reference</span>
                      <strong className="mono">{currentPayout.payment_reference ?? "-"}</strong>
                    </div>
                    <div>
                      <span>Cree le</span>
                      <strong>{formatDateTime(currentPayout.created_at)}</strong>
                    </div>
                  </div>

                  <label className="adminPartners__field">
                    <span>Reference de paiement</span>
                    <input
                      value={payoutComposer.paymentReference}
                      onChange={(event) =>
                        setPayoutComposer((prev) => ({ ...prev, paymentReference: event.target.value }))
                      }
                      placeholder="Reference qui sera enregistree au paiement"
                    />
                  </label>

                  <label className="adminPartners__field">
                    <span>Notes internes</span>
                    <textarea
                      rows={4}
                      value={payoutComposer.notes}
                      onChange={(event) => setPayoutComposer((prev) => ({ ...prev, notes: event.target.value }))}
                    />
                  </label>

                  <div className="adminPartners__formActions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleMarkPayoutPaid}
                      disabled={currentPayout.status !== "approved" || isMarkingPayoutPaid}
                    >
                      {isMarkingPayoutPaid ? "Traitement..." : "Marquer paye"}
                    </button>
                  </div>
                </div>

                <div className="adminPartners__workspaceColumn card">
                  <div className="card__titleRow">
                    <h3>Commissions compatibles</h3>
                    <span className="badge badge--blue">{payoutCandidates.length}</span>
                  </div>

                  {payoutCandidates.length === 0 ? (
                    <div className="empty">Aucune commission approuvee compatible pour ce payout.</div>
                  ) : (
                    <div className="adminPartners__selectionList">
                      {payoutCandidates.map((commission) => {
                        const isSelected = payoutComposer.selectedCommissionIds.includes(commission.id);
                        const isAlreadyAttached = commission.payout_id === currentPayout.id;

                        return (
                          <label key={commission.id} className={`adminPartners__selectionItem${isSelected ? " is-selected" : ""}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleCommissionSelection(commission.id)}
                              disabled={currentPayout.status === "paid"}
                            />
                            <div>
                              <strong>{formatMinorAmount(commission.currency, commission.commission_amount_minor)}</strong>
                              <span>
                                Vente #{commission.sale_sequence_number} | {formatDateTime(commission.approved_at ?? commission.calculated_at)}
                              </span>
                            </div>
                            {isAlreadyAttached && <span className="badge badge--green">Deja rattachee</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="adminPartners__formActions">
                    <button
                      type="button"
                      className="btn"
                      onClick={handleAttachCommissions}
                      disabled={!payoutComposer.selectedCommissionIds.length || currentPayout.status === "paid" || isAttachingCommissions}
                    >
                      {isAttachingCommissions ? "Rattachement..." : "Rattacher la selection"}
                    </button>
                  </div>
                </div>

                <div className="adminPartners__workspaceColumn card">
                  <div className="card__titleRow">
                    <h3>Commissions deja rattachees</h3>
                    <span className="badge badge--gray">{attachedPayoutCommissions.length}</span>
                  </div>

                  {attachedPayoutCommissions.length === 0 ? (
                    <div className="empty">Aucune commission rattachee pour l'instant.</div>
                  ) : (
                    <div className="adminPartners__attachedList">
                      {attachedPayoutCommissions.map((commission) => (
                        <div key={commission.id} className="adminPartners__attachedItem">
                          <div>
                            <strong>{formatMinorAmount(commission.currency, commission.commission_amount_minor)}</strong>
                            <span>
                              {getPartnerLabel(commission.partner_id)} | {commission.status}
                            </span>
                          </div>
                          <span className={statusBadgeClass(commission.status)}>{commission.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
