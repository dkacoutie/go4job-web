// scripts/backfill_enrichments.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL)");
if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function toTextArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String);
  return [];
}

async function fetchActiveJobs(limit = 200) {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, created_at")
    .eq("is_active", true)
    .eq("is_expired", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

async function fetchLatestEnrichedIds(jobIds) {
  if (!jobIds.length) return new Set();
  const { data, error } = await supabase
    .from("job_enrichments")
    .select("job_id")
    .eq("is_latest", true)
    .in("job_id", jobIds);

  if (error) throw error;
  return new Set((data ?? []).map((r) => r.job_id).filter(Boolean));
}

async function callJobEnrich(jobId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/job_enrich`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`job_enrich failed (${res.status}) ${txt}`);
  }

  return await res.json();
}

async function saveEnrichment(jobId, enrich) {
  // 1) désactive l'ancien latest
  const { error: uErr } = await supabase
    .from("job_enrichments")
    .update({ is_latest: false })
    .eq("job_id", jobId)
    .eq("is_latest", true);

  if (uErr) throw uErr;

  // 2) insère un nouveau snapshot latest
  const row = {
    job_id: jobId,
    version: 1,
    is_latest: true,
    job_family: enrich?.job_family ?? null,
    required_skills: toTextArray(enrich?.required_skills),
    optional_skills: toTextArray(enrich?.optional_skills),
    job_skills: toTextArray(enrich?.job_skills),
    experience_years_min:
      Number.isFinite(enrich?.experience_years_min) ? enrich.experience_years_min : null,
    experience_years_max:
      Number.isFinite(enrich?.experience_years_max) ? enrich.experience_years_max : null,
    enrichment: enrich ?? null,
    meta: { source: "backfill", at: new Date().toISOString() },
  };

  const { error: iErr } = await supabase.from("job_enrichments").insert(row);
  if (iErr) throw iErr;
}

async function main() {
  const limit = Number(process.argv[2] ?? 50); // nb de jobs à enrichir max
  const active = await fetchActiveJobs(300);
  const ids = active.map((x) => x.id);

  const already = await fetchLatestEnrichedIds(ids);
  const missing = ids.filter((id) => !already.has(id)).slice(0, limit);

  console.log(`Active jobs: ${ids.length}`);
  console.log(`Already enriched (latest): ${already.size}`);
  console.log(`Missing to enrich (this run): ${missing.length}`);

  let ok = 0;
  for (const jobId of missing) {
    try {
      const enrich = await callJobEnrich(jobId);
      await saveEnrichment(jobId, enrich);
      ok += 1;
      console.log(`✅ enriched ${jobId}`);
    } catch (e) {
      console.error(`❌ ${jobId}`, e?.message ?? e);
    }
  }

  console.log(`Done. Success: ${ok}/${missing.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
