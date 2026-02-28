insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do update set public = false;

drop policy if exists "cvs_select_own" on storage.objects;
drop policy if exists "cvs_insert_own" on storage.objects;
drop policy if exists "cvs_update_own" on storage.objects;
drop policy if exists "cvs_delete_own" on storage.objects;

create policy "cvs_select_own"
on storage.objects for select
using (
  bucket_id = 'cvs'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "cvs_insert_own"
on storage.objects for insert
with check (
  bucket_id = 'cvs'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "cvs_update_own"
on storage.objects for update
using (
  bucket_id = 'cvs'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'cvs'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy "cvs_delete_own"
on storage.objects for delete
using (
  bucket_id = 'cvs'
  and auth.uid()::text = split_part(name, '/', 1)
);
