export type HimalayasApiItem = {
  external_id: string | null;
  title: string;
  company_name: string | null;
  location: string | null;
  country: string | null;
  country_codes: string[] | null;
  remote_type: string | null;
  description_html: string | null;
  apply_url: string | null;
  source_url: string | null;
  canonical_url: string | null;
  tags: string[] | null;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  payload: Record<string, unknown>;
};

type FetchHimalayasItemsOptions = {
  apiUrl?: string | null;
  searchUrl?: string | null;
  searchQuery?: string | null;
  limit: number;
  maxPages?: number;
  offset?: number;
};

function safeStr(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = safeStr(entry);
      if (text) return text;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (
      const key of [
        "value",
        "text",
        "label",
        "name",
        "title",
        "url",
        "href",
        "slug",
        "path",
        "date",
        "datetime",
        "iso",
        "$date",
      ]
    ) {
      if (!(key in record)) continue;
      const text = safeStr(record[key]);
      if (text) return text;
    }
    return null;
  }
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function safeIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = safeStr(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function normalizeCountryCode(value: unknown): string | null {
  const text = safeStr(value);
  if (!text) return null;
  const normalized = text.toUpperCase();
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : null;
}

function isGenericRestriction(value: string) {
  const normalized = value.toLowerCase();
  return normalized === "remote" ||
    normalized === "global" ||
    normalized === "worldwide" ||
    normalized === "anywhere";
}

function collectRestrictionValues(
  input: unknown,
  labels: string[],
  countries: string[],
  countryCodes: string[],
  depth = 0,
) {
  if (input === null || input === undefined || depth > 2) return;

  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    const text = safeStr(input);
    if (!text) return;
    labels.push(text);
    const code = normalizeCountryCode(text);
    if (code) countryCodes.push(code);
    if (!isGenericRestriction(text)) countries.push(text);
    return;
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      collectRestrictionValues(entry, labels, countries, countryCodes, depth + 1);
    }
    return;
  }

  if (typeof input === "object") {
    const value = input as Record<string, unknown>;

    const label = safeStr(
      value.label ?? value.name ?? value.country ?? value.countryName ?? value.displayName ??
        value.location ?? value.value,
    );
    if (label) labels.push(label);

    const country = safeStr(value.country ?? value.countryName);
    if (country && !isGenericRestriction(country)) countries.push(country);

    const code = normalizeCountryCode(
      value.countryCode ?? value.country_code ?? value.code ?? value.iso2 ?? value.alpha2,
    );
    if (code) countryCodes.push(code);

    for (const nestedKey of ["items", "values", "countries", "locations", "locationRestrictions"]) {
      if (nestedKey in value) {
        collectRestrictionValues(value[nestedKey], labels, countries, countryCodes, depth + 1);
      }
    }
  }
}

function parseLocationRestrictions(input: unknown) {
  const labels: string[] = [];
  const countries: string[] = [];
  const countryCodes: string[] = [];

  collectRestrictionValues(input, labels, countries, countryCodes);

  const normalizedLabels = uniqueStrings(labels);
  const normalizedCountries = uniqueStrings(countries);
  const normalizedCountryCodes = uniqueStrings(countryCodes);

  const location = normalizedLabels.length ? normalizedLabels.join(", ") : null;
  const country = normalizedCountries.length ? normalizedCountries.join(", ") : null;

  return {
    location,
    country,
    country_codes: normalizedCountryCodes.length ? normalizedCountryCodes : null,
  };
}

function parseTags(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;

  const tags = uniqueStrings(
    input.map((entry) => {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        return String(entry);
      }
      if (entry && typeof entry === "object") {
        const value = entry as Record<string, unknown>;
        return safeStr(value.label ?? value.name ?? value.title ?? value.value);
      }
      return null;
    }),
  );

  return tags.length ? tags : null;
}

function normalizeRemoteType(
  rawRemoteType: string | null,
  location: string | null,
  country: string | null,
) {
  const hay = [rawRemoteType, location, country]
    .map((value) => safeStr(value)?.toLowerCase() ?? "")
    .filter(Boolean)
    .join(" ");

  if (!hay) return null;
  if (/(hybrid|hybride)/.test(hay)) return "hybrid";
  if (/(on[\s-]?site|sur site|office|onsite|presentiel|presential)/.test(hay)) return "on_site";
  if (/(remote|worldwide|global|anywhere)/.test(hay)) return "remote";
  return safeStr(rawRemoteType)?.toLowerCase() ?? null;
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}

function pickCanonicalJobUrl(job: Record<string, unknown>) {
  return safeStr(
    job.canonicalUrl ?? job.canonicalURL ?? job.url ?? job.jobUrl ?? job.jobURL ?? job.sourceUrl ??
      job.sourceURL ?? job.link ?? job.applicationLink ?? job.guid,
  );
}

