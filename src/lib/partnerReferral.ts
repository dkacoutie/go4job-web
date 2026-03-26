export const PARTNER_REFERRAL_STORAGE_KEY = "go4job.partner_referral";
const PARTNER_REFERRAL_QUERY_PARAM = "ref";
const PARTNER_REFERRAL_MIN_LENGTH = 4;
const PARTNER_REFERRAL_MAX_LENGTH = 32;

export type StoredPartnerReferral = {
  code: string;
  capturedAt: string;
  sourcePath: string | null;
};

export type CapturePartnerReferralResult = {
  didCapture: boolean;
  didReplace: boolean;
  hasQueryParam: boolean;
  referral: StoredPartnerReferral | null;
  cleanedRelativeUrl: string | null;
};

export function normalizePartnerReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = raw.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().trim();
  if (!normalized) return null;
  if (normalized.length < PARTNER_REFERRAL_MIN_LENGTH) return null;
  if (normalized.length > PARTNER_REFERRAL_MAX_LENGTH) return null;

  return normalized;
}

function isStoredPartnerReferral(value: unknown): value is StoredPartnerReferral {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.capturedAt === "string" &&
    (typeof candidate.sourcePath === "string" || candidate.sourcePath === null)
  );
}

function hasWindow() {
  return typeof window !== "undefined";
}

export function readPartnerReferral(): StoredPartnerReferral | null {
  if (!hasWindow()) return null;

  try {
    const raw = window.localStorage.getItem(PARTNER_REFERRAL_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredPartnerReferral(parsed)) {
      window.localStorage.removeItem(PARTNER_REFERRAL_STORAGE_KEY);
      return null;
    }

    const normalizedCode = normalizePartnerReferralCode(parsed.code);
    if (!normalizedCode) {
      window.localStorage.removeItem(PARTNER_REFERRAL_STORAGE_KEY);
      return null;
    }

    return {
      code: normalizedCode,
      capturedAt: parsed.capturedAt,
      sourcePath: parsed.sourcePath ?? null,
    };
  } catch {
    return null;
  }
}

export function getPartnerReferralCode(): string | null {
  return readPartnerReferral()?.code ?? null;
}

export function hasPartnerReferral(): boolean {
  return Boolean(getPartnerReferralCode());
}

export function writePartnerReferral(code: string, sourcePath?: string | null): StoredPartnerReferral | null {
  if (!hasWindow()) return null;

  const normalizedCode = normalizePartnerReferralCode(code);
  if (!normalizedCode) return null;

  const next: StoredPartnerReferral = {
    code: normalizedCode,
    capturedAt: new Date().toISOString(),
    sourcePath: sourcePath ?? null,
  };

  try {
    window.localStorage.setItem(PARTNER_REFERRAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }

  return next;
}

export function clearPartnerReferral() {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(PARTNER_REFERRAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function capturePartnerReferralFromSearch(
  search: string,
  pathname: string,
  hash = ""
): CapturePartnerReferralResult {
  const params = new URLSearchParams(search);
  const rawReferral = params.get(PARTNER_REFERRAL_QUERY_PARAM);
  const hasQueryParam = params.has(PARTNER_REFERRAL_QUERY_PARAM);
  const normalizedCode = normalizePartnerReferralCode(rawReferral);

  let referral = readPartnerReferral();
  let didCapture = false;

  if (normalizedCode) {
    referral = writePartnerReferral(normalizedCode, pathname);
    didCapture = true;
  }

  let didReplace = false;
  let cleanedRelativeUrl: string | null = null;

  if (hasQueryParam) {
    params.delete(PARTNER_REFERRAL_QUERY_PARAM);
    const nextSearch = params.toString();
    cleanedRelativeUrl = `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash || ""}`;
    didReplace = true;
  }

  return {
    didCapture,
    didReplace,
    hasQueryParam,
    referral,
    cleanedRelativeUrl,
  };
}
