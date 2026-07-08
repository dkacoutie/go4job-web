// supabase/functions/ingest_source/sources/emploi_ci.ts

export type EmploiCiItem = {
  external_id: string;
  title: string;
  source_url: string;
  apply_url: string;
  country: "CI";
  country_codes: string[];
  location: string | null;
  company_name: string | null;
  contract_type: string | null;
  description_text: string | null;
  published_at: string | null;
  expires_at: string | null;
};

export type EmploiCiPageStat = {
  page: number;
  url: string;
  parsed_count: number;
  added_count: number;
  duplicate_count: number;
};

const BASE_URL = "https://emploi.educarriere.ci";
const FIRST_PAGE_URL = `${BASE_URL}/nos-offres`;
const DEFAULT_MAX_PAGES = 31;
const FETCH_DELAY_MS = 250;
const CONTRACT_TYPES = new Set([
  "emploi",
  "stage",
  "interim",
  "freelance",
  "consultance",
  "cdd",
  "cdi",
]);

function absUrl(href: string) {
  if (href.startsWith("http")) return href;
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
}

function safeDecodeURIComponent(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function titleFromSlug(slug: string) {
  const cleaned = slug
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  const decoded = safeDecodeURIComponent(cleaned);

  return decoded
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function pageUrl(page: number) {
  return page <= 1 ? FIRST_PAGE_URL : `${BASE_URL}/emploi/page/emploi/${page}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)))
    .replace(
      /&#x([a-f0-9]+);/gi,
      (_all, code) => String.fromCharCode(parseInt(code, 16)),
    );
}

function cleanText(value: string | null | undefined) {
  return decodeHtmlEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrenchDate(value: string | null | undefined) {
  const text = cleanText(value);
  const match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year || month > 12 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function stableUrlExternalId(url: string) {
  return `educarriere:url:${url.toLowerCase().replace(/\/+$/, "")}`;
}

function extractMaxPages(html: string) {
  const text = stripHtml(html);
  const fromLabel = text.match(
    /Page\s*n(?:\u00b0|\u00ba)?\s*\d+\s*sur\s*(\d+)/i,
  );
  if (fromLabel) return Number(fromLabel[1]);

  let max = 1;
  const pageLinkRe = /\/emploi\/page\/emploi\/(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pageLinkRe.exec(html)) !== null) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

function extractField(segmentText: string, label: string) {
  const re = new RegExp(
    `${label}\\s*:\\s*([^:]+?)(?=\\s+(?:Code|Date d['\\u2019]\\u00e9dition|Date limite)\\s*:|$)`,
    "i",
  );
  return cleanText(segmentText.match(re)?.[1]);
}

function extractContractType(anchorTexts: string[]) {
  for (const text of anchorTexts) {
    const cleaned = cleanText(text);
    if (CONTRACT_TYPES.has(cleaned.toLowerCase())) return cleaned;
  }
  return null;
}

function extractTitle(anchorTexts: string[], slug: string) {
  const candidates = anchorTexts
    .map(cleanText)
    .filter((text) => text && !CONTRACT_TYPES.has(text.toLowerCase()));
  return candidates.sort((a, b) => b.length - a.length)[0] ??
    titleFromSlug(slug);
}

function parseOffersFromHtml(html: string) {
  const linkRe =
    /<a\b[^>]*href=["']([^"']*\/offre-(\d+)-([^"']+?)\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches: Array<{
    href: string;
    offerId: string;
    slug: string;
    text: string;
    index: number;
  }> = [];

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    matches.push({
      href: m[1],
      offerId: m[2],
      slug: m[3] ?? "",
      text: stripHtml(m[4]),
      index: m.index,
    });
  }

  const grouped = new Map<string, typeof matches>();
  for (const match of matches) {
    const group = grouped.get(match.offerId) ?? [];
    group.push(match);
    grouped.set(match.offerId, group);
  }

  const offers: EmploiCiItem[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const nextIndex = matches.find((candidate) =>
      candidate.index > first.index && candidate.offerId !== first.offerId
    )?.index ?? html.length;
    const segment = html.slice(first.index, nextIndex);
    const segmentText = stripHtml(segment);
    const sourceUrl = absUrl(first.href);
    const external_id = first.offerId
      ? `educarriere:${first.offerId}`
      : stableUrlExternalId(sourceUrl);
    const anchorTexts = group.map((item) =>
      item.text
    );
    const dateEdition = extractField(
      segmentText,
      String.raw`Date d['\u2019]\u00e9dition`,
    );
    const dateLimite = extractField(segmentText, "Date limite");

    offers.push({
      external_id,
      title: extractTitle(anchorTexts, first.slug),
      source_url: sourceUrl,
      apply_url: sourceUrl,
      country: "CI",
      country_codes: ["CI"],
      location: "Cote d'Ivoire",
      company_name: null,
      contract_type: extractContractType(anchorTexts),
      description_text: null,
      published_at: parseFrenchDate(dateEdition),
      expires_at: parseFrenchDate(dateLimite),
    });
  }

  return offers;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
      "accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(
      `emploi_ci list fetch failed: ${res.status} ${res.statusText}`,
    );
  }

  return await res.text();
}

