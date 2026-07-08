-- Drop exact duplicate indexes identified by the index audit (2026-07-07/08).
-- Uses CONCURRENTLY even though DROP INDEX itself is near-instant regardless of table
-- size (it only removes catalog/file entries, no table scan) — jobs and job_source_runs
-- are continuously written by the ingestion cron jobs, so this avoids any brief
-- ACCESS EXCLUSIVE lock queueing behind/blocking concurrent inserts.
--
-- NOTE: run each statement outside of any transaction block (plain psql/SQL editor,
-- not wrapped in BEGIN/COMMIT) — CONCURRENTLY requires this.
--
-- jobs: keep jobs_job_source_id_external_id_key (backed by the actual UNIQUE CONSTRAINT).
-- Not touched: jobs_unique_source_external_id — it has a partial WHERE clause, so it is
-- NOT a strict duplicate of the others; left for a separate decision.
drop index concurrently if exists public.jobs_job_source_external_id_ux;
drop index concurrently if exists public.jobs_source_external_uidx;
drop index concurrently if exists public.jobs_source_external_unique;

-- job_source_runs: keep job_source_runs_source_started_idx (from the original migration).
drop index concurrently if exists public.idx_job_source_runs_source_time;
drop index concurrently if exists public.job_source_runs_source_time_idx;
