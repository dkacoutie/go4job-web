import { supabase } from "./supabaseClient";
import type {
  PartnerAccountRow,
  PartnerCommissionRow,
  PartnerConversionRow,
  PartnerPayoutRow,
} from "./adminPartnersApi";

export type CurrencyTotals = Record<string, number>;

export type PartnerDashboardSummaryRow = {
  partner_id: string;
  user_id: string | null;
  display_name: string;
  referral_code: string;
  partner_status: PartnerAccountRow["status"];
  total_subscriptions_sold: number;
  total_commissionable_sales: number;
  sold_7d_count: number;
  sold_30d_count: number;
  sold_90d_count: number;
  commissions_pending_by_currency: CurrencyTotals | null;
  commissions_approved_by_currency: CurrencyTotals | null;
  commissions_paid_by_currency: CurrencyTotals | null;
  commissions_total_earned_by_currency: CurrencyTotals | null;
  last_conversion_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerPortalSnapshot = {
  partner: PartnerAccountRow | null;
  summary: PartnerDashboardSummaryRow | null;
  conversions: PartnerConversionRow[];
  commissions: PartnerCommissionRow[];
  payouts: PartnerPayoutRow[];
};

export async function fetchPartnerPortalSnapshot(userId: string): Promise<PartnerPortalSnapshot> {
  const partnerRes = await supabase.from("partner_accounts").select("*").eq("user_id", userId).maybeSingle();

  if (partnerRes.error) {
    throw new Error(partnerRes.error.message || "Impossible de charger le compte partenaire.");
  }

  const partner = (partnerRes.data as PartnerAccountRow | null) ?? null;

  if (!partner) {
    return {
      partner: null,
      summary: null,
      conversions: [],
      commissions: [],
      payouts: [],
    };
  }

  const [summaryRes, conversionsRes, commissionsRes, payoutsRes] = await Promise.all([
    supabase.from("partner_dashboard_summary").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("partner_conversions").select("*").order("converted_at", { ascending: false }).limit(12),
    supabase.from("partner_commissions").select("*").order("calculated_at", { ascending: false }).limit(20),
    supabase.from("partner_payouts").select("*").order("created_at", { ascending: false }).limit(12),
  ]);

  if (summaryRes.error) {
    throw new Error(summaryRes.error.message || "Impossible de charger le resume partenaire.");
  }
  if (conversionsRes.error) {
    throw new Error(conversionsRes.error.message || "Impossible de charger l'historique des ventes.");
  }
  if (commissionsRes.error) {
    throw new Error(commissionsRes.error.message || "Impossible de charger les commissions.");
  }
  if (payoutsRes.error) {
    throw new Error(payoutsRes.error.message || "Impossible de charger les paiements.");
  }

  return {
    partner,
    summary: (summaryRes.data as PartnerDashboardSummaryRow | null) ?? null,
    conversions: (conversionsRes.data ?? []) as PartnerConversionRow[],
    commissions: (commissionsRes.data ?? []) as PartnerCommissionRow[],
    payouts: (payoutsRes.data ?? []) as PartnerPayoutRow[],
  };
}
