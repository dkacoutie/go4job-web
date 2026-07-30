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
  html_bytes: number;
  raw_link_count: number;
  parsed_count: number;
  added_count: number;
  duplicate_count: number;
  marker_count: number;
};

const BASE_URL = "https://emploi.educarriere.ci";
const FIRST_PAGE_URL = `${BASE_URL}/emploi-accueil`;
const DEFAULT_MAX_PAGES = 75;
const DEFAULT_MAX_CONSECUTIVE_PAGES_WITHOUT_NEW_IDS = 2;
const MIN_HTML_BYTES_FOR_LIST_PAGE = 1000;
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
  return page <= 1 ? FIRST_PAGE_URL : `${FIRST_PAGE_URL}?page=${page}`;
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

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  ) ?? text.match(/\bPage\s+\d+\s+sur\s+(\d+)\b/i);
  if (fromLabel) return Number(fromLabel[1]);

  let max = 1;
  const pageLinkRe =
    /(?:emploi-accueil\?page=|changePage\(|<option\s+value=["']?)(\d+)/gi;
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

function extractContractTypeFromSegment(segment: string) {
  const value = extractFirst(
    segment,
    /<span\b[^>]*class=["'][^"']*\bej-tag\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
  );
  return value && CONTRACT_TYPES.has(value.toLowerCase()) ? value : null;
}

function extractFirst(segment: string, re: RegExp) {
  return cleanText(segment.match(re)?.[1]);
}

function extractLocation(segment: string) {
  return extractFirst(
    segment,
    /<span\b[^>]*class=["'][^"']*\bej-lieu\b[^"']*["'][^>]*>\s*(?:<i\b[\s\S]*?<\/i>)?\s*([\s\S]*?)<\/span>/i,
  ) || null;
}

function extractCompany(segment: string) {
  return extractFirst(
    segment,
    /<div\b[^>]*class=["'][^"']*\bej-societe\b[^"']*["'][^>]*>\s*(?:<i\b[\s\S]*?<\/i>)?\s*([\s\S]*?)<\/div>/i,
  ) ||
    extractFirst(
      segment,
      /<div\b[^>]*font-size\s*:\s*11px[^>]*>([\s\S]*?)<\/div>/i,
    ) ||
    extractFirst(
      segment,
      /<img\b[^>]*\balt=["']([^"']{2,160})["'][^>]*\bclass=["'][^"']*\bej-logo\b/i,
    ) ||
    extractFirst(
      segment,
      /<img\b[^>]*\bsrc=["'][^"']*logos-recruteurs[^"']*["'][^>]*\balt=["']([^"']{2,160})["']/i,
    ) ||
    null;
}

function extractDateAfterLabel(segmentText: string, label: string) {
  const normalized = stripAccents(segmentText);
  const normalizedLabel = stripAccents(label);
  const escapedLabel = normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(
    new RegExp(`${escapedLabel}\\s+le\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{4})`, "i"),
  );
  return match?.[1] ?? null;
}

function extractTitle(anchorTexts: string[], slug: string) {
  const candidates = anchorTexts
    .map(cleanText)
    .filter((text) => text && !CONTRACT_TYPES.has(text.toLowerCase()));
  return candidates.sort((a, b) => b.length - a.length)[0] ??
    titleFromSlug(slug);
}

function extractTitleFromSegment(
  segment: string,
  anchorTexts: string[],
  slug: string,
) {
  const cardTitle = extractFirst(
    segment,
    /<a\b[^>]*class=["'][^"']*\bej-poste\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
  );
  if (cardTitle) return cardTitle;

  const featuredTitle = extractFirst(
    segment,
    /<div\b[^>]*font-size\s*:\s*12px[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (featuredTitle && !featuredTitle.includes("&#...")) {
    return featuredTitle;
  }

  const fallback = extractTitle(anchorTexts, slug);
  if (/\bLimite\s*:/i.test(fallback) || fallback.includes("&#...")) {
    return titleFromSlug(slug);
  }
  return fallback;
}

export function parseEmploiCiOffersFromHtml(html: string) {
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
  let parsingErrorCount = 0;
  for (const group of grouped.values()) {
    const candidateSegments = group.map((candidate) => {
      const nextIndex = matches.find((next) =>
        next.index > candidate.index && next.offerId !== candidate.offerId
      )?.index ?? html.length;
      const segment = html.slice(candidate.index, nextIndex);
      const segmentText = stripHtml(segment);
      const score = (/\bej-societe\b/i.test(segment) ? 4 : 0) +
        (/\bPubli/i.test(segmentText) ? 2 : 0) +
        (/\bExpire le\b/i.test(segmentText) ? 2 : 0) +
        (/\bej-poste\b/i.test(segment) ? 1 : 0);
      return { candidate, segment, segmentText, score };
    });
    const best = candidateSegments.sort((a, b) => b.score - a.score)[0];
    const first = best.candidate;
    const segment = best.segment;
    const segmentText = best.segmentText;
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
    ) || extractDateAfterLabel(segmentText, "Publie");
    const dateLimite = extractField(segmentText, "Date limite") ||
      extractDateAfterLabel(segmentText, "Expire");
    const title = extractTitleFromSegment(segment, anchorTexts, first.slug);

    if (!title || !sourceUrl) {
      parsingErrorCount++;
      continue;
    }

    offers.push({
      external_id,
      title,
      source_url: sourceUrl,
      apply_url: sourceUrl,
      country: "CI",
      country_codes: ["CI"],
      location: extractLocation(segment) ?? "Cote d'Ivoire",
      company_name: extractCompany(segment),
      contract_type: extractContractType(anchorTexts) ??
        extractContractTypeFromSegment(segment),
      description_text: null,
      published_at: parseFrenchDate(dateEdition),
      expires_at: parseFrenchDate(dateLimite),
    });
  }

  return {
    items: offers,
    raw_link_count: matches.length,
    unique_link_id_count: grouped.size,
    parsing_error_count: parsingErrorCount,
  };
}

function detectDisplayedOfferCount(html: string) {
  const heroCount = html.match(
    /id=["']ec-hero-count["'][^>]*>\s*([0-9\s.,]+)/i,
  );
  const fromHero = heroCount?.[1]?.replace(/\D/g, "");
  if (fromHero) return Number(fromHero);

  const text = stripHtml(html);
  const count = text.match(/\b([0-9][0-9\s.,]*)\s+offres\s+en\s+ligne\b/i);
  const normalized = count?.[1]?.replace(/\D/g, "");
  return normalized ? Number(normalized) : null;
}

function countExpectedMarkers(html: string) {
  const markerPatterns = [
    /emploi-accueil/i,
    /Trouvez votre prochain emploi/i,
    /offres en ligne/i,
    /Offres\s+.{0,4}\s*la\s+Une/i,
    /\bej-card\b/i,
    /\bej-poste\b/i,
    /changePage\(/i,
    /\/offre-\d+-/i,
  ];
  return markerPatterns.filter((re) => re.test(html)).length;
}

function classifyInvalidHtml(html: string) {
  const text = stripHtml(html);
  if (
    /Erreur\s*:\s*Le fichier .* n.?existe pas/i.test(text) ||
    /controllers\/[^"' ]+\.php/i.test(text)
  ) {
    return "php_error_page";
  }
  if (
    /(?:cloudflare|captcha|g-recaptcha|cf-chl|challenge-form|just a moment|attention required|access denied|403 forbidden)/i
      .test(text)
  ) {
    return "challenge_or_error_page";
  }
  const markerCount = countExpectedMarkers(html);
  if (html.length < MIN_HTML_BYTES_FOR_LIST_PAGE && markerCount < 2) {
    return "invalid_html";
  }
  if (markerCount < 2) return "invalid_html";
  return null;
}

export class EmploiCiFetchError extends Error {
  code: string;
  url?: string;

  constructor(code: string, message: string, url?: string) {
    super(message);
    this.name = "EmploiCiFetchError";
    this.code = code;
    this.url = url;
  }
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
    throw new EmploiCiFetchError(
      "network_or_http_error",
      `emploi_ci list fetch failed: ${res.status} ${res.statusText}`,
      url,
    );
  }

  const html = await res.text();
  const invalidCode = classifyInvalidHtml(html);
  if (invalidCode) {
    throw new EmploiCiFetchError(
      invalidCode,
      `emploi_ci list page invalid (${invalidCode}, ${html.length} bytes) for ${url}`,
      url,
    );
  }

  return {
    html,
    html_bytes: html.length,
    marker_count: countExpectedMarkers(html),
    displayed_offer_count: detectDisplayedOfferCount(html),
    detected_max_pages: extractMaxPages(html),
  };
}

export async function fetchEmploiCiItems(
  limit = 30,
  options?: {
    maxPages?: number;
    startPage?: number;
    maxConsecutivePagesWithoutNewIds?: number;
  },
) {
  const capped = Math.max(1, Math.trunc(limit));
  const startPage = Math.max(1, Math.trunc(options?.startPage ?? 1));
  const safetyMaxPages = Math.max(
    1,
    Math.trunc(options?.maxPages ?? DEFAULT_MAX_PAGES),
  );
  const maxConsecutivePagesWithoutNewIds = Math.max(
    1,
    Math.trunc(
      options?.maxConsecutivePagesWithoutNewIds ??
        DEFAULT_MAX_CONSECUTIVE_PAGES_WITHOUT_NEW_IDS,
    ),
  );
  const requestedLastPage = startPage + safetyMaxPages - 1;
  let lastRequestedPage = requestedLastPage;
  let detectedMaxPages: number | null = null;
  let displayedOfferCount: number | null = null;
  const items: EmploiCiItem[] = [];
  const seen = new Set<string>();
  const pageStats: EmploiCiPageStat[] = [];
  let pagesFetched = 0;
  let validPages = 0;
  let rawLinkCount = 0;
  let parsingErrorCount = 0;
  let consecutivePagesWithoutNewIds = 0;
  let firstUsefulPage: number | null = null;
  let lastUsefulPage: number | null = null;
  let stoppedReason = "max_pages_reached";

  for (let page = startPage; page <= lastRequestedPage; page++) {
    const url = pageUrl(page);
    const fetched = await fetchPage(url);
    const html = fetched.html;
    pagesFetched++;
    validPages++;
    if (displayedOfferCount === null) {
      displayedOfferCount = fetched.displayed_offer_count;
    }

    if (detectedMaxPages === null && fetched.detected_max_pages > 1) {
      detectedMaxPages = fetched.detected_max_pages;
      lastRequestedPage = Math.min(requestedLastPage, detectedMaxPages);
    }

    const parsedPage = parseEmploiCiOffersFromHtml(html);
    const pageOffers = parsedPage.items;
    rawLinkCount += parsedPage.raw_link_count;
    parsingErrorCount += parsedPage.parsing_error_count;

    if (pageOffers.length === 0 && (displayedOfferCount ?? 1) > 0) {
      throw new EmploiCiFetchError(
        "parser_zero_results",
        `emploi_ci parser found zero offers on a valid-looking page with displayed_count=${displayedOfferCount}`,
        url,
      );
    }

    if (pageOffers.length === 0) {
      pageStats.push({
        page,
        url,
        html_bytes: fetched.html_bytes,
        raw_link_count: parsedPage.raw_link_count,
        parsed_count: 0,
        added_count: 0,
        duplicate_count: 0,
        marker_count: fetched.marker_count,
      });
      stoppedReason = "empty_valid_source";
      break;
    }

    let addedFromPage = 0;
    let duplicateFromPage = 0;
    for (const item of pageOffers) {
      if (seen.has(item.external_id)) {
        duplicateFromPage++;
        continue;
      }
      seen.add(item.external_id);
      items.push(item);
      addedFromPage++;
      firstUsefulPage ??= page;
      lastUsefulPage = page;

      if (items.length >= capped) {
        stoppedReason = "limit_reached";
        break;
      }
    }

    pageStats.push({
      page,
      url,
      html_bytes: fetched.html_bytes,
      raw_link_count: parsedPage.raw_link_count,
      parsed_count: pageOffers.length,
      added_count: addedFromPage,
      duplicate_count: duplicateFromPage,
      marker_count: fetched.marker_count,
    });

    if (items.length >= capped) {
      break;
    }

    if (addedFromPage === 0) {
      consecutivePagesWithoutNewIds++;
    } else {
      consecutivePagesWithoutNewIds = 0;
    }

    if (consecutivePagesWithoutNewIds >= maxConsecutivePagesWithoutNewIds) {
      stoppedReason = "pagination_stalled";
      break;
    }

    if (detectedMaxPages !== null && page >= detectedMaxPages) {
      stoppedReason = "detected_last_page";
      break;
    }

    if (page < lastRequestedPage) await delay(FETCH_DELAY_MS);
  }

  const internalDuplicateCount = Math.max(0, rawLinkCount - seen.size);
  const withTitleCount = items.filter((item) => item.title.trim()).length;
  const withCompanyCount = items.filter((item) =>
    Boolean(item.company_name?.trim())
  ).length;
  const withSourceUrlCount = items.filter((item) =>
    Boolean(item.source_url?.trim())
  ).length;

  return {
    list_url: FIRST_PAGE_URL,
    effective_start_page: startPage,
    effective_max_pages: safetyMaxPages,
    detected_max_pages: detectedMaxPages,
    pages_fetched: pagesFetched,
    pages_requested: pagesFetched,
    valid_pages: validPages,
    page_stats: pageStats,
    parsed_count_by_page: Object.fromEntries(
      pageStats.map((stat) => [String(stat.page), stat.added_count]),
    ),
    parsed: items.length,
    stopped_reason: stoppedReason,
    diagnostics: {
      pages_requested: pagesFetched,
      pages_valid: validPages,
      raw_link_count: rawLinkCount,
      unique_id_count: seen.size,
      internal_duplicate_count: internalDuplicateCount,
      with_title_count: withTitleCount,
      with_company_count: withCompanyCount,
      with_source_url_count: withSourceUrlCount,
      parsing_error_count: parsingErrorCount,
      first_useful_page: firstUsefulPage,
      last_useful_page: lastUsefulPage,
      stopped_reason: stoppedReason,
      displayed_offer_count: displayedOfferCount,
      detected_max_pages: detectedMaxPages,
      safety_max_pages: safetyMaxPages,
      max_consecutive_pages_without_new_ids:
        maxConsecutivePagesWithoutNewIds,
    },
    sample: items.slice(0, 3),
    items,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
