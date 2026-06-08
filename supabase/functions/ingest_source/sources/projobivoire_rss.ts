export type ProjobivoireRssDryRunOptions = {
  dryRun: boolean;
  maxPages?: number;
  limit?: number;
  includeItemsForDbCompare?: boolean;
  includeItemsForImport?: boolean;
};

type CountryClassification = "probable_ci" | "probable_non_ci" | "ambiguous";

export type ProjobivoireRssCompareItem = {
  external_id_candidate: string | null;
  canonical_url_candidate: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  published_at: string | null;
  expires_at: string | null;
  job_type: string | null;
  category: string | null;
  country_classification: CountryClassification;
  classification_reasons: string[];
  is_expired: boolean | null;
  wp_post_id: string | null;
};

type ProjobivoireRssItem = ProjobivoireRssCompareItem & {
  wp_post_id: string | null;
  guid: string | null;
  description: string | null;
  content_encoded: string | null;
};

export type ProjobivoireRssImportItem = {
  external_id: string | null;
  source_url: string | null;
  apply_url: string | null;
  title: string | null;
  company_name: string | null;
  location: string | null;
  published_at: string | null;
  expires_at: string | null;
  expires_at_iso: string | null;
  contract_type: string | null;
  category: string | null;
  country_classification: CountryClassification;
  classification_reasons: string[];
  is_expired: boolean | null;
  wp_post_id: string | null;
  guid: string | null;
  description_text: string | null;
  description_html: string | null;
};

export type ProjobivoireRssDryRunResult = {
  ok: boolean;
  dry_run: true;
  source_code: "projobivoire_rss";
  fetched_count: number;
  would_insert_count: 0;
  would_update_count: 0;
  skipped_count: number;
  diagnostics: {
    pages_fetched: number;
    rss_items: number;
    items_parsed: number;
    parse_errors: string[];
    newest_pub_date: string | null;
    oldest_pub_date: string | null;
    items_with_company: number;
    items_with_address: number;
    items_with_closing: number;
    items_with_type: number;
    items_with_category: number;
    items_with_description: number;
    items_with_stable_wp_post_id: number;
    probable_ci_count: number;
    probable_non_ci_count: number;
    ambiguous_country_count: number;
    expired_count: number;
    active_or_unknown_count: number;
    internal_duplicate_count: number;
  };
  items_for_db_compare?: ProjobivoireRssCompareItem[];
  items_for_import?: ProjobivoireRssImportItem[];
  sample_items: Array<{
    external_id_candidate: string | null;
    canonical_url_candidate: string | null;
    title: string | null;
    company: string | null;
    location: string | null;
    published_at: string | null;
    expires_at: string | null;
    job_type: string | null;
    category: string | null;
    country_classification: CountryClassification;
    classification_reasons: string[];
    is_expired: boolean | null;
  }>;
};

const SOURCE_CODE = "projobivoire_rss" as const;
const BASE_FEED_URL = "https://projobivoire.com/jobs/feed/";
const DEFAULT_MAX_PAGES = 3;
const HARD_MAX_PAGES = 5;
const DEFAULT_LIMIT = 30;
const HARD_LIMIT = 50;
const PAGE_DELAY_MS = 750;
const REQUEST_TIMEOUT_MS = 15000;

const CI_SIGNALS = [
  "Côte d'Ivoire",
  "Cote d'Ivoire",
  "Côte d’Ivoire",
  "Cote d’Ivoire",
  "CI",
  "Abidjan",
  "Yopougon",
  "Cocody",
  "Bouaké",
  "Bouake",
  "San Pedro",
  "San-Pédro",
  "San-Pedro",
  "Korhogo",
  "Daloa",
  "Yamoussoukro",
  "Man",
];

const NON_CI_SIGNALS = [
  "Bamako",
  "Dakar",
  "LomÃ©",
  "Lome",
  "Cotonou",
  "Niamey",
  "Ouagadougou",
  "YaoundÃ©",
  "Yaounde",
  "Douala",
  "Accra",
  "Lagos",
  "Conakry",
  "Kinshasa",
  "Bénin",
  "Benin",
  "Mali",
  "Sénégal",
  "Senegal",
  "Cameroun",
  "Cameroon",
  "Burkina",
  "Togo",
  "Niger",
  "Ghana",
  "Nigeria",
  "GuinÃ©e",
  "Guinee",
  "RDC",
  "Congo",
];

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function feedUrlForPage(page: number) {
  if (page <= 1) return BASE_FEED_URL;
  return `${BASE_FEED_URL}?paged=${page}`;
}

