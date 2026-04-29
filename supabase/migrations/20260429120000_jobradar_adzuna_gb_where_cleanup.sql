begin;

do $$
declare
  v_config jsonb;
  v_segments jsonb;
  v_next_segments jsonb;
  v_runtime_state jsonb;
  v_segment_pages jsonb;
begin
  select ingest_config
    into v_config
  from public.job_sources
  where code = 'adzuna_api'
  for update;

  if v_config is null then
    raise notice 'adzuna_api source not found; skipping GB where cleanup';
    return;
  end if;

  v_segments := v_config -> 'rotation_segments';

  if jsonb_typeof(v_segments) = 'array' then
    select jsonb_agg(
      case coalesce(segment ->> 'key', segment ->> 'segment_key')
        when 'gb_general' then
          segment
          || jsonb_build_object(
            'country', 'gb',
            'params',
              (
                coalesce(segment -> 'params', segment -> 'search_params', '{}'::jsonb)
                - 'where'
                - 'country'
                - 'what'
              )
          )
          - 'default_country'
          - 'search_params'
        when 'gb_developer' then
          segment
          || jsonb_build_object(
            'country', 'gb',
            'params',
              (
                coalesce(segment -> 'params', segment -> 'search_params', '{}'::jsonb)
                - 'where'
                - 'country'
              )
              || jsonb_build_object('what', 'developer')
          )
          - 'default_country'
          - 'search_params'
        when 'gb_data' then
          segment
          || jsonb_build_object(
            'country', 'gb',
            'params',
              (
                coalesce(segment -> 'params', segment -> 'search_params', '{}'::jsonb)
                - 'where'
                - 'country'
              )
              || jsonb_build_object('what', 'data')
          )
          - 'default_country'
          - 'search_params'
        else
          segment
      end
      order by ordinality
    )
      into v_next_segments
    from jsonb_array_elements(v_segments) with ordinality as items(segment, ordinality);
  elsif jsonb_typeof(v_segments) = 'object' then
    select jsonb_object_agg(
      key,
      case key
        when 'gb_general' then
          value
          || jsonb_build_object(
            'country', 'gb',
            'params',
              (
                coalesce(value -> 'params', value -> 'search_params', '{}'::jsonb)
                - 'where'
                - 'country'
                - 'what'
              )
          )
          - 'default_country'
          - 'search_params'
        when 'gb_developer' then
          value
          || jsonb_build_object(
            'country', 'gb',
            'params',
              (
                coalesce(value -> 'params', value -> 'search_params', '{}'::jsonb)
                - 'where'
                - 'country'
              )
              || jsonb_build_object('what', 'developer')
          )
          - 'default_country'
          - 'search_params'
        when 'gb_data' then
          value
          || jsonb_build_object(
            'country', 'gb',
            'params',
              (
                coalesce(value -> 'params', value -> 'search_params', '{}'::jsonb)
                - 'where'
                - 'country'
              )
              || jsonb_build_object('what', 'data')
          )
          - 'default_country'
          - 'search_params'
        else
          value
      end
    )
      into v_next_segments
    from jsonb_each(v_segments);
  else
    raise notice 'adzuna_api has no rotation_segments; keeping existing config';
    v_next_segments := v_segments;
  end if;

  v_runtime_state := coalesce(v_config -> 'runtime_state', '{}'::jsonb);
  v_segment_pages :=
    coalesce(v_runtime_state -> 'segment_pages', '{}'::jsonb)
    - 'gb_general'
    - 'gb_developer'
    - 'gb_data';
  v_runtime_state := jsonb_set(v_runtime_state, '{segment_pages}', v_segment_pages, true);

  update public.job_sources
  set ingest_config =
    jsonb_set(
      jsonb_set(
        v_config
        || jsonb_build_object(
          'staging_only', false,
          'subset_label', 'adzuna_rotation_v2_gb_fix',
          'updated_by_note', 'adzuna_gb_where_cleanup_2026_04_29'
        ),
        '{rotation_segments}',
        coalesce(v_next_segments, v_segments, '[]'::jsonb),
        true
      ),
      '{runtime_state}',
      v_runtime_state,
      true
    )
  where code = 'adzuna_api';
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'disabled_reason'
  ) then
    update public.job_sources
    set disabled_reason = null
    where code = 'adzuna_api';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_sources'
      and column_name = 'disabled_note'
  ) then
    update public.job_sources
    set disabled_note = null
    where code = 'adzuna_api';
  end if;
end
$$;

commit;
