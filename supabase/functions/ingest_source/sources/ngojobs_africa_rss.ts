import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

export async function fetchNgoJobsAfricaRssItems(options?: { limit?: number }) {
  const baseUrl = "https://ngojobsinafrica.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "ngojobs_africa_rss",
    sourceFamily: "ngojobs_africa_rss",
    baseUrl,
    country: "West Africa",
    maxItems: options?.limit ?? 50,
    feedUrls: [
      `${baseUrl}/feed`,
      `${baseUrl}/rss`,
      `${baseUrl}/rss.xml`,
      `${baseUrl}/jobs/feed`,
    ],
    startUrls: [
      `${baseUrl}/jobs`,
      `${baseUrl}/jobs-in-nigeria`,
      `${baseUrl}/jobs-in-ghana`,
    ],
    linkInclude: "ngojobsinafrica.com",
    jobUrlIncludes: ["ngojobsinafrica.com/"],
    excludeUrlIncludes: ["/category/", "/tag/", "/author/", "/page/", "/jobs/"],
  });
}
