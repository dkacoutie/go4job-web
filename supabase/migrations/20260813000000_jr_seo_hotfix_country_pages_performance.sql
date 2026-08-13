-- HOTFIX performance, meme incident que 20260812230000 / 20260812233000 :
-- les 8 pages publiques pays/ville (/offres/cote-divoire, /offres/france, etc.,
-- JR-0135 du 11/08/2026) etaient cassees en production depuis leur lancement --
-- pas une regression de ce soir, un probleme pre-existant jamais detecte
-- (l'erreur est silencieuse : "L'apercu n'est pas disponible pour le moment").
--
-- Diagnostic complet (voir rapport SEO du 12/08/2026, section "Incident") :
-- 1. Bloat de la table jobs (253k lignes mortes / 1,5M) -- traite hors
--    migration par un VACUUM ANALYZE public.jobs (operation ponctuelle, pas
--    un changement de schema, non versionnee ici).
-- 2. Absence d'index adapte au filtre (pays + actif + non expire) --
--    idx_jobs_public_country_active cree ci-dessous.
-- 3. Le tri par date (top 24 les plus recentes) necessitait de trier
--    l'intégralite du resultat avant de prendre les 24 premieres --
--    idx_jobs_public_country_sort cree ci-dessous (aide partiellement :
--    Postgres ne peut pas garantir un ordre trie a travers plusieurs valeurs
--    d'un meme "= ANY(tableau)" sans un index sur chaque valeur separement,
--    donc cet index n'est pas systematiquement choisi par le planificateur --
--    conserve car utilise dans certains cas, sans risque).
-- 4. Les fonctions publiques (LANGUAGE SQL + SECURITY DEFINER) ne se
--    replanifiaient pas correctement par appel avec les valeurs reelles des
--    parametres (confirme par comparaison avec une requete preparee
--    equivalente, qui utilisait bien le nouvel index) -- converties en
--    LANGUAGE plpgsql.
-- 5. Meme corrigees, un pays a tres gros volume (France : 309 459 offres
--    actives) prend encore plusieurs secondes a compter/trier en entier --
--    borne desormais a un maximum de lignes scannees (3000 pour la liste,
--    100000 pour le compteur) plutot que de scanner l'integralite du
--    resultat a chaque visite. Compromis assume : au-dela de ce plafond, le
--    compteur affiche un plancher ("100000") plutot qu'un nombre exact, et la
--    liste des 24 offres montrees peut ne pas etre au sens strict les 24 plus
--    recentes. Acceptable pour une page vitrine ; a revisiter si un compteur
--    exact devient necessaire (piste : table de compteurs precalcules
--    rafraichie periodiquement plutot que comptee en direct).
--
-- Teste sous statement_timeout='3s' (celui du role anon) pour Cote d'Ivoire
-- (1742 offres), Abidjan (722), France (309k, plafonne a 100000) et Paris
-- (10367) avant deploiement -- tous passent desormais sous ce delai.

-- CREATE INDEX CONCURRENTLY ne peut pas s'executer dans un bloc transactionnel
-- explicite -- ces deux instructions doivent rester hors de tout begin/commit
-- (y compris celui que le processus d'application de migration ajoute parfois
-- automatiquement autour du fichier ; les executer manuellement statement par
-- statement via le SQL Editor si c'est le cas, comme deja fait pour cet
-- incident).

create index concurrently if not exists idx_jobs_public_country_active
  on jobs (country)
  where is_active = true and is_expired = false;

create index concurrently if not exists idx_jobs_public_country_sort
  on jobs (country, (coalesce(sort_at, posted_at, created_at)) desc)
  where is_active = true and is_expired = false;

begin;

create or replace function public.jobradar_public_jobs_by_location(
  p_countries text[] default null,
  p_location_pattern text default null,
  p_limit int default 24
)
returns table (
  id uuid, title text, company_name text, location text, country_codes text[],
  remote_type text, contract_type text, seniority text, salary_min numeric,
  salary_max numeric, salary_currency text, salary_period text, job_family text,
  posted_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select t.id, t.title, t.company_name, t.location, t.country_codes, t.remote_type,
         t.contract_type, t.seniority, t.salary_min, t.salary_max, t.salary_currency,
         t.salary_period, t.job_family, t.posted_at
  from (
    select j.*
    from jobs j
    where j.is_active = true
      and j.is_expired = false
      and (j.quality_status = 'ok' or j.quality_status is null)
      and (p_countries is null or j.country = any(p_countries))
      and (p_location_pattern is null or j.location ilike p_location_pattern)
    limit 3000
  ) t
  order by coalesce(t.sort_at, t.posted_at, t.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 24);
end;
$$;

create or replace function public.jobradar_public_jobs_by_location_count(
  p_countries text[] default null,
  p_location_pattern text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from (
    select 1
    from jobs j
    where j.is_active = true
      and j.is_expired = false
      and (j.quality_status = 'ok' or j.quality_status is null)
      and (p_countries is null or j.country = any(p_countries))
      and (p_location_pattern is null or j.location ilike p_location_pattern)
    limit 100000
  ) t;
  return v_count;
end;
$$;

commit;
