import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type QualificationBody = {
  lead_id?: string | null;
  job_search_status?: string | null;
};

const ALLOWED_STATUSES = new Set([
  "active_search",
  "new_graduate",
  "employed_better_opportunity",
  "career_change",
  "watching_opportunities",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_misconfigured" });
  }

  let body: QualificationBody;
  try {
    body = (await req.json()) as QualificationBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const leadId = cleanText(body.lead_id);
  const jobSearchStatus = cleanText(body.job_search_status);

  if (!leadId || !isUuid(leadId)) {
    return json(400, { ok: false, error: "invalid_lead_id" });
  }

  if (!jobSearchStatus) {
    return json(200, { ok: true, skipped: true, reason: "empty_job_search_status" });
  }

  if (!ALLOWED_STATUSES.has(jobSearchStatus)) {
    return json(400, { ok: false, error: "invalid_job_search_status" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("cv_ats_leads")
    .update({
      job_search_status: jobSearchStatus,
      qualification_completed_at: now,
      updated_at: now,
    })
    .eq("id", leadId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return json(500, { ok: false, error: "qualification_update_failed" });
  }

  if (!data?.id) {
    return json(404, { ok: false, error: "lead_not_found" });
  }

  return json(200, { ok: true });
});
