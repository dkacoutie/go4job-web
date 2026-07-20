-- Repair jobs whose title/company_name were swapped by a Talentsoft RSS
-- parsing bug (see supabase/functions/ingest_source/index.ts:
-- parseTitleCompany vs the new parseTalentsoftTitle/isTalentsoftFeed).
--
-- Talentsoft feeds (Air France, EDF, MAIF, ALTEN, and ~50 other active
-- sources) publish <title>{offerReference} - {job title}</title>, e.g.
-- "2026-24105 - Technicien Metrologue F/H". The old parser read the
-- reference as the job title and the real title as the company name.
--
-- Verified before writing this migration (2026-07-12): 964 active, non-
-- expired jobs match this pattern, all from sources whose feed_url uses the
-- Talentsoft "/handlers/offerRss.ashx" handler. A code fix + re-scrape of
-- all 47 active Talentsoft sources ran first and corrected ~900 recent
-- postings automatically (these feeds only expose their ~20 most recent
-- offers, so older still-active rows were never touched by the re-scrape
-- and need this repair instead). The residual is still 964: re-scraping had
-- zero effect on it, confirming these rows are outside the feeds' window.
--
-- Of these 964, 909 have a usable company_name (the real title: multi-word,
-- >= 8 chars) and job_sources.name (the real company) and are safe to swap.
-- The remaining 55 have a single-word/short company_name (e.g. "Alternance",
-- "Stage", "TRACFIN") -- a separate, worse symptom of the same historical
-- bug: when the real title itself contained a 2nd " - ", the OLD parser
-- truncated it at ingestion time, so the original full title is not
-- recoverable from this table at all. Swapping those would just move a
-- fragment into the title field, not fix it. This migration intentionally
-- excludes them; they stay as-is until they either scroll back into a
-- Talentsoft feed's recent window (auto-repaired by the fixed ingester) or
-- expire naturally.
--
-- This UPDATE is naturally idempotent: once a row is repaired, its title no
-- longer matches the reference pattern, so re-running this migration is a
-- no-op on already-fixed rows.

update jobs j
set
  title = j.company_name,
  company_name = js.name,
  updated_at = now()
from job_sources js
where js.id = j.job_source_id
  and j.title ~ '^[0-9]{4}-[0-9]+$'
  and j.is_active = true
  and j.is_expired = false
  and js.ingest_config->>'feed_url' ~* '/handlers/offerRss\.ashx'
  and j.company_name like '% %'
  and coalesce(length(trim(j.company_name)), 0) >= 8
  and coalesce(length(trim(js.name)), 0) >= 2;
