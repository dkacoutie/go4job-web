-- Rewrite jobradar_feed_by_alert() so the geographic match is sargable and can use
-- idx_jobs_country_codes_gin, instead of testing country_codes row-by-row via a
-- correlated CTE subplan after fetching ~231k active jobs from the heap.
--
-- Root cause (confirmed via EXPLAIN (ANALYZE, BUFFERS) on 2026-07-07): the original
-- function fetches ALL rows matching `is_active = true` (not selective: ~24% of
-- public.jobs) via jobs_feed_gate_idx, then evaluates the target-country overlap
-- test (`target_countries && country_codes`) once per fetched row through a
-- correlated CTE Scan (loops = 231183). The GIN index on country_codes is never
-- touched, because the `&&` operator is buried inside a per-row CASE expression
-- rather than expressed as a direct WHERE predicate.
--
-- This rewrite keeps the exact same 3 fallback tiers (target country -> Africa ->
-- worldwide), plus the original's implicit 4th tier ("other", geo_rank -1, for
-- jobs that match none of the above) needed for strict output equivalence. Each
-- tier is now a plain WHERE predicate BEFORE scoring, and later tiers are only
-- executed if the earlier ones did not already produce p_limit rows (real
-- short-circuit via PL/pgSQL, not just a query-planner optimization).
--
-- NOT APPLIED to the database and NOT committed by this change — see the
-- accompanying diagnostic (EXPLAIN comparison + result-equivalence check) before
-- running this migration for real.

begin;

create or replace function public.jobradar_feed_by_alert(p_alert_id uuid, p_limit integer default 50)
returns table(id uuid, title text, company_name text, country_codes text[], geo_rank integer, geo_reason text, sort_at timestamptz)
language plpgsql
stable
as $function$
declare
  v_target_countries text[];
  v_target_mode text;
  v_africa_codes text[] := array[
    'DZ','AO','BJ','BW','BF','BI','CM','CV','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET',
    'GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW',
    'ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW'
  ];
  v_remaining integer := p_limit;
  v_emitted integer;
begin
  -- Resolve target countries exactly as before: explicit alert countries > alert.country
  -- > profile.country_code > default West Africa list. Computed once (cheap, index-backed).
  select
    case
      when array_length(coalesce(a.countries, array[]::text[]), 1) is not null then a.countries
      when nullif(a.country, '') is not null then array[upper(a.country)]
      when p.country_code is not null then array[p.country_code]
      else array['CI','GH','NG','SN','ML','BF','BJ','TG','NE','GW','LR','SL','GM','MR','CV']::text[]
    end,
    case
      when array_length(coalesce(a.countries, array[]::text[]), 1) is not null then 'explicit_alert_countries'
      when nullif(a.country, '') is not null then 'alert_country'
      when p.country_code is not null then 'profile_country_code'
      else 'default_ci_west_africa'
    end
  into v_target_countries, v_target_mode
  from public.alerts a
  left join public.profiles p on p.user_id = a.user_id
  where a.id = p_alert_id and a.is_active is true;

  if v_remaining <= 0 then
    return;
  end if;

  -- Branch A: target-country match. Sargable predicate -> planner can use
  -- idx_jobs_country_codes_gin instead of a per-row correlated check.
  return query
    select j.id, j.title, j.company_name, j.country_codes, 4 as geo_rank,
           ('match_' || v_target_mode)::text as geo_reason, j.sort_at
    from public.v_jobs_active j
    where v_target_countries is not null
      and j.country_codes && v_target_countries
    order by j.sort_at desc nulls last
    limit v_remaining;

  get diagnostics v_emitted = row_count;
  v_remaining := v_remaining - v_emitted;
  if v_remaining <= 0 then
    return;
  end if;

  -- Branch B: Africa fallback. Only runs if branch A did not fill p_limit.
  -- Excludes rows already matched (and emitted) in branch A.
  return query
    select j.id, j.title, j.company_name, j.country_codes, 1 as geo_rank,
           'africa_fallback'::text as geo_reason, j.sort_at
    from public.v_jobs_active j
    where j.country_codes && v_africa_codes
      and not coalesce(j.country_codes && v_target_countries, false)
    order by j.sort_at desc nulls last
    limit v_remaining;

  get diagnostics v_emitted = row_count;
  v_remaining := v_remaining - v_emitted;
  if v_remaining <= 0 then
    return;
  end if;

  -- Branch C: worldwide fallback. Only runs if branches A+B did not fill p_limit.
  return query
    select j.id, j.title, j.company_name, j.country_codes, 0 as geo_rank,
           'worldwide'::text as geo_reason, j.sort_at
    from public.v_jobs_active j
    where 'WW' = any(j.country_codes)
      and not coalesce(j.country_codes && v_target_countries, false)
      and not coalesce(j.country_codes && v_africa_codes, false)
    order by j.sort_at desc nulls last
    limit v_remaining;

  get diagnostics v_emitted = row_count;
  v_remaining := v_remaining - v_emitted;
  if v_remaining <= 0 then
    return;
  end if;

  -- Branch D: everything else (geo_rank -1, "other") — kept only for exact parity
  -- with the original function's implicit else branch; only runs if A+B+C were
  -- still not enough to fill p_limit.
  return query
    select j.id, j.title, j.company_name, j.country_codes, -1 as geo_rank,
           'other'::text as geo_reason, j.sort_at
    from public.v_jobs_active j
    where not coalesce(j.country_codes && v_target_countries, false)
      and not coalesce(j.country_codes && v_africa_codes, false)
      and not coalesce('WW' = any(j.country_codes), false)
    order by j.sort_at desc nulls last
    limit v_remaining;
end;
$function$;

commit;
