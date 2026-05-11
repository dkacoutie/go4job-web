import { type CommercialSourceJob, fetchCommercialSourceDryRun } from "./west_africa_source_common.ts";

const NON_JOB_TERMS = [
  "scholarship",
  "scholarships",
  "fellowship",
  "fellowships",
  "programme application",
  "program application",
  "programmes application",
  "internship placement program",
  "young professionals program",
  "apprenticeship training program",
  "grant",
  "grants",
  "award",
  "awards",
  "scheme",
  "masters degree scholarship",
  "master's degree scholarship",
  "call for applications",
  "training programme",
  "accelerator",
  "incubation",
  "competition",
];

const PROGRAM_JOB_EXCEPTIONS = [
  "programme officer",
  "program officer",
  "programme manager",
  "program manager",
];

const COUNTRY_SIGNALS = [
  { country: "Nigeria", signals: ["nigeria", "lagos", "abuja", "kano", "borno", "adamawa"] },
  { country: "Ghana", signals: ["ghana", "accra", "kumasi"] },
  { country: "Cote d'Ivoire", signals: ["cote d'ivoire", "cote d ivoire", "ivory coast", "abidjan"] },
  { country: "Senegal", signals: ["senegal", "dakar"] },
  { country: "Benin", signals: ["benin", "cotonou"] },
  { country: "Togo", signals: ["togo", "lome"] },
  { country: "Burkina Faso", signals: ["burkina faso", "ouagadougou"] },
  { country: "Mali", signals: ["mali", "bamako"] },
  { country: "Guinea", signals: ["guinea", "conakry"] },
  { country: "Niger", signals: ["niger", "niamey"] },
];

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .toLowerCase();
}

function isNonJobContent(job: CommercialSourceJob) {
  const categories = Array.isArray(job.payload.categories) ? job.payload.categories.join(" ") : "";
  const haystack = normalize(`${job.title} ${job.description_text ?? ""} ${job.source_url} ${categories}`);
  if (PROGRAM_JOB_EXCEPTIONS.some((term) => haystack.includes(term))) {
    return false;
  }
  if (NON_JOB_TERMS.some((term) => haystack.includes(normalize(term)))) {
    return true;
  }
  const title = normalize(job.title);
  return /\bprogram(me)?s?\b/.test(title) && !PROGRAM_JOB_EXCEPTIONS.some((term) => title.includes(term));
}

function detectCountry(job: CommercialSourceJob) {
  const haystack = normalize(`${job.source_url} ${job.title} ${job.description_text ?? ""}`);
  return COUNTRY_SIGNALS.find((entry) => entry.signals.some((signal) => haystack.includes(signal)))?.country ?? null;
}

function improveNgoJob(job: CommercialSourceJob): CommercialSourceJob {
  const detectedCountry = detectCountry(job);
  const titleCompanyMatch = job.title.match(/^(.+?)\s+at\s+(.+)$/i);
  const seekingCompanyMatch = job.description_text?.match(/(?:^|\s)([A-Z][A-Za-z0-9&.' -]{2,80}?)\s+(?:is\s+)?seek(?:ing|s)\s/i);
  const companyName = titleCompanyMatch?.[2]?.trim() || seekingCompanyMatch?.[1]?.trim() || job.company_name;
  return {
    ...job,
    title: titleCompanyMatch?.[1]?.trim() || job.title,
    company_name: companyName,
    country: detectedCountry ?? "Unknown",
    location: detectedCountry,
    tags: [detectedCountry ?? "Unknown", "ngojobs_africa_rss"],
    payload: {
      ...job.payload,
      detected_country: detectedCountry,
      country_detection_status: detectedCountry ? "detected" : "unknown",
    },
  };
}

export async function fetchNgoJobsAfricaRssItems(options?: { limit?: number }) {
  const baseUrl = "https://ngojobsinafrica.com";
  return await fetchCommercialSourceDryRun({
    sourceCode: "ngojobs_africa_rss",
    sourceFamily: "ngojobs_africa_rss",
    baseUrl,
    country: "Unknown",
    maxItems: options?.limit ?? 50,
    rssOnly: true,
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
    postProcessJob: improveNgoJob,
    shouldSkipJob: isNonJobContent,
  });
}
