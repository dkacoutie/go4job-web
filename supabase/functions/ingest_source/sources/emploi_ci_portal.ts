// supabase/functions/ingest_source/sources/emploi_ci_portal.ts

export type EmploiCiPortalItem = {
  external_id: string;
  title: string;
  company_name: string | null;
  country: "CI";
  location: string | null;
  source_url: string;
  apply_url: string;
  published_at: string | null;
  expires_at: string | null;
  contract_type: string | null;
  description_text: string | null;
  tags: string[];
};

export type EmploiCiPortalPageStat = {
  page: number;
  url: string;
  parsed_count: number;
  added_count: number;
  duplicate_count: number;
  skipped_quality_count: number;
};

const BASE_URL = "https://www.emploi.ci";
const FIRST_PAGE_URL = `${BASE_URL}/recherche-jobs-cote-ivoire`;
const DEFAULT_MAX_PAGES = 15;
const FETCH_DELAY_MS = 1000;
const PAGE_TIMEOUT_MS = 30000;
const QUALITY_BLOCKLIST = [
  "melbet",
  "1xbet",
  "betting",
  "gambling",
  "casino",
  "paris sportifs",
  "pari sportif",
  "bookmaker",
  "affilie marketing betting",
];

function absUrl(href: string) {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
}

function pageUrl(page: number) {
  return page <= 1 ? FIRST_PAGE_URL : `${FIRST_PAGE_URL}?page=${page - 1}`;
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
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&eacute;/gi, "e")
    .replace(/&Eacute;/g, "E")
    .replace(/&egrave;/gi, "e")
    .replace(/&agrave;/gi, "a")
    .replace(/&ocirc;/gi, "o")
    .replace(/&icirc;/gi, "i")
    .replace(/&ccedil;/gi, "c")
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

function normalizeForQuality(value: string) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isQualityBlocked(item: {
  title: string;
  company_name: string | null;
  description_text: string | null;
}) {
  const haystack = normalizeForQuality(
    `${item.title} ${item.company_name ?? ""} ${item.description_text ?? ""}`,
  );
  return QUALITY_BLOCKLIST.some((term) => haystack.includes(term));
}

function extractAttr(html: string, attr: string) {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  return cleanText(html.match(re)?.[1]);
}

function extractFirst(html: string, re: RegExp) {
  return cleanText(html.match(re)?.[1]);
}

function extractStrongAfterLabel(segment: string, labelPattern: string) {
  const re = new RegExp(
    `<li[^>]*>[\\s\\S]*?${labelPattern}[\\s\\S]*?<strong>([\\s\\S]*?)<\\/strong>[\\s\\S]*?<\\/li>`,
    "i",
  );
  return cleanText(segment.match(re)?.[1]);
}

function extractTags(value: string | null) {
  if (!value) return [];
  return value
    .split(/\s+-\s+/)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 20);
}

