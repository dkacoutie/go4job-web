import {
  type CommercialSourceConfig,
  type CommercialSourceJob,
  fetchCommercialSourceDryRun,
} from "./west_africa_source_common.ts";

const SOURCE_CODE = "goafricaonline_ci_portal";
const SOURCE_FAMILY = "goafricaonline_ci_portal";
const COUNTRY = "Cote d'Ivoire";

const GENERIC_TITLES = new Set([
  "emploi",
  "offre",
  "offres",
  "offres d'emploi",
  "postuler",
  "publier une offre d'emploi",
  "share",
  "facebook",
  "twitter",
  "linkedin",
  "whatsapp",
]);

const GENERIC_COMPANY_NAMES = new Set([
  "entreprise",
  "societe",
  "confidentiel",
  "non precise",
  "n/a",
]);

const SOCIAL_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "whatsapp.com",
  "wa.me",
];

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
};

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSignal(value: string) {
  return cleanText(value)
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

function normalizeGoAfricaJobUrl(rawUrl: string | null | undefined) {
  const value = String(rawUrl ?? "").trim();
  if (!value || isSocialUrl(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "goafricaonline.com") return null;
    if (!/^\/ci\/emploi\/job-\d+-[^/]+$/i.test(pathname)) return null;
    return `https://www.goafricaonline.com${pathname}`;
  } catch {
    return null;
  }
}

function isNavigationUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "goafricaonline.com") return false;
    return pathname === "/ci/emploi" ||
      pathname === "/ci/entreprises" ||
      pathname === "/ci/talents" ||
      pathname.includes("/annuaire") ||
      pathname.includes("/actualites") ||
      pathname.includes("/packs-");
  } catch {
    return false;
  }
}

function isGenericTitle(title: string) {
  const normalized = normalizedSignal(title);
  return normalized.length < 5 || GENERIC_TITLES.has(normalized);
}

function isGenericCompanyName(companyName: string | null | undefined) {
  const normalized = normalizedSignal(companyName ?? "");
  return !normalized || GENERIC_COMPANY_NAMES.has(normalized);
}

function textFromFirstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = cleanText(html.match(pattern)?.[1] ?? "");
    if (value) return value;
  }
  return null;
}

