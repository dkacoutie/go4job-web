-- Jobs.tags should be text[] (functions write arrays)
-- Safe conversion if tags was text.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'tags'
      and data_type = 'text'
  ) then
    alter table public.jobs
      alter column tags type text[]
      using case
        when tags is null then null
        when tags = '' then '{}'::text[]
        when tags ~ '^{.*}$' then tags::text[]
        else string_to_array(tags, ',')
      end;
  end if;
end $$;
