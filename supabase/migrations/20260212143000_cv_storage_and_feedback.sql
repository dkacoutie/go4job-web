-- CV storage + job_feedback nullable feedback + user_cvs file fields
-- Idempotent and safe on existing local DB.

-- 1) job_feedback: allow action-only rows (dismissed)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='job_feedback' and column_name='feedback'
  ) then
    execute 'alter table public.job_feedback alter column feedback drop not null';
  end if;
end $$;

-- 2) user_cvs: file metadata
alter table public.user_cvs
  add column if not exists cv_file_path text,
  add column if not exists cv_file_name text,
  add column if not exists cv_file_type text,
  add column if not exists cv_file_size int,
  add column if not exists cv_updated_at timestamptz;

-- 3) Storage bucket for CVs
insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;
-- 4) Storage RLS policies must be created using supabase_storage_admin (see Phase 6 step)
