// Gazetteer used to detect a country from free-text `location` (or `country_raw`)
// for job postings coming from Cote d'Ivoire job boards that don't provide a
// structured country field (aej_ci, emploi_ci, emploi_ci__dup__17d5574e,
// projobivoire_rss, goafricaonline_ci_portal, novojob_portal).
//
// Provenance: CI_LOCALITIES is seeded from (a) the actual `location` values observed
// in production for these 6 sources (audit 2026-07-08) and (b) well-known Cote
// d'Ivoire commune/sous-prefecture names. It is NOT a claimed-exhaustive official
// INS list — extend it as new localities show up in future ingestion runs.
//
// Matching rule (see detectCountryCodesFromText): CI locality signals are checked
// BEFORE foreign country/city signals. This matters because some real Abidjan
// addresses mention a foreign country name incidentally (e.g. a street named
// "Boulevard du Gabon" in Koumassi) — checking CI first avoids misclassifying
// those as foreign.

export const NEVER_GUESS_TERMS = [
  "international",
  "afrique de l'est",
  "afrique de lest",
  "afrique centrale",
  "afrique de l'ouest",
  "afrique de louest",
  "ocean indien",
  "remote",
  "non precise",
  "non specifie",
];

// Foreign city/country signal -> ISO 3166-1 alpha-2 code.
// Order does not matter (all foreign signals are checked after CI signals).
export const FOREIGN_LOCALITY_TO_ISO: Record<string, string> = {
  "dakar": "SN",
  "senegal": "SN",
  "accra": "GH",
  "ghana": "GH",
  "lagos": "NG",
  "nigeria": "NG",
  "lome": "TG",
  "togo": "TG",
  "cotonou": "BJ",
  "benin": "BJ",
  "bamako": "ML",
  "mali": "ML",
  "ouagadougou": "BF",
  "burkina faso": "BF",
  "burkina": "BF",
  "douala": "CM",
  "yaounde": "CM",
  "cameroun": "CM",
  "cameroon": "CM",
  "conakry": "GN",
  "guinee": "GN",
  "guinea": "GN",
  "nouakchott": "MR",
  "mauritanie": "MR",
  "niamey": "NE",
  "kinshasa": "CD",
  "rdc": "CD",
  "nairobi": "KE",
  "kenya": "KE",
  "casablanca": "MA",
  "rabat": "MA",
  "maroc": "MA",
  "le caire": "EG",
  "caire": "EG",
  "egypte": "EG",
  "tunis": "TN",
  "tunisie": "TN",
  "alger": "DZ",
  "algerie": "DZ",
  "kigali": "RW",
  "rwanda": "RW",
  "libreville": "GA",
  "gabon": "GA",
  "port louis": "MU",
  "ile maurice": "MU",
  "maurice": "MU",
  "johannesburg": "ZA",
  "le cap": "ZA",
  "afrique du sud": "ZA",
  "tchad": "TD",
  "congo": "CG",
};

// Cote d'Ivoire locality / commune / sous-prefecture signals (non-exhaustive, see header).
export const CI_LOCALITIES: string[] = [
  "cote d'ivoire",
  "cote divoire",
  "abengourou",
  "aboisso",
  "abidjan",
  "abobo",
  "adiake",
  "adjame",
  "adzope",
  "affery",
  "agboville",
  "alepe",
  "angre",
  "anyama",
  "arrah",
  "attecoube",
  "ayame",
  "azaguie",
  "bako",
  "bangolo",
  "beoumi",
  "bettie",
  "biankouma",
  "bingerville",
  "blolequin",
  "bocanda",
  "bondoukou",
  "bongouanou",
  "bonon",
  "bonoua",
  "booko",
  "botro",
  "bouafle",
  "bouake",
  "bouna",
  "boundiali",
  "buyo",
  "cocody",
  "dabakala",
  "dabou",
  "daloa",
  "danane",
  "daoukro",
  "didievi",
  "dimbokro",
  "divo",
  "duekoue",
  "ferkessedougou",
  "gagnoa",
  "grand bassam",
  "grand-bassam",
  "grand lahou",
  "grand-lahou",
  "grand-zattry",
  "gueyo",
  "guiberoua",
  "guiglo",
  "guitry",
  "hire",
  "issia",
  "jacqueville",
  "kani",
  "kassere",
  "katiola",
  "koni",
  "kong",
  "korhogo",
  "koumassi",
  "kouto",
  "lakota",
  "logouale",
  "mankono",
  "man",
  "marcory",
  "meagui",
  "minignan",
  "niakara",
  "niakaramandougou",
  "odienne",
  "ouangolodougou",
  "plateau",
  "port bouet",
  "port-bouet",
  "prikro",
  "riviera",
  "rubino",
  "sakassou",
  "san pedro",
  "san-pedro",
  "sassandra",
  "seguela",
  "sikensi",
  "sinfra",
  "sirasso",
  "soubre",
  "songon",
  "tabou",
  "taabo",
  "tengrela",
  "tiassale",
  "tiebissou",
  "toulepleu",
  "toumodi",
  "touba",
  "treichville",
  "vavoua",
  "yamoussoukro",
  "yopougon",
  "zouan-hounien",
  "zouan hounien",
  "zuenoula",
];

export function normalizeSignalText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsSignal(normalizedText: string, signal: string): boolean {
  const normalizedSignal = normalizeSignalText(signal);
  if (!normalizedSignal) return false;
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedSignal)}([^a-z0-9]|$)`,
    "i",
  );
  return pattern.test(normalizedText);
}

/**
 * Detects an ISO 3166-1 alpha-2 country code array from free-text location
 * (and/or a secondary text such as country_raw or description). Returns:
 *   - null if the text is empty, or matches a "never guess" term (leave
 *     country_codes untouched in that case)
 *   - ["CI"] if a Cote d'Ivoire locality signal is found (checked first)
 *   - [ISO] if a recognizable foreign city/country signal is found
 *   - null if nothing matches (ambiguous - leave country_codes untouched)
 */
export function detectCountryCodesFromText(
  ...texts: Array<string | null | undefined>
): string[] | null {
  const normalizedText = normalizeSignalText(texts.filter(Boolean).join(" "));
  if (!normalizedText) return null;

  for (const term of NEVER_GUESS_TERMS) {
    if (containsSignal(normalizedText, term)) return null;
  }

  for (const locality of CI_LOCALITIES) {
    if (containsSignal(normalizedText, locality)) return ["CI"];
  }

  for (const [locality, iso] of Object.entries(FOREIGN_LOCALITY_TO_ISO)) {
    if (containsSignal(normalizedText, locality)) return [iso];
  }

  return null;
}
