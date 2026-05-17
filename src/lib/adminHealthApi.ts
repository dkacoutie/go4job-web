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

export type AdminHealthData = {
  overview: AdminHealthOverview;
  sources: AdminHealthSource[];
  runs: AdminHealthRun[];
  crons: AdminHealthCron[];
};

export type AdminHealthResponse = {
  ok: boolean;
  data?: AdminHealthData;
  error?: string;
  message?: string;
};

export async function fetchAdminHealthV1() {
  const { data, error } = await supabase.functions.invoke<AdminHealthResponse>("admin_health", {
    body: { scope: "jobradar_health_v1" },
  });

  if (error) {
    throw new Error(error.message || "admin_health_failed");
  }

  if (!data?.ok || !data.data) {
    throw new Error(data?.message || data?.error || "admin_health_unavailable");
  }

  return data.data;
}
