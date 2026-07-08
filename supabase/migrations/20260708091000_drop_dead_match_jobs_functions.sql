-- Drop dead RPC functions: match_jobs, match_jobs_hybrid, match_jobs_hybrid_pct.
-- Confirmed via pg_get_functiondef that they reference columns removed from public.jobs
-- long ago (company, description, req_skills, url — replaced by company_name,
-- description_text/html, required_skills, apply_url/source_url). Confirmed via repo-wide
-- search (frontend + Edge Functions) that none of the three names are called anywhere.

begin;

drop function if exists public.match_jobs(uuid);
drop function if exists public.match_jobs_hybrid(uuid, integer, integer);
drop function if exists public.match_jobs_hybrid_pct(uuid, integer, integer);

commit;
