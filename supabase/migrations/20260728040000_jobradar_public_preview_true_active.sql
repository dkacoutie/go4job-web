-- =============================================================================
-- JobRadar — Les RPC publiques ne montrent que les offres réellement fraîches
--
-- jobradar_public_jobs_count comptait is_active = true, le booléen legacy qui
-- inclut les offres périmées non nettoyées. C'est le même angle mort que celui
-- qui a masqué la panne de collecte du 20/07 : le tableau de bord affichait
-- 263 000 offres pendant que le catalogue vivant était tombé à 41 000.
--
-- Sur la page vitrine, ce compteur alimente l'accroche « Plus de N offres
-- disponibles ». Il promettait donc à des visiteurs un catalogue qui n'existait
-- plus, au moment précis où on leur demande de créer un compte.
--
-- jobradar_public_jobs_preview acceptait 'stale' en plus de 'active' : l'aperçu
-- public pouvait montrer des offres mortes à un prospect qui découvre le
-- produit. C'est l'endroit où une offre périmée coûte le plus cher.
--
-- Effet mesuré : compteur vitrine 265 922 -> 232 220, aperçu public sans
-- aucune offre non fraîche.
--
-- Ce changement ne fait que resserrer un filtre. Aucune donnée supplémentaire
-- n'est exposée à anon, la surface reste celle définie par
-- 20260724060000_jobradar_public_offers_preview_rpc.sql : pas de description,
-- pas de lien de candidature, pas de pagination, échantillon plafonné à 24.
-- =============================================================================

begin;

create or replace function public.jobradar_public_jobs_count()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)
  from jobs
  where job_status = 'active'::job_lifecycle_status;
$function$;

create or replace function public.jobradar_public_jobs_preview(p_limit integer default 24)
returns table(
  id uuid, title text, company_name text, location text, country_codes text[],
  remote_type text, contract_type text, seniority text,
  salary_min numeric, salary_max numeric, salary_currency text, salary_period text,
  job_family text, posted_at timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    j.id,
    j.title,
    j.company_name,
    j.location,
    j.country_codes,
    j.remote_type,
    j.contract_type,
    j.seniority,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.salary_period,
    j.job_family,
    j.posted_at
  from jobs j
  where j.job_status = 'active'::job_lifecycle_status
  order by j.published_at desc nulls last,
           j.posted_at desc nulls last,
           j.scraped_at desc nulls last,
           j.created_at desc nulls last
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$function$;

commit;