function parsePostedAt(value: string | null) {
  const match = normalizedSignal(value ?? "").match(/poste le\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (!match?.[1] || !match?.[2] || !match?.[3]) return null;
  const month = FRENCH_MONTHS[match[2]];
  if (!month) return null;
  const day = match[1].padStart(2, "0");
  return `${match[3]}-${month}-${day}T00:00:00.000Z`;
}

function badgeValues(cardHtml: string) {
  return Array.from(cardHtml.matchAll(/<div\b[^>]*rounded-full bg-gray-100[^>]*>([\s\S]*?)<\/div>/gi))
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
}

function pickContractType(badges: string[]) {
  return badges.find((badge) =>
    /^(cdi|cdd|stage|alternance|freelance|interim)$/i.test(normalizedSignal(badge))
  ) ?? null;
}

function pickExperience(badges: string[]) {
  return badges.find((badge) => normalizedSignal(badge).includes("experience")) ?? null;
}

function cardStart(html: string, anchorIndex: number) {
  const marker = '<div class="relative flex flex-col';
  const start = html.lastIndexOf(marker, anchorIndex);
  return start >= 0 ? start : Math.max(0, anchorIndex - 1200);
}

function cardEnd(html: string, anchorIndex: number) {
  const marker = '<div class="relative flex flex-col';
  const next = html.indexOf(marker, anchorIndex + marker.length);
  return next >= 0 ? next : html.length;
}

function parseGoAfricaOnlineHtmlJobs(
  html: string,
  config: CommercialSourceConfig,
  pageUrl: string,
): CommercialSourceJob[] {
  const anchors = Array.from(
    html.matchAll(/<a\b[^>]*href=["']([^"']*\/ci\/emploi\/job-\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi),
  );
  const seenUrls = new Set<string>();
  const jobs: CommercialSourceJob[] = [];

  for (const [index, match] of anchors.entries()) {
    const normalizedUrl = normalizeGoAfricaJobUrl(match[1]);
    const sourceUrl = normalizedUrl ?? String(match[1] ?? "");
    if (seenUrls.has(sourceUrl)) continue;
    seenUrls.add(sourceUrl);

    const start = cardStart(html, match.index ?? 0);
    const end = cardEnd(html, match.index ?? 0);
    const cardHtml = html.slice(start, end);
    const title = textFromFirstMatch(cardHtml, [
      /<p\b[^>]*\[grid-area:jobtitle\][^>]*>([\s\S]*?)<\/p>/i,
      /<a\b[^>]*\[grid-area:title\][^>]*>([\s\S]*?)<\/a>/i,
    ]) ?? cleanText(match[2]);
    const postedText = textFromFirstMatch(cardHtml, [
      /<div\b[^>]*\[grid-area:date\][^>]*>([\s\S]*?)<\/div>/i,
    ]);
    const publishedAt = parsePostedAt(postedText);
    const companyName = textFromFirstMatch(cardHtml, [
      /<div\b[^>]*font-bold text-16[^>]*>([\s\S]*?)<\/div>/i,
    ]);
    const sector = textFromFirstMatch(cardHtml, [
      /<div\b[^>]*font-italic[^>]*>([\s\S]*?)<\/div>/i,
    ]);
    const location = textFromFirstMatch(cardHtml, [
      /<img\b[^>]*circle-flags\/flags\/ci\.svg[^>]*>\s*<div\b[^>]*font-bold text-12[^>]*>([\s\S]*?)<\/div>/i,
      /<div\b[^>]*font-bold text-12[^>]*>([\s\S]*?)<\/div>/i,
    ]);
    const description = textFromFirstMatch(cardHtml, [
      /<p\b[^>]*line-clamp[^>]*>([\s\S]*?)<\/p>/i,
    ]);
    const badges = badgeValues(cardHtml);

    jobs.push({
      external_id: `${config.sourceCode}:${normalizedUrl ?? (sourceUrl || String(index))}`,
      title,
      company_name: companyName,
      country: COUNTRY,
      location: location ?? COUNTRY,
      sector,
      contract_type: pickContractType(badges),
      experience: pickExperience(badges),
      posted_at: publishedAt,
      source_url: normalizedUrl ?? sourceUrl,
      apply_url: normalizedUrl ?? sourceUrl,
      published_at: publishedAt,
      expires_at: null,
      description_text: description,
      tags: [COUNTRY, SOURCE_FAMILY],
      payload: {
        source_kind: "html",
        parser_mode: "goafricaonline_ci_listing_cards",
        page_url: pageUrl,
        sector,
        contract_type: pickContractType(badges),
        experience: pickExperience(badges),
        posted_text: postedText,
        badges,
      },
    });
  }

  return jobs;
}

function improveGoAfricaJob(job: CommercialSourceJob): CommercialSourceJob {
  const normalizedUrl = normalizeGoAfricaJobUrl(job.source_url);
  const sourceUrl = normalizedUrl ?? job.source_url;
  return {
    ...job,
    external_id: `${SOURCE_CODE}:${sourceUrl}`,
    source_url: sourceUrl,
    apply_url: sourceUrl,
    country: COUNTRY,
    location: job.location?.trim() || COUNTRY,
    tags: [COUNTRY, SOURCE_FAMILY],
  };
}

function rejectGoAfricaJob(job: CommercialSourceJob) {
  if (!job.source_url || isSocialUrl(job.source_url)) {
    return "rejected_social_url_count";
  }
  if (isNavigationUrl(job.source_url) || isGenericTitle(job.title)) {
    return "rejected_navigation_url_count";
  }
  if (!normalizeGoAfricaJobUrl(job.source_url)) {
    return "rejected_invalid_job_url_count";
  }
  if (isGenericCompanyName(job.company_name)) {
    return "rejected_missing_company_count";
  }
  return null;
}

export async function fetchGoAfricaOnlineCiPortalItems(options?: { limit?: number; maxPages?: number }) {
  const baseUrl = "https://www.goafricaonline.com";
  const requestedMaxPages = Number.isFinite(options?.maxPages) ? Math.trunc(options?.maxPages as number) : 6;
  const maxPages = Math.max(1, Math.min(requestedMaxPages, 6));
  return await fetchCommercialSourceDryRun({
    sourceCode: SOURCE_CODE,
    sourceFamily: SOURCE_FAMILY,
    baseUrl,
    country: COUNTRY,
    maxItems: options?.limit ?? 50,
    maxItemsHardCap: 150,
    maxPages,
    maxPagesHardCap: 6,
    minValidItemsPerPage: 5,
    duplicatePageUrlRatioToStop: 0.5,
    htmlOnly: true,
    alwaysFetchStartPages: true,
    probeAllStartPages: true,
    pageDelayMs: 3000,
    startUrls: [
      `${baseUrl}/ci/emploi`,
      `${baseUrl}/ci/emploi?page=2`,
      `${baseUrl}/ci/emploi?page=3`,
      `${baseUrl}/ci/emploi?page=4`,
      `${baseUrl}/ci/emploi?page=5`,
      `${baseUrl}/ci/emploi?page=6`,
    ],
    linkInclude: "goafricaonline.com/ci/",
    jobUrlIncludes: ["/ci/emploi/job-"],
    excludeUrlIncludes: ["/packs-", "/annuaire", "/actualites", "/recherche", "/entreprises"],
    parseHtmlJobs: parseGoAfricaOnlineHtmlJobs,
    htmlParserMode: "goafricaonline_ci_listing_cards",
    postProcessJob: improveGoAfricaJob,
    rejectJobReason: rejectGoAfricaJob,
    stoppedReasonWhenEmpty: "goafricaonline_requires_specific_parser_review",
  });
}
