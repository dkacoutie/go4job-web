import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

const COMPANY_STOP_MARKERS = [
  "Nombre de postes",
  "Experience demandee",
  "Experience demandée",
  "Métier / Fonction",
  "Metier / Fonction",
  "Secteurs d'activite",
  "Secteurs d'activité",
  "Niveau de poste",
  "Lieu de residence",
  "Lieu de résidence",
];

const GENERIC_COMPANY_NAMES = new Set([
  "entreprise",
  "societe",
  "société",
  "confidentiel",
  "non precise",
  "non précisé",
  "n/a",
]);

function cleanCompanyText(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.,;:|\-–—\s]+$/u, "")
    .trim();
}

function normalizedSignal(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractCompanyName(description: string | null | undefined) {
  if (!description) return null;
  const markerMatch = description.match(/\b(?:Entreprise|Soci[eé]t[eé]|Societe)\s*:\s*/iu);
  if (!markerMatch || markerMatch.index === undefined) return null;

  const start = markerMatch.index + markerMatch[0].length;
  let candidate = description.slice(start);
  for (const marker of COMPANY_STOP_MARKERS) {
    const markerIndex = normalizedSignal(candidate).indexOf(normalizedSignal(marker));
    if (markerIndex >= 0) {
      candidate = candidate.slice(0, markerIndex);
    }
  }

  const companyName = cleanCompanyText(candidate);
  if (!companyName) return null;
  if (companyName.length < 2 || companyName.length > 120) return null;
  if (GENERIC_COMPANY_NAMES.has(normalizedSignal(companyName))) return null;
  return companyName;
}

function improveNovojob(job: CommercialSourceJob): CommercialSourceJob {
  const url = job.source_url.toLowerCase();
  const country = url.includes("/cote-d-ivoire/")
    ? "Cote d'Ivoire"
    : url.includes("/senegal/")
    ? "Senegal"
    : url.includes("/benin/")
    ? "Benin"
    : url.includes("/togo/")
    ? "Togo"
    : url.includes("/burkina-faso/")
    ? "Burkina Faso"
    : url.includes("/guinee/")
    ? "Guinea"
    : job.country;
  const companyName = job.company_name || extractCompanyName(job.description_text);
  return {
    ...job,
    company_name: companyName,
    country,
    location: country,
    tags: [country ?? "Unknown", "novojob_portal"],
  };
}

export async function fetchNovojobPortalItems(options?: { limit?: number }) {
  const baseUrl = "https://www.novojob.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "novojob_portal",
    sourceFamily: "novojob_portal",
    baseUrl,
    country: "West Africa Francophone",
    maxItems: options?.limit ?? 50,
    feedUrls: [
      `${baseUrl}/feed`,
      `${baseUrl}/rss`,
      `${baseUrl}/rss.xml`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
    startUrls: [`${baseUrl}/offres-emploi`, `${baseUrl}/jobs`],
    linkInclude: "novojob.com",
    jobUrlIncludes: ["/offre-d-emploi/"],
    excludeUrlIncludes: ["/entreprises/", "/candidats/", "/conseils/"],
    postProcessJob: improveNovojob,
    stoppedReasonWhenEmpty: "js_rendered_or_specific_parser_required",
  });
}
