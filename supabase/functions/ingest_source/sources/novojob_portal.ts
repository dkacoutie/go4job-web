import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

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
      `${baseUrl}/rss.xml`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
    startUrls: [`${baseUrl}/offres-emploi`, `${baseUrl}/jobs`],
    linkInclude: "novojob.com",
    jobUrlIncludes: ["/offre-d-emploi/"],
    excludeUrlIncludes: ["/entreprises/", "/candidats/", "/conseils/"],
  });
}
