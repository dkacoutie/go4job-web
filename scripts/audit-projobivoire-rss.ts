type ParsedArgs = {
  maxPages: number;
};

type RssItem = {
  title: string | null;
  link: string | null;
  guid: string | null;
  wp_post_id: string | null;
  pubDate: string | null;
  description: string | null;
  content_encoded: string | null;
  company: string | null;
  address: string | null;
  closing: string | null;
  type: string | null;
  category: string | null;
  external_id_candidate: string | null;
  canonical_url_candidate: string | null;
  country_classification: "probable_ci" | "probable_non_ci" | "ambiguous" | "unknown";
  is_expired: boolean | null;
};

const SOURCE_CODE_CANDIDATE = "projobivoire_rss";
const BASE_FEED_URL = "https://projobivoire.com/jobs/feed/";
const DEFAULT_MAX_PAGES = 3;
const HARD_MAX_PAGES = 5;
const PAGE_DELAY_MS = 750;
const REQUEST_TIMEOUT_MS = 15000;

const CI_SIGNALS = [
  "cote d'ivoire",
  "côte d'ivoire",
  "cote divoire",
  "côte divoire",
  "ivoirien",
  "ivoirienne",
  "abidjan",
  "yopougon",
  "cocody",
  "bouake",
  "bouaké",
  "san pedro",
  "korhogo",
  "daloa",
  "riviéra",
  "riviera",
  "bonoumin",
  "plateau",
  "treichville",
  "marcory",
  "koumassi",
  "bingerville",
];

const NON_CI_SIGNALS = [
  "benin",
  "bénin",
  "mali",
  "senegal",
  "sénégal",
  "cameroun",
  "cameroon",
  "burkina",
  "togo",
  "niger",
  "ghana",
  "guinea",
  "guinée",
  "dakar",
  "bamako",
  "douala",
  "cotonou",
  "lome",
  "lomé",
  "ouagadougou",
];

function parseArgs(): ParsedArgs {
  const rawMaxPages = getArgValue("maxPages") ?? Deno.env.get("MAX_PAGES") ??
    String(DEFAULT_MAX_PAGES);
  const parsed = Number(rawMaxPages);
  const normalized = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : DEFAULT_MAX_PAGES;

  return {
    maxPages: Math.max(1, Math.min(normalized, HARD_MAX_PAGES)),
  };
}

function getArgValue(name: string) {
  const prefix = `--${name}=`;
  for (let index = 0; index < Deno.args.length; index += 1) {
    const arg = Deno.args[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) return Deno.args[index + 1] ?? null;
  }
  return null;
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
    .replace(/&agrave;/g, "à")
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

function hasAnySignal(text: string, signals: string[]) {
  return signals.some((signal) => {
    const normalized = escapeRegex(normalizeForSignal(signal))
      .replace(/\\ /g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${normalized}([^a-z0-9]|$)`, "i")
      .test(text);
  });
}

function classifyCountry(item: Pick<RssItem, "title" | "address" | "description" | "content_encoded">) {
  const text = normalizeForSignal([
    item.title,
    item.address,
    item.description,
    stripHtml(item.content_encoded),
  ].filter(Boolean).join(" "));
  const hasCi = hasAnySignal(text, CI_SIGNALS);
  const hasNonCi = hasAnySignal(text, NON_CI_SIGNALS);

  if (hasCi && hasNonCi) return "ambiguous";
  if (hasCi) return "probable_ci";
  if (hasNonCi) return "probable_non_ci";
  return "unknown";
}

function parseFrenchClosingDate(value: string | null) {
  const text = normalizeForSignal(value);
  if (!text) return null;

  const months: Record<string, number> = {
    janvier: 0,
    fevrier: 1,
    février: 1,
    mars: 2,
    avril: 3,
    mai: 4,
    juin: 5,
    juillet: 6,
    aout: 7,
    août: 7,
    septembre: 8,
    octobre: 9,
    novembre: 10,
    decembre: 11,
    décembre: 11,
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

function parseRssItems(xml: string) {
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  const items: RssItem[] = [];

  for (const match of matches) {
    const itemXml = match[1];
    const guid = tagValue(itemXml, "guid");
    const wpPostId = extractWpPostId(guid);
    const item: RssItem = {
      title: tagValue(itemXml, "title"),
      link: tagValue(itemXml, "link"),
      guid,
      wp_post_id: wpPostId,
      pubDate: tagValue(itemXml, "pubDate"),
      description: stripHtml(tagValue(itemXml, "description")),
      content_encoded: tagValue(itemXml, "content:encoded"),
      company: tagValue(itemXml, "job:company"),
      address: tagValue(itemXml, "job:address"),
      closing: tagValue(itemXml, "job:closing"),
      type: tagValue(itemXml, "job:type"),
      category: tagValue(itemXml, "job:category"),
      external_id_candidate: wpPostId ? `projobivoire:${wpPostId}` : null,
      canonical_url_candidate: tagValue(itemXml, "link"),
      country_classification: "unknown",
      is_expired: null,
    };
    item.country_classification = classifyCountry(item);
    item.is_expired = isExpired(item.closing);
    items.push(item);
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

function isoDateOrNull(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildReport(items: RssItem[], pagesFetched: number, parseErrors: string[]) {
  const pubDates = items
    .map((item) => isoDateOrNull(item.pubDate))
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    ok: parseErrors.length === 0,
    dry_run: true,
    source_code_candidate: SOURCE_CODE_CANDIDATE,
    pages_fetched: pagesFetched,
    items_fetched: items.length,
    items_parsed: items.length,
    parse_errors: parseErrors,
    newest_pub_date: pubDates.at(-1) ?? null,
    oldest_pub_date: pubDates[0] ?? null,
    items_with_company: countWhere(items, (item) => Boolean(item.company)),
    items_with_address: countWhere(items, (item) => Boolean(item.address)),
    items_with_closing: countWhere(items, (item) => Boolean(item.closing)),
    items_with_type: countWhere(items, (item) => Boolean(item.type)),
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
    expired_count: countWhere(items, (item) => item.is_expired === true),
    active_or_unknown_count: countWhere(items, (item) => item.is_expired !== true),
    sample_items: items.slice(0, 5).map((item) => ({
      title: item.title,
      link: item.link,
      wp_post_id: item.wp_post_id,
      pubDate: item.pubDate,
      company: item.company,
      address: item.address,
      closing: item.closing,
      type: item.type,
      category: item.category,
      country_classification: item.country_classification,
      is_expired: item.is_expired,
      external_id_candidate: item.external_id_candidate,
      canonical_url_candidate: item.canonical_url_candidate,
    })),
  };
}

if (import.meta.main) {
  const args = parseArgs();
  const allItems: RssItem[] = [];
  const parseErrors: string[] = [];
  let pagesFetched = 0;

  for (let page = 1; page <= args.maxPages; page += 1) {
    const url = feedUrlForPage(page);
    try {
      const response = await fetchText(url);
      if (!response.ok) {
        parseErrors.push(`page_${page}_http_${response.status}`);
        continue;
      }
      if (!response.contentType?.toLowerCase().includes("rss") &&
        !response.contentType?.toLowerCase().includes("xml")) {
        parseErrors.push(`page_${page}_unexpected_content_type:${response.contentType}`);
      }
      const pageItems = parseRssItems(response.text);
      pagesFetched += 1;
      allItems.push(...pageItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseErrors.push(`page_${page}_fetch_failed:${message}`);
    }

    if (page < args.maxPages) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  console.log(JSON.stringify(buildReport(allItems, pagesFetched, parseErrors), null, 2));
}
