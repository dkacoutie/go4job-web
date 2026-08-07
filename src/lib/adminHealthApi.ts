import { supabase } from "./supabaseClient";

export type HealthStatus = "ok" | "warning" | "critical" | string;

export type AdminHealthOverview = {
  as_of?: string;
  status?: HealthStatus;
  red_flags?: string[];
  jobs?: {
    total?: number;
    active_not_expired?: number;
    active_with_url?: number;
    expired?: number;
    created_today?: number;
    seen_today?: number;
    created_7d?: number;
    active_by_country?: Array<{ country: string; count: number }>;
  };
  sources?: {
    total?: number;
    active?: number;
    ready_active?: number;
    ready_inactive?: number;
    auto_disabled?: number;
    healthy?: number;
    warning?: number;
    critical?: number;
    without_success_24h?: number;
    without_success_48h?: number;
    without_success_7d?: number;
  };
  runs?: {
    ingest_runs_24h?: number;
    ingest_success_24h?: number;
    ingest_failures_24h?: number;
    running_over_30m?: number;
  };
  health_events_7d?: Array<{
    level: string;
    code: string;
    count_7d: number;
    latest_at: string;
  }>;
};

export type AdminHealthSource = {
  source_id?: string;
  code?: string;
  name?: string;
  ingest_method?: string;
  ingest_status?: string;
  is_active?: boolean;
  auto_disabled?: boolean;
  health_status?: string | null;
  last_success_at?: string | null;
  consecutive_failures?: number | null;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_run_ok?: boolean | null;
  last_run_fetched?: number | null;
  last_run_inserted?: number | null;
  last_run_updated?: number | null;
  last_run_duration_ms?: number | null;
  last_error_summary?: string | null;
  watch_level?: "ok" | "warning" | "critical" | string;
};

export type AdminHealthRun = {
  run_id?: number;
  source_code?: string | null;
  source_name?: string | null;
  run_kind?: string;
  started_at?: string;
  finished_at?: string | null;
  status?: string;
  ok?: boolean;
  fetched_count?: number | null;
  inserted_count?: number | null;
  updated_count?: number | null;
  duration_ms?: number | null;
  error_summary?: string | null;
};

export type AdminHealthCron = {
  jobid?: number | null;
  jobname?: string | null;
  active?: boolean;
  schedule?: string | null;
  target_summary?: string | null;
  dry_run_false_detected?: boolean;
  allow_send_detected?: boolean;
  allow_import_detected?: boolean;
  hardcoded_user_id_detected?: boolean;
  last_run_status?: string | null;
  last_run_at?: string | null;
  recent_error_summary?: string | null;
};

// JR-0068 (07/08/2026) : paiements + inscriptions, absents de la V1
// initiale (admin_health_v1_overview listait 'billing_details' dans
// 'excluded_from_v1'). Alimente par la RPC admin_health_v1_billing.
export type AdminHealthBilling = {
  as_of?: string;
  signups?: {
    total?: number;
    today?: number;
    "7d"?: number;
    "30d"?: number;
  };
  payments?: {
    paid_total_count?: number;
    paid_today?: number;
    paid_7d?: number;
    paid_30d?: number;
    pending_count?: number;
    failed_30d?: number;
    revenue_by_currency_30d?: Array<{ currency: string; amount_minor: number }>;
    by_plan_30d?: Array<{ plan_code: string; count: number }>;
  };
  subscriptions?: {
    active_count?: number;
    expiring_48h?: number;
    expired_30d?: number;
  };
  payment_alerts_unresolved?: number;
};

export type AdminHealthData = {
  overview: AdminHealthOverview;
  sources: AdminHealthSource[];
  runs: AdminHealthRun[];
  crons: AdminHealthCron[];
  billing: AdminHealthBilling;
};

export type AdminHealthResponse = {
  ok: boolean;
  data?: AdminHealthData;
  error?: string;
  message?: string;
};

function redactEdgeErrorMessage(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]")
    .slice(0, 500);
}

function readStringField(source: unknown, key: string) {
  if (!source || typeof source !== "object") return "";
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

async function readEdgeErrorBody(context: unknown) {
  if (!(context instanceof Response)) {
    return { status: undefined as number | undefined, code: "", message: "" };
  }

  const status = context.status;
  const raw = (await context.clone().text().catch(() => "")).trim();
  if (!raw) return { status, code: "", message: "" };

  try {
    const parsed = JSON.parse(raw) as unknown;
    const code = readStringField(parsed, "error") || readStringField(parsed, "code");
    const message = readStringField(parsed, "message") || code || raw;
    return { status, code, message: redactEdgeErrorMessage(message) };
  } catch {
    return { status, code: "", message: redactEdgeErrorMessage(raw) };
  }
}

async function buildAdminHealthError(error: unknown) {
  const fallbackMessage = error instanceof Error ? error.message : "admin_health_failed";
  const context = error && typeof error === "object" ? (error as { context?: unknown }).context : undefined;
  const details = await readEdgeErrorBody(context);
  const parts = [
    details.status ? `status ${details.status}` : null,
    details.code ? `code ${details.code}` : null,
    details.message || redactEdgeErrorMessage(fallbackMessage),
  ].filter(Boolean);

  return new Error(`admin_health failed: ${parts.join(" - ")}`);
}

export async function fetchAdminHealthV1() {
  const { data, error } = await supabase.functions.invoke<AdminHealthResponse>("admin_health", {
    body: { scope: "jobradar_health_v1" },
  });

  if (error) {
    throw await buildAdminHealthError(error);
  }

  if (!data?.ok || !data.data) {
    const parts = [
      data?.error ? `code ${redactEdgeErrorMessage(data.error)}` : null,
      data?.message ? redactEdgeErrorMessage(data.message) : null,
    ].filter(Boolean);
    throw new Error(`admin_health unavailable: ${parts.join(" - ") || "empty response"}`);
  }

  return data.data;
}
