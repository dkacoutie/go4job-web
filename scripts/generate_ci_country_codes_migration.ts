// Regenerates the CASE block of
// supabase/migrations/20260708120000_backfill_ci_sources_country_codes.sql
// from the single source of truth:
// supabase/functions/ingest_source/_shared/ciGeoGazetteer.ts
// (CI_LOCALITIES, FOREIGN_LOCALITY_TO_ISO, NEVER_GUESS_TERMS).
//
// Run with: deno run --allow-read --allow-write scripts/generate_ci_country_codes_migration.ts
// This only reads the gazetteer module and rewrites the local migration file —
// it does not touch the database and does not execute any SQL.
//
// Do not hand-edit the CASE block in the migration file; edit the gazetteer
// and re-run this script instead, so there is only one place where the
// locality/country lists are maintained.

import {
  CI_LOCALITIES,
  FOREIGN_LOCALITY_TO_ISO,
  NEVER_GUESS_TERMS,
  normalizeSignalText,
} from "../supabase/functions/ingest_source/_shared/ciGeoGazetteer.ts";

const MIGRATION_PATH = new URL(
  "../supabase/migrations/20260708120000_backfill_ci_sources_country_codes.sql",
  import.meta.url,
);

function escapeSqlRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalizes each term the same way the runtime detector normalizes free text
// (normalizeSignalText strips accents and turns apostrophes/hyphens into
// spaces), then de-duplicates and escapes for use inside a SQL regex.
function alternation(terms: string[]): string {
  const normalized = Array.from(
    new Set(terms.map((term) => normalizeSignalText(term)).filter(Boolean)),
  );
  return normalized.map(escapeSqlRegex).join("|");
}

function boundedPattern(terms: string[]): string {
  return `(^|[^a-z0-9])(${alternation(terms)})([^a-z0-9]|$)`;
}

// Group foreign localities by ISO code, preserving first-seen order so the
// generated CASE branches stay in the same order as FOREIGN_LOCALITY_TO_ISO.
const isoOrder: string[] = [];
const localitiesByIso = new Map<string, string[]>();
for (const [locality, iso] of Object.entries(FOREIGN_LOCALITY_TO_ISO)) {
  if (!localitiesByIso.has(iso)) {
    localitiesByIso.set(iso, []);
    isoOrder.push(iso);
  }
  localitiesByIso.get(iso)!.push(locality);
}

const caseLines: string[] = [];
caseLines.push(
  `      when txt ~ '${boundedPattern(NEVER_GUESS_TERMS)}' then null`,
);
caseLines.push(
  "      -- CI signals checked FIRST: a real Abidjan address can incidentally mention",
  '      -- a foreign country name (e.g. "Boulevard du Gabon" in Koumassi); CI-first',
  "      -- avoids misclassifying those as foreign.",
);
caseLines.push(
  `      when txt ~ '${boundedPattern(CI_LOCALITIES)}' then array['CI']`,
);
for (const iso of isoOrder) {
  caseLines.push(
    `      when txt ~ '${boundedPattern(localitiesByIso.get(iso)!)}' then array['${iso}']`,
  );
}
caseLines.push("      else null");

const caseBlock = caseLines.join("\n");

const sql = `-- Backfill jobs.country_codes for the 6 Cote d'Ivoire job boards that never wrote
-- it during ingestion (aej_ci, emploi_ci, emploi_ci__dup__17d5574e, projobivoire_rss,
-- goafricaonline_ci_portal, novojob_portal). Detection is done per-offer from the
-- free-text \`location\` (+ \`country_raw\`), NOT per-source.
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
${caseBlock}
    end as detected_country_codes
  from scope
)
update public.jobs j
set country_codes = c.detected_country_codes
from classified c
where c.id = j.id
  and c.detected_country_codes is not null;

commit;
`;

await Deno.writeTextFile(MIGRATION_PATH, sql);
console.log("Regenerated:", MIGRATION_PATH.pathname);
