// src/lib/adminApi.ts
import { supabase } from "./supabaseClient";

export type Validation = { level: "info" | "warn" | "error"; message: string };

export type AdminJobSource = {
  id: string;
  code: string;
  name: string | null;
  ingest_method: string | null;
  ingest_status: string | null;
  is_active: boolean | null;
  ingest_config: any;
};

export type AdminListSourcesResult = {
  ok: boolean;
  sources?: AdminJobSource[];
  message?: string;
  error?: string;
};

export type AdminTestSourceSampleItem = {
  title: string;
  url: string;
  published_at?: string;
};

export type AdminTestSourceResult = {
  ok: boolean;
  admin_user_id?: string;
  source?: {
    id: string;
    code: string;
    ingest_method: string;
    ingest_status: string | null;
    is_active: boolean;
    ingest_config: any;
  };
  validations?: Validation[];
  sample_items?: AdminTestSourceSampleItem[];
  note?: string;
  error?: string;
  message?: string;
};

export type AdminConfigureSourceResult = {
  ok: boolean;
  action: "upsert_rss" | "mark_ready" | "set_active" | string;
  source?: AdminJobSource;
  validations?: Validation[];
  message?: string;
  error?: string;
};

/**
 * Erreur normalisée côté client
 */
export type AdminInvokeError = {
  name?: string;
  message: string;
  status?: number;
  details?: unknown;
  requestId?: string;
};

export type AdminInvokeResponse<T> = {
  data: T | null;
  error: AdminInvokeError | null;
};

/**
 * Anti double-clic / double appel: même (fn + body) => même Promise en vol.
 */
const inflight = new Map<string, Promise<AdminInvokeResponse<any>>>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null || v === undefined) return v;
    if (typeof v !== "object") return v;

    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(normalize);

    if (typeof v === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);

      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
      return out;
    }

    return String(v);
  };

  return JSON.stringify(normalize(value));
}

function extractStatus(err: any): number | undefined {
  return (
    err?.context?.status ??
    err?.status ??
    (typeof err?.statusCode === "number" ? err.statusCode : undefined)
  );
}

function normalizeError(err: any, requestId?: string): AdminInvokeError {
  const status = extractStatus(err);
  return {
    name: err?.name,
    message: err?.message || "Erreur inconnue (invoke)",
    status,
    details: err?.context ?? err?.details ?? err,
    requestId,
  };
}

function shouldRetry(err: any): boolean {
  const status = extractStatus(err);
  if (!status) return true;
  if (status === 408) return true;
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * Wrapper fiable pour les Edge Functions admin:
 * - timeout
 * - retry
 * - dedupe optionnel
 *
 * IMPORTANT (CORS):
 * - Ne PAS ajouter de headers custom (ex: x-request-id) côté navigateur,
 *   sauf si les Edge Functions incluent ce header dans Access-Control-Allow-Headers.
 */
async function invokeAdminFn<T>(
  fnName: string,
  body: unknown,
  opts?: {
    timeoutMs?: number;
    retries?: number;
    dedupe?: boolean;
    headers?: Record<string, string>;
  }
): Promise<AdminInvokeResponse<T>> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const retries = opts?.retries ?? 2;
  const dedupe = opts?.dedupe ?? false;

  const requestId = createRequestId();

  const key = dedupe ? `${fnName}:${stableStringify(body)}` : "";
  if (dedupe && inflight.has(key)) return inflight.get(key)!;

  const runner = (async (): Promise<AdminInvokeResponse<T>> => {
    let attempt = 0;
    let lastErr: any = null;

    while (attempt <= retries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // ⚠️ Ne pas injecter de header custom par défaut (CORS)
        const headers = opts?.headers && Object.keys(opts.headers).length > 0 ? opts.headers : undefined;

        const res = (await supabase.functions.invoke<T>(fnName, {
          body,
          ...(headers ? { headers } : {}),
          signal: controller.signal as any,
        } as any)) as { data: T | null; error: any | null };

        clearTimeout(timer);

        if (!res.error) return { data: res.data ?? null, error: null };

        lastErr = res.error;

        if (attempt < retries && shouldRetry(res.error)) {
          const base = 350 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * 150);
          await sleep(base + jitter);
          attempt += 1;
          continue;
        }

        return { data: res.data ?? null, error: normalizeError(res.error, requestId) };
      } catch (err: any) {
        clearTimeout(timer);
        lastErr = err;

        if (attempt < retries && shouldRetry(err)) {
          const base = 350 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * 150);
          await sleep(base + jitter);
          attempt += 1;
          continue;
        }

        return { data: null, error: normalizeError(err, requestId) };
      }
    }

    return { data: null, error: normalizeError(lastErr, requestId) };
  })();

  if (dedupe) inflight.set(key, runner);

  try {
    return await runner;
  } finally {
    if (dedupe) inflight.delete(key);
  }
}

