export type AejItem = {
  external_id: string;
  title: string;
  reference: string | null;
  company_name: string | null;
  location: string | null;
  contract_type: string | null;
  sector: string | null;
  posted_at: string | null;
  published_at: string | null;
  expires_at: string | null;
  description_text: string | null;
  description_html: string | null;
  source_url: string;
  apply_url: string;
  country: "CI";
  is_expired: boolean;
};

type AejRawOffer = Record<string, unknown>;

type AejPageDiagnostic = {
  page: number;
  url: string;
  status: number;
  content_type: string;
  body_length: number;
  parsed_candidate_count: number;
  accepted_count: number;
  duplicate_count: number;
  skipped_quality_count: number;
  last_page: number | null;
  total: number | null;
  error?: string;
};

export type AejFetchResult = {
  ok: boolean;
  source_code: "aej_ci";
  source_family: "aej_html_v2";
  dry_run: true;
  detected_country: "CI";
  list_url: string;
  parsed: number;
  parsed_count: number;
  fetched_count: number;
  pages_fetched: number;
  detail_pages_fetched: number;
  skipped_quality_count: number;
  duplicate_count: number;
  stopped_reason: string;
  warnings: string[];
  sample: AejItem[];
  items: AejItem[];
  meta: {
    diagnostics: AejPageDiagnostic[];
    max_pages_used: number;
    max_items_used: number;
    detail_fetch_limit_used: number;
    total_available: number | null;
    last_page_detected: number | null;
    duplicate_count: number;
    skipped_quality_count: number;
    stopped_reason: string;
    legacy_config_url_ignored: boolean;
    canonical_list_url: string;
  };
};

const AEJ_BASE_URL = "https://agenceemploijeunes.ci";
const AEJ_CANONICAL_LIST_URL = `${AEJ_BASE_URL}/offres-emploi`;
const USER_AGENT =
  "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)";
const PAGE_TIMEOUT_MS = 20000;
const DEFAULT_MAX_PAGES = 2;
const MAX_PAGES_CAP = 20;
const DEFAULT_LIMIT = 30;
export const AEJ_MAX_ITEMS_PER_RUN = 200;
const DEFAULT_DELAY_MS = 800;

const INVALID_TITLE_TERMS = new Set([
  "-",
  "_",
  ".",
  "1",
  "offre",
  "emploi",
  "offre d'emploi",
  "details de l'emploi",
]);

function sleep(ms: number) {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#039;|&apos;|&rsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(
      /&#(\d+);/g,
      (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|tr|h\d)>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeSignal(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function stringValue(value: unknown) {
  const text = cleanText(value);
  return text ? text : null;
}

function isValidTitle(value: unknown) {
  const title = cleanText(value);
  const signal = normalizeSignal(title);
  if (!title || title.length < 3 || title.length > 180) return false;
  if (INVALID_TITLE_TERMS.has(signal)) return false;
  if (/^\d+$/.test(signal)) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(title)) return false;
  return true;
}

function parseAejDate(value: unknown, endOfDay = false) {
  const raw = cleanText(value);
  if (!raw) return null;
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const frDate = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const parts = isoDate
    ? [Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3])]
    : frDate
    ? [Number(frDate[3]), Number(frDate[2]), Number(frDate[1])]
    : null;
  if (parts) {
    const [yyyy, mm, dd] = parts;
    const date = new Date(
      Date.UTC(
        yyyy,
        mm - 1,
        dd,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
      ),
    );
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function canonicalListUrl(rawUrl?: string | null) {
  if (!rawUrl) return { url: AEJ_CANONICAL_LIST_URL, legacyIgnored: false };
  try {
    const url = new URL(rawUrl, AEJ_BASE_URL);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/g, "");
    const isAej = hostname === "agenceemploijeunes.ci";
    const legacyIgnored = isAej && pathname === "/site/offres-emplois";
    if (isAej && (legacyIgnored || pathname === "/offres-emploi")) {
      return { url: AEJ_CANONICAL_LIST_URL, legacyIgnored };
    }
  } catch {
    // Fall through to the canonical URL.
  }
  return { url: AEJ_CANONICAL_LIST_URL, legacyIgnored: true };
}

