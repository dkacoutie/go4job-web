import { supabase } from "./supabaseClient";

// Aperçu public des offres (visiteurs non connectés). Les fonctions RPC
// appelées ici sont SECURITY DEFINER volontairement restreintes (voir
// supabase/migrations/20260724060000_jobradar_public_offers_preview_rpc.sql
// et .../jobradar_public_job_detail_rpc.sql) : pas de description complète,
// pas de lien de candidature — seulement les champs "vitrine" et, pour la
// fiche par offre (JR-0131), un extrait tronqué de la description.

export type PublicJobPreview = {
  id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  country_codes: string[] | null;
  remote_type: string | null;
  contract_type: string | null;
  seniority: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  job_family: string | null;
  posted_at: string | null;
};

export type PublicJobDetail = PublicJobPreview & {
  country: string | null;
  description_excerpt: string | null;
};

const PREVIEW_LIMIT = 24;

// JR-SEO-audit-20260812, bataille prioritaire #1 : pagination bornee sur les
// pages de listing publiques (au lieu du plafond fixe de 24 sans suite).
// Fenetre volontairement limitee a 10 pages (240 offres) — decision produit
// du 13/08/2026 : /offres et les pages pays/ville restent un apercu qui
// pousse a la creation de compte, pas un acces gratuit au catalogue entier.
// La fonction RPC borne aussi p_page cote serveur (defense en profondeur,
// jamais confiance au seul clampage cote client) — voir
// 20260813060000_jr_seo_public_jobs_pagination.sql.
export const PUBLIC_JOBS_PAGE_SIZE = PREVIEW_LIMIT;
export const PUBLIC_JOBS_MAX_PAGE = 10;

export function clampPublicJobsPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.floor(page), 1), PUBLIC_JOBS_MAX_PAGE);
}

export async function fetchPublicJobsPreview(page = 1): Promise<PublicJobPreview[]> {
  const { data, error } = await supabase.rpc("jobradar_public_jobs_preview", {
    p_limit: PREVIEW_LIMIT,
    p_page: clampPublicJobsPage(page),
  });
  if (error) throw error;
  return (data ?? []) as PublicJobPreview[];
}

export async function fetchPublicJobsCount(): Promise<number | null> {
  const { data, error } = await supabase.rpc("jobradar_public_jobs_count");
  if (error || typeof data !== "number") return null;
  return data;
}

/**
 * Fiche publique d'une offre (teaser SEO / Google for Jobs, JR-0131).
 * Retourne null si l'offre n'existe pas, n'est plus active, ou a expiré —
 * la fonction RPC filtre déjà côté serveur (is_active, is_expired,
 * quality_status), donc un retour vide ici est une absence légitime, pas
 * une erreur à distinguer davantage.
 */
export async function fetchPublicJobDetail(id: string): Promise<PublicJobDetail | null> {
  const { data, error } = await supabase.rpc("jobradar_public_job_detail", { p_id: id });
  if (error) throw error;
  const rows = (data ?? []) as PublicJobDetail[];
  return rows[0] ?? null;
}

/**
 * Offres publiques filtrées par pays et, optionnellement, par motif de
 * localisation (pages pays/ville, JR-0135).
 */
export async function fetchPublicJobsByLocation(
  countries: string[],
  locationPattern: string | null,
  page = 1
): Promise<PublicJobPreview[]> {
  const { data, error } = await supabase.rpc("jobradar_public_jobs_by_location", {
    p_countries: countries,
    p_location_pattern: locationPattern,
    p_limit: PREVIEW_LIMIT,
    p_page: clampPublicJobsPage(page),
  });
  if (error) throw error;
  return (data ?? []) as PublicJobPreview[];
}

export async function fetchPublicJobsByLocationCount(
  countries: string[],
  locationPattern: string | null
): Promise<number | null> {
  const { data, error } = await supabase.rpc("jobradar_public_jobs_by_location_count", {
    p_countries: countries,
    p_location_pattern: locationPattern,
  });
  if (error || typeof data !== "number") return null;
  return data;
}
