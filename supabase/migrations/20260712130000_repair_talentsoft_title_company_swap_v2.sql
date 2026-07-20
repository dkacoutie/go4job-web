-- Follow-up to 20260712120000_repair_talentsoft_title_company_swap.sql.
--
-- The first pass only targeted the plain "YYYY-NNNNN" reference format
-- (e.g. "2026-24105"). Inspecting more Talentsoft client sites revealed the
-- offer reference scheme is set per client and varies widely: EDF uses
-- "DKA-REC-2026-13293" / "FRA-REC-2026-25692", Coallia uses free-text admin
-- codes like "IAS/HUDA/RENNES/35-11274" or "AT 2 -11044". The ingest code
-- was generalized accordingly (parseTalentsoftTitle now splits on the first
-- " - " regardless of the reference's shape, deployed as version 206) and
-- all 47 active Talentsoft sources were re-scraped, which auto-repaired
-- their ~20 most recent postings each.
--
-- This migration repairs the residual: active, non-expired jobs whose title
-- still has no space (real job titles are virtually always multi-word; a
-- single unbroken token is the signature of a leftover raw reference,
-- whatever its format) and that were not refreshed by the re-scrape because
-- they've scrolled outside their feed's recent window.
--
-- Verified before writing this migration (2026-07-12): 201 such rows exist.
-- Of these, 132 have a usable company_name (the real title: multi-word,
-- >= 8 chars) and are safe to swap. The remaining 69 (mostly already known
-- from the first pass) have a short/single-word company_name -- the real
-- title was itself truncated at ingestion time by the old parser and is not
-- recoverable from this table. This migration intentionally excludes them,
-- same as the first pass.
--
-- Naturally idempotent: once repaired, a row's title has a space and no
-- longer matches this migration's WHERE clause.

update jobs j
set
  title = j.company_name,
  company_name = js.name,
  updated_at = now()
from job_sources js
where js.id = j.job_source_id
  and j.title !~ ' '
  and j.is_active = true
  and j.is_expired = false
  and js.ingest_config->>'feed_url' ~* '/handlers/offerRss\.ashx'
  and j.company_name like '% %'
  and coalesce(length(trim(j.company_name)), 0) >= 8
  and coalesce(length(trim(js.name)), 0) >= 2;
