export type JobIdentityInput = {
  title?: string | null;
  companyName?: string | null;
  location?: string | null;
  sourceUrl?: string | null;
  applyUrl?: string | null;
};

export type CanonicalJobUrl = {
  canonicalUrl: string | null;
};

export type CrossSourceJobIdentity = {
  canonicalUrl: string | null;
  dedupeIdentityKey: string;
  crossSourceFingerprint: string;
};

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
]);

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalizeJobUrl(
  value: string | null | undefined,
): CanonicalJobUrl {
  const raw = (value ?? "").trim();
  if (!raw) return { canonicalUrl: null };

  try {
    const url = new URL(raw);
    url.hash = "";

    for (const key of Array.from(url.searchParams.keys())) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_") ||
        TRACKING_PARAMS.has(normalizedKey)
      ) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();
    return { canonicalUrl: url.toString().replace(/\/$/, "") || null };
  } catch {
    return { canonicalUrl: raw || null };
  }
}

export async function buildCrossSourceJobIdentity(
  input: JobIdentityInput,
): Promise<CrossSourceJobIdentity> {
  const canonicalUrl = canonicalizeJobUrl(input.sourceUrl).canonicalUrl ??
    canonicalizeJobUrl(input.applyUrl).canonicalUrl;
  const title = normalizeText(input.title);
  const company = normalizeText(input.companyName);
  const location = normalizeText(input.location);
  const url = normalizeText(canonicalUrl);

  const identitySeed = [title, company, location].filter(Boolean).join("|");
  const fallbackSeed = url || "unknown";
  const dedupeIdentityKey = await sha256Hex(identitySeed || fallbackSeed);
  const crossSourceFingerprint = await sha256Hex(
    [identitySeed, url].join("|"),
  );

  return {
    canonicalUrl,
    dedupeIdentityKey,
    crossSourceFingerprint,
  };
}
