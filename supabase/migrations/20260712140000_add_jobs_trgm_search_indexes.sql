-- Fixes the JobRadar feed freeze diagnosed 2026-07-12 (P2).
--
-- Root cause: fetchJobsSearch (src/JobRadarFeedPage.tsx) runs, for every user with a
-- "desired role" set, up to 6 sequential ILIKE OR queries across
-- title/company_name/location/country ("%term%", leading wildcard). None of these
-- columns had a text-search index, so each query was a full filtered scan of the
-- ~1M-row jobs table. Verified via EXPLAIN ANALYZE: a single term ("chef de projet")
-- took 1.44s and read ~65k heap blocks / filtered 209,955 rows. Six such queries in
-- series (plus an observed duplicate-fetch bug on initial load, tracked separately)
-- easily reach the double-digit-second freeze reproduced live on /jobradar/feed.
--
-- Fix: add trigram (pg_trgm) GIN indexes so leading-wildcard ILIKE can use an index
-- scan instead of a full scan. Combined with parallelizing the 6 term queries
-- (front-end change, separate commit), this should bring each query down from
-- ~1.4s to low milliseconds.
--
-- jobs is a 6+ GB, ~1M-row table under continuous write load from ingestion cron
-- jobs. Regular CREATE INDEX takes an ACCESS EXCLUSIVE lock for the whole build
-- (would block cron writes and every feed read for the duration). Using CONCURRENTLY
-- avoids that: it never blocks reads/writes, at the cost of a slower build and two
-- table passes.
--
-- NOTE: every statement below must run outside a transaction block (plain SQL
-- editor / execute_sql, not apply_migration's transactional runner) — CONCURRENTLY
-- requires this, same convention as
-- 20260708100000_drop_duplicate_indexes_concurrently.sql. This file is committed for
-- history/tracking; the actual application happened via direct SQL execution.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS and CREATE INDEX ... IF NOT EXISTS are
-- both safe to re-run.

create extension if not exists pg_trgm;

create index concurrently if not exists jobs_title_trgm_idx
  on public.jobs using gin (title gin_trgm_ops);

create index concurrently if not exists jobs_company_name_trgm_idx
  on public.jobs using gin (company_name gin_trgm_ops);

create index concurrently if not exists jobs_location_trgm_idx
  on public.jobs using gin (location gin_trgm_ops);

create index concurrently if not exists jobs_country_trgm_idx
  on public.jobs using gin (country gin_trgm_ops);
