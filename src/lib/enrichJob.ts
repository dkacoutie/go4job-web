// src/lib/enrichJob.ts
import { supabase } from "./supabaseClient"; // <- adapte si besoin

export async function enrichJob(jobId: string, opts?: { force?: boolean; debug?: boolean; persist?: boolean }) {
  const force = opts?.force ?? true;
  const debug = opts?.debug ?? false;
  const persist = opts?.persist ?? true;

  const { data, error } = await supabase.functions.invoke("job_enrich", {
    body: {
      job_id: jobId,
      debug,
      force,
      persist,
    },
  });

  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? "job_enrich failed");

  return data;
}
