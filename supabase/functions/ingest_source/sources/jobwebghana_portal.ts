import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

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
    startUrls: [`${baseUrl}/jobs`, `${baseUrl}/page/2`],
    linkInclude: "jobwebghana.com",
    jobUrlIncludes: ["/jobs/"],
    excludeUrlIncludes: ["/job-category/", "/job-location/", "/page/"],
  });
}
