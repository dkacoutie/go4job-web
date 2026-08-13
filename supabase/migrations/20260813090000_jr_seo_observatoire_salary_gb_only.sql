-- JR-SEO : Observatoire -- restreint le calcul du salaire median a GB.
--
-- Verifie apres coup (13/08/2026) : le premier calcul du snapshot donnait un
-- salaire "median" France de 5 000 - 11 000 EUR, implausible pour un salaire
-- annuel (SMIC annuel ~21 600 EUR). Echantillon direct de jobs.salary_min /
-- salary_max sur des offres France : melange incoherent d'unites selon la
-- source -- taux horaire d'agences interim (12, 13, 15 EUR), salaire mensuel
-- (4 305 EUR, Carrefour), salaire annuel (20 000 a 276 000 EUR) -- sans que
-- jobs.salary_period permette de distinguer (100% NULL sur les lignes
-- concernees, verifie). Publier une mediane sur ce melange serait un chiffre
-- faux affiche publiquement -- pire que ne rien publier.
--
-- Royaume-Uni ne presente pas ce probleme : mediane 37 204 - 40 000 GBP,
-- coherent avec un salaire annuel plein temps reel au UK, source homogene.
-- Etats-Unis et Cote d'Ivoire restent a 0% de couverture salariale (verifie
-- le 13/08/2026), donc deja sans salary_stats.
--
-- Tant que jobs.salary_period n'est pas fiabilise a la source pour la France
-- (chantier ingestion, hors perimetre SEO), le salaire median France reste
-- desactive ici plutot que d'etre approxime.

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
      -- Restreint a GB : voir commentaire en tete de la migration
      -- 20260813090000 (donnees France non fiables faute de salary_period).
      case when m.market_key = 'GB'
             and (select count(*) from base where salary_min is not null or salary_max is not null) >= 200 then
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

-- Recalcule immediatement pour corriger le snapshot France deja stocke.
select public.jobradar_refresh_observatoire_snapshot();
