-- ROLLBACK for migration 20260707150000_jobradar_feed_by_alert_sargable_country_match.sql
--
-- This restores public.jobradar_feed_by_alert() to the exact definition captured via
-- pg_get_functiondef('public.jobradar_feed_by_alert(uuid, integer)'::regprocedure) on
-- 2026-07-07, immediately before the sargable-country-match rewrite was applied.
--
-- Use this ONLY if a problem is observed after applying migration 20260707150000
-- (wrong/missing results, errors, unexpected performance regression, etc.).
-- Not applied and not committed by this change — kept as a standby file.
--
-- To use: run this file's CREATE OR REPLACE FUNCTION statement against the database
-- (e.g. via the Supabase SQL editor or psql). It fully supersedes the rewritten
-- version since both share the same signature (p_alert_id uuid, p_limit integer).

begin;

CREATE OR REPLACE FUNCTION public.jobradar_feed_by_alert(p_alert_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, title text, company_name text, country_codes text[], geo_rank integer, geo_reason text, sort_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  with africa as (
    select unnest(array[
      'DZ','AO','BJ','BW','BF','BI','CM','CV','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET',
      'GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW',
      'ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW'
    ]) as code
  ),
  al as (
    select id, user_id, upper(nullif(country,'')) as country_one, coalesce(countries, array[]::text[]) as countries_arr
    from public.alerts
    where id = p_alert_id and is_active is true
  ),
  pr as (
    select p.country_code
    from public.profiles p
    join al on al.user_id = p.user_id
  ),
  target as (
    select
      al.*,
      case
        when array_length(al.countries_arr,1) is not null then al.countries_arr
        when al.country_one is not null then array[al.country_one]
        when (select country_code from pr) is not null then array[(select country_code from pr)]
        else array['CI','GH','NG','SN','ML','BF','BJ','TG','NE','GW','LR','SL','GM','MR','CV']::text[]
      end as target_countries,
      case
        when array_length(al.countries_arr,1) is not null then 'explicit_alert_countries'
        when al.country_one is not null then 'alert_country'
        when (select country_code from pr) is not null then 'profile_country_code'
        else 'default_ci_west_africa'
      end as target_mode
    from al
  ),
  scored as (
    select
      j.id, j.title, j.company_name, j.country_codes, j.sort_at,
      case
        when (select t.target_countries && j.country_codes from target t) then 4
        when exists (select 1 from africa af where af.code = any(j.country_codes)) then 1
        when 'WW' = any(j.country_codes) then 0
        else -1
      end as geo_rank,
      case
        when (select t.target_countries && j.country_codes from target t) then 'match_' || (select target_mode from target)
        when exists (select 1 from africa af where af.code = any(j.country_codes)) then 'africa_fallback'
        when 'WW' = any(j.country_codes) then 'worldwide'
        else 'other'
      end as geo_reason
    from public.v_jobs_active j
  )
  select id, title, company_name, country_codes, geo_rank, geo_reason, sort_at
  from scored
  order by geo_rank desc, sort_at desc nulls last
  limit p_limit;
$function$;

commit;
