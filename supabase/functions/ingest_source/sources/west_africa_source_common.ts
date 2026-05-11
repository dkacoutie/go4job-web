export type CommercialSourceJob = {
  external_id: string;
  title: string;
  company_name: string | null;
  country: string | null;
  location: string | null;
  sector?: string | null;
  contract_type?: string | null;
  experience?: string | null;
  posted_at?: string | null;
  source_url: string;
  apply_url: string;
  published_at: string | null;
  expires_at: string | null;
  description_text: string | null;
  tags: string[];
  payload: Record<string, unknown>;
};

export type CommercialSourceResult = {
  ok: boolean;
  source_code: string;
  source_family: string;
  dry_run: true;
  detected_country: string | null;
  list_url: string;
  parsed_count: number;
  fetched_count: number;
  feeds_fetched: number;
  pages_fetched: number;
  skipped_quality_count: number;
  stopped_reason: string;
  sample_jobs: CommercialSourceJob[];
  items: CommercialSourceJob[];
  meta: Record<string, unknown>;
};

export type CommercialSourceConfig = {
  sourceCode: string;
  sourceFamily: string;
  baseUrl: string;
  startUrls?: string[];
  feedUrls?: string[];
  sitemapUrls?: string[];
  country: string;
  maxItems?: number;
  maxItemsHardCap?: number;
  maxPages?: number;
  maxPagesHardCap?: number;
  minValidItemsPerPage?: number;
  duplicatePageUrlRatioToStop?: number;
  alwaysFetchStartPages?: boolean;
  fetchSitemapsAfterHtml?: boolean;
  probeAllStartPages?: boolean;
  pageDelayMs?: number;
  htmlOnly?: boolean;
  rssOnly?: boolean;
  linkInclude?: string;
  jobUrlIncludes?: string[];
  excludeUrlIncludes?: string[];
  postProcessJob?: (job: CommercialSourceJob) => CommercialSourceJob;
  rejectJobReason?: (job: CommercialSourceJob) => string | null;
  shouldSkipJob?: (job: CommercialSourceJob) => boolean;
  parseHtmlJobs?: (
    html: string,
    config: CommercialSourceConfig,
    pageUrl: string,
  ) => CommercialSourceJob[];
  htmlParserMode?: string;
  reasonWhenZero?: string;
  stoppedReasonWhenEmpty?: string;
};

const USER_AGENT = "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)";
const PAGE_TIMEOUT_MS = 15000;
const QUALITY_TERMS = [
  "betting",
  "casino",
  "gambling",
  "1xbet",
  "melbet",
  "crypto",
  "mlm",
  "parrainage",
  "revenus passifs",
  "trading miracle",
  "whatsapp only",
  "whatsapp-only",
];

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#038;/gi, "&")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8230;/gi, "\u2026")
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&eacute;/gi, "e")
    .replace(/&Eacute;/g, "E")
    .replace(/&egrave;/gi, "e")
    .replace(/&agrave;/gi, "a")
    .replace(/&ocirc;/gi, "o")
    .replace(/&ccedil;/gi, "c")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(baseUrl: string, href: string) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
}

function normalizeSignal(value: string) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isQualityBlocked(job: { title: string; source_url: string; description_text?: string | null }) {
  if (!job.title || !job.source_url) return true;
  const haystack = normalizeSignal(`${job.title} ${job.description_text ?? ""}`);
  return QUALITY_TERMS.some((term) => haystack.includes(normalizeSignal(term)));
}

