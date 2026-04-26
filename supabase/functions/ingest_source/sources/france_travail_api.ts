export type FranceTravailApiItem = {
  external_id: string;
  offer_id: string | null;
  title: string;
  company_name: string | null;
  location: string | null;
  country: string | null;
  contract_type: string | null;
  description_text: string | null;
  source_url: string;
  apply_url: string | null;
  detail_url: string | null;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  payload: Record<string, unknown>;
};

type FetchFranceTravailItemsOptions = {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string | null;
  searchUrl?: string | null;
  scope?: string | null;
  limit: number;
  maxPages?: number;
  rangeStep?: number;
  searchParams?: Record<string, unknown> | null;
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
    for (const key of ["label", "libelle", "value", "name", "nom", "title", "text", "url"]) {
      if (!(key in record)) continue;
      const text = safeStr(record[key]);
      if (text) return text;
    }
  }
  return null;
}

function safeIsoDate(value: unknown): string | null {
  const text = safeStr(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
}

function buildDetailUrl(offerId: string | null) {
  if (!offerId) return null;
  return `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(offerId)}`;
}

function normalizeCountry(rawCountry: string | null) {
  if (!rawCountry) return "France";
  return rawCountry;
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

function normalizeSearchParams(input: Record<string, unknown> | null | undefined) {
  const normalized = new URLSearchParams();
  const entries = Object.entries(input ?? {});

  for (const [key, value] of entries) {
    if (!key.trim() || value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        const text = safeStr(entry);
        if (text) normalized.append(key, text);
      }
      continue;
    }

    if (typeof value === "boolean") {
      normalized.set(key, value ? "true" : "false");
      continue;
    }

    if (typeof value === "number") {
      normalized.set(key, String(value));
      continue;
    }

    const text = safeStr(value);
    if (text) normalized.set(key, text);
  }

  return normalized;
}

async function fetchAccessToken(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  scope: string | null,
) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const normalizedScope = safeStr(scope);
  if (normalizedScope) {
    body.set("scope", normalizedScope);
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`france_travail_token_failed: ${res.status} ${text}`);
  }

  const payload = await res.json() as Record<string, unknown>;
  const accessToken = safeStr(payload.access_token);
  if (!accessToken) {
    throw new Error("france_travail_token_missing_access_token");
  }

  return accessToken;
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [
    record.resultats,
    record.results,
    record.items,
    record.offres,
    record.data,
    record.data && asRecord(record.data)?.resultats,
    record.data && asRecord(record.data)?.results,
    record.data && asRecord(record.data)?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function parseTotalFromContentRange(value: string | null) {
  const text = safeStr(value);
  if (!text) return null;

  const match = text.match(/\/(\d+)\s*$/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapFranceTravailItem(input: unknown): FranceTravailApiItem | null {
  const offer = asRecord(input);
  if (!offer) return null;

  const offerId = safeStr(offer.id);
  const detailUrl = buildDetailUrl(offerId);
  const locationRecord = asRecord(offer.lieuTravail);
  const companyRecord = asRecord(offer.entreprise);
  const originRecord = asRecord(offer.origineOffre);

  const sourceUrl = safeStr(originRecord?.urlOrigine ?? originRecord?.urlOrigineOffre) ??
    detailUrl;
  if (!sourceUrl) return null;

  const publishedAt = safeIsoDate(offer.dateCreation ?? offer.datePublication ?? offer.dateActualisation);
  const expiresAt = safeIsoDate(offer.dateExpiration);
  const location = safeStr(
    locationRecord?.libelle ?? offer.lieuTravailLibelle ?? offer.communeLibelle ?? offer.commune,
  );
  const country = normalizeCountry(
    safeStr(locationRecord?.paysLibelle ?? offer.paysLibelle ?? offer.pays ?? offer.nomPays),
  );

  return {
    external_id: offerId ? `france_travail:${offerId}` : "",
    offer_id: offerId,
    title: safeStr(offer.intitule) ?? "Offre France Travail",
    company_name: safeStr(companyRecord?.nom ?? offer.nomEntreprise ?? offer.enseigne),
    location,
    country,
    contract_type: safeStr(
      offer.typeContratLibelle ?? offer.typeContrat ?? offer.natureContrat ?? offer.natureContratLibelle,
    ),
    description_text: stripHtmlLikeText(offer.description),
    source_url: sourceUrl,
    apply_url: safeStr(originRecord?.urlOrigine ?? originRecord?.urlPostulation) ?? detailUrl,
    detail_url: detailUrl,
    published_at: publishedAt,
    expires_at: expiresAt,
    is_expired: isExpired(expiresAt),
    payload: offer,
  };
}

async function fetchSearchPage(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`france_travail_fetch_failed: ${res.status} ${text}`);
  }

  const payload = await res.json();
  const contentRange = res.headers.get("content-range") ?? res.headers.get("Content-Range");

  return {
    payload,
    contentRange,
  };
}

export async function fetchFranceTravailItems(options: FetchFranceTravailItemsOptions) {
  const tokenUrl = safeStr(options.tokenUrl) ??
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
  const searchUrl = safeStr(options.searchUrl) ??
    "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
  const totalLimit = Math.max(1, Math.min(Math.trunc(options.limit), 1000));
  const maxPages = Math.max(1, Math.min(Math.trunc(options.maxPages ?? 1), 10));
  const rangeStep = Math.max(1, Math.min(Math.trunc(options.rangeStep ?? totalLimit), 100));
  const searchParams = normalizeSearchParams(options.searchParams);
  const accessToken = await fetchAccessToken(
    tokenUrl,
    options.clientId,
    options.clientSecret,
    options.scope ?? null,
  );

  const items: FranceTravailApiItem[] = [];
  let currentOffset = 0;
  let totalAvailable: number | null = null;
  let lastUrl = searchUrl;
  let lastContentRange: string | null = null;

  for (let page = 0; page < maxPages && items.length < totalLimit; page += 1) {
    const remaining = totalLimit - items.length;
    const pageSize = Math.max(1, Math.min(rangeStep, remaining));
    const url = new URL(searchUrl);

    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
    url.searchParams.set("range", `${currentOffset}-${currentOffset + pageSize - 1}`);

    lastUrl = url.toString();
    const { payload, contentRange } = await fetchSearchPage(lastUrl, accessToken);
    lastContentRange = contentRange;
    const pageItems = extractItems(payload);

    if (!pageItems.length) break;

    for (const entry of pageItems) {
      const mapped = mapFranceTravailItem(entry);
      if (!mapped) continue;
      if (!mapped.external_id) continue;
      items.push(mapped);
      if (items.length >= totalLimit) break;
    }

    totalAvailable = parseTotalFromContentRange(contentRange) ?? totalAvailable;
    currentOffset += pageItems.length;

    if (pageItems.length < pageSize) break;
    if (totalAvailable !== null && currentOffset >= totalAvailable) break;
  }

  return {
    list_url: lastUrl,
    parsed: items.length,
    items,
    total_available: totalAvailable,
    content_range: lastContentRange,
  };
}
