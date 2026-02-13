-- Storage RLS policies for CVs bucket (idempotent).
-- Safe for local/prod: if lacking privileges, it will not fail the migration.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='cvs_select_own'
  ) then
    execute 'create policy "cvs_select_own" on storage.objects
      for select using (bucket_id = ''cvs'' and owner = auth.uid())';
  end if;
exception
  when insufficient_privilege or undefined_function then
    raise notice 'Skipping cvs_select_own policy (insufficient privileges or auth.uid missing).';
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='cvs_insert_own'
  ) then
    execute 'create policy "cvs_insert_own" on storage.objects
      for insert with check (bucket_id = ''cvs'' and owner = auth.uid())';
  end if;
exception
  when insufficient_privilege or undefined_function then
    raise notice 'Skipping cvs_insert_own policy (insufficient privileges or auth.uid missing).';
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='cvs_update_own'
  ) then
    execute 'create policy "cvs_update_own" on storage.objects
      for update using (bucket_id = ''cvs'' and owner = auth.uid())
      with check (bucket_id = ''cvs'' and owner = auth.uid())';
  end if;
exception
  when insufficient_privilege or undefined_function then
    raise notice 'Skipping cvs_update_own policy (insufficient privileges or auth.uid missing).';
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='cvs_delete_own'
  ) then
    execute 'create policy "cvs_delete_own" on storage.objects
      for delete using (bucket_id = ''cvs'' and owner = auth.uid())';
  end if;
exception
  when insufficient_privilege or undefined_function then
    raise notice 'Skipping cvs_delete_own policy (insufficient privileges or auth.uid missing).';
end $$;