export async function fetchEmploiCiItems(
  limit = 30,
  options?: { maxPages?: number; startPage?: number },
) {
  const capped = Math.max(1, Math.trunc(limit));
  const startPage = Math.max(1, Math.trunc(options?.startPage ?? 1));
  let maxPages = Math.max(
    1,
    Math.trunc(options?.maxPages ?? DEFAULT_MAX_PAGES),
  );
  let lastRequestedPage = startPage + maxPages - 1;
  const items: EmploiCiItem[] = [];
  const seen = new Set<string>();
  const pageStats: EmploiCiPageStat[] = [];
  let pagesFetched = 0;
  let stoppedReason = "max_pages_reached";

  for (let page = startPage; page <= lastRequestedPage; page++) {
    const url = pageUrl(page);
    const html = await fetchPage(url);
    pagesFetched++;

    if (page === 1) {
      maxPages = Math.min(maxPages, Math.max(1, extractMaxPages(html)));
      lastRequestedPage = startPage + maxPages - 1;
    }

    const pageOffers = parseOffersFromHtml(html);
    if (pageOffers.length === 0) {
      pageStats.push({
        page,
        url,
        parsed_count: 0,
        added_count: 0,
        duplicate_count: 0,
      });
      stoppedReason = "empty_page";
      break;
    }

    let addedFromPage = 0;
    let duplicateFromPage = 0;
    for (const item of pageOffers) {
      if (seen.has(item.external_id)) {
        duplicateFromPage++;
        stoppedReason = "duplicate_external_id";
        page = lastRequestedPage + 1;
        break;
      }
      seen.add(item.external_id);
      items.push(item);
      addedFromPage++;

      if (items.length >= capped) {
        stoppedReason = "limit_reached";
        break;
      }
    }

    pageStats.push({
      page,
      url,
      parsed_count: pageOffers.length,
      added_count: addedFromPage,
      duplicate_count: duplicateFromPage,
    });

    if (items.length >= capped || stoppedReason === "duplicate_external_id") {
      break;
    }
    if (addedFromPage === 0) {
      stoppedReason = "empty_page";
      break;
    }
    if (page < lastRequestedPage) await delay(FETCH_DELAY_MS);
  }

  return {
    list_url: FIRST_PAGE_URL,
    effective_start_page: startPage,
    effective_max_pages: maxPages,
    pages_fetched: pagesFetched,
    page_stats: pageStats,
    parsed_count_by_page: Object.fromEntries(
      pageStats.map((stat) => [String(stat.page), stat.added_count]),
    ),
    parsed: items.length,
    stopped_reason: stoppedReason,
    sample: items.slice(0, 3),
    items,
  };
}
