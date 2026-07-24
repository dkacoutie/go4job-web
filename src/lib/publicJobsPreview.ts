import { supabase } from "./supabaseClient";

// Aperçu public des offres (visiteurs non connectés). Les deux fonctions
// appellent des RPC Postgres SECURITY DEFINER volontairement restreintes
// (voir supabase/migrations/20260724060000_jobradar_public_offers_preview_rpc.sql) :
// pas de description, pas de lien de candidature, pas de pagination —
// seulement un échantillon plafonné des offres les plus récentes.

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
