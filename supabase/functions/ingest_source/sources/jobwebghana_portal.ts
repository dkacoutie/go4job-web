import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

function improveJobWebJob(job: CommercialSourceJob): CommercialSourceJob {
  const titleMatch = job.title.match(/^(.+?)\s+at\s+(.+)$/i);
  if (titleMatch?.[1] && titleMatch?.[2]) {
    return {
      ...job,
      title: titleMatch[1].trim(),
      company_name: titleMatch[2].trim(),
    };
  }

  const descriptionMatch = job.description_text?.match(/The post\s+.+?\s+at\s+(.+?)\s+appeared first on Jobweb Ghana/i);
  if (descriptionMatch?.[1]) {
    return {
      ...job,
      company_name: descriptionMatch[1].trim(),
    };
  }

  return job;
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
    startUrls: [`${baseUrl}/jobs`, `${baseUrl}/page/2`],
    linkInclude: "jobwebghana.com",
    jobUrlIncludes: ["/jobs/"],
    excludeUrlIncludes: ["/job-category/", "/job-location/", "/page/"],
    postProcessJob: improveJobWebJob,
  });
}