/** =========================
 *  API ADMIN (Edge Functions)
 *  ========================= */

export async function adminListSources(): Promise<AdminInvokeResponse<AdminListSourcesResult>> {
  return invokeAdminFn<AdminListSourcesResult>("admin_list_sources", {}, { retries: 2, timeoutMs: 20_000 });
}

export async function adminTestSource(
  source_code: string,
  limit = 10
): Promise<AdminInvokeResponse<AdminTestSourceResult>> {
  return invokeAdminFn<AdminTestSourceResult>(
    "admin_test_source",
    { source_code, limit, fetch_sample: true },
    { retries: 2, timeoutMs: 30_000, dedupe: true }
  );
}

export async function adminConfigureRssSource(input: {
  code: string;
  name: string;
  feed_url: string;
  default_location: string;
  expire_after_days: number;
  activate?: boolean;
}): Promise<AdminInvokeResponse<AdminConfigureSourceResult>> {
  return invokeAdminFn<AdminConfigureSourceResult>(
    "admin_configure_source",
    { action: "upsert_rss", ...input, activate: input.activate ?? true },
    { retries: 2, timeoutMs: 30_000 }
  );
}

export async function adminMarkSourceReady(input: {
  code: string;
  activate?: boolean;
}): Promise<AdminInvokeResponse<AdminConfigureSourceResult>> {
  return invokeAdminFn<AdminConfigureSourceResult>(
    "admin_configure_source",
    { action: "mark_ready", code: input.code, activate: input.activate ?? true },
    { retries: 2, timeoutMs: 20_000 }
  );
}

export async function adminSetSourceActive(input: {
  code: string;
  is_active: boolean;
}): Promise<AdminInvokeResponse<AdminConfigureSourceResult>> {
  return invokeAdminFn<AdminConfigureSourceResult>(
    "admin_configure_source",
    { action: "set_active", code: input.code, is_active: input.is_active },
    { retries: 2, timeoutMs: 20_000 }
  );
}

/**
 * Aperçu / simulation (sans écriture DB)
 * Edge function: admin_run_ingest
 */
export type AdminRunIngestResult = {
  ok: boolean;
  ingest?: {
    ok: boolean;
    status?: string;
    parsed?: number;
    feed_url?: string;
    sample?: any[];
    message?: string;
    error?: string;
  };
  message?: string;
  error?: string;
};

export async function adminRunIngest(
  source_code: string,
  limit = 5
): Promise<AdminInvokeResponse<AdminRunIngestResult>> {
  return invokeAdminFn<AdminRunIngestResult>(
    "admin_run_ingest",
    { source_code, limit },
    { retries: 1, timeoutMs: 30_000, dedupe: true }
  );
}

/**
 * IMPORTER MAINTENANT
 * Edge function: admin_import_source
 */
export type AdminImportNowResult = {
  ok: boolean;
  source_code?: string;
  message?: string;
  error?: string;
  ingest?: {
    ok?: boolean;
    status?: string;
    inserted?: number;
    updated?: number;
    expired?: number;
    message?: string;
    error?: string;
  };
  inserted?: number;
  updated?: number;
  expired?: number;
};

export async function adminImportNow(
  source_code: string,
  limit = 50
): Promise<AdminInvokeResponse<AdminImportNowResult>> {
  return invokeAdminFn<AdminImportNowResult>(
    "admin_import_source",
    { source_code, limit },
    { retries: 2, timeoutMs: 60_000, dedupe: true }
  );
}

/**
 * VALIDATION DB post-import (optionnel)
 * Edge function: admin_validate_import
 */
export type AdminValidateImportResult = {
  ok: boolean;
  error?: string;
  message?: string;
  source?: any;
  stats?: {
    source_id: string;
    total_jobs: number;
    active_jobs: number;
    seen_last_10m: number;
    seen_last_60m: number;
    updated_last_10m: number;
    created_last_10m: number;
    last_job_seen: null | {
      title: string | null;
      company_name: string | null;
      last_seen_at: string | null;
      updated_at: string | null;
      created_at: string | null;
    };
  };
  server_time?: string;
};

export async function adminValidateImport(
  source_code: string
): Promise<AdminInvokeResponse<AdminValidateImportResult>> {
  return invokeAdminFn<AdminValidateImportResult>(
    "admin_validate_import",
    { source_code },
    { retries: 1, timeoutMs: 20_000, dedupe: true }
  );
}