function decodeHtml(value: string | null) {
  if (!value) return null;
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&lsquo;|&#8216;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&mdash;|&#8212;/g, "-")
    .replace(/&eacute;/g, "é")
    .replace(/&Eacute;/g, "É")
    .replace(/&egrave;/g, "è")
    .replace(/&Egrave;/g, "È")
    .replace(/&agrave;/g, "à")
    .replace(/&Agrave;/g, "À")
    .replace(/&ocirc;/g, "ô")
    .replace(/&deg;/g, "°")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim() || null;
}

function stripHtml(value: string | null) {
  if (!value) return null;
  return decodeHtml(
    value
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function tagValue(xml: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)</${escaped}>`, "i"));
  return decodeHtml(match?.[1] ?? null);
}

function extractWpPostId(guid: string | null) {
  if (!guid) return null;
  const match = guid.match(/[?&]p=(\d+)/);
  return match?.[1] ?? null;
}

function normalizeForSignal(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectSignals(text: string, signals: string[]) {
  const found: string[] = [];
  for (const signal of signals) {
    const normalized = escapeRegex(normalizeForSignal(signal)).replace(/\\ /g, "\\s+");
    const pattern = new RegExp(`(^|[^a-z0-9])${normalized}([^a-z0-9]|$)`, "i");
    if (pattern.test(text)) found.push(signal);
  }
  return [...new Set(found)];
}

function collectSignalsWithPrefix(
  text: string,
  signals: string[],
  prefix: string,
) {
  return collectSignals(text, signals).map((signal) => `${prefix}_${signal}`);
}

function ciReason(signal: string) {
  return signal.toLowerCase().includes("abidjan")
    ? "ci_signal:address_abidjan"
    : `ci_signal:${signal}`;
}

function classifyCountry(item: Pick<
  ProjobivoireRssItem,
  | "title"
  | "canonical_url_candidate"
  | "location"
  | "description"
  | "content_encoded"
>) {
  const titleText = normalizeForSignal(item.title);
  const urlText = normalizeForSignal(item.canonical_url_candidate);
  const locationText = normalizeForSignal(item.location);
  const bodyText = normalizeForSignal([
    item.description,
    stripHtml(item.content_encoded),
  ].filter(Boolean).join(" "));
  const text = normalizeForSignal([
    item.title,
    item.canonical_url_candidate,
    item.location,
    item.description,
    stripHtml(item.content_encoded),
  ].filter(Boolean).join(" "));
  const ciSignals = collectSignals(text, CI_SIGNALS);
  const nonCiSignals = [
    ...collectSignalsWithPrefix(titleText, NON_CI_SIGNALS, "title"),
    ...collectSignalsWithPrefix(urlText, NON_CI_SIGNALS, "url"),
    ...collectSignalsWithPrefix(locationText, NON_CI_SIGNALS, "address"),
    ...collectSignalsWithPrefix(bodyText, NON_CI_SIGNALS, "body"),
  ];

  if (ciSignals.length > 0 && nonCiSignals.length === 0) {
    return {
      country_classification: "probable_ci" as const,
      classification_reasons: ciSignals.map(ciReason),
    };
  }

  if (nonCiSignals.length > 0) {
    const nonCiReasons = nonCiSignals.map((signal) => `non_ci_signal:${signal}`);
    if (ciSignals.length > 0) {
      return {
        country_classification: "ambiguous" as const,
        classification_reasons: [
          ...ciSignals.map(ciReason),
          ...nonCiReasons,
          "conflict:ci_and_non_ci_signals",
          "excluded_from_ci_due_to_non_ci_geo_signal",
        ],
      };
    }
    return {
      country_classification: "probable_non_ci" as const,
      classification_reasons: [
        ...nonCiReasons,
        "excluded_from_ci_due_to_non_ci_geo_signal",
      ],
    };
  }

  return {
    country_classification: "ambiguous" as const,
    classification_reasons: [
      ...ciSignals.map(ciReason),
      "no_country_signal",
    ],
  };
}

function parseFrenchClosingDate(value: string | null) {
  const text = normalizeForSignal(value);
  if (!text) return null;

  const months: Record<string, number> = {
    janvier: 0,
    fevrier: 1,
    mars: 2,
    avril: 3,
    mai: 4,
    juin: 5,
    juillet: 6,
    aout: 7,
    septembre: 8,
    octobre: 9,
    novembre: 10,
    decembre: 11,
  };
  const match = text.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = months[match[2]];
  const year = Number(match[3]);
  if (!Number.isInteger(day) || month === undefined || !Number.isInteger(year)) {
    return null;
  }
  return new Date(Date.UTC(year, month, day, 23, 59, 59));
}

function isExpired(closing: string | null, now = new Date()) {
  const closingDate = parseFrenchClosingDate(closing);
  if (!closingDate) return null;
  return closingDate.getTime() < now.getTime();
}

function closingDateIso(closing: string | null) {
  return parseFrenchClosingDate(closing)?.toISOString() ?? null;
}

function parsePubDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRssItem(itemXml: string) {
  const guid = tagValue(itemXml, "guid");
  const wpPostId = extractWpPostId(guid);
  const description = stripHtml(tagValue(itemXml, "description"));
  const item: ProjobivoireRssItem = {
    external_id_candidate: wpPostId ? `projobivoire:${wpPostId}` : null,
    canonical_url_candidate: tagValue(itemXml, "link"),
    title: tagValue(itemXml, "title"),
    company: tagValue(itemXml, "job:company"),
    location: tagValue(itemXml, "job:address"),
    published_at: parsePubDate(tagValue(itemXml, "pubDate")),
    expires_at: tagValue(itemXml, "job:closing"),
    job_type: tagValue(itemXml, "job:type"),
    category: tagValue(itemXml, "job:category"),
    country_classification: "ambiguous",
    classification_reasons: [],
    is_expired: null,
    wp_post_id: wpPostId,
    guid,
    description,
    content_encoded: tagValue(itemXml, "content:encoded"),
  };
  const classification = classifyCountry(item);
  item.country_classification = classification.country_classification;
  item.classification_reasons = classification.classification_reasons;
  item.is_expired = isExpired(item.expires_at);
  return item;
}

function parseRssItems(xml: string, page: number, parseErrors: string[]) {
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const items: ProjobivoireRssItem[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    try {
      items.push(parseRssItem(matches[index][1]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseErrors.push(`page_${page}_item_${index + 1}_parse_failed:${message}`);
    }
  }
  return items;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countWhere<T>(items: T[], predicate: (item: T) => boolean) {
  return items.filter(predicate).length;
}

function normalizedKey(value: string | null) {
  return normalizeForSignal(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countInternalDuplicates(items: ProjobivoireRssItem[]) {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const item of items) {
    const keys = [
      item.wp_post_id ? `wp:${item.wp_post_id}` : null,
      item.canonical_url_candidate ? `url:${item.canonical_url_candidate}` : null,
      item.title && item.company && item.expires_at
        ? `identity:${normalizedKey(item.title)}|${normalizedKey(item.company)}|${
          normalizedKey(item.expires_at)
        }`
        : null,
    ].filter((value): value is string => Boolean(value));

    if (keys.some((key) => seen.has(key))) {
      duplicates += 1;
    }
    for (const key of keys) seen.add(key);
  }
  return duplicates;
}

function buildResult(
  items: ProjobivoireRssItem[],
  pagesFetched: number,
  parseErrors: string[],
  includeItemsForDbCompare: boolean,
  includeItemsForImport: boolean,
): ProjobivoireRssDryRunResult {
  const pubDates = items
    .map((item) => item.published_at)
    .filter((value): value is string => Boolean(value))
    .sort();
  const internalDuplicateCount = countInternalDuplicates(items);
  const expiredCount = countWhere(items, (item) => item.is_expired === true);

  const result: ProjobivoireRssDryRunResult = {
    ok: parseErrors.length === 0,
    dry_run: true,
    source_code: SOURCE_CODE,
    fetched_count: items.length,
    would_insert_count: 0,
    would_update_count: 0,
    skipped_count: expiredCount + internalDuplicateCount,
    diagnostics: {
      pages_fetched: pagesFetched,
      rss_items: items.length,
      items_parsed: items.length,
      parse_errors: parseErrors,
      newest_pub_date: pubDates.at(-1) ?? null,
      oldest_pub_date: pubDates[0] ?? null,
      items_with_company: countWhere(items, (item) => Boolean(item.company)),
      items_with_address: countWhere(items, (item) => Boolean(item.location)),
      items_with_closing: countWhere(items, (item) => Boolean(item.expires_at)),
      items_with_type: countWhere(items, (item) => Boolean(item.job_type)),
      items_with_category: countWhere(items, (item) => Boolean(item.category)),
      items_with_description: countWhere(items, (item) =>
        Boolean(item.description) || Boolean(item.content_encoded)
      ),
      items_with_stable_wp_post_id: countWhere(items, (item) =>
        Boolean(item.wp_post_id)
      ),
      probable_ci_count: countWhere(items, (item) =>
        item.country_classification === "probable_ci"
      ),
      probable_non_ci_count: countWhere(items, (item) =>
        item.country_classification === "probable_non_ci"
      ),
      ambiguous_country_count: countWhere(items, (item) =>
        item.country_classification === "ambiguous"
      ),
      expired_count: expiredCount,
      active_or_unknown_count: countWhere(items, (item) => item.is_expired !== true),
      internal_duplicate_count: internalDuplicateCount,
    },
    sample_items: items.slice(0, 5).map((item) => ({
      external_id_candidate: item.external_id_candidate,
      canonical_url_candidate: item.canonical_url_candidate,
      title: item.title,
      company: item.company,
      location: item.location,
      published_at: item.published_at,
      expires_at: item.expires_at,
      job_type: item.job_type,
      category: item.category,
      country_classification: item.country_classification,
      classification_reasons: item.classification_reasons,
      is_expired: item.is_expired,
    })),
  };

  if (includeItemsForDbCompare) {
    result.items_for_db_compare = items.map((item) => ({
      external_id_candidate: item.external_id_candidate,
      canonical_url_candidate: item.canonical_url_candidate,
      title: item.title,
      company: item.company,
      location: item.location,
      published_at: item.published_at,
      expires_at: item.expires_at,
      job_type: item.job_type,
      category: item.category,
      country_classification: item.country_classification,
      classification_reasons: item.classification_reasons,
      is_expired: item.is_expired,
      wp_post_id: item.wp_post_id,
    }));
  }

  if (includeItemsForImport) {
    result.items_for_import = items.map((item) => ({
      external_id: item.external_id_candidate,
      source_url: item.canonical_url_candidate,
      apply_url: item.canonical_url_candidate,
      title: item.title,
      company_name: item.company,
      location: item.location,
      published_at: item.published_at,
      expires_at: item.expires_at,
      expires_at_iso: closingDateIso(item.expires_at),
      contract_type: item.job_type,
      category: item.category,
      country_classification: item.country_classification,
      classification_reasons: item.classification_reasons,
      is_expired: item.is_expired,
      wp_post_id: item.wp_post_id,
      guid: item.guid,
      description_text: item.description ?? stripHtml(item.content_encoded),
      description_html: item.content_encoded,
    }));
  }

  return result;
}

export async function fetchProjobivoireRssDryRun(
  opts: ProjobivoireRssDryRunOptions,
): Promise<ProjobivoireRssDryRunResult> {
  if (opts.dryRun !== true) {
    throw new Error("SAFETY: projobivoire_rss dry_run must be true");
  }

  const maxPages = boundedInt(opts.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const limit = boundedInt(opts.limit, DEFAULT_LIMIT, 1, HARD_LIMIT);
  const parseErrors: string[] = [];
  const allItems: ProjobivoireRssItem[] = [];
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages && allItems.length < limit; page += 1) {
    try {
      const response = await fetchText(feedUrlForPage(page));
      if (!response.ok) {
        parseErrors.push(`page_${page}_http_${response.status}`);
        continue;
      }
      const contentType = response.contentType?.toLowerCase() ?? "";
      if (!contentType.includes("rss") && !contentType.includes("xml")) {
        parseErrors.push(`page_${page}_unexpected_content_type:${response.contentType}`);
      }
      pagesFetched += 1;
      const pageItems = parseRssItems(response.text, page, parseErrors);
      allItems.push(...pageItems);
      if (pageItems.length === 0) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseErrors.push(`page_${page}_fetch_failed:${message}`);
    }

    if (page < maxPages && allItems.length < limit) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  return buildResult(
    allItems.slice(0, limit),
    pagesFetched,
    parseErrors,
    opts.includeItemsForDbCompare === true,
    opts.includeItemsForImport === true,
  );
}
