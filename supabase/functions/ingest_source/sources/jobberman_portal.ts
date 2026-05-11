import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

export async function fetchJobbermanPortalItems(
  sourceCode: "jobberman_ng_portal" | "jobberman_gh_portal",
  options?: { limit?: number },
) {
  const isGhana = sourceCode === "jobberman_gh_portal";
  const baseUrl = isGhana ? "https://www.jobberman.com.gh" : "https://www.jobberman.com";
  return await fetchCommercialSourceDryRun({
    sourceCode,
    sourceFamily: "jobberman_portal",
    baseUrl,
    country: isGhana ? "Ghana" : "Nigeria",
    maxItems: options?.limit ?? 50,
    htmlOnly: true,
    startUrls: [`${baseUrl}/jobs`, `${baseUrl}/jobs?page=2`],
    linkInclude: isGhana ? "jobberman.com.gh" : "jobberman.com",
    jobUrlIncludes: ["/listings/"],
    excludeUrlIncludes: ["/discover/", "/account/", "/employer", "/job-seeker"],
  });
}
