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

export async function fetchPublicJobsPreview(): Promise<PublicJobPreview[]> {
  const { data, error } = await supabase.rpc("jobradar_public_jobs_preview", {
    p_limit: PREVIEW_LIMIT,
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