function pickApplyUrl(job: Record<string, unknown>) {
  return safeStr(job.applicationLink ?? job.applyUrl ?? job.applyURL ?? job.url);
}

function mapHimalayasItem(input: unknown): HimalayasApiItem | null {
  if (!input || typeof input !== "object") return null;

  const job = input as Record<string, unknown>;
  const title = safeStr(job.title) ?? "Remote Job";
  const publishedAt = safeIsoDate(
    job.pubDate ?? job.publishedAt ?? job.postedAt ?? job.createdAt ?? job.created_at,
  );
  const expiresAt = safeIsoDate(job.expiryDate ?? job.expiresAt ?? job.expirationDate);
  const restrictions = parseLocationRestrictions(
    job.locationRestrictions ?? job.locationRestriction ?? job.locations,
  );
  const fallbackLocation = safeStr(job.location);
  const fallbackCountry = safeStr(job.country);
  const rawRemoteType = safeStr(job.remoteType ?? job.remote_type);
  const sourceUrl = pickCanonicalJobUrl(job);
  const applyUrl = pickApplyUrl(job);
  const location = restrictions.location ?? fallbackLocation;
  const country = restrictions.country ?? fallbackCountry;
  const tags = parseTags(job.tags) ??
    parseTags(job.skills) ??
    parseTags(job.techStack) ??
    parseTags(job.technologies);

  return {
    external_id: safeStr(job.guid ?? job.id),
    title,
    company_name: safeStr(job.companyName ?? job.company),
    location,
    country,
    country_codes: restrictions.country_codes,
    remote_type: normalizeRemoteType(rawRemoteType, location, country) ?? "remote",
    description_html: safeStr(job.description),
    apply_url: applyUrl,
    source_url: sourceUrl ?? applyUrl,
    canonical_url: sourceUrl,
    tags,
    published_at: publishedAt,
    expires_at: expiresAt,
    is_expired: isExpired(expiresAt),
    payload: job,
  };
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const value = payload as Record<string, unknown>;
  const candidates = [
    value.jobs,
    value.items,
    value.results,
    value.data,
    (value.jobs && typeof value.jobs === "object") ? (value.jobs as Record<string, unknown>).items : null,
    (value.jobs && typeof value.jobs === "object") ? (value.jobs as Record<string, unknown>).results : null,
    (value.data && typeof value.data === "object") ? (value.data as Record<string, unknown>).jobs : null,
    (value.data && typeof value.data === "object") ? (value.data as Record<string, unknown>).items : null,
    (value.data && typeof value.data === "object") ? (value.data as Record<string, unknown>).results : null,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; JobRadarBot/1.0; +https://go4job.org)",
      accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`himalayas_fetch_failed: ${res.status}`);
  }

  return await res.json();
}

export async function fetchHimalayasItems(options: FetchHimalayasItemsOptions) {
  const apiUrl = safeStr(options.apiUrl) ?? "https://himalayas.app/jobs/api";
  const searchUrl = safeStr(options.searchUrl) ?? "https://himalayas.app/jobs/api/search";
  const searchQuery = safeStr(options.searchQuery);
  const totalLimit = Math.max(1, Math.min(Math.trunc(options.limit), 100));
  const maxPages = Math.max(1, Math.min(Math.trunc(options.maxPages ?? 1), 5));
  const startOffset = Math.max(0, Math.trunc(options.offset ?? 0));
  const endpoint = searchQuery ? searchUrl : apiUrl;

  const items: HimalayasApiItem[] = [];
  let lastUrl = endpoint;
  let nextOffset = startOffset;

  for (let page = 0; page < maxPages && items.length < totalLimit; page += 1) {
    const remaining = totalLimit - items.length;
    const pageLimit = Math.max(1, Math.min(20, remaining));
    const url = new URL(endpoint);

    url.searchParams.set("offset", String(nextOffset));
    url.searchParams.set("limit", String(pageLimit));
    if (searchQuery) {
      url.searchParams.set("query", searchQuery);
    }

    lastUrl = url.toString();
    const payload = await fetchJson(lastUrl);
    const pageItems = extractItems(payload);

    if (!pageItems.length) break;

    for (const entry of pageItems) {
      const mapped = mapHimalayasItem(entry);
      if (mapped) items.push(mapped);
      if (items.length >= totalLimit) break;
    }

    nextOffset += pageItems.length;
    if (pageItems.length < pageLimit) break;
  }

  return {
    list_url: lastUrl,
    parsed: items.length,
    items,
  };
}
