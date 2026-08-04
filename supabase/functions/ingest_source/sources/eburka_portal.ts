import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

// EBURKA JOB (job.eburka-ci.net) — petit job board WordPress, Côte d'Ivoire
// uniquement (Abidjan et villes de l'intérieur constaté sur les offres
// examinées). Audité le 30/07/2026 : 50 offres actives, 8 pages, la plus
// ancienne datée d'environ 9 mois. robots.txt permissif, sitemap déclaré.
//
// /feed et /emploi/feed répondent en application/rss+xml (vérifié) mais,
// contrairement à l'hypothèse de départ, ne renvoient aucune offre exploitable
// (confirmé au dry-run réel du 30/07/2026 : "no_static_job_markers"). C'est le
// listing HTML (/emploi/, pages 2 à 5) qui fournit les offres via le repli
// générique du cadre commun fetchCommercialSourceDryRun. Même construction
// que jobwebghana_portal.ts ; les URLs de flux sont conservées au cas où le
// site change de gabarit.
//
// Le listing HTML ne fournit ni description ni extrait par offre, donc le
// nom d'entreprise ne peut pas être lu dans une description (toujours null).
// Il est reconstruit depuis le slug de l'URL (voir extractEburkaCompanyFromSlug
// plus bas), confirmé fonctionnel sur l'échantillon du 30/07/2026.

const GENERIC_TITLES = new Set([
  "offres",
  "offres d'emploi",
  "offre d'emploi",
  "emploi",
  "recruteurs",
  "contacts",
  "facebook",
  "linkedin",
  "share",
  "apply now",
]);

const SOCIAL_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "whatsapp.com",
  "wa.me",
];

function normalizeSignal(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function normalizeEburkaJobUrl(rawUrl: string | null | undefined) {
  const value = String(rawUrl ?? "").trim();
  if (!value || isSocialUrl(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "job.eburka-ci.net") return null;
    // Les fiches offre suivent /job/<slug>/, jamais /job-type/, /employer/ ni /emploi/.
    if (!/^\/job\/[a-z0-9][a-z0-9-]*$/i.test(pathname)) return null;
    return `https://job.eburka-ci.net${pathname}`;
  } catch {
    return null;
  }
}

function isNavigationUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "job.eburka-ci.net") return false;
    return pathname === "/emploi" || pathname.startsWith("/emploi/page/") ||
      pathname.startsWith("/job-type/") || pathname.startsWith("/employer/") ||
      pathname.startsWith("/recruteur/") || pathname.startsWith("/contact/") ||
      pathname.startsWith("/login-register/") || pathname.startsWith("/messages/");
  } catch {
    return false;
  }
}

function isGenericTitle(title: string) {
  const normalized = normalizeSignal(title);
  return normalized.length < 3 || GENERIC_TITLES.has(normalized);
}

// Premier dry-run réel du 30/07/2026 : le listing HTML (seule source
// exploitable, les flux RSS ne renvoient aucune offre statique detectable)
// ne fournit ni description ni extrait, donc la fonction ci-dessous ne
// trouve jamais rien en pratique. Conservee en repli au cas ou un futur
// changement de gabarit WordPress ajouterait un extrait au flux.
function extractEburkaCompanyName(description: string | null | undefined) {
  if (!description) return null;
  const patterns = [
    /\bPar\s+([A-ZÀ-Ü][^.\n]{1,80}?)(?:\s+(?:dans|à|posté)\b|$)/u,
    /\b(?:Entreprise|Soci[ée]t[ée])\s*:\s*([^.\n]{1,80})/iu,
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1].trim();
      if (cleaned.length >= 2 && cleaned.length <= 120) return cleaned;
    }
  }
  return null;
}

