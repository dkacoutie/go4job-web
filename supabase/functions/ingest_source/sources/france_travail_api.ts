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
  /**
   * Offset de depart dans le jeu de resultats du segment courant.
   * Persiste entre deux executions dans
   * ingest_config.runtime_state.segment_offsets[segment_key].
   *
   * Sans cet offset, chaque execution repartait de 0 et relisait indefiniment
   * la tete de liste de chaque segment. Le catalogue France Travail compte
   * ~147 000 offres pour ~11 000 revues par jour : tout ce qui se trouvait
   * au-dela des premiers milliers de resultats n'etait jamais rafraichi et
   * finissait par sortir du catalogue.
   */
  startOffset?: number;
};

/**
 * L'API France Travail refuse les plages au-dela de 3149 (limite documentee
 * du parametre `range`). Au-dela, le curseur revient a 0 et le segment est
 * relu depuis le debut.
 */
const FRANCE_TRAVAIL_RANGE_CEILING = 3149;

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

/**
 * Nettoie le texte d'une description tout en préservant les retours à la
 * ligne réels (paragraphes, listes à puces "- ..." ligne par ligne). A la
 * différence de safeStr() (utilisée pour titre/entreprise/lieu, où aplatir
 * les espaces est correct), la description perd toute sa structure si on la
 * fait passer par un simple `.replace(/\s+/g, " ")` : c'est exactement ce
 * qui rendait les offres France Travail illisibles (missions et profil
 * fusionnés en un seul bloc). On ne collapse ici que les espaces/tabulations
 * répétés, jamais les retours à la ligne.
 */
function stripHtmlLikeText(value: unknown) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value : safeStr(value);
  if (!raw) return null;

  const text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || null;
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
  const requestedStartOffset = Math.max(0, Math.trunc(options.startOffset ?? 0));
  const startOffset = requestedStartOffset > FRANCE_TRAVAIL_RANGE_CEILING
    ? 0
    : requestedStartOffset;
  let currentOffset = startOffset;
  let totalAvailable: number | null = null;
  let lastUrl = searchUrl;
  let lastContentRange: string | null = null;
  let exhausted = false;

  for (let page = 0; page < maxPages && items.length < totalLimit; page += 1) {
    // L'API rejette toute plage dont la borne haute depasse le plafond.
    // On arrete la boucle plutot que d'emettre une requete vouee a echouer.
    if (currentOffset > FRANCE_TRAVAIL_RANGE_CEILING) {
      exhausted = true;
      break;
    }

    const remaining = totalLimit - items.length;
    const roomToCeiling = FRANCE_TRAVAIL_RANGE_CEILING - currentOffset + 1;
    const pageSize = Math.max(
      1,
      Math.min(rangeStep, remaining, roomToCeiling),
    );
    const url = new URL(searchUrl);

    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
    url.searchParams.set("range", `${currentOffset}-${currentOffset + pageSize - 1}`);

    lastUrl = url.toString();
    const { payload, contentRange } = await fetchSearchPage(lastUrl, accessToken);
    lastContentRange = contentRange;
    const pageItems = extractItems(payload);

    if (!pageItems.length) {
      exhausted = true;
      break;
    }

    for (const entry of pageItems) {
      const mapped = mapFranceTravailItem(entry);
      if (!mapped) continue;
      if (!mapped.external_id) continue;
      items.push(mapped);
      if (items.length >= totalLimit) break;
    }

    totalAvailable = parseTotalFromContentRange(contentRange) ?? totalAvailable;
    currentOffset += pageItems.length;

    if (pageItems.length < pageSize) {
      exhausted = true;
      break;
    }
    if (totalAvailable !== null && currentOffset >= totalAvailable) {
      exhausted = true;
      break;
    }
    if (currentOffset > FRANCE_TRAVAIL_RANGE_CEILING) {
      exhausted = true;
      break;
    }
  }

  // Curseur pour l'execution suivante. On repart de 0 des que le segment est
  // epuise ou que le plafond de pagination de l'API est atteint, pour balayer
  // le segment en boucle au lieu de rester colle a une seule fenetre.
  const nextOffset = exhausted ||
      currentOffset > FRANCE_TRAVAIL_RANGE_CEILING ||
      (totalAvailable !== null && currentOffset >= totalAvailable)
    ? 0
    : currentOffset;

  return {
    list_url: lastUrl,
    parsed: items.length,
    items,
    total_available: totalAvailable,
    content_range: lastContentRange,
    start_offset: startOffset,
    next_offset: nextOffset,
  };
}
