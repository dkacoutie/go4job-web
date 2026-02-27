-- Add experience_years to profiles (idempotent)

alter table public.profiles
  add column if not exists experience_years int;