// Best-effort : le slug des fiches offre suit <employeur>-<bloc-numerique>-
// <titre-poste>, ou le bloc numerique (au moins deux segments chiffres
// consecutifs separes par des tirets, ex. "49-721-616") separe l'employeur
// du titre. Confirme sur l'echantillon du dry-run reel du 30/07/2026 :
// eburka-conseils-49-721-616-manager-..., cabinet-eburka-conseils-49-721-72-
// chauffeur, bidi-group-cote-divoire-49-721-617-commercial,
// look-du-jour-boutique-49-721-616-assistante-commerciale. Aucune garantie
// totale (accents et apostrophes perdus dans le slug, ex. "cote-divoire" au
// lieu de "Cote d'Ivoire") : a traiter comme une estimation lisible, pas une
// donnee certifiee exacte.
function extractEburkaCompanyFromSlug(pathname: string): string | null {
  const slug = pathname.replace(/^\/job\//, "").replace(/\/$/, "");
  const match = slug.match(/^([a-z0-9]+(?:-[a-z0-9]+)*?)-(\d+(?:-\d+){1,})-[a-z0-9-]+$/i);
  if (!match) return null;
  const words = match[1].split("-").filter(Boolean);
  if (words.length === 0) return null;
  const companyName = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  if (companyName.length < 2 || companyName.length > 120) return null;
  return companyName;
}

function improveEburka(job: CommercialSourceJob): CommercialSourceJob {
  const normalizedUrl = normalizeEburkaJobUrl(job.source_url);
  const baseJob = normalizedUrl
    ? {
      ...job,
      external_id: `eburka_portal:${normalizedUrl}`,
      source_url: normalizedUrl,
      apply_url: normalizedUrl,
    }
    : job;
  const slugCompanyName = normalizedUrl
    ? extractEburkaCompanyFromSlug(new URL(normalizedUrl).pathname)
    : null;
  return {
    ...baseJob,
    company_name: baseJob.company_name || slugCompanyName ||
      extractEburkaCompanyName(baseJob.description_text),
    country: "Cote d'Ivoire",
    country_codes: ["CI"],
    location: baseJob.location ?? "Cote d'Ivoire",
    tags: ["Cote d'Ivoire", "eburka_portal"],
  };
}

function rejectEburka(job: CommercialSourceJob) {
  if (!job.source_url || isSocialUrl(job.source_url)) {
    return "rejected_social_url_count";
  }
  if (isNavigationUrl(job.source_url) || isGenericTitle(job.title)) {
    return "rejected_navigation_url_count";
  }
  if (!normalizeEburkaJobUrl(job.source_url)) {
    return "rejected_invalid_job_url_count";
  }
  return null;
}

export async function fetchEburkaPortalItems(options?: { limit?: number }) {
  const baseUrl = "https://job.eburka-ci.net";
  return await fetchCommercialSourceDryRun({
    sourceCode: "eburka_portal",
    sourceFamily: "eburka_portal",
    baseUrl,
    country: "Cote d'Ivoire",
    maxItems: options?.limit ?? 50,
    feedUrls: [
      `${baseUrl}/emploi/feed`,
      `${baseUrl}/feed`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap_index.xml`],
    startUrls: [
      `${baseUrl}/emploi/`,
      `${baseUrl}/emploi/page/2/`,
      `${baseUrl}/emploi/page/3/`,
      `${baseUrl}/emploi/page/4/`,
      `${baseUrl}/emploi/page/5/`,
      `${baseUrl}/emploi/page/6/`,
      `${baseUrl}/emploi/page/7/`,
      `${baseUrl}/emploi/page/8/`,
    ],
    maxPages: 8,
    alwaysFetchStartPages: true,
    fetchSitemapsAfterHtml: true,
    pageDelayMs: 1000,
    linkInclude: "eburka-ci.net",
    jobUrlIncludes: ["/job/"],
    excludeUrlIncludes: ["/job-type/", "/employer/", "/recruteur/", "/emploi/page/", "/emploi/?"],
    postProcessJob: improveEburka,
    rejectJobReason: rejectEburka,
    stoppedReasonWhenEmpty: "eburka_requires_specific_static_endpoint",
  });
}
