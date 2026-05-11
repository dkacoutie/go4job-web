import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

function improveNovojob(job: CommercialSourceJob): CommercialSourceJob {
  const url = job.source_url.toLowerCase();
  const country = url.includes("/cote-d-ivoire/")
    ? "Cote d'Ivoire"
    : url.includes("/senegal/")
    ? "Senegal"
    : url.includes("/benin/")
    ? "Benin"
    : url.includes("/togo/")
    ? "Togo"
    : url.includes("/burkina-faso/")
    ? "Burkina Faso"
    : url.includes("/guinee/")
    ? "Guinea"
    : job.country;
  return {
    ...job,
    country,
    location: country,
    tags: [country ?? "Unknown", "novojob_portal"],
  };
}

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
      `${baseUrl}/rss`,
      `${baseUrl}/rss.xml`,
    ],
    sitemapUrls: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap_index.xml`],
    startUrls: [`${baseUrl}/offres-emploi`, `${baseUrl}/jobs`],
    linkInclude: "novojob.com",
    jobUrlIncludes: ["/offre-d-emploi/"],
    excludeUrlIncludes: ["/entreprises/", "/candidats/", "/conseils/"],
    postProcessJob: improveNovojob,
    stoppedReasonWhenEmpty: "js_rendered_or_specific_parser_required",
  });
}
