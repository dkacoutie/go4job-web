-- =============================================================================
-- JobRadar — Sélection des offres candidates par pertinence, en base
--
-- PROBLÈME RÉSOLU
--
-- La récupération des candidats et le calcul de pertinence étaient deux
-- logiques séparées qui ne partageaient pas la même notion de pertinence : la
-- récupération choisissait par DATE, le barème classait par CORRESPONDANCE. Le
-- vivier remis au barème pouvait donc ne pas contenir les meilleures offres, et
-- le barème ne pouvait pas rattraper ce qu'il n'avait pas reçu.
--
-- Constaté le 28/07/2026 sur une alerte « Chef de projet finance » : le digest
-- proposait de l'automobile, de l'international et du datacenter, alors que le
-- catalogue contenait 33 postes de chef de projet orientés finance. Ils
-- n'entraient jamais dans le vivier parce que le tri par date les écrasait.
--
-- CONSTRUCTION RETENUE, asymétrique et vérifiée à chaque étape
--
--   FILTRER par OU des expressions de métier
--     -> décide qui a le droit d'être vu. Un candidat cherchant plusieurs
--        métiers reste servi.
--
--   CLASSER par OU des termes de spécialisation, en excluant les termes du
--   filtre
--     -> décide dans quel ordre. Les termes de métier sont exclus du classement
--        parce que le filtre les garantit déjà : les inclure départage les
--        synonymes (« product owner » contre « chef de projet ») au lieu de
--        départager les spécialisations.
--
--   REMONTER le pays demandé en tête, sans exclure les autres
--     -> une alerte ivoirienne ne peut pas se contenter d'un filtre dur : le
--        vivier CI compte ~640 offres actives et tomberait sous le minimum de
--        5 offres requis pour envoyer un digest.
--
-- POURQUOI UN OU ET NON UN ET POUR LE CLASSEMENT
--
-- Mesuré sur des titres réels :
--   ET de 6 termes, 1 seul présent  -> 1e-20  (nul en pratique)
--   OU de 6 termes, 1 présent       -> 0,0101
--   OU de 6 termes, 2 présents      -> 0,0203 (exactement le double)
--
-- Un ts_rank sur un ET s'effondre dès que la plupart des termes manquent. Un OU
-- croît proportionnellement au nombre de termes trouvés, ce qui est exactement
-- le comportement attendu d'un score de spécialisation.
--
-- SÉCURITÉ
--
-- Les tsquery sont composés en combinant des valeurs typées avec l'opérateur
-- ||, jamais en concaténant du texte. Aucune injection possible dans la syntaxe
-- de recherche, quels que soient les mots-clés saisis par l'utilisateur.
--
-- INDEX
--
-- S'appuie sur jobs_title_fts_fr_active_idx, index GIN partiel sur les offres
-- actives. Créé séparément en mode concurrent (CREATE INDEX CONCURRENTLY ne
-- peut pas s'exécuter dans une transaction) :
--
--   create index concurrently if not exists jobs_title_fts_fr_active_idx
--     on public.jobs using gin (to_tsvector('french', coalesce(title, '')))
--     where job_status = 'active'::job_lifecycle_status;
--
-- Taille : 6,2 Mo. Postgres le maintient à chaque écriture : une offre insérée
-- en 'active' y entre, une offre basculée en 'stale' en sort. Vérifié sur
-- 1 509 offres collectées après sa création, plan d'exécution en Bitmap Index
-- Scan, 3 à 5 ms.
--
-- Point de vigilance : job_status change environ 17 000 fois par jour, donc
-- autant d'entrées et de sorties de l'index. Les GIN encaissent cela avec leur
-- liste d'attente interne. Si les écritures ralentissaient un jour, regarder
-- ici en premier.
-- =============================================================================

begin;

create or replace function public.jobradar_candidate_jobs(
  p_criteria jsonb,
  p_limit int default 300
)
returns table (
  id uuid, title text, company_name text, location text, country text,
  remote_type text, contract_type text, seniority text,
  published_at timestamptz, posted_at timestamptz, scraped_at timestamptz,
  created_at timestamptz, updated_at timestamptz, last_seen_at timestamptz,
  description_text text, official_desc text, tags text[], job_skills text[],
  required_skills text[], optional_skills text[], job_family text,
  source_url text, apply_url text, external_id text,
  is_active boolean, is_expired boolean, job_status text,
  match_rank real, country_preferred boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  -- Termes trop génériques pour discriminer. « job » à lui seul rendait
  -- n'importe quelle annonce éligible dans l'ancien barème.
  v_faibles constant text[] := array[
    'job','jobs','emploi','emplois','poste','postes','offre','offres',
    'chef','projet','projets','manager','responsable','directeur','directrice',
    'assistant','assistante','agent','charge','chargee','technicien','senior',
    'junior','stage','alternance','cdi','cdd','france','remote','teletravail'
  ];
  v_termes text[];
  v_phrases text[];
  v_specialisation text[];
  v_pays text[];
  v_filtre tsquery := null;
  v_classement tsquery := null;
  t text;
  v_limite int := least(greatest(coalesce(p_limit, 300), 1), 1000);
begin
  select array_agg(distinct lower(btrim(x)))
  into v_pays
  from unnest(coalesce(
    array(select jsonb_array_elements_text(p_criteria->'countries')),
    array[]::text[]
  )) x
  where x is not null and btrim(x) <> '';

  select array_agg(distinct terme)
  into v_termes
  from (
    select lower(btrim(regexp_replace(x, '\s+', ' ', 'g'))) as terme
    from unnest(
      coalesce(array(select jsonb_array_elements_text(p_criteria->'keywords')), array[]::text[])
      || coalesce(array[p_criteria->>'desired_role'], array[]::text[])
    ) as x
    where x is not null and btrim(x) <> ''
  ) s
  where terme <> ''
    and not (terme = any (v_faibles))
    and (position(' ' in terme) > 0 or length(terme) >= 5);

  -- Aucun terme exploitable : on ne devine pas, on rend les offres récentes.
  if v_termes is null or array_length(v_termes, 1) is null then
    return query
      select j.id, j.title, j.company_name, j.location, j.country, j.remote_type,
             j.contract_type, j.seniority, j.published_at, j.posted_at, j.scraped_at,
             j.created_at, j.updated_at, j.last_seen_at, j.description_text,
             j.official_desc, j.tags, j.job_skills, j.required_skills,
             j.optional_skills, j.job_family, j.source_url, j.apply_url,
             j.external_id, j.is_active, j.is_expired, j.job_status::text,
             0::real, false
      from public.jobs j
      where j.job_status = 'active'::job_lifecycle_status
      order by j.published_at desc nulls last
      limit v_limite;
    return;
  end if;

  -- Les expressions de plusieurs mots désignent le métier : elles filtrent.
  select array_agg(x) into v_phrases
  from unnest(v_termes) x where position(' ' in x) > 0;
  if v_phrases is null then v_phrases := v_termes; end if;

  -- Tout le reste désigne la spécialisation : elle classe.
  select array_agg(x) into v_specialisation
  from unnest(v_termes) x where not (x = any (v_phrases));

  foreach t in array v_phrases loop
    v_filtre := case when v_filtre is null
                     then websearch_to_tsquery('french', t)
                     else v_filtre || websearch_to_tsquery('french', t) end;
  end loop;
  if v_filtre is null then return; end if;

  if v_specialisation is not null then
    foreach t in array v_specialisation loop
      v_classement := case when v_classement is null
                           then websearch_to_tsquery('french', t)
                           else v_classement || websearch_to_tsquery('french', t) end;
    end loop;
  end if;

  -- Sans terme de spécialisation, on ne peut départager que par fraîcheur.
  if v_classement is null then v_classement := v_filtre; end if;

  return query
    select j.id, j.title, j.company_name, j.location, j.country, j.remote_type,
           j.contract_type, j.seniority, j.published_at, j.posted_at, j.scraped_at,
           j.created_at, j.updated_at, j.last_seen_at, j.description_text,
           j.official_desc, j.tags, j.job_skills, j.required_skills,
           j.optional_skills, j.job_family, j.source_url, j.apply_url,
           j.external_id, j.is_active, j.is_expired, j.job_status::text,
           ts_rank(to_tsvector('french', coalesce(j.title, '')), v_classement) as match_rank,
           (v_pays is not null and (
              lower(coalesce(j.country, '')) = any (v_pays)
              or exists (select 1 from unnest(coalesce(j.country_codes, array[]::text[])) c
                         where lower(c) = any (v_pays))
           )) as country_preferred
    from public.jobs j
    where j.job_status = 'active'::job_lifecycle_status
      and to_tsvector('french', coalesce(j.title, '')) @@ v_filtre
    order by
      (v_pays is not null and (
         lower(coalesce(j.country, '')) = any (v_pays)
         or exists (select 1 from unnest(coalesce(j.country_codes, array[]::text[])) c
                    where lower(c) = any (v_pays))
      )) desc,
      ts_rank(to_tsvector('french', coalesce(j.title, '')), v_classement) desc,
      j.published_at desc nulls last
    limit v_limite;
end;
$function$;

comment on function public.jobradar_candidate_jobs(jsonb, int) is
  'Vivier d''offres candidates classe par pertinence. Filtre par OU des expressions metier, classe par OU des termes de specialisation, remonte le pays demande en tete. Source unique de la notion de candidat pour les digests.';

revoke all on function public.jobradar_candidate_jobs(jsonb, int) from public, anon;
grant execute on function public.jobradar_candidate_jobs(jsonb, int) to service_role;

commit;

-- -----------------------------------------------------------------------------
-- RESTE À FAIRE : brancher les fonctions edge sur cette RPC.
--
-- send_job_alert_digest_v2 et preview_job_alert_digest utilisent encore
-- buildRelevanceOrFilter (ilike sur le titre), ajouté quelques heures plus tôt
-- comme correctif d'urgence. Il fonctionne (vivier 240 -> 534, offres eligibles
-- 3 -> 30) mais il classe par date et non par pertinence.
--
-- Le remplacer par un appel a jobradar_candidate_jobs supprimera la double
-- definition de « candidat » entre l'apercu et l'envoi, qui ont deja du etre
-- modifies deux fois separement pour rester identiques.
-- -----------------------------------------------------------------------------
