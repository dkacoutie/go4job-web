-- =============================================================================
-- JobRadar — Les RPC publiques dépassaient le statement_timeout du rôle anon
--
-- Symptôme observé sur la page vitrine en production : le compteur affichait
-- « Des milliers d'offres disponibles » au lieu du nombre réel. Le frontend
-- avale l'erreur silencieusement (fetchPublicJobsCount retourne null sur
-- erreur), donc rien ne remontait.
--
-- Diagnostic depuis le navigateur, sur les deux RPC :
--   HTTP 500 {"code":"57014","message":"canceling statement due to statement
--   timeout"}
--
-- 1. jobradar_public_jobs_count
--    Compter 232 000 lignes sur une table de 1,24 million ne tient pas dans le
--    délai alloué à anon, quel que soit le filtre. Ce compteur n'a donc jamais
--    fonctionné en production, avant comme après le passage à job_status.
--
--    On lit désormais la dernière valeur calculée par jobradar_health_guard(),
--    qui tourne toutes les 30 minutes (cron jobid 25) et stocke jobs_active
--    dans jobradar_health_snapshots. Lecture d'une seule ligne indexée.
--    L'affichage arrondit au millier inférieur, une valeur vieille de trente
--    minutes est donc sans conséquence visible.
--
--    Garde-fou : au-delà de 24 h sans instantané, on renvoie null pour que
--    l'interface retombe sur son texte générique plutôt que d'annoncer un
--    chiffre périmé si le cron de supervision tombait.
--
-- 2. jobradar_public_jobs_preview
--    Régression introduite le même jour par
--    20260728040000_jobradar_public_preview_true_active.sql : en filtrant sur
--    job_status = 'active' seul, la requête ne correspondait plus au prédicat
--    de l'index partiel jobs_digest_feed_sort_idx, qui exige également
--    is_active = true et is_expired faux. Le planificateur ne pouvait plus
--    prouver que l'index couvrait la requête et repartait sur un parcours
--    complet.
--
--    On remet ces deux conditions. Elles sont redondantes sur le plan logique
--    (le cycle de vie maintient les booléens synchronisés avec job_status,
--    donc job_status = 'active' implique is_active = true et is_expired =
--    false) mais nécessaires au planificateur.
--
-- Mesures après correction, depuis le navigateur :
--   compteur : 200, 251 ms, 232220
--   aperçu   : 200, 270 ms, 24 offres
-- =============================================================================

begin;

create or replace function public.jobradar_public_jobs_count()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.jobs_active::bigint
  from public.jobradar_health_snapshots s
  where s.jobs_active is not null
    and s.created_at > now() - interval '24 hours'
  order by s.created_at desc
  limit 1;
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
    -- Redondant avec la ligne ci-dessus, mais indispensable pour que le
    -- planificateur retienne l'index partiel jobs_digest_feed_sort_idx.
    and j.is_active = true
    and (j.is_expired = false or j.is_expired is null)
  order by j.published_at desc nulls last,
           j.posted_at desc nulls last,
           j.scraped_at desc nulls last,
           j.created_at desc nulls last
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
$function$;

create index if not exists jobradar_health_snapshots_created_at_idx
  on public.jobradar_health_snapshots (created_at desc);

commit;
