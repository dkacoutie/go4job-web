-- Backfill jobs.country_codes for the 6 Cote d'Ivoire job boards that never wrote
-- it during ingestion (aej_ci, emploi_ci, emploi_ci__dup__17d5574e, projobivoire_rss,
-- goafricaonline_ci_portal, novojob_portal). Detection is done per-offer from the
-- free-text `location` (+ `country_raw`), NOT per-source.
--
-- GENERATED FILE: the CASE block below is generated from the single source of
-- truth supabase/functions/ingest_source/_shared/ciGeoGazetteer.ts
-- (CI_LOCALITIES, FOREIGN_LOCALITY_TO_ISO, NEVER_GUESS_TERMS) by
-- scripts/generate_ci_country_codes_migration.ts. Do not hand-edit the CASE
-- block below — edit the gazetteer and re-run the generator instead.
--
-- Safety: only touches rows where country_codes IS currently NULL/empty (never
-- overwrites an existing value) AND job_source_id belongs to one of the 6 codes
-- above. Rows matching a "never guess" term (International, Afrique de l'Est,
-- Remote, etc.) or matching neither a CI locality nor a recognizable foreign
-- city/country are left untouched (ambiguous).
--
-- Dry-run result (read-only, executed via postgres-audit on 2026-07-08) against
-- this exact logic, scoped to the 8178 rows with country_codes IS NULL across the
-- 6 sources:
--   CI          7722
--   UNMATCHED    367  (left untouched by this migration)
--   NEVER_GUESS   80  (left untouched by this migration)
--   MR             2
--   GA             2
--   TD             1
--   MU             1
--   ZA             1
--   RW             1
--   MA             1
--
-- NOT APPLIED to the database and NOT committed by this change.

begin;

with scope as (
  select j.id,
    regexp_replace(
      public.unaccent(lower(coalesce(j.location, '') || ' ' || coalesce(j.country_raw, ''))),
      '[''’-]', ' ', 'g'
    ) as txt
  from public.jobs j
  join public.job_sources js on js.id = j.job_source_id
  where js.code in (
    'emploi_ci', 'aej_ci', 'emploi_ci__dup__17d5574e',
    'projobivoire_rss', 'goafricaonline_ci_portal', 'novojob_portal'
  )
    and (j.country_codes is null or array_length(j.country_codes, 1) is null)
),
classified as (
  select id,
    case
      when txt ~ '(^|[^a-z0-9])(international|afrique de l est|afrique de lest|afrique centrale|afrique de l ouest|afrique de louest|ocean indien|remote|non precise|non specifie)([^a-z0-9]|$)' then null
      -- CI signals checked FIRST: a real Abidjan address can incidentally mention
      -- a foreign country name (e.g. "Boulevard du Gabon" in Koumassi); CI-first
      -- avoids misclassifying those as foreign.
      when txt ~ '(^|[^a-z0-9])(cote d ivoire|cote divoire|abengourou|aboisso|abidjan|abobo|adiake|adjame|adzope|affery|agboville|alepe|angre|anyama|arrah|attecoube|ayame|azaguie|bako|bangolo|beoumi|bettie|biankouma|bingerville|blolequin|bocanda|bondoukou|bongouanou|bonon|bonoua|booko|botro|bouafle|bouake|bouna|boundiali|buyo|cocody|dabakala|dabou|daloa|danane|daoukro|didievi|dimbokro|divo|duekoue|ferkessedougou|gagnoa|grand bassam|grand lahou|grand zattry|gueyo|guiberoua|guiglo|guitry|hire|issia|jacqueville|kani|kassere|katiola|koni|kong|korhogo|koumassi|kouto|lakota|logouale|mankono|man|marcory|meagui|minignan|niakara|niakaramandougou|odienne|ouangolodougou|plateau|port bouet|prikro|riviera|rubino|sakassou|san pedro|sassandra|seguela|sikensi|sinfra|sirasso|soubre|songon|tabou|taabo|tengrela|tiassale|tiebissou|toulepleu|toumodi|touba|treichville|vavoua|yamoussoukro|yopougon|zouan hounien|zuenoula)([^a-z0-9]|$)' then array['CI']
      when txt ~ '(^|[^a-z0-9])(dakar|senegal)([^a-z0-9]|$)' then array['SN']
      when txt ~ '(^|[^a-z0-9])(accra|ghana)([^a-z0-9]|$)' then array['GH']
      when txt ~ '(^|[^a-z0-9])(lagos|nigeria)([^a-z0-9]|$)' then array['NG']
      when txt ~ '(^|[^a-z0-9])(lome|togo)([^a-z0-9]|$)' then array['TG']
      when txt ~ '(^|[^a-z0-9])(cotonou|benin)([^a-z0-9]|$)' then array['BJ']
      when txt ~ '(^|[^a-z0-9])(bamako|mali)([^a-z0-9]|$)' then array['ML']
      when txt ~ '(^|[^a-z0-9])(ouagadougou|burkina faso|burkina)([^a-z0-9]|$)' then array['BF']
      when txt ~ '(^|[^a-z0-9])(douala|yaounde|cameroun|cameroon)([^a-z0-9]|$)' then array['CM']
      when txt ~ '(^|[^a-z0-9])(conakry|guinee|guinea)([^a-z0-9]|$)' then array['GN']
      when txt ~ '(^|[^a-z0-9])(nouakchott|mauritanie)([^a-z0-9]|$)' then array['MR']
      when txt ~ '(^|[^a-z0-9])(niamey)([^a-z0-9]|$)' then array['NE']
      when txt ~ '(^|[^a-z0-9])(kinshasa|rdc)([^a-z0-9]|$)' then array['CD']
      when txt ~ '(^|[^a-z0-9])(nairobi|kenya)([^a-z0-9]|$)' then array['KE']
      when txt ~ '(^|[^a-z0-9])(casablanca|rabat|maroc)([^a-z0-9]|$)' then array['MA']
      when txt ~ '(^|[^a-z0-9])(le caire|caire|egypte)([^a-z0-9]|$)' then array['EG']
      when txt ~ '(^|[^a-z0-9])(tunis|tunisie)([^a-z0-9]|$)' then array['TN']
      when txt ~ '(^|[^a-z0-9])(alger|algerie)([^a-z0-9]|$)' then array['DZ']
      when txt ~ '(^|[^a-z0-9])(kigali|rwanda)([^a-z0-9]|$)' then array['RW']
      when txt ~ '(^|[^a-z0-9])(libreville|gabon)([^a-z0-9]|$)' then array['GA']
      when txt ~ '(^|[^a-z0-9])(port louis|ile maurice|maurice)([^a-z0-9]|$)' then array['MU']
      when txt ~ '(^|[^a-z0-9])(johannesburg|le cap|afrique du sud)([^a-z0-9]|$)' then array['ZA']
      when txt ~ '(^|[^a-z0-9])(tchad)([^a-z0-9]|$)' then array['TD']
      when txt ~ '(^|[^a-z0-9])(congo)([^a-z0-9]|$)' then array['CG']
      else null
    end as detected_country_codes
  from scope
)
update public.jobs j
set country_codes = c.detected_country_codes
from classified c
where c.id = j.id
  and c.detected_country_codes is not null;

commit;
