import { supabase } from "./supabaseClient";

// JR-SEO, 13/08/2026 : Observatoire de l'emploi -- lecture d'un snapshot
// precalcule (voir supabase/migrations/20260813080000_jr_seo_observatoire_snapshot.sql
// et .../20260813090000_jr_seo_observatoire_salary_gb_only.sql). Jamais
// d'agregation en direct ici : la table jobs fait 400k+ lignes actives et un
// calcul a la demande a deja provoque un 500 en production ce soir sur
// /offres avant correction (voir 20260813050000_jr_seo_fix_public_preview_timeout.sql).
// Le rafraichissement tourne une fois par jour via cron
// (jobradar_refresh_observatoire_snapshot_daily, 03:20 UTC).

export type ObservatoireMarketKey = "GLOBAL" | "FR" | "GB" | "US" | "CI";

export type ObservatoireContractBucket = { bucket: string; n: number };

export type ObservatoireRemoteBreakdown = {
  remote: number;
  hybrid: number;
  on_site: number;
  covered: number;
};

export type ObservatoireSalaryStats = {
  currency: string;
  median_min: number | null;
  median_max: number | null;
  covered: number;
} | null;

export type ObservatoireTopCompany = { name: string; n: number };

export type ObservatoireSnapshot = {
  market_key: ObservatoireMarketKey;
  market_label: string;
  total_active: number;
  new_last_7d: number;
  new_last_30d: number;
  contract_type_breakdown: ObservatoireContractBucket[];
  remote_breakdown: ObservatoireRemoteBreakdown;
  salary_stats: ObservatoireSalaryStats;
  top_companies: ObservatoireTopCompany[];
  generated_at: string;
};

export const OBSERVATOIRE_MARKETS: { key: ObservatoireMarketKey; label: string; offersPath: string | null }[] = [
  { key: "GLOBAL", label: "Monde", offersPath: "/offres" },
  { key: "FR", label: "France", offersPath: "/offres/france" },
  { key: "GB", label: "Royaume-Uni", offersPath: null },
  { key: "US", label: "États-Unis", offersPath: null },
  { key: "CI", label: "Côte d'Ivoire", offersPath: "/offres/cote-divoire" },
];

export async function fetchObservatoireSnapshot(market: ObservatoireMarketKey): Promise<ObservatoireSnapshot | null> {
  const { data, error } = await supabase.rpc("jobradar_public_observatoire", { p_market: market });
  if (error) throw error;
  const rows = (data ?? []) as ObservatoireSnapshot[];
  return rows[0] ?? null;
}
