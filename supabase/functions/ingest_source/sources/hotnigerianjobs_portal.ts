import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

export async function fetchHotNigerianJobsPortalItems(options?: { limit?: number }) {
  const baseUrl = "https://www.hotnigerianjobs.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "hotnigerianjobs_portal",
    sourceFamily: "hotnigerianjobs_portal",
    baseUrl,
    country: "Nigeria",
    maxItems: options?.limit ?? 50,
    htmlOnly: true,
    startUrls: [
      `${baseUrl}/`,
      `${baseUrl}/hotjobs/2/`,
    ],
    linkInclude: "hotnigerianjobs.com",
    jobUrlIncludes: ["/jobs/"],
    excludeUrlIncludes: ["/jobs/featured", "/jobs/today", "/jobs/lastweek", "/industry/", "/field/", "/role/", "/recruiter", "/employer"],
  });
}
