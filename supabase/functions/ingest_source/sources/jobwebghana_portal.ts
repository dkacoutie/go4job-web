import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

const GENERIC_TITLES = new Set([
  "facebook",
  "twitter",
  "linkedin",
  "whatsapp",
  "all jobs",
  "share",
  "apply now",
  "jobs",
  "job",
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
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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

function normalizeJobWebJobUrl(rawUrl: string | null | undefined) {
  const value = String(rawUrl ?? "").trim();
  if (!value || isSocialUrl(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "jobwebghana.com") return null;
    if (!/^\/jobs\/[^/]+$/i.test(pathname)) return null;
    return `https://jobwebghana.com${pathname}`;
  } catch {
    return null;
  }
}

function isNavigationUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== "jobwebghana.com") return false;
    return pathname === "/jobs" || /^\/jobs\/page\/\d+$/i.test(pathname) ||
      /^\/(job-category|job-location)\b/i.test(pathname);
  } catch {
    return false;
  }
}

function isGenericTitle(title: string) {
  const normalized = normalizeSignal(title);
  return normalized.length < 5 || GENERIC_TITLES.has(normalized);
}

function improveJobWebJob(job: CommercialSourceJob): CommercialSourceJob {
  const normalizedUrl = normalizeJobWebJobUrl(job.source_url);
  const baseJob = normalizedUrl
    ? {
      ...job,
      external_id: `jobwebghana_portal:${normalizedUrl}`,
      source_url: normalizedUrl,
      apply_url: normalizedUrl,
    }
    : job;

  const titleMatch = baseJob.title.match(/^(.+?)\s+at\s+(.+)$/i);
  if (titleMatch?.[1] && titleMatch?.[2]) {
    return {
      ...baseJob,
      title: titleMatch[1].trim(),
      company_name: titleMatch[2].trim(),
    };
  }

  const descriptionMatch = baseJob.description_text?.match(/The post\s+.+?\s+at\s+(.+?)\s+appeared first on Jobweb Ghana/i);
  if (descriptionMatch?.[1]) {
    return {
      ...baseJob,
      company_name: descriptionMatch[1].trim(),
    };
  }

  return baseJob;
}

function rejectJobWebJob(job: CommercialSourceJob) {
  if (!job.source_url || isSocialUrl(job.source_url)) {
    return "rejected_social_url_count";
  }
  if (isNavigationUrl(job.source_url) || isGenericTitle(job.title)) {
    return "rejected_navigation_url_count";
  }
  if (!normalizeJobWebJobUrl(job.source_url)) {
    return "rejected_invalid_job_url_count";
  }
  if (!job.company_name?.trim() || isGenericTitle(job.company_name)) {
    return "rejected_missing_company_count";
  }
  return null;
}

export async function fetchJobWebGhanaPortalItems(options?: { limit?: number }) {
  const baseUrl = "https://jobwebghana.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "jobwebghana_portal",
    sourceFamily: "jobwebghana_portal",
    baseUrl,
    country: "Ghana",
    maxItems: options?.limit ?? 50,
    feedUrls: [
      `${baseUrl}/feed`,
      `${baseUrl}/rss`,
      `${baseUrl}/rss.xml`,
      `${baseUrl}/jobs/feed`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
    startUrls: [
      `${baseUrl}/jobs/`,
      `${baseUrl}/jobs/page/2/`,
      `${baseUrl}/jobs/page/3/`,
    ],
    maxPages: 3,
    alwaysFetchStartPages: true,
    fetchSitemapsAfterHtml: true,
    probeAllStartPages: true,
    pageDelayMs: 1000,
    linkInclude: "jobwebghana.com",
    jobUrlIncludes: ["/jobs/"],
    excludeUrlIncludes: ["/job-category/", "/job-location/", "/page/"],
    postProcessJob: improveJobWebJob,
    rejectJobReason: rejectJobWebJob,
  });
}
