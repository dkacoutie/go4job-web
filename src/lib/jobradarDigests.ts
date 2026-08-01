import { supabase } from "./supabaseClient";

export type JobRadarDigestRun = {
  id: string;
  user_id: string;
  digest_date: string;
  channel: string;
  subject: string | null;
  preheader: string | null;
  job_count: number;
  created_at: string;
};

export type JobRadarDigestItem = {
  id: string;
  run_id: string;
  job_id: string | null;
  rank: number;
  title: string;
  company_name: string | null;
  location: string | null;
  country: string | null;
  score: number | null;
  created_at: string;
  jobs?: {
    id?: string | null;
    is_expired?: boolean | null;
    job_status?: string | null;
    source_url?: string | null;
    apply_url?: string | null;
  } | null;
};

export async function fetchDigestRuns(userId: string) {
  const { data, error } = await supabase
    .from("jobradar_digest_runs")
    .select("id,user_id,digest_date,channel,subject,preheader,job_count,created_at")
    .eq("user_id", userId)
    .order("digest_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as JobRadarDigestRun[];
}

export async function fetchDigestDetail(userId: string, runId: string) {
  const { data: run, error: runError } = await supabase
    .from("jobradar_digest_runs")
    .select("id,user_id,digest_date,channel,subject,preheader,job_count,created_at")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();

  if (runError) throw runError;
  if (!run) return { run: null, items: [] as JobRadarDigestItem[] };

  const { data: items, error: itemsError } = await supabase
    .from("jobradar_digest_items")
    .select("id,run_id,job_id,rank,title,company_name,location,country,score,created_at,jobs:jobs(id,is_expired,job_status,source_url,apply_url)")
    .eq("run_id", runId)
    .order("rank", { ascending: true });

  if (itemsError) throw itemsError;
  return {
    run: run as JobRadarDigestRun,
    items: (items ?? []) as JobRadarDigestItem[],
  };
}

export function formatDigestDate(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function isDigestItemExpired(item: JobRadarDigestItem) {
  return !item.job_id ||
    item.jobs?.is_expired === true ||
    ["expired", "tombstoned", "pending"].includes(String(item.jobs?.job_status ?? ""));
}
