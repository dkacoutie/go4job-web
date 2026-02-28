alter table public.profiles
  add column if not exists cv_file_path text,
  add column if not exists cv_filename text,
  add column if not exists cv_updated_at timestamptz;
