import { fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

export async function fetchGoAfricaOnlineCiPortalItems(options?: { limit?: number }) {
  const baseUrl = "https://www.goafricaonline.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "goafricaonline_ci_portal",
    sourceFamily: "goafricaonline_ci_portal",
    baseUrl,
    country: "Cote d'Ivoire",
    maxItems: options?.limit ?? 50,
    htmlOnly: true,
    startUrls: [
      `${baseUrl}/ci/emploi`,
      `${baseUrl}/ci/emploi?page=2`,
    ],
    linkInclude: "goafricaonline.com/ci/",
    jobUrlIncludes: ["/ci/emploi/job-"],
    excludeUrlIncludes: ["/packs-", "/annuaire", "/actualites"],
  });
}