function safeIsoDate(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isExpired(expiresAt: string | null) {
  return expiresAt ? Date.parse(expiresAt) < Date.now() : false;
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("page_timeout"), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml,application/rss+xml,application/xml,text/xml,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      finalUrl: res.url,
      text,
      blocked: isBlocked(res.status, text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      finalUrl: url,
      text: "",
      blocked: false,
      error: String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isBlocked(status: number, text: string) {
  if ([401, 403, 429].includes(status)) return true;
  const plain = cleanText(text).toLowerCase();
  return ["cloudflare", "captcha", "checking your browser", "login required", "access denied"].some((term) =>
    plain.includes(term)
  );
}

function tagValue(xml: string, tag: string) {
  return cleanText(xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
}

function linkFromItem(xml: string) {
  return tagValue(xml, "link") ||
    cleanText(xml.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? "");
}

function parseFeed(xml: string, config: CommercialSourceConfig) {
  const blocks = [
    ...Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((m) => m[0]),
    ...Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)).map((m) => m[0]),
  ];
  return blocks.map((block, index) => {
    const sourceUrl = linkFromItem(block);
    if (!isJobUrl(sourceUrl, config)) return null;
    const title = tagValue(block, "title");
    const publishedAt = safeIsoDate(tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated"));
    const expiresAt = safeIsoDate(tagValue(block, "expires") || tagValue(block, "expirationDate"));
    const description = tagValue(block, "description") || tagValue(block, "summary");
    const categories = Array.from(block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)).map((match) =>
      cleanText(match[1])
    ).filter(Boolean);
    return buildJob(config, {
      title,
      sourceUrl,
      publishedAt,
      expiresAt,
      description,
      index,
      payload: { source_kind: "feed", categories },
    });
  }).filter((job): job is CommercialSourceJob => Boolean(job));
}

function parseSitemap(xml: string, config: CommercialSourceConfig) {
  return Array.from(xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi))
    .map((match, index) => {
      const sourceUrl = cleanText(match[1]);
      if (!isJobUrl(sourceUrl, config)) return null;
      return buildJob(config, {
        title: titleFromUrl(sourceUrl),
        sourceUrl,
        publishedAt: null,
        expiresAt: null,
        description: null,
        index,
        payload: { source_kind: "sitemap" },
      });
    })
    .filter((job): job is CommercialSourceJob => Boolean(job));
}

function titleFromUrl(url: string) {
  const segment = url.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";
  return cleanText(segment.replace(/[-_]+/g, " "));
}

function parseHtml(html: string, config: CommercialSourceConfig, pageUrl: string) {
  const links = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const seen = new Set<string>();
  const jobs: CommercialSourceJob[] = [];
  for (const [index, match] of links.entries()) {
    const href = absUrl(config.baseUrl, match[1] ?? "");
    if (!href || seen.has(href)) continue;
    if (!isJobUrl(href, config)) continue;
    const title = cleanText(match[2]);
    if (!title || title.length < 5 || title.length > 180) continue;
    seen.add(href);
    jobs.push(buildJob(config, {
      title,
      sourceUrl: href,
      publishedAt: null,
      expiresAt: null,
      description: null,
      index,
      payload: { source_kind: "html", page_url: pageUrl },
    }));
  }
  return jobs;
}

function isJobUrl(url: string, config: CommercialSourceConfig) {
  if (!url) return false;
  if (config.linkInclude && !url.includes(config.linkInclude)) return false;
  const lowerUrl = url.toLowerCase();
  if ((config.excludeUrlIncludes ?? []).some((pattern) => lowerUrl.includes(pattern.toLowerCase()))) {
    return false;
  }
  return (config.jobUrlIncludes ?? [config.linkInclude ?? config.baseUrl]).some((pattern) =>
    lowerUrl.includes(pattern.toLowerCase())
  );
}

function urlsFromText(text: string, parserMode: string) {
  if (parserMode === "html") {
    return Array.from(text.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi))
      .map((match) => match[1] ?? "");
  }
  if (parserMode === "sitemap") {
    return Array.from(text.matchAll(/<loc>([\s\S]*?)<\/loc>/gi))
      .map((match) => cleanText(match[1]));
  }
  return Array.from(text.matchAll(/<link\b[^>]*href=["']([^"']+)["']|<link\b[^>]*>([\s\S]*?)<\/link>/gi))
    .map((match) => cleanText(match[1] ?? match[2] ?? ""));
}

function hasJobMarkers(text: string, config: CommercialSourceConfig) {
  const normalized = normalizeSignal(text);
  const urlMarkers = (config.jobUrlIncludes ?? []).some((pattern) =>
    normalized.includes(normalizeSignal(pattern))
  );
  return urlMarkers ||
    normalized.includes("entreprise :") ||
    normalized.includes("nombre de postes") ||
    normalized.includes("offre d'emploi") ||
    normalized.includes("offres d'emploi");
}

function reasonWhenZero(
  res: { ok: boolean; status: number; blocked: boolean; text: string },
  config: CommercialSourceConfig,
) {
  if (res.blocked) return "blocked_by_site";
  if (!res.ok) return res.status >= 500 ? "server_error" : "html_not_ok";
  if (!res.text.trim()) return "empty_body";
  if (!hasJobMarkers(res.text, config)) return config.reasonWhenZero ?? "no_static_job_markers";
  return config.reasonWhenZero ?? "no_detected_static_jobs";
}

