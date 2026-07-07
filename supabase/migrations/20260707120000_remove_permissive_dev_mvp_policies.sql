-- Remove leftover permissive RLS policies that are not used by any current code path.
-- "dev all" on profiles and the "... for MVP" policies on radar_prefs allow any
-- authenticated (and, for radar_prefs, anon) request to read/write rows regardless
-- of ownership. Code audit (2026-07-07) confirmed: every profiles access in the
-- frontend and Edge Functions is scoped by user_id (or runs under service_role,
-- which bypasses RLS anyway), and radar_prefs has zero references in the codebase
-- (legacy MVP table, data present only in an old SQL dump).

begin;

drop policy if exists "dev all" on public.profiles;

drop policy if exists "anyone can insert radar prefs for MVP" on public.radar_prefs;
drop policy if exists "anyone can select radar prefs for MVP" on public.radar_prefs;
drop policy if exists "anyone can update radar prefs for MVP" on public.radar_prefs;

commit;
