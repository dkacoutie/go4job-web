export type AdzunaApiItem = {
  external_id: string | null;
  ad_id: string | null;
  title: string;
  company_name: string | null;
  location: string | null;
  country: string | null;
  country_code: string | null;
  remote_type: string | null;
  contract_type: string | null;
  description_text: string | null;
  source_url: string | null;
  apply_url: string | null;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  tags: string[] | null;
  payload: Record<string, unknown>;
};

type FetchAdzunaItemsOptions = {
  appId: string;
  appKey: string;
  searchUrlTemplate?: string | null;
  defaultCountry?: string | null;
  fallbackCountry?: string | null;
  defaultParams?: Record<string, unknown> | null;
  limit: number;
  maxPages?: number;
  resultsPerPage?: number;
};

const COUNTRY_NAMES: Record<string, string> = {
  ci: "Cote d'Ivoire",
  cm: "Cameroon",
  dz: "Algeria",
  eg: "Egypt",
  fr: "France",
  gb: "United Kingdom",
  gh: "Ghana",
  ke: "Kenya",
  ma: "Morocco",
  ng: "Nigeria",
  sn: "Senegal",
  tn: "Tunisia",
  za: "South Africa",
};

const COUNTRY_CURRENCIES: Record<string, string> = {
  ci: "XOF",
  cm: "XAF",
  dz: "DZD",
  eg: "EGP",
  fr: "EUR",
  gb: "GBP",
  gh: "GHS",
  ke: "KES",
  ma: "MAD",
  ng: "NGN",
  sn: "XOF",
  tn: "TND",
  za: "ZAR",
};

function safeStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = safeStr(entry);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (
      const key of [
        "display_name",
        "displayName",
        "label",
        "name",
        "title",
        "value",
        "text",
        "url",
      ]
    ) {
      if (!(key in record)) continue;
      const text = safeStr(record[key]);
      if (text) return text;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeIsoDate(value: unknown): string | null {
  const text = safeStr(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = safeStr(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function stripHtmlLikeText(value: unknown) {
  const text = safeStr(value);
  if (!text) return null;

  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function normalizeCountryCode(value: unknown): string | null {
  const text = safeStr(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeCountryName(value: unknown, fallbackCountryCode?: string | null) {
  const text = safeStr(value);
  if (text) {
    const normalizedCode = normalizeCountryCode(text);
    if (normalizedCode && COUNTRY_NAMES[normalizedCode]) return COUNTRY_NAMES[normalizedCode];
    return text;
  }

  if (fallbackCountryCode && COUNTRY_NAMES[fallbackCountryCode]) {
    return COUNTRY_NAMES[fallbackCountryCode];
  }

  return null;
}

function normalizeSalaryCurrency(value: unknown, fallbackCountryCode?: string | null) {
  const text = safeStr(value);
  if (text) return text.toUpperCase();
  if (fallbackCountryCode && COUNTRY_CURRENCIES[fallbackCountryCode]) {
    return COUNTRY_CURRENCIES[fallbackCountryCode];
  }
  return null;
}

function normalizeContractType(job: Record<string, unknown>) {
  const values = uniqueStrings([
    safeStr(job.contract_time),
    safeStr(job.contractType),
    safeStr(job.contract_type),
  ]);

  return values.length ? values.join(" / ") : null;
}

function normalizeRemoteType(
  title: string,
  location: string | null,
  descriptionText: string | null,
) {
  const hay = [title, location, descriptionText]
    .map((value) => safeStr(value)?.toLowerCase() ?? "")
    .filter(Boolean)
    .join(" ");

  if (!hay) return null;
  if (/(hybrid|hybride)/.test(hay)) return "hybrid";
  if (/(on[\s-]?site|onsite|sur site|presentiel|presential)/.test(hay)) return "on_site";
  if (/(remote|teletravail|work from home|worldwide|anywhere)/.test(hay)) return "remote";
  return null;
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}

function normalizeDefaultParams(input: Record<string, unknown> | null | undefined) {
  const normalized = new URLSearchParams();

  for (const [key, value] of Object.entries(input ?? {})) {
    const cleanKey = key.trim();
    if (!cleanKey || value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        const text = safeStr(entry);
        if (text) normalized.append(cleanKey, text);
      }
      continue;
    }

    if (typeof value === "boolean") {
      normalized.set(cleanKey, value ? "1" : "0");
      continue;
    }

    if (typeof value === "number") {
      normalized.set(cleanKey, String(value));
      continue;
    }

    const text = safeStr(value);
    if (text) normalized.set(cleanKey, text);
  }

  return normalized;
}

function buildSearchUrl(
  searchUrlTemplate: string,
  countryCode: string,
  page: number,
  pageSize: number,
  appId: string,
  appKey: string,
  defaultParams: URLSearchParams,
) {
  const template = searchUrlTemplate.includes("{country}") && searchUrlTemplate.includes("{page}")
    ? searchUrlTemplate
    : "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}";

  const resolved = template
    .replace("{country}", encodeURIComponent(countryCode))
    .replace("{page}", encodeURIComponent(String(page)));
  const url = new URL(resolved);

  for (const [key, value] of defaultParams.entries()) {
    url.searchParams.append(key, value);
  }

  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("results_per_page", String(pageSize));

  return url.toString();
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [
    record.results,
    record.items,
    record.jobs,
    record.data,
    record.data && asRecord(record.data)?.results,
    record.data && asRecord(record.data)?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function parseTotalAvailable(payload: unknown) {
  const record = asRecord(payload);
  if (!record) return null;

  const total = toFiniteNumber(record.count ?? record.total ?? record.totalResults);
  return total !== null ? Math.trunc(total) : null;
}

function extractLocationInfo(job: Record<string, unknown>, fallbackCountryCode: string | null) {
  const locationRecord = asRecord(job.location);
  const displayName = safeStr(locationRecord?.display_name ?? locationRecord?.displayName ?? job.location);
  const area = Array.isArray(locationRecord?.area)
    ? uniqueStrings(locationRecord.area.map((entry) => safeStr(entry)))
    : [];
  const fallbackLocation = area.length ? area.join(", ") : null;
  const location = displayName ?? fallbackLocation;
  const areaCountry = area.length ? area[area.length - 1] : null;

  return {
    location,
    country: normalizeCountryName(areaCountry, fallbackCountryCode),
  };
}

function parseTags(job: Record<string, unknown>) {
  const category = safeStr(asRecord(job.category)?.label ?? job.category);
  const contractType = safeStr(job.contract_type ?? job.contract_time);
  const tags = uniqueStrings([category, contractType]);
  return tags.length ? tags : null;
}

function mapAdzunaItem(input: unknown, fallbackCountryCode: string | null): AdzunaApiItem | null {
  const job = asRecord(input);
  if (!job) return null;

  const title = safeStr(job.title) ?? "Offre Adzuna";
  const descriptionText = stripHtmlLikeText(job.description ?? job.snippet);
  const locationInfo = extractLocationInfo(job, fallbackCountryCode);
  const publishedAt = safeIsoDate(job.created ?? job.created_at ?? job.publication_date);
  const expiresAt = safeIsoDate(job.expiry_date ?? job.expiration_date ?? job.expires_at);
  const sourceUrl = safeStr(job.redirect_url ?? job.redirectUrl ?? job.url ?? job.adref);
  const applyUrl = safeStr(job.redirect_url ?? job.redirectUrl ?? job.adref ?? job.url);
  const countryCode = fallbackCountryCode;

  if (!sourceUrl && !applyUrl) return null;

  return {
    external_id: safeStr(job.id) ? `adzuna:${safeStr(job.id)}` : null,
    ad_id: safeStr(job.id),
    title,
    company_name: safeStr(asRecord(job.company)?.display_name ?? job.company),
    location: locationInfo.location,
    country: locationInfo.country,
    country_code: countryCode,
    remote_type: normalizeRemoteType(title, locationInfo.location, descriptionText),
    contract_type: normalizeContractType(job),
    description_text: descriptionText,
    source_url: sourceUrl ?? applyUrl,
    apply_url: applyUrl ?? sourceUrl,
    published_at: publishedAt,
    expires_at: expiresAt,
    is_expired: isExpired(expiresAt),
    salary_min: toFiniteNumber(job.salary_min),
    salary_max: toFiniteNumber(job.salary_max),
    salary_currency: normalizeSalaryCurrency(job.salary_currency ?? job.currency, countryCode),
    tags: parseTags(job),
    payload: job,
  };
}

async function fetchSearchPage(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
      accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(`adzuna_fetch_failed: ${res.status}${text ? ` ${text}` : ""}`);
  }

  return await res.json();
}

export async function fetchAdzunaItems(options: FetchAdzunaItemsOptions) {
  const searchUrlTemplate = safeStr(options.searchUrlTemplate) ??
    "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}";
  const primaryCountry = normalizeCountryCode(options.defaultCountry) ?? "fr";
  const secondaryCountry = normalizeCountryCode(options.fallbackCountry);
  const countryCandidates = uniqueStrings([primaryCountry, secondaryCountry])
    .map((value) => normalizeCountryCode(value))
    .filter((value): value is string => Boolean(value));
  const totalLimit = Math.max(1, Math.min(Math.trunc(options.limit), 100));
  const maxPages = Math.max(1, Math.min(Math.trunc(options.maxPages ?? 1), 5));
  const pageSize = Math.max(1, Math.min(Math.trunc(options.resultsPerPage ?? 10), 50));
  const normalizedDefaultParams = normalizeDefaultParams(options.defaultParams);
  const failures: string[] = [];

  let finalItems: AdzunaApiItem[] = [];
  let finalUrl = buildSearchUrl(
    searchUrlTemplate,
    countryCandidates[0] ?? "fr",
    1,
    pageSize,
    options.appId,
    options.appKey,
    normalizedDefaultParams,
  );
  let totalAvailable: number | null = null;
  let countryUsed = countryCandidates[0] ?? "fr";
  let fallbackUsed = false;

  for (let candidateIndex = 0; candidateIndex < countryCandidates.length; candidateIndex += 1) {
    const countryCode = countryCandidates[candidateIndex];
    const items: AdzunaApiItem[] = [];
    let lastUrl = finalUrl;
    let candidateTotal: number | null = null;
    let hadSuccess = false;

    try {
      for (let page = 1; page <= maxPages && items.length < totalLimit; page += 1) {
        const remaining = totalLimit - items.length;
        const currentPageSize = Math.max(1, Math.min(pageSize, remaining));
        const url = buildSearchUrl(
          searchUrlTemplate,
          countryCode,
          page,
          currentPageSize,
          options.appId,
          options.appKey,
          normalizedDefaultParams,
        );
        const payload = await fetchSearchPage(url);
        const pageItems = extractItems(payload);

        hadSuccess = true;
        lastUrl = url;
        candidateTotal = parseTotalAvailable(payload) ?? candidateTotal;

        if (!pageItems.length) break;

        for (const entry of pageItems) {
          const mapped = mapAdzunaItem(entry, countryCode);
          if (mapped) items.push(mapped);
          if (items.length >= totalLimit) break;
        }

        if (pageItems.length < currentPageSize) break;
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      if (candidateIndex < countryCandidates.length - 1) {
        continue;
      }
      throw new Error(failures.join(" | "));
    }

    finalItems = items;
    finalUrl = lastUrl;
    totalAvailable = candidateTotal;
    countryUsed = countryCode;
    fallbackUsed = candidateIndex > 0;

    if (items.length > 0 || candidateIndex === countryCandidates.length - 1 || !hadSuccess) {
      break;
    }
  }

  return {
    list_url: finalUrl,
    parsed: finalItems.length,
    items: finalItems,
    total_available: totalAvailable,
    country_used: countryUsed,
    fallback_used: fallbackUsed,
  };
}
