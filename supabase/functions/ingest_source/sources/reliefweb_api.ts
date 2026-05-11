export type ReliefWebApiItem = {
  external_id: string;
  title: string;
  company_name: string | null;
  country: string | null;
  location: string | null;
  source_url: string | null;
  apply_url: string | null;
  published_at: string | null;
  expires_at: string | null;
  description_text: string | null;
  tags: string[];
  payload: Record<string, unknown>;
};

export type FetchReliefWebJobsOptions = {
  appname: string;
  limit?: number;
  offset?: number;
  countries?: string[];
};

const API_URL = "https://api.reliefweb.int/v2/jobs";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_COUNTRIES = [
  "Côte d'Ivoire",
  "Senegal",
  "Ghana",
  "Nigeria",
  "Benin",
  "Togo",
  "Burkina Faso",
  "Mali",
  "Guinea",
  "Niger",
];

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = cleanText(entry);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "title", "url", "value", "label", "text"]) {
      const text = cleanText(record[key]);
      if (text) return text;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function safeIsoDate(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeCountries(countries?: string[] | null) {
  const normalized = uniqueStrings(
    Array.isArray(countries) && countries.length ? countries : DEFAULT_COUNTRIES,
  );
  return normalized.length ? normalized : DEFAULT_COUNTRIES;
}

function extractNames(input: unknown) {
  return uniqueStrings(
    asArray(input).map((entry) => {
      const record = asRecord(entry);
      return cleanText(record.name ?? record.title ?? entry);
    }),
  );
}

function extractSourceName(fields: Record<string, unknown>) {
  return extractNames(fields.source)[0] ?? null;
}

function extractCountries(fields: Record<string, unknown>) {
  return extractNames(fields.country);
}

function extractTags(fields: Record<string, unknown>) {
  return uniqueStrings([
    ...extractNames(fields.country),
    ...extractNames(fields.source),
    ...extractNames(fields.career_categories),
    ...extractNames(fields.type),
    ...extractNames(fields.experience),
  ]).slice(0, 30);
}

function extractUrl(fields: Record<string, unknown>, record: Record<string, unknown>) {
  return cleanText(fields.url) ?? cleanText(fields.url_alias) ?? cleanText(record.href);
}

function extractApplyUrl(fields: Record<string, unknown>, record: Record<string, unknown>) {
  return extractUrl(fields, record) ?? cleanText(fields.how_to_apply);
}

function extractDate(fields: Record<string, unknown>, key: string) {
  return safeIsoDate(asRecord(fields.date)[key]);
}

function extractLocation(fields: Record<string, unknown>) {
  const cities = extractNames(fields.city);
  const countries = extractCountries(fields);
  return uniqueStrings([...cities, ...countries]).join(", ") || null;
}

function mapReliefWebJob(record: Record<string, unknown>): ReliefWebApiItem {
  const fields = asRecord(record.fields);
  const id = cleanText(record.id) ?? cleanText(fields.id) ?? crypto.randomUUID();
  const countries = extractCountries(fields);
  const sourceUrl = extractUrl(fields, record);
  const applyUrl = extractApplyUrl(fields, record);
  const howToApply = cleanText(fields.how_to_apply);
  const body = cleanText(fields.body);

  return {
    external_id: `reliefweb_api:${id}`,
    title: cleanText(fields.title) ?? "Untitled ReliefWeb job",
    company_name: extractSourceName(fields),
    country: countries[0] ?? null,
    location: extractLocation(fields),
    published_at: extractDate(fields, "created"),
    expires_at: extractDate(fields, "closing"),
    source_url: sourceUrl,
    apply_url: applyUrl,
    description_text: body ?? howToApply,
    tags: extractTags(fields),
    payload: {
      id,
      score: record.score ?? null,
      href: record.href ?? null,
      fields,
    },
  };
}

function buildRequestBody(limit: number, offset: number, countries: string[]) {
  return {
    limit,
    offset,
    profile: "full",
    preset: "latest",
    sort: ["date.created:desc"],
    fields: {
      include: [
        "id",
        "title",
        "body",
        "country",
        "country.name",
        "country.iso3",
        "city",
        "source",
        "source.name",
        "url",
        "url_alias",
        "how_to_apply",
        "date.created",
        "date.closing",
        "date.changed",
        "career_categories",
        "type",
        "experience",
      ],
    },
    filter: {
      field: "country.name",
      value: countries,
      operator: "OR",
    },
  };
}

export async function fetchReliefWebJobs(options: FetchReliefWebJobsOptions) {
  const appname = cleanText(options.appname);
  if (!appname) {
    throw new Error("reliefweb_appname_missing");
  }

  const limit = boundedInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = boundedInt(options.offset, 0, 0, 10000);
  const countries = normalizeCountries(options.countries);
  const url = `${API_URL}?appname=${encodeURIComponent(appname)}`;
  const body = buildRequestBody(limit, offset, countries);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": `JobRadarBot/1.0 (${appname}; +https://go4job.org)`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }

  if (!response.ok) {
    const message = cleanText(json.message) ?? cleanText(json.error) ?? text;
    throw new Error(`reliefweb_api_fetch_failed: ${response.status} ${message ?? ""}`.trim());
  }

  const data = asArray(json.data);
  const items = data.map((entry) => mapReliefWebJob(asRecord(entry)));
  const totalCount = Number(asRecord(json.totalCount).value ?? json.totalCount);

  return {
    endpoint: API_URL,
    appname,
    requested_limit: options.limit ?? null,
    effective_limit: limit,
    offset,
    countries_requested: countries,
    parsed: items.length,
    total_count: Number.isFinite(totalCount) ? totalCount : null,
    items,
    meta: {
      status: response.status,
      content_type: response.headers.get("content-type"),
      request_body: body,
      raw_count: data.length,
    },
  };
}