function diagnosticForFetch(
  config: CommercialSourceConfig,
  res: {
    status: number;
    contentType: string;
    finalUrl: string;
    text: string;
    blocked: boolean;
    error?: string;
  },
  parserMode: string,
  parsedCount: number,
) {
  const candidateUrls = urlsFromText(res.text, parserMode);
  const detectedJobUrlCount = candidateUrls.filter((url) => isJobUrl(url, config)).length;
  const candidateUrlCount = candidateUrls.length;
  return {
    fetched_url: res.finalUrl,
    url: res.finalUrl,
    http_status: res.status,
    status: res.status,
    content_type: res.contentType,
    body_length: res.text.length,
    html_length: parserMode === "html" ? res.text.length : null,
    has_job_markers: hasJobMarkers(res.text, config),
    detected_job_url_count: detectedJobUrlCount,
    candidate_url_count: candidateUrlCount,
    rejected_candidate_count: Math.max(0, candidateUrlCount - detectedJobUrlCount),
    parser_mode: parserMode,
    reason_when_zero: parsedCount === 0 ? reasonWhenZero({ ...res, ok: res.status >= 200 && res.status < 300 }, config) : null,
    blocked: res.blocked,
    error: res.error,
  };
}

function buildJob(
  config: CommercialSourceConfig,
  input: {
    title: string;
    sourceUrl: string;
    publishedAt: string | null;
    expiresAt: string | null;
    description: string | null;
    index: number;
    payload: Record<string, unknown>;
  },
): CommercialSourceJob {
  return {
    external_id: `${config.sourceCode}:${input.sourceUrl || input.index}`,
    title: input.title,
    company_name: null,
    country: config.country,
    location: config.country,
    source_url: input.sourceUrl,
    apply_url: input.sourceUrl,
    published_at: input.publishedAt,
    expires_at: input.expiresAt,
    description_text: input.description,
    tags: [config.country, config.sourceFamily],
    payload: input.payload,
  };
}