function pageUrl(listUrl: string, page: number) {
  const url = new URL(listUrl);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort("aej_page_timeout"),
    PAGE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: response.url,
      text: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      finalUrl: url,
      text: "",
      error: String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseInertiaPage(html: string): Record<string, unknown> | null {
  const match = html.match(/\sdata-page="([\s\S]*?)"/i);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(decodeHtmlAttribute(match[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function propsObject(page: Record<string, unknown> | null) {
  const props = page?.props;
  return props && typeof props === "object" && !Array.isArray(props)
    ? props as Record<string, unknown>
    : {};
}

function offersPayload(props: Record<string, unknown>) {
  const offres = props.offres;
  if (!offres || typeof offres !== "object" || Array.isArray(offres)) {
    return { data: [] as AejRawOffer[], total: null, lastPage: null };
  }
  const payload = offres as Record<string, unknown>;
  const data = Array.isArray(payload.data)
    ? payload.data.filter(isObject) as AejRawOffer[]
    : [];
  return {
    data,
    total: typeof payload.total === "number" ? payload.total : null,
    lastPage: typeof payload.last_page === "number" ? payload.last_page : null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function detailOfferPayload(props: Record<string, unknown>) {
  return isObject(props.offre) ? props.offre as AejRawOffer : null;
}

function detailUrlForOffer(offer: AejRawOffer) {
  const slug = stringValue(offer.slug) || stringValue(offer.reference) ||
    stringValue(offer.id);
  if (!slug) return null;
  try {
    return new URL(`/offres-emploi/${encodeURIComponent(slug)}`, AEJ_BASE_URL)
      .toString();
  } catch {
    return null;
  }
}

function mergeDescription(detail: AejRawOffer | null) {
  if (!detail) {
    return { html: null as string | null, text: null as string | null };
  }
  const sections = [
    detail.description,
    detail.description_taches,
    detail.profil,
    detail.connaissances,
    detail.comment_postuler,
  ].map((section) => typeof section === "string" ? section : "").filter(
    Boolean,
  );
  const html = sections.length ? sections.join("\n") : null;
  return {
    html,
    text: html ? cleanText(html) : null,
  };
}

function buildItem(
  offer: AejRawOffer,
  detail: AejRawOffer | null,
  sourceUrl: string,
): AejItem | null {
  const title = stringValue(detail?.titre ?? offer.titre);
  if (!isValidTitle(title)) return null;

  const reference = stringValue(
    detail?.reference ?? offer.reference ?? offer.id ?? offer.slug,
  );
  const companyName = stringValue(detail?.entreprise ?? offer.entreprise);
  const location = stringValue(detail?.localisation ?? offer.localisation) ||
    stringValue(offer.agence_regionale) ||
    null;
  const contractType = stringValue(detail?.type_contrat ?? offer.type_contrat);
  const sector = stringValue(
    detail?.secteur_activite ?? detail?.secteur ?? offer.secteur,
  );
  const publishedAt = parseAejDate(
    detail?.date_publication ?? offer.date_publication,
  );
  const expiresAt = parseAejDate(detail?.date_fin ?? offer.date_fin, true);
  const description = mergeDescription(detail);
  const isExpired = expiresAt ? Date.parse(expiresAt) < Date.now() : false;
  const externalSeed = reference || stringValue(offer.slug) || sourceUrl;

  return {
    external_id: `aej:${externalSeed}`,
    title: title!,
    reference,
    company_name: companyName,
    location,
    contract_type: contractType,
    sector,
    posted_at: publishedAt,
    published_at: publishedAt,
    expires_at: expiresAt,
    description_text: description.text,
    description_html: description.html,
    source_url: sourceUrl,
    apply_url: sourceUrl,
    country: "CI",
    is_expired: isExpired,
  };
}

export async function fetchAejItems(
  configuredListUrl?: string | null,
  maxPagesInput?: number,
  maxItemsInput?: number,
  delayMsInput?: number,
): Promise<AejFetchResult> {
  const canonical = canonicalListUrl(configuredListUrl);
  const listUrl = canonical.url;
  const maxPages = toBoundedInt(
    maxPagesInput,
    DEFAULT_MAX_PAGES,
    1,
    MAX_PAGES_CAP,
  );
  const maxItems = toBoundedInt(
    maxItemsInput,
    DEFAULT_LIMIT,
    1,
    AEJ_MAX_ITEMS_PER_RUN,
  );
  const delayMs = toBoundedInt(delayMsInput, DEFAULT_DELAY_MS, 0, 5000);
  const diagnostics: AejPageDiagnostic[] = [];
  const warnings: string[] = [];
  const items: AejItem[] = [];
  const seenUrls = new Set<string>();
  let fetchedCount = 0;
  let pagesFetched = 0;
  let detailPagesFetched = 0;
  let duplicateCount = 0;
  let skippedQualityCount = 0;
  let stoppedReason = "max_pages_reached";
  let totalAvailable: number | null = null;
  let lastPageDetected: number | null = null;

  for (let page = 1; page <= maxPages; page++) {
    const url = pageUrl(listUrl, page);
    const response = await fetchHtml(url);
    const diagnostic: AejPageDiagnostic = {
      page,
      url: response.finalUrl,
      status: response.status,
      content_type: response.contentType,
      body_length: response.text.length,
      parsed_candidate_count: 0,
      accepted_count: 0,
      duplicate_count: 0,
      skipped_quality_count: 0,
      last_page: null,
      total: null,
      error: response.error,
    };

    if (!response.ok) {
      diagnostic.error = response.error ?? `http_${response.status}`;
      diagnostics.push(diagnostic);
      stoppedReason = response.status === 0 ? "fetch_failed" : "page_not_ok";
      warnings.push("aej_list_page_fetch_failed");
      break;
    }

    pagesFetched++;
    const inertia = parseInertiaPage(response.text);
    const offers = offersPayload(propsObject(inertia));
    diagnostic.parsed_candidate_count = offers.data.length;
    diagnostic.last_page = offers.lastPage;
    diagnostic.total = offers.total;
    totalAvailable = offers.total ?? totalAvailable;
    lastPageDetected = offers.lastPage ?? lastPageDetected;
    fetchedCount += offers.data.length;

    if (offers.data.length === 0) {
      stoppedReason = "empty_page";
      warnings.push("aej_empty_page");
      diagnostics.push(diagnostic);
      break;
    }

    let pageNewUrlCount = 0;
    for (const offer of offers.data) {
      const sourceUrl = detailUrlForOffer(offer);
      if (!sourceUrl) {
        skippedQualityCount++;
        diagnostic.skipped_quality_count++;
        continue;
      }
      if (seenUrls.has(sourceUrl)) {
        duplicateCount++;
        diagnostic.duplicate_count++;
        continue;
      }
      seenUrls.add(sourceUrl);
      pageNewUrlCount++;

      let detail: AejRawOffer | null = null;
      if (items.length < maxItems) {
        if (detailPagesFetched > 0 && delayMs > 0) await sleep(delayMs);
        const detailResponse = await fetchHtml(sourceUrl);
        if (detailResponse.ok) {
          detailPagesFetched++;
          detail = detailOfferPayload(
            propsObject(parseInertiaPage(detailResponse.text)),
          );
        } else {
          warnings.push("aej_detail_fetch_failed");
        }
      }

      const item = buildItem(offer, detail, sourceUrl);
      if (!item) {
        skippedQualityCount++;
        diagnostic.skipped_quality_count++;
        continue;
      }
      diagnostic.accepted_count++;
      if (items.length < maxItems) items.push(item);
    }

    diagnostics.push(diagnostic);
    if (items.length >= maxItems) {
      stoppedReason = "limit_reached";
      break;
    }
    if (pageNewUrlCount === 0) {
      stoppedReason = "duplicate_or_invalid_page";
      warnings.push("aej_page_had_no_new_valid_urls");
      break;
    }
    if (lastPageDetected !== null && page >= lastPageDetected) {
      stoppedReason = "last_page_reached";
      break;
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  if (items.length === 0 && warnings.length === 0) {
    warnings.push("aej_no_items_parsed");
  }
  if (items.length === 0 && stoppedReason === "max_pages_reached") {
    stoppedReason = "no_items_parsed";
  }

  return {
    ok: items.length > 0,
    source_code: "aej_ci",
    source_family: "aej_html_v2",
    dry_run: true,
    detected_country: "CI",
    list_url: listUrl,
    parsed: items.length,
    parsed_count: items.length,
    fetched_count: fetchedCount,
    pages_fetched: pagesFetched,
    detail_pages_fetched: detailPagesFetched,
    skipped_quality_count: skippedQualityCount,
    duplicate_count: duplicateCount,
    stopped_reason: stoppedReason,
    warnings,
    sample: items.slice(0, 3),
    items,
    meta: {
      diagnostics,
      max_pages_used: maxPages,
      max_items_used: maxItems,
      detail_fetch_limit_used: maxItems,
      total_available: totalAvailable,
      last_page_detected: lastPageDetected,
      duplicate_count: duplicateCount,
      skipped_quality_count: skippedQualityCount,
      stopped_reason: stoppedReason,
      legacy_config_url_ignored: canonical.legacyIgnored,
      canonical_list_url: AEJ_CANONICAL_LIST_URL,
    },
  };
}
