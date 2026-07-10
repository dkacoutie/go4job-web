import { type CommercialSourceJob, type CommercialSourceResult } from "./west_africa_source_common.ts";

type MyJobMagSourceCode = "myjobmag_ng_portal" | "myjobmag_gh_portal";

type MyJobMagConfig = {
  sourceCode: MyJobMagSourceCode;
  sourceFamily: "myjobmag_xml_feed";
  baseUrl: string;
  country: "NG" | "GH";
};

type FeedFetchResult = {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
  error?: string;
};

type AggregateEntry = {
  id: string | null;
  title: string;
  position: string | null;
  company: string | null;
  location: string | null;
  region: string | null;
  experience: string | null;
  contractType: string | null;
  description: string | null;
  publishedAt: string | null;
};

type ParseStats = {
  jobs: CommercialSourceJob[];
  feedItemsRead: number;
  enrichmentItemsRead: number;
  rejectedNonJob: number;
  rejectedQuality: number;
  rejectedInvalidUrl: number;
  skippedStale: number;
  missingPublishedAt: number;
  skippedDuplicate: number;
  enrichmentMatched: number;
  enrichmentMismatch: number;
  enrichmentCompanyMismatch: number;
  feedTitleExamples: unknown[];
  enrichmentTitleExamples: unknown[];
  enrichmentCompanyMismatchExamples: unknown[];
};

const USER_AGENT = "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)";
const PAGE_TIMEOUT_MS = 15000;
const DEFAULT_LIMIT = 20;
const DRY_RUN_CAP = 100;
const FEED_DELAY_MS = 1000;
const LOCATION_MAX_LENGTH = 140;
const STALE_MAX_AGE_DAYS = 120;
const STALE_MAX_AGE_MS = STALE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

const QUALITY_TERMS = [
  "betting",
  "gambling",
  "casino",
  "1xbet",
  "melbet",
  "forex",
  "get-rich-quick",
  "trading miracle",
  "whatsapp only",
  "whatsapp-only",
];

const GENERIC_TITLE_TERMS = [
  "all jobs",
  "facebook",
  "newsletter",
  "subscribe",
  "job alert",
  "jobs by",
  "search jobs",
];

const SOURCE_CONFIGS: Record<MyJobMagSourceCode, MyJobMagConfig> = {
  myjobmag_ng_portal: {
    sourceCode: "myjobmag_ng_portal",
    sourceFamily: "myjobmag_xml_feed",
    baseUrl: "https://www.myjobmag.com",
    country: "NG",
  },
  myjobmag_gh_portal: {
    sourceCode: "myjobmag_gh_portal",
    sourceFamily: "myjobmag_xml_feed",
    baseUrl: "https://www.myjobmagghana.com",
    country: "GH",
  },
};