function incrementCount(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function keepQuality(jobs: CommercialSourceJob[], config: CommercialSourceConfig) {
  const kept: CommercialSourceJob[] = [];
  let skippedQuality = 0;
  let skippedNonJob = 0;
  const rejectedCounts: Record<string, number> = {};
  for (const rawJob of jobs) {
    const job = config.postProcessJob ? config.postProcessJob(rawJob) : rawJob;
    const rejectReason = config.rejectJobReason?.(job);
    if (rejectReason) {
      incrementCount(rejectedCounts, rejectReason);
      skippedNonJob++;
      continue;
    }
    if (config.shouldSkipJob?.(job)) {
      skippedNonJob++;
      continue;
    }
    if (isExpired(job.expires_at) || isQualityBlocked(job)) {
      skippedQuality++;
      continue;
    }
    kept.push(job);
  }
  return { kept, skippedQuality, skippedNonJob, rejectedCounts };
}

export async function fetchCommercialSourceDryRun(config: CommercialSourceConfig): Promise<CommercialSourceResult> {
  const maxItems = Math.max(1, Math.min(config.maxItems ?? 50, config.maxItemsHardCap ?? 100));
  const maxPages = Math.max(1, Math.min(config.maxPages ?? 2, config.maxPagesHardCap ?? 5));
  const pageDelayMs = Math.max(0, config.pageDelayMs ?? 0);
  const minValidItemsPerPage = Math.max(0, config.minValidItemsPerPage ?? 0);
  const duplicatePageUrlRatioToStop = Math.max(0, Math.min(config.duplicatePageUrlRatioToStop ?? 1, 1));
  const items: CommercialSourceJob[] = [];
  const seenUrls = new Set<string>();
  let fetchedCount = 0;
  let feedsFetched = 0;
  let pagesFetched = 0;
  let sitemapsFetched = 0;
  let duplicateUrlCount = 0;
  let skippedQualityCount = 0;
  let skippedNonJobCount = 0;
  let stoppedReason = "exhausted_candidates";
  let paginationModeUsed = "none";
  const rejectedCounts: Record<string, number> = {};
  const diagnostics: unknown[] = [];
  const perPageValidCounts: number[] = [];

  function appendUnique(job: CommercialSourceJob) {
    if (seenUrls.has(job.source_url)) {
      duplicateUrlCount++;
      return false;
    }
    seenUrls.add(job.source_url);
    if (items.length >= maxItems) {
      return false;
    }
    items.push(job);
    return true;
  }

  if (!config.htmlOnly) {
    for (const feedUrl of config.feedUrls ?? []) {
      const res = await fetchText(feedUrl);
      if (res.blocked) return result(config, feedUrl, [], fetchedCount, feedsFetched, pagesFetched, skippedQualityCount, skippedNonJobCount, "blocked_by_site", diagnostics);
      if (!res.ok) {
        diagnostics.push(diagnosticForFetch(config, res, "feed", 0));
        continue;
      }
      feedsFetched++;
      const parsed = parseFeed(res.text, config);
      diagnostics.push(diagnosticForFetch(config, res, "feed", parsed.length));
      fetchedCount += parsed.length;
      const quality = keepQuality(parsed, config);
      skippedQualityCount += quality.skippedQuality;
      skippedNonJobCount += quality.skippedNonJob;
      mergeCounts(rejectedCounts, quality.rejectedCounts);
      for (const item of quality.kept) {
        appendUnique(item);
      }
      if (items.length >= maxItems) {
        stoppedReason = "limit_reached";
        break;
      }
    }
  }

  if (!config.htmlOnly && !config.fetchSitemapsAfterHtml && items.length < 3) {
    for (const sitemapUrl of config.sitemapUrls ?? []) {
      const res = await fetchText(sitemapUrl);
      if (res.blocked) return result(config, sitemapUrl, [], fetchedCount, feedsFetched, pagesFetched, skippedQualityCount, skippedNonJobCount, "blocked_by_site", diagnostics, sitemapsFetched, duplicateUrlCount, paginationModeUsed);
      if (!res.ok) {
        diagnostics.push(diagnosticForFetch(config, res, "sitemap", 0));
        continue;
      }
      sitemapsFetched++;
      const parsed = parseSitemap(res.text, config);
      diagnostics.push(diagnosticForFetch(config, res, "sitemap", parsed.length));
      fetchedCount += parsed.length;
      const quality = keepQuality(parsed, config);
      skippedQualityCount += quality.skippedQuality;
      skippedNonJobCount += quality.skippedNonJob;
      mergeCounts(rejectedCounts, quality.rejectedCounts);
      for (const item of quality.kept) {
        appendUnique(item);
      }
      if (items.length >= maxItems) {
        stoppedReason = "limit_reached";
        break;
      }
    }
  }

  if (!config.rssOnly && (items.length < 3 || (config.alwaysFetchStartPages && items.length < maxItems))) {
    for (let i = 0; i < maxPages; i++) {
      const startUrl = config.startUrls?.[i];
      if (!startUrl) break;
      if (pagesFetched > 0) {
        await delay(pageDelayMs);
      }
      const res = await fetchText(startUrl);
      if (res.blocked) return result(config, startUrl, [], fetchedCount, feedsFetched, pagesFetched, skippedQualityCount, skippedNonJobCount, "blocked_by_site", diagnostics, sitemapsFetched, duplicateUrlCount, paginationModeUsed, rejectedCounts, maxPages, perPageValidCounts);
      if (!res.ok) {
        diagnostics.push(diagnosticForFetch(config, res, "html", 0));
        stoppedReason = res.status >= 500 ? "server_error" : "html_not_ok";
        continue;
      }
      pagesFetched++;
      const parsed = config.parseHtmlJobs
        ? config.parseHtmlJobs(res.text, config, startUrl)
        : parseHtml(res.text, config, startUrl);
      diagnostics.push(diagnosticForFetch(config, res, "html", parsed.length));
      if (parsed.length === 0) {
        perPageValidCounts.push(0);
        stoppedReason = "html_structure_unstable";
        break;
      }
      paginationModeUsed = pagesFetched > 1 ? "multi_page_html" : "single_page_html";
      fetchedCount += parsed.length;
      const quality = keepQuality(parsed, config);
      perPageValidCounts.push(quality.kept.length);
      skippedQualityCount += quality.skippedQuality;
      skippedNonJobCount += quality.skippedNonJob;
      mergeCounts(rejectedCounts, quality.rejectedCounts);
      const repeatedUrlCount = quality.kept.filter((item) => seenUrls.has(item.source_url)).length;
      const repeatedUrlRatio = quality.kept.length > 0 ? repeatedUrlCount / quality.kept.length : 0;
      if (pagesFetched > 1 && repeatedUrlRatio >= duplicatePageUrlRatioToStop) {
        stoppedReason = "duplicate_pagination_page";
        break;
      }
      for (const item of quality.kept) {
        appendUnique(item);
      }
      if (minValidItemsPerPage > 0 && quality.kept.length < minValidItemsPerPage) {
        stoppedReason = quality.kept.length === 0 ? "empty_pagination_page" : "low_valid_count_page";
        break;
      }
      if (items.length >= maxItems) {
        stoppedReason = "limit_reached";
        if (!config.probeAllStartPages) break;
      }
    }
  }

  if (!config.htmlOnly && config.fetchSitemapsAfterHtml && items.length < maxItems) {
    for (const sitemapUrl of config.sitemapUrls ?? []) {
      const res = await fetchText(sitemapUrl);
      if (res.blocked) return result(config, sitemapUrl, [], fetchedCount, feedsFetched, pagesFetched, skippedQualityCount, skippedNonJobCount, "blocked_by_site", diagnostics, sitemapsFetched, duplicateUrlCount, paginationModeUsed);
      if (!res.ok) {
        diagnostics.push(diagnosticForFetch(config, res, "sitemap", 0));
        continue;
      }
      sitemapsFetched++;
      const parsed = parseSitemap(res.text, config);
      diagnostics.push(diagnosticForFetch(config, res, "sitemap", parsed.length));
      fetchedCount += parsed.length;
      const quality = keepQuality(parsed, config);
      skippedQualityCount += quality.skippedQuality;
      skippedNonJobCount += quality.skippedNonJob;
      mergeCounts(rejectedCounts, quality.rejectedCounts);
      for (const item of quality.kept) {
        appendUnique(item);
      }
      if (items.length >= maxItems) {
        stoppedReason = "limit_reached";
        break;
      }
    }
  }

  if (items.length === 0 && config.stoppedReasonWhenEmpty) {
    stoppedReason = config.stoppedReasonWhenEmpty;
  }

  return result(config, config.startUrls?.[0] ?? config.feedUrls?.[0] ?? config.baseUrl, items.slice(0, maxItems), fetchedCount, feedsFetched, pagesFetched, skippedQualityCount, skippedNonJobCount, stoppedReason, diagnostics, sitemapsFetched, duplicateUrlCount, paginationModeUsed, rejectedCounts, maxPages, perPageValidCounts);
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

function result(
  config: CommercialSourceConfig,
  listUrl: string,
  items: CommercialSourceJob[],
  fetchedCount: number,
  feedsFetched: number,
  pagesFetched: number,
  skippedQualityCount: number,
  skippedNonJobCount: number,
  stoppedReason: string,
  diagnostics: unknown[],
  sitemapsFetched = 0,
  duplicateUrlCount = 0,
  paginationModeUsed = "none",
  rejectedCounts: Record<string, number> = {},
  maxPagesUsed = 0,
  perPageValidCounts: number[] = [],
): CommercialSourceResult {
  const countryUnknownCount = items.filter((item) => !item.country || item.country === "Unknown").length;
  return {
    ok: true,
    source_code: config.sourceCode,
    source_family: config.sourceFamily,
    dry_run: true,
    detected_country: config.country,
    list_url: listUrl,
    parsed_count: items.length,
    fetched_count: fetchedCount,
    feeds_fetched: feedsFetched,
    pages_fetched: pagesFetched,
    skipped_quality_count: skippedQualityCount,
    stopped_reason: stoppedReason,
    sample_jobs: items.slice(0, 10),
    items,
    meta: {
      diagnostics,
      sitemaps_fetched: sitemapsFetched,
      feeds_fetched: feedsFetched,
      pages_fetched: pagesFetched,
      unique_url_count: items.length,
      duplicate_url_count: duplicateUrlCount,
      rejected_social_url_count: rejectedCounts.rejected_social_url_count ?? 0,
      rejected_navigation_url_count: rejectedCounts.rejected_navigation_url_count ?? 0,
      rejected_missing_company_count: rejectedCounts.rejected_missing_company_count ?? 0,
      rejected_invalid_job_url_count: rejectedCounts.rejected_invalid_job_url_count ?? 0,
      pagination_mode_used: paginationModeUsed,
      parser_mode: paginationModeUsed.includes("html") ? config.htmlParserMode ?? "html" : paginationModeUsed,
      stopped_reason: stoppedReason,
      max_pages_used: maxPagesUsed,
      per_page_valid_counts: perPageValidCounts,
      skipped_non_job_count: skippedNonJobCount,
      country_detected_count: items.length - countryUnknownCount,
      country_unknown_count: countryUnknownCount,
    },
  };
}
