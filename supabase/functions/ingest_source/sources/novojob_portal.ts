import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

const COMPANY_STOP_MARKERS = [
  "Nombre de postes",
  "Experience demandee",
  "Metier / Fonction",
  "Secteurs d'activite",
  "Niveau de poste",
  "Lieu de residence",
];

const GENERIC_COMPANY_NAMES = new Set([
  "entreprise",
  "societe",
  "confidentiel",
  "non precise",
  "n/a",
]);

const GENERIC_TITLES = new Set([
  "emploi",
  "emplois",
  "offre",
  "offres",
  "offres emploi",
  "offres d'emploi",
  "postuler",
  "apply now",
  "share",
  "facebook",
  "twitter",
  "linkedin",
  "whatsapp",
]);

const SOCIAL_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "whatsapp.com",
  "wa.me",
];

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
    .replace(/[.,;:|\-\u2013\u2014\s]+$/u, "")
    .trim();
}

function normalizedSignal(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isSocialUrl(rawUrl: string) {
  const lowerUrl = rawUrl.toLowerCase();
  if (/(sharer\.php|\/share\b|share=|whatsapp|linkedin|facebook|twitter)/i.test(lowerUrl)) {
    return true;
  }
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return SOCIAL_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function normalizeNovojobUrl(rawUrl: string | null | undefined) {
  const value = String(rawUrl ?? "").trim();
  if (!value || isSocialUrl(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "novojob.com") return null;
    if (!/\/offres-d-emploi\/offre-d-emploi\/[^/]+\/(?:[^/]+\/)?\d+-[^/]+$/i.test(pathname)) {
      return null;
    }
    return `https://www.novojob.com${pathname}`;
  } catch {
    return null;
  }
}

function isNavigationUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "novojob.com") return false;
    return pathname === "/offres-emploi" || pathname.endsWith("/offres-emploi") ||
      pathname === "/jobs" || pathname.includes("/entreprises") ||
      pathname.includes("/candidats") || pathname.includes("/conseils");
  } catch {
    return false;
  }
}

function isGenericTitle(title: string) {
  const normalized = normalizedSignal(title);
  return normalized.length < 5 || GENERIC_TITLES.has(normalized);
}

function extractCompanyName(description: string | null | undefined) {
  if (!description) return null;
  const markerMatch = description.match(/\b(?:Entreprise|Soci[e\u00e9]t[e\u00e9]|Societe)\s*:\s*/iu);
  if (!markerMatch || markerMatch.index === undefined) return null;

  const start = markerMatch.index + markerMatch[0].length;
  let candidate = description.slice(start);
  const normalizedCandidate = normalizedSignal(candidate);
  for (const marker of COMPANY_STOP_MARKERS) {
    const markerIndex = normalizedCandidate.indexOf(normalizedSignal(marker));
    if (markerIndex >= 0) {
      candidate = candidate.slice(0, markerIndex);
      break;
    }
  }

  const companyName = cleanCompanyText(candidate);
  if (!companyName) return null;
  if (companyName.length < 2 || companyName.length > 120) return null;
  if (GENERIC_COMPANY_NAMES.has(normalizedSignal(companyName))) return null;
  return companyName;
}

function improveNovojob(job: CommercialSourceJob): CommercialSourceJob {
  const normalizedUrl = normalizeNovojobUrl(job.source_url);
  const baseJob = normalizedUrl
    ? {
      ...job,
      external_id: `novojob_portal:${normalizedUrl}`,
      source_url: normalizedUrl,
      apply_url: normalizedUrl,
    }
    : job;
  const url = baseJob.source_url.toLowerCase();
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
    : baseJob.country;
  const companyName = baseJob.company_name || extractCompanyName(baseJob.description_text);
  return {
    ...baseJob,
    company_name: companyName,
    country,
    location: country,
    tags: [country ?? "Unknown", "novojob_portal"],
  };
}

function rejectNovojob(job: CommercialSourceJob) {
  if (!job.source_url || isSocialUrl(job.source_url)) {
    return "rejected_social_url_count";
  }
  if (isNavigationUrl(job.source_url) || isGenericTitle(job.title)) {
    return "rejected_navigation_url_count";
  }
  if (!normalizeNovojobUrl(job.source_url)) {
    return "rejected_invalid_job_url_count";
  }
  if (!job.company_name?.trim() || GENERIC_COMPANY_NAMES.has(normalizedSignal(job.company_name))) {
    return "rejected_missing_company_count";
  }
  if (!job.country || job.country === "West Africa Francophone") {
    return "rejected_invalid_job_url_count";
  }
  return null;
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
      `${baseUrl}/cote-d-ivoire/rss`,
      `${baseUrl}/cote-d-ivoire/feed`,
      `${baseUrl}/feed`,
      `${baseUrl}/rss`,
      `${baseUrl}/rss.xml`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
    startUrls: [
      `${baseUrl}/cote-d-ivoire/offres-emploi`,
      `${baseUrl}/offres-emploi`,
      `${baseUrl}/jobs`,
    ],
    maxPages: 3,
    linkInclude: "novojob.com",
    jobUrlIncludes: ["/offre-d-emploi/"],
    excludeUrlIncludes: ["/entreprises/", "/candidats/", "/conseils/"],
    postProcessJob: improveNovojob,
    rejectJobReason: rejectNovojob,
    stoppedReasonWhenEmpty: "novojob_requires_specific_static_endpoint",
  });
}