function extractNumericId(url: string) {
  const match = url.match(/-(\d+)(?:[/?#].*)?$/);
  return match?.[1] ?? null;
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildExternalId(item: {
  title: string;
  company_name: string | null;
  published_at: string | null;
  source_url: string;
}) {
  const numericId = extractNumericId(item.source_url);
  if (numericId) return `emploi_ci_portal:${numericId}`;
  const hash = await sha256Hex(
    `${item.title}|${item.company_name ?? ""}|${
      item.published_at ?? ""
    }|${item.source_url}`,
  );
  return `emploi_ci_portal:${hash}`;
}

function extractMaxPages(html: string) {
  let max = 1;
  const pageRe = /recherche-jobs-cote-ivoire\?page=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(html)) !== null) {
    max = Math.max(max, Number(m[1]) + 1);
  }
  return max;
}

async function parseOffersFromHtml(html: string) {
  const cardRe =
    /<div\b[^>]*class=["'][^"']*\bcard\b[^"']*\bcard-job\b[^"']*["'][^>]*>/gi;
  const matches = Array.from(html.matchAll(cardRe));
  const items: EmploiCiPortalItem[] = [];
  let skippedQualityCount = 0;

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const next = matches[i + 1]?.index ?? html.length;
    const segment = html.slice(start, next);
    const sourceUrl = absUrl(extractAttr(matches[i][0], "data-href"));
    if (!sourceUrl || !sourceUrl.includes("/offre-emploi-cote-ivoire/")) {
      continue;
    }

    const title = extractFirst(
      segment,
      /<h3[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i,
    );
    if (!title) continue;

    const companyName = extractFirst(
      segment,
      /class=["'][^"']*\bcompany-name\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    ) ||
      null;
    const descriptionText = extractFirst(
      segment,
      /<div\b[^>]*class=["'][^"']*\bcard-job-description\b[^"']*["'][^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i,
    ) ||
      null;
    const contractType =
      extractStrongAfterLabel(segment, "Contrat\\s+propos") || null;
    const location =
      extractStrongAfterLabel(segment, "R(?:\\u00e9|e)gion\\s+de") ||
      "Cote d'Ivoire";
    const rawTags = extractStrongAfterLabel(
      segment,
      "Comp(?:\\u00e9|e)tences\\s+cl(?:\\u00e9|e)s",
    );
    const publishedAt = extractAttr(
      segment.match(/<time\b[^>]*datetime=["'][^"']+["'][^>]*>/i)?.[0] ?? "",
      "datetime",
    );
    const normalizedPublishedAt = publishedAt
      ? new Date(`${publishedAt}T00:00:00.000Z`).toISOString()
      : null;
    const candidate = {
      title,
      company_name: companyName,
      description_text: descriptionText,
    };

    if (isQualityBlocked(candidate)) {
      skippedQualityCount++;
      continue;
    }

    items.push({
      external_id: await buildExternalId({
        title,
        company_name: companyName,
        published_at: normalizedPublishedAt,
        source_url: sourceUrl,
      }),
      title,
      company_name: companyName,
      country: "CI",
      location,
      source_url: sourceUrl,
      apply_url: sourceUrl,
      published_at: normalizedPublishedAt,
      expires_at: null,
      contract_type: contractType,
      description_text: descriptionText,
      tags: extractTags(rawTags),
    });
  }

  return { items, skippedQualityCount };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort("page_timeout"),
    PAGE_TIMEOUT_MS,
  );
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
        "accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > PAGE_TIMEOUT_MS) {
      throw new Error(
        `emploi_ci_portal page fetch exceeded ${PAGE_TIMEOUT_MS}ms`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `emploi_ci_portal list fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    return await res.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchEmploiCiPortalItems(
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
  const items: EmploiCiPortalItem[] = [];
  const seen = new Set<string>();
  const pageStats: EmploiCiPortalPageStat[] = [];
  let pagesFetched = 0;
  let skippedQualityCount = 0;
  let stoppedReason = "max_pages_reached";

  for (let page = startPage; page <= lastRequestedPage; page++) {
    const url = pageUrl(page);
    const html = await fetchPage(url);
    pagesFetched++;

    if (page === 1) {
      maxPages = Math.min(maxPages, Math.max(1, extractMaxPages(html)));
      lastRequestedPage = startPage + maxPages - 1;
    }

    const parsedPage = await parseOffersFromHtml(html);
    skippedQualityCount += parsedPage.skippedQualityCount;
    if (parsedPage.items.length === 0) {
      pageStats.push({
        page,
        url,
        parsed_count: 0,
        added_count: 0,
        duplicate_count: 0,
        skipped_quality_count: parsedPage.skippedQualityCount,
      });
      stoppedReason = "empty_page";
      break;
    }

    let addedFromPage = 0;
    let duplicateFromPage = 0;
    for (const item of parsedPage.items) {
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
      parsed_count: parsedPage.items.length,
      added_count: addedFromPage,
      duplicate_count: duplicateFromPage,
      skipped_quality_count: parsedPage.skippedQualityCount,
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
    skipped_quality_count: skippedQualityCount,
    stopped_reason: stoppedReason,
    sample: items.slice(0, 3),
    items,
  };
}
