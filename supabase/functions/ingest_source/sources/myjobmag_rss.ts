import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

export async function fetchMyJobMagRssItems(
  sourceCode: "myjobmag_ng_rss" | "myjobmag_gh_rss",
  options?: { limit?: number },
) {
  const isGhana = sourceCode === "myjobmag_gh_rss";
  const baseUrl = isGhana ? "https://www.myjobmagghana.com" : "https://www.myjobmag.com";
  return await fetchCommercialSourceDryRun({
    sourceCode,
    sourceFamily: "myjobmag_rss",
    baseUrl,
    country: isGhana ? "Ghana" : "Nigeria",
    maxItems: options?.limit ?? 50,
    feedUrls: [
      `${baseUrl}/feed`,
      `${baseUrl}/rss`,
      `${baseUrl}/rss.xml`,
      `${baseUrl}/jobs/feed`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
    startUrls: [`${baseUrl}/jobs`],
    linkInclude: isGhana ? "myjobmagghana.com" : "myjobmag.com",
    jobUrlIncludes: ["/job/", "/jobs/"],
    excludeUrlIncludes: ["/jobs-by-", "/jobs-location", "/jobs/feed", "/blog", "/course", "/employers", "/signup"],
  });
}