function repairMojibake(value: string) {
  const repairs: Array<[string, string]> = [
    ["\u00e2\u20ac\u2122", "'"],
    ["\u00e2\u20ac\u02dc", "'"],
    ["\u00e2\u0080\u0099", "'"],
    ["\u00e2\u0080\u0098", "'"],
    ["\u00e2\u20ac\u0153", '"'],
    ["\u00e2\u20ac\ufffd", '"'],
    ["\u00e2\u0080\u009c", '"'],
    ["\u00e2\u0080\u009d", '"'],
    ["\u00e2\u20ac\u201c", "-"],
    ["\u00e2\u20ac\u009d", "-"],
    ["\u00e2\u0080\u0093", "-"],
    ["\u00e2\u0080\u0094", "-"],
    ["\u00e2\u20ac\u00a6", "..."],
    ["\u00e2\u0080\u00a6", "..."],
    ["\u00e2\u20ac\u00a2", "-"],
    ["\u00e2\u0080\u00a2", "-"],
    ["\u00c3\u0082", ""],
    ["\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u201e\u00a2", "'"],
    ["\u00c3\u00a2\u00e2\u201a\u00ac\u02dc", "'"],
    ["\u00c3\u00a2\u00e2\u201a\u00ac\u2026\u0153", '"'],
    ["\u00c3\u00a2\u00e2\u201a\u00ac\ufffd", '"'],
    ["\u00c3\u00a2\u00e2\u201a\u00ac\u201c", "-"],
    ["\u00c3\u00a2\u00e2\u201a\u00ac\u00a6", "..."],
  ];
  let repaired = value;
  for (const [needle, replacement] of repairs) {
    repaired = repaired.replaceAll(needle, replacement);
  }
  return repaired
    .replace(/([A-Za-z])\u00e2([A-Za-z])/g, "$1'$2")
    .replace(/\u00c3\u00c2+/g, "")
    .replace(/\u00c2+/g, "");
}
function cleanText(value: unknown): string {
  return repairMojibake(String(value ?? ""))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocation(value: unknown): { location: string | null; rawLocation: string | null; truncated: boolean } {
  const rawLocation = cleanText(value)
    .replace(/\s*[,;|/]\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();
  if (!rawLocation) {
    return { location: null, rawLocation: null, truncated: false };
  }
  if (rawLocation.length <= LOCATION_MAX_LENGTH) {
    return { location: rawLocation, rawLocation, truncated: false };
  }

  const truncated = rawLocation.slice(0, LOCATION_MAX_LENGTH + 1);
  const lastComma = truncated.lastIndexOf(",");
  const safeCut = lastComma >= 40 ? truncated.slice(0, lastComma) : rawLocation.slice(0, LOCATION_MAX_LENGTH);
  return {
    location: `${safeCut.trim().replace(/\s*,$/, "")}...`,
    rawLocation,
    truncated: true,
  };
}

function normalizeSignal(value: string) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function tagValue(xml: string, tag: string) {
  return cleanText(xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
}

function safeIsoDate(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isStaleDate(value: string | null, nowMs: number) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed < nowMs - STALE_MAX_AGE_MS;
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function limitValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(DRY_RUN_CAP, Math.trunc(parsed)));
}

function charsetFromContentType(contentType: string) {
  return contentType.match(/charset=([^;\s]+)/i)?.[1]?.trim().replace(/^["']|["']$/g, "") || "utf-8";
}

function decodeBody(bytes: ArrayBuffer, contentType: string) {
  const charset = charsetFromContentType(contentType);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchText(url: string): Promise<FeedFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("page_timeout"), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept": "application/rss+xml,application/xml,text/xml,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const bytes = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      contentType,
      text: decodeBody(bytes, contentType),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      contentType: "",
      text: "",
      error: String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeJobUrl(rawUrl: string, config: MyJobMagConfig) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value, config.baseUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const expected = new URL(config.baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    if (hostname !== expected) return null;
    if (!/^\/jobs\/[a-z0-9][a-z0-9-]*$/i.test(pathname)) return null;
    return `${config.baseUrl}${pathname}`;
  } catch {
    return null;
  }
}

function parseTitleCompany(rawTitle: string, aggregate?: AggregateEntry | null) {
  const fallbackTitle = cleanText(rawTitle);
  const titleMatch = fallbackTitle.match(/^(.+?)\s+at\s+(.+)$/i);
  const fallbackParsed = titleMatch?.[1] && titleMatch?.[2]
    ? {
      title: titleMatch[1].trim(),
      company: titleMatch[2].trim(),
    }
    : null;
  const position = cleanText(aggregate?.position ?? "");
  const company = cleanText(aggregate?.company ?? "");
  if (position) {
    return {
      title: position,
      company: company || fallbackParsed?.company || null,
    };
  }
  if (fallbackParsed) return fallbackParsed;

  return {
    title: fallbackTitle,
    company: company || null,
  };
}

function companyFromCanonicalTitle(rawTitle: string) {
  return cleanText(rawTitle).match(/^(.+?)\s+at\s+(.+)$/i)?.[2]?.trim() ?? null;
}

function positionFromCanonicalTitle(rawTitle: string) {
  return cleanText(rawTitle).match(/^(.+?)\s+at\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function isSameCompany(left: string | null | undefined, right: string | null | undefined) {
  const leftSignal = normalizeSignal(left ?? "").replace(/\blimited\b|\bltd\b|\bplc\b|\binc\b|\bllc\b/g, "").trim();
  const rightSignal = normalizeSignal(right ?? "").replace(/\blimited\b|\bltd\b|\bplc\b|\binc\b|\bllc\b/g, "").trim();
  if (!leftSignal || !rightSignal) return false;
  return leftSignal === rightSignal || leftSignal.includes(rightSignal) || rightSignal.includes(leftSignal);
}

function isSamePosition(left: string | null | undefined, right: string | null | undefined) {
  const leftSignal = normalizeSignal(left ?? "");
  const rightSignal = normalizeSignal(right ?? "");
  return Boolean(leftSignal && rightSignal && leftSignal === rightSignal);
}

function isBlockedQuality(job: Pick<CommercialSourceJob, "title" | "company_name" | "description_text" | "source_url">) {
  const haystack = normalizeSignal(`${job.title} ${job.company_name ?? ""} ${job.description_text ?? ""} ${job.source_url}`);
  return QUALITY_TERMS.some((term) => haystack.includes(normalizeSignal(term)));
}

function isNonJob(title: string, sourceUrl: string) {
  const normalizedTitle = normalizeSignal(title);
  const normalizedUrl = normalizeSignal(sourceUrl);
  if (!title || title.length < 5 || title.length > 180) return true;
  if (GENERIC_TITLE_TERMS.some((term) => normalizedTitle.includes(normalizeSignal(term)))) return true;
  return /\/(jobs-location|jobs-by-|jobs-industry|jobs-field|jobs-education|feeds|blog|career|employers|signup|login)\b/i
    .test(normalizedUrl);
}

function itemBlocks(xml: string) {
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((match) => match[0]);
}

function parseEnrichmentFeed(xml: string) {
  const byTitle = new Map<string, AggregateEntry>();
  for (const block of itemBlocks(xml)) {
    const title = tagValue(block, "title");
    if (!title) continue;
    const entry: AggregateEntry = {
      id: tagValue(block, "id") || null,
      title,
      position: tagValue(block, "position") || null,
      company: tagValue(block, "company") || null,
      location: tagValue(block, "location") || tagValue(block, "city_area") || null,
      region: tagValue(block, "region") || null,
      experience: tagValue(block, "experience") || null,
      contractType: tagValue(block, "working_hours") || tagValue(block, "contract") || null,
      description: tagValue(block, "description") || tagValue(block, "introduction") || null,
      publishedAt: safeIsoDate(tagValue(block, "pubDate")),
    };
    byTitle.set(normalizeSignal(title), entry);
  }
  return byTitle;
}

function parseJobsFeed(xml: string, config: MyJobMagConfig, aggregateByTitle: Map<string, AggregateEntry>) {
  const jobs: CommercialSourceJob[] = [];
  const seenUrls = new Set<string>();
  let rejectedNonJob = 0;
  let rejectedQuality = 0;
  let rejectedInvalidUrl = 0;
  let skippedStale = 0;
  let missingPublishedAt = 0;
  let skippedDuplicate = 0;
  let enrichmentMatched = 0;
  let enrichmentMismatch = 0;
  let enrichmentCompanyMismatch = 0;
  const feedTitleExamples: unknown[] = [];
  const enrichmentCompanyMismatchExamples: unknown[] = [];

  const feedItems = itemBlocks(xml);
  const enrichmentTitleExamples = Array.from(aggregateByTitle.values()).slice(0, 5).map((entry) => ({
    title: entry.title,
    key: normalizeSignal(entry.title),
    position: entry.position,
    company: entry.company,
  }));
  const nowMs = Date.now();
  for (const [index, block] of feedItems.entries()) {
    const rawTitle = tagValue(block, "title");
    const rawTitleKey = normalizeSignal(rawTitle);
    if (feedTitleExamples.length < 5) {
      feedTitleExamples.push({
        raw_title: rawTitle,
        normalized_key: rawTitleKey,
        canonical_company: companyFromCanonicalTitle(rawTitle),
      });
    }
    const sourceUrl = normalizeJobUrl(tagValue(block, "link"), config);
    if (!sourceUrl) {
      rejectedInvalidUrl++;
      continue;
    }
    if (seenUrls.has(sourceUrl)) {
      skippedDuplicate++;
      continue;
    }
    seenUrls.add(sourceUrl);

    const aggregateCandidate = aggregateByTitle.get(rawTitleKey);
    const canonicalCompany = companyFromCanonicalTitle(rawTitle);
    const canonicalPosition = positionFromCanonicalTitle(rawTitle);
    const companyMatches = Boolean(
      aggregateCandidate && (!canonicalCompany || isSameCompany(canonicalCompany, aggregateCandidate.company)),
    );
    const positionMatches = Boolean(aggregateCandidate && isSamePosition(canonicalPosition, aggregateCandidate.position));
    const aggregate = aggregateCandidate && (companyMatches || positionMatches)
      ? {
        ...aggregateCandidate,
        company: companyMatches ? aggregateCandidate.company : canonicalCompany,
      }
      : null;
    if (aggregate) enrichmentMatched++;
    if (aggregateCandidate && !companyMatches) {
      enrichmentCompanyMismatch++;
      if (enrichmentCompanyMismatchExamples.length < 5) {
        enrichmentCompanyMismatchExamples.push({
          raw_title: rawTitle,
          normalized_key: rawTitleKey,
          canonical_company: canonicalCompany,
          aggregate_title: aggregateCandidate.title,
          aggregate_position: aggregateCandidate.position,
          aggregate_company: aggregateCandidate.company,
        });
      }
    }
    if (aggregateCandidate && !aggregate) enrichmentMismatch++;
    const parsedTitle = parseTitleCompany(rawTitle, aggregate);
    if (isNonJob(parsedTitle.title, sourceUrl)) {
      rejectedNonJob++;
      continue;
    }

    const publishedAt = aggregate?.publishedAt ?? safeIsoDate(tagValue(block, "pubDate"));
    if (!publishedAt) {
      missingPublishedAt++;
    } else if (isStaleDate(publishedAt, nowMs)) {
      skippedStale++;
      continue;
    }
    const description = cleanText(aggregate?.description ?? tagValue(block, "description"));
    const normalizedLocation = normalizeLocation(aggregate?.location ?? aggregate?.region ?? "");
    const job: CommercialSourceJob = {
      external_id: `${config.sourceCode}:${sourceUrl}`,
      title: parsedTitle.title,
      company_name: parsedTitle.company,
      country: config.country,
      country_codes: [config.country],
      location: normalizedLocation.location,
      contract_type: cleanText(aggregate?.contractType ?? "") || null,
      experience: cleanText(aggregate?.experience ?? "") || null,
      sector: tagValue(block, "industry") || null,
      posted_at: publishedAt,
      source_url: sourceUrl,
      apply_url: sourceUrl,
      published_at: publishedAt,
      expires_at: null,
      description_text: description || null,
      tags: [config.country, config.sourceFamily],
      payload: {
        source_kind: "myjobmag_jobsxml",
        aggregate_id: aggregate?.id ?? null,
        enrichment_matched: Boolean(aggregate),
        raw_title: rawTitle,
        raw_location: normalizedLocation.rawLocation,
        location_truncated: normalizedLocation.truncated,
        feed_index: index,
      },
    };

    if (isBlockedQuality(job)) {
      rejectedQuality++;
      continue;
    }

    jobs.push(job);
  }

  return {
    jobs,
    feedItemsRead: feedItems.length,
    enrichmentItemsRead: aggregateByTitle.size,
    rejectedNonJob,
    rejectedQuality,
    rejectedInvalidUrl,
    skippedStale,
    missingPublishedAt,
    skippedDuplicate,
    enrichmentMatched,
    enrichmentMismatch,
    enrichmentCompanyMismatch,
    feedTitleExamples,
    enrichmentTitleExamples,
    enrichmentCompanyMismatchExamples,
  } satisfies ParseStats;
}

export async function fetchMyJobMagPortalItems(
  sourceCode: MyJobMagSourceCode,
  options?: { limit?: number },
): Promise<CommercialSourceResult> {
  const config = SOURCE_CONFIGS[sourceCode];
  const maxItems = limitValue(options?.limit);
  const jobsFeedUrl = `${config.baseUrl}/jobsxml.xml`;
  const enrichmentFeedUrl = `${config.baseUrl}/jobsxml_by_categories.xml`;
  const diagnostics: unknown[] = [];
  const warnings: string[] = [];

  // This source uses MyJobMag XML feeds plus an enrichment feed. It is not an HTML portal paginator.
  const enrichmentResponse = await fetchText(enrichmentFeedUrl);
  diagnostics.push({
    fetched_url: enrichmentFeedUrl,
    status: enrichmentResponse.status,
    content_type: enrichmentResponse.contentType,
    body_length: enrichmentResponse.text.length,
    parser_mode: "myjobmag_jobsxml_by_categories_enrichment",
    error: enrichmentResponse.error,
  });
  if (!enrichmentResponse.ok) warnings.push("myjobmag_enrichment_feed_unavailable");

  await delay(FEED_DELAY_MS);

  const jobsResponse = await fetchText(jobsFeedUrl);
  diagnostics.push({
    fetched_url: jobsFeedUrl,
    status: jobsResponse.status,
    content_type: jobsResponse.contentType,
    body_length: jobsResponse.text.length,
    parser_mode: "myjobmag_jobsxml_canonical_feed",
    error: jobsResponse.error,
  });

  if (!jobsResponse.ok) {
    warnings.push("myjobmag_canonical_jobs_feed_unavailable");
    return buildResult(config, jobsFeedUrl, [], 0, 0, 0, "feed_not_ok", diagnostics, maxItems, warnings);
  }

  const aggregateByTitle = enrichmentResponse.ok ? parseEnrichmentFeed(enrichmentResponse.text) : new Map<string, AggregateEntry>();
  const parsed = parseJobsFeed(jobsResponse.text, config, aggregateByTitle);
  const items = parsed.jobs.slice(0, maxItems);
  const stoppedReason = parsed.jobs.length > maxItems ? "limit_reached" : "feed_exhausted";
  if (parsed.enrichmentItemsRead === 0) warnings.push("myjobmag_no_enrichment_items_read");
  if (parsed.missingPublishedAt > 0) warnings.push("myjobmag_some_items_missing_published_at");
  if (parsed.skippedStale >= 10 || parsed.skippedStale > parsed.jobs.length) {
    warnings.push("myjobmag_high_stale_item_count");
  }

  return buildResult(
    config,
    jobsFeedUrl,
    items,
    parsed.jobs.length,
    parsed.rejectedQuality,
    parsed.rejectedNonJob + parsed.rejectedInvalidUrl,
    stoppedReason,
    diagnostics,
    maxItems,
    warnings,
    {
      enrichment_feed_url: enrichmentFeedUrl,
      enrichment_items_read: parsed.enrichmentItemsRead,
      enrichment_matched_count: parsed.enrichmentMatched,
      enrichment_mismatch_count: parsed.enrichmentMismatch,
      enrichment_company_mismatch_count: parsed.enrichmentCompanyMismatch,
      enrichment_feed_title_examples: parsed.enrichmentTitleExamples,
      canonical_feed_title_examples: parsed.feedTitleExamples,
      enrichment_company_mismatch_examples: parsed.enrichmentCompanyMismatchExamples,
      raw_feed_items_read: parsed.feedItemsRead,
      feed_items_read: parsed.feedItemsRead,
      rejected_invalid_job_url_count: parsed.rejectedInvalidUrl,
      skipped_stale_count: parsed.skippedStale,
      stale_max_age_days: STALE_MAX_AGE_DAYS,
      missing_published_at_count: parsed.missingPublishedAt,
      skipped_duplicate_count: parsed.skippedDuplicate,
    },
  );
}

function buildResult(
  config: MyJobMagConfig,
  listUrl: string,
  items: CommercialSourceJob[],
  fetchedCount: number,
  skippedQualityCount: number,
  skippedNonJobCount: number,
  stoppedReason: string,
  diagnostics: unknown[],
  maxItems: number,
  warnings: string[] = [],
  extraMeta: Record<string, unknown> = {},
): CommercialSourceResult {
  return {
    ok: true,
    source_code: config.sourceCode,
    source_family: config.sourceFamily,
    dry_run: true,
    detected_country: config.country,
    list_url: listUrl,
    parsed_count: items.length,
    fetched_count: fetchedCount,
    feeds_fetched: 2,
    pages_fetched: 0,
    skipped_quality_count: skippedQualityCount,
    stopped_reason: stoppedReason,
    sample_jobs: items.slice(0, 10),
    items,
    meta: {
      diagnostics,
      sitemaps_fetched: 0,
      feeds_fetched: 2,
      pages_fetched: 0,
      unique_url_count: fetchedCount,
      duplicate_url_count: extraMeta.skipped_duplicate_count ?? 0,
      skipped_duplicate_count: extraMeta.skipped_duplicate_count ?? 0,
      skipped_non_job_count: skippedNonJobCount,
      parser_mode: "myjobmag_jobsxml_plus_jobsxml_by_categories",
      source_kind: "xml_feed",
      max_items_used: maxItems,
      warnings,
      country_detected_count: items.length,
      country_unknown_count: 0,
      ...extraMeta,
    },
  };
}
