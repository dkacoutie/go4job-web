import { supabase } from "./supabaseClient";

export type CurrencyTotals = Record<string, number>;

export type PartnerAccountStatus = "pending" | "active" | "paused" | "inactive";
export type PartnerCommissionStatus = "pending" | "approved" | "paid" | "voided";
export type PartnerPayoutStatus = "draft" | "approved" | "paid" | "failed" | "cancelled";
export type PartnerConversionStatus = "attributed" | "disqualified";

export type AdminPartnerSummaryRow = {
  partner_id: string;
  user_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  display_name: string;
  referral_code: string;
  partner_status: PartnerAccountStatus;
  total_subscriptions_sold: number;
  total_commissionable_sales: number;
  sold_7d_count: number;
  sold_30d_count: number;
  sold_90d_count: number;
  commissions_pending_by_currency: CurrencyTotals | null;
  commissions_approved_by_currency: CurrencyTotals | null;
  commissions_paid_by_currency: CurrencyTotals | null;
  commissions_total_earned_by_currency: CurrencyTotals | null;
  payouts_paid_by_currency: CurrencyTotals | null;
  payout_count: number;
  last_payout_at: string | null;
  last_conversion_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerAccountRow = {
  id: string;
  user_id: string | null;
  status: PartnerAccountStatus;
  display_name: string;
  contact_name: string | null;
  contact_email: string | null;
  referral_code: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerCommissionRow = {
  id: string;
  partner_id: string;
  conversion_id: string;
  billing_payment_id: string;
  payout_id: string | null;
  status: PartnerCommissionStatus;
  currency: string;
  commissionable_amount_minor: number;
  commission_rate_percent: number;
  commission_amount_minor: number;
  sale_sequence_number: number;
  calculated_at: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerPayoutRow = {
  id: string;
  partner_id: string;
  status: PartnerPayoutStatus;
  currency: string;
  amount_minor: number;
  payment_method: string | null;
  payment_reference: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  paid_by_user_id: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerConversionRow = {
  id: string;
  partner_id: string;
  billing_payment_id: string;
  customer_user_id: string;
  billing_plan_id: string;
  referral_code_used: string;
  attribution_method: string;
  status: PartnerConversionStatus;
  is_first_paid_subscription: boolean;
  disqualification_reason: string | null;
  converted_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AdminPartnerSnapshot = {
  summaries: AdminPartnerSummaryRow[];
  partners: PartnerAccountRow[];
  commissions: PartnerCommissionRow[];
  payouts: PartnerPayoutRow[];
  conversions: PartnerConversionRow[];
};

export type AdminUserRow = {
  id: string;
  user_id: string;
  email: string;
  role: "super_admin" | "admin";
  is_active: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  is_current_user: boolean;
  is_protected: boolean;
};

export type PartnerAccountUpsertInput = {
  partnerId?: string | null;
  userId?: string | null;
  status: PartnerAccountStatus;
  displayName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  referralCode?: string | null;
  notes?: string | null;
};

export type PartnerPayoutCreateInput = {
  partnerId: string;
  currency: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  notes?: string | null;
};

function ensureNoError<T>(error: { message?: string } | null, data: T | null, fallback: string): T {
  if (error) throw new Error(error.message || fallback);
  if (data === null) throw new Error(fallback);
  return data;
}

export async function fetchAdminPartnerSnapshot(): Promise<AdminPartnerSnapshot> {
  const [summariesRes, partnersRes, commissionsRes, payoutsRes, conversionsRes] = await Promise.all([
    supabase.from("admin_partner_summary").select("*"),
    supabase.from("partner_accounts").select("*").order("created_at", { ascending: false }),
    supabase.from("partner_commissions").select("*").order("calculated_at", { ascending: false }),
    supabase.from("partner_payouts").select("*").order("created_at", { ascending: false }),
    supabase.from("partner_conversions").select("*").order("converted_at", { ascending: false }).limit(40),
  ]);

  if (summariesRes.error) throw new Error(summariesRes.error.message || "Impossible de charger le resume partenaires.");
  if (partnersRes.error) throw new Error(partnersRes.error.message || "Impossible de charger les partenaires.");
  if (commissionsRes.error) throw new Error(commissionsRes.error.message || "Impossible de charger les commissions.");
  if (payoutsRes.error) throw new Error(payoutsRes.error.message || "Impossible de charger les paiements.");
  if (conversionsRes.error) throw new Error(conversionsRes.error.message || "Impossible de charger les conversions.");

  return {
    summaries: (summariesRes.data ?? []) as AdminPartnerSummaryRow[],
    partners: (partnersRes.data ?? []) as PartnerAccountRow[],
    commissions: (commissionsRes.data ?? []) as PartnerCommissionRow[],
    payouts: (payoutsRes.data ?? []) as PartnerPayoutRow[],
    conversions: (conversionsRes.data ?? []) as PartnerConversionRow[],
  };
}

export async function upsertPartnerAccount(input: PartnerAccountUpsertInput): Promise<PartnerAccountRow> {
  const { data, error } = await supabase.rpc("partner_admin_upsert_account", {
    p_partner_id: input.partnerId ?? null,
    p_user_id: input.userId || null,
    p_status: input.status,
    p_display_name: input.displayName,
    p_contact_name: input.contactName || null,
    p_contact_email: input.contactEmail || null,
    p_referral_code: input.referralCode || null,
    p_notes: input.notes || null,
  });

  return ensureNoError(error, data as PartnerAccountRow | null, "Impossible d'enregistrer le partenaire.");
}

export async function approvePartnerCommission(commissionId: string, notes?: string | null): Promise<PartnerCommissionRow> {
  const { data, error } = await supabase.rpc("partner_admin_approve_commission", {
    p_commission_id: commissionId,
    p_notes: notes || null,
  });

  return ensureNoError(error, data as PartnerCommissionRow | null, "Impossible d'approuver la commission.");
}

export async function voidPartnerCommission(commissionId: string, notes?: string | null): Promise<PartnerCommissionRow> {
  const { data, error } = await supabase.rpc("partner_admin_void_commission", {
    p_commission_id: commissionId,
    p_notes: notes || null,
  });

  return ensureNoError(error, data as PartnerCommissionRow | null, "Impossible d'annuler la commission.");
}

export async function createPartnerPayout(input: PartnerPayoutCreateInput): Promise<PartnerPayoutRow> {
  const { data, error } = await supabase.rpc("partner_admin_create_payout", {
    p_partner_id: input.partnerId,
    p_currency: input.currency,
    p_payment_method: input.paymentMethod || null,
    p_payment_reference: input.paymentReference || null,
    p_notes: input.notes || null,
  });

  return ensureNoError(error, data as PartnerPayoutRow | null, "Impossible de creer le paiement.");
}

export async function attachCommissionsToPayout(
  payoutId: string,
  commissionIds: string[]
): Promise<{ payout_id: string; attached_commission_count: number; payout_amount_minor: number }> {
  const { data, error } = await supabase.rpc("partner_admin_attach_commissions_to_payout", {
    p_payout_id: payoutId,
    p_commission_ids: commissionIds,
  });

  const rows = (data ?? []) as { payout_id: string; attached_commission_count: number; payout_amount_minor: number }[];
  if (error) throw new Error(error.message || "Impossible de rattacher les commissions.");
  if (!rows.length) throw new Error("Aucun resultat recu apres rattachement des commissions.");
  return rows[0];
}

export async function markPartnerPayoutPaid(
  payoutId: string,
  paymentReference?: string | null,
  notes?: string | null
): Promise<PartnerPayoutRow> {
  const { data, error } = await supabase.rpc("partner_admin_mark_payout_paid", {
    p_payout_id: payoutId,
    p_payment_reference: paymentReference || null,
    p_notes: notes || null,
  });

  return ensureNoError(error, data as PartnerPayoutRow | null, "Impossible de marquer le paiement comme paye.");
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_list_admin_users");

  if (error) throw new Error(error.message || "Impossible de charger les admins.");
  return (data ?? []) as AdminUserRow[];
}

export async function grantAdminAccess(email: string): Promise<AdminUserRow> {
  const { data, error } = await supabase.rpc("admin_grant_admin_access", {
    p_email: email,
  });

  return ensureNoError(error, data as AdminUserRow | null, "Impossible d'ajouter cet admin.");
}

export async function setAdminUserActive(adminUserId: string, isActive: boolean): Promise<AdminUserRow> {
  const { data, error } = await supabase.rpc("admin_set_admin_user_active", {
    p_admin_user_id: adminUserId,
    p_is_active: isActive,
  });

  return ensureNoError(error, data as AdminUserRow | null, "Impossible de mettre a jour cet admin.");
}
