-- JR-SEO : Observatoire de l'emploi -- table de snapshot + fonction de
-- rafraichissement + RPC publique.
--
-- Objectif : donner a JobRadar un contenu statistique original (E-E-A-T +
-- asset "linkable" pour la strategie de netlinking, voir le doc projet
-- claude/netlinking-strategie-jobradar.md) sans jamais calculer ces stats en
-- direct sur une requete publique -- lecon tiree de l'incident /offres de ce
-- soir (13/08/2026) : agreger 300k+ lignes a la demande a deja provoque un
-- 500 en production. Ici on calcule a l'avance (cron) et on sert un snapshot
-- deja pret (lecture d'une seule ligne, quasi instantanee).
--
-- Choix des marches (mêmes libelles jobs.country que publicLocationsConfig.ts,
-- pour rester coherent avec les pages /offres/* existantes) + ajout de
-- Royaume-Uni et Etats-Unis : deux marches reels et volumineux (72k et 11.7k
-- offres actives au 13/08/2026, verifie par requete) qui n'ont aujourd'hui
-- aucune page dediee sur le site -- l'Observatoire est le premier contenu a
-- exister pour eux.
--
-- Choix des metriques -- fait apres audit reel de la couverture des champs
-- (requetes du 13/08/2026), pas suppose :
--   - job_family : 37 lignes actives sur 431 101 (0,009%) -- inutilisable,
--     ecarte entierement malgre l'audit initial du 12/08 qui le presentait
--     comme deja exploitable.
--   - location (ville) : valeurs tres heterogenes (pays seul, "ville,
--     region", "departement, region", valeurs meta comme "France/Global") --
--     ecarte pour cette v1, une statistique "villes" fiable demanderait un
--     nettoyage du champ a la source. A reprendre plus tard.
--   - contract_type : rempli sur 75-85% des offres FR/GB/CI, 0% sur US --
--     regroupe en quelques categories lisibles (CDI, CDD, Interim, etc.) par
--     un CASE sur des motifs ILIKE, valide manuellement sur l'echantillon
--     France (0,3% seulement finit dans "Autre").
--   - remote_type : 4 a 15% de couverture FR/GB/CI, 100% sur US (la source
--     US ne remplit que ce champ) -- garde avec un compteur "covered" pour
--     que le frontend affiche un cadrage honnete plutot que pretendre une
--     couverture totale.
--   - salaire : seulement FR (EUR, 15,8%) et GB (GBP, 98,9%) ont des lignes
--     avec salaire renseigne -- US et CI a 0%. Le champ salary_stats est
--     laisse a null si moins de 200 lignes couvertes (echantillon trop
--     faible pour une mediane publique credible).
--   - "entreprises qui recrutent le plus" : company_name est rempli a 100%
--     mais contient au moins une valeur de test manifeste ("name", 2551
--     occurrences) -- filtree explicitement, avec quelques autres valeurs
--     placeholder usuelles par precaution.

create table if not exists public.jobradar_observatoire_snapshot (
  market_key text primary key,
  market_label text not null,
  total_active integer not null,
  new_last_7d integer not null,
  new_last_30d integer not null,
  contract_type_breakdown jsonb not null default '[]'::jsonb,
  remote_breakdown jsonb not null default '{}'::jsonb,
  salary_stats jsonb,
  top_companies jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

comment on table public.jobradar_observatoire_snapshot is
  'Snapshot precalcule des statistiques publiques "Observatoire de l''emploi", rafraichi par jobradar_refresh_observatoire_snapshot() via cron. Ne jamais agreger jobs en direct sur une requete publique -- voir commentaire en tete de la migration 20260813080000.';

-- RLS activee, aucune policy publique : cette table n'est jamais lue
-- directement par anon/authenticated, uniquement via la RPC
-- jobradar_public_observatoire ci-dessous (meme principe que jobs lui-meme).
alter table public.jobradar_observatoire_snapshot enable row level security;

-- Fonction de rafraichissement -----------------------------------------

create or replace function public.jobradar_refresh_observatoire_snapshot()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m record;
  v_total integer;
  v_new7 integer;
  v_new30 integer;
  v_contract jsonb;
  v_remote jsonb;
  v_salary jsonb;
  v_companies jsonb;
begin
  for m in
    select * from (values
      ('GLOBAL'::text, 'Monde'::text,        null::text[]),
      ('FR',           'France',             array['France']),
      ('GB',           'Royaume-Uni',        array['United Kingdom']),
      ('US',           'Etats-Unis',         array['United States']),
      ('CI',           'Cote d''Ivoire',     array['CI', 'Côte d''Ivoire', 'Cote d''Ivoire'])
    ) as t(market_key, market_label, countries)
  loop
    -- Un seul passage sur jobs par marche (CTE materialisee) : agreger 5
    -- marches x plusieurs comptages separes multiplierait les scans lourds
    -- (mesure a 13s pour un seul GROUP BY contract_type sans filtre pays,
    -- faute d'index couvrant sur ce champ -- attendu et acceptable ici,
    -- cette fonction ne tourne qu'une fois par jour hors heures de pointe,
    -- jamais sur une requete publique).
    with base as materialized (
      select j.contract_type, j.remote_type, j.salary_min, j.salary_max,
             j.salary_currency, j.company_name, j.posted_at, j.created_at
      from jobs j
      where j.is_active = true
        and j.is_expired = false
        and (j.quality_status = 'ok' or j.quality_status is null)
        and (m.countries is null or j.country = any(m.countries))
    )
    select
      (select count(*) from base),
      (select count(*) from base where coalesce(posted_at, created_at) >= now() - interval '7 days'),
      (select count(*) from base where coalesce(posted_at, created_at) >= now() - interval '30 days'),
      (
        select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n) order by n desc), '[]'::jsonb)
        from (
          select
            case
              when contract_type ilike '%intérim%' or contract_type ilike '%interim%' then 'Intérim / Temporaire'
              when contract_type ilike '%cdd%' then 'CDD'
              when contract_type ilike '%stage%' then 'Stage / Alternance'
              when contract_type ilike '%saisonnier%' then 'Saisonnier'
              when contract_type ilike '%freelance%' or contract_type ilike '%libérale%' or contract_type ilike '%liberale%'
                   or contract_type ilike '%consultance%' or contract_type ilike '%commerciale%' then 'Freelance / Indépendant'
              when contract_type ilike '%cdi%' or contract_type ilike '%permanent%' then 'CDI / Permanent'
              when contract_type ilike '%contract%' or contract_type ilike '%contrat%' then 'Contrat / Temporaire'
              when contract_type ilike '%part_time%' then 'Temps partiel'
              when contract_type ilike '%full_time%' then 'Temps plein (non précisé)'
              else 'Autre'
            end as bucket,
            count(*) as n
          from base
          where contract_type is not null
          group by 1
        ) s
      ),
      jsonb_build_object(
        'remote', (select count(*) from base where remote_type = 'remote'),
        'hybrid', (select count(*) from base where remote_type = 'hybrid'),
        'on_site', (select count(*) from base where remote_type = 'on_site'),
        'covered', (select count(*) from base where remote_type is not null)
      ),
      case when (select count(*) from base where salary_min is not null or salary_max is not null) >= 200 then
        (
          select jsonb_build_object(
            'currency', mode() within group (order by salary_currency),
            'median_min', percentile_cont(0.5) within group (order by salary_min) filter (where salary_min is not null),
            'median_max', percentile_cont(0.5) within group (order by salary_max) filter (where salary_max is not null),
            'covered', count(*) filter (where salary_min is not null or salary_max is not null)
          )
          from base
        )
      else null end,
      (
        select coalesce(jsonb_agg(jsonb_build_object('name', company_name, 'n', n) order by n desc), '[]'::jsonb)
        from (
          select company_name, count(*) as n
          from base
          where company_name is not null and company_name <> ''
            and lower(company_name) not in ('name', 'n/a', 'na', 'unknown', 'test')
          group by company_name
          order by n desc
          limit 8
        ) s
      )
    into v_total, v_new7, v_new30, v_contract, v_remote, v_salary, v_companies;

    insert into public.jobradar_observatoire_snapshot
      (market_key, market_label, total_active, new_last_7d, new_last_30d,
       contract_type_breakdown, remote_breakdown, salary_stats, top_companies, generated_at)
    values
      (m.market_key, m.market_label, v_total, v_new7, v_new30,
       v_contract, v_remote, v_salary, v_companies, now())
    on conflict (market_key) do update set
      market_label = excluded.market_label,
      total_active = excluded.total_active,
      new_last_7d = excluded.new_last_7d,
      new_last_30d = excluded.new_last_30d,
      contract_type_breakdown = excluded.contract_type_breakdown,
      remote_breakdown = excluded.remote_breakdown,
      salary_stats = excluded.salary_stats,
      top_companies = excluded.top_companies,
      generated_at = excluded.generated_at;
  end loop;
end;
$function$;

-- RPC publique de lecture -------------------------------------------------

create or replace function public.jobradar_public_observatoire(p_market text default 'GLOBAL')
returns setof public.jobradar_observatoire_snapshot
language sql
stable
security definer
set search_path to 'public'
as $function$
  select *
  from public.jobradar_observatoire_snapshot
  where market_key = coalesce(upper(p_market), 'GLOBAL')
  limit 1;
$function$;

comment on function public.jobradar_public_observatoire(text) is
  'Lecture publique d''un snapshot Observatoire (une ligne precalculee, pas d''agregation en direct). p_market: GLOBAL, FR, GB, US, CI.';

create or replace function public.jobradar_public_observatoire_markets()
returns table(market_key text, market_label text, total_active integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select market_key, market_label, total_active
  from public.jobradar_observatoire_snapshot
  order by total_active desc;
$function$;

grant execute on function public.jobradar_refresh_observatoire_snapshot() to service_role;
grant execute on function public.jobradar_public_observatoire(text) to anon, authenticated;
grant execute on function public.jobradar_public_observatoire_markets() to anon, authenticated;

-- Premier calcul immediat : sans ca la table reste vide jusqu'au premier
-- passage du cron (voir migration suivante), et la page publique n'aurait
-- rien a afficher tout de suite apres le deploiement.
select public.jobradar_refresh_observatoire_snapshot();
