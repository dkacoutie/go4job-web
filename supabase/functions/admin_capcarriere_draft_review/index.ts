import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://go4jobapp.com",
  "https://jobradar.go4jobapp.com",
]);

const INTERNAL_TEST_USER_ID = "d8069021-87ff-452a-beb3-e5b708378a7e";

type RequestBody = {
  draftId?: string | null;
};

type DeadlineInfo = {
  value: string | null;
  source: "draft_metadata" | "apply_intel_metadata" | "job_expires_at" | "not_found";
  label: "offre_validated" | "job_expiration" | "not_found";
};

function stringFromRecord(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function pickDeadline(
  draft: Record<string, unknown>,
  applyIntel: Record<string, unknown> | null,
  job: Record<string, unknown> | null,
): DeadlineInfo {
  const draftMetadata = metadataFrom(draft.metadata_json);
  const applyIntelMetadata = metadataFrom(applyIntel?.metadata_json);
  const draftDeadline = stringFromRecord(draftMetadata, "application_deadline");
  const applyIntelDeadline = stringFromRecord(applyIntelMetadata, "deadline");
  const jobExpiresAt = typeof job?.expires_at === "string" && job.expires_at.trim() ? job.expires_at.trim() : null;

  if (draftDeadline) {
    return { value: draftDeadline, source: "draft_metadata", label: "offre_validated" };
  }

  if (applyIntelDeadline) {
    return { value: applyIntelDeadline, source: "apply_intel_metadata", label: "offre_validated" };
  }

  if (jobExpiresAt) {
    return { value: jobExpiresAt, source: "job_expires_at", label: "job_expiration" };
  }

  return { value: null, source: "not_found", label: "not_found" };
}

function cleanSecret(value: string | undefined | null): string {
  let v = (value ?? "").trim();
  v = v.replace(/^['"]|['"]$/g, "");
  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7).trim();
  }
  return v;
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  );
}

serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, headers);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { ok: false, error: "missing_session" }, headers);
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json(400, { ok: false, error: "invalid_json_body" }, headers);
  }

  const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
  if (!isUuid(draftId)) {
    return json(400, { ok: false, error: "missing_or_invalid_draft_id" }, headers);
  }

  const supabaseUrl = cleanSecret(Deno.env.get("SUPABASE_URL"));
  const anonKey = cleanSecret(Deno.env.get("SUPABASE_ANON_KEY"));
  const serviceKey = cleanSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { ok: false, error: "server_misconfigured" }, headers);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return json(401, { ok: false, error: "invalid_session" }, headers);
  }

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin_user");
  if (adminError) {
    return json(403, { ok: false, error: "admin_check_failed" }, headers);
  }

  if (isAdmin !== true) {
    return json(403, { ok: false, error: "admin_only" }, headers);
  }

  if (userData.user.id !== INTERNAL_TEST_USER_ID) {
    return json(403, { ok: false, error: "internal_test_user_only" }, headers);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const draftRes = await serviceClient
    .from("cc_application_drafts")
    .select(
      [
        "id",
        "user_id",
        "job_id",
        "apply_intel_id",
        "recipient_email",
        "subject",
        "email_body",
        "cover_letter_body",
        "status",
        "cv_required",
        "cover_letter_required",
        "send_attempt_count",
        "send_provider",
        "send_provider_message_id",
        "send_error",
        "last_send_attempt_at",
        "user_consent_at",
        "sent_at",
        "cancelled_at",
        "metadata_json",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftRes.error) {
    return json(500, { ok: false, error: "draft_lookup_failed", message: draftRes.error.message }, headers);
  }

  if (!draftRes.data) {
    return json(404, { ok: false, error: "draft_not_found" }, headers);
  }

  const draft = draftRes.data as unknown as Record<string, unknown>;

  const [jobRes, applyIntelRes, eventsRes] = await Promise.all([
    serviceClient
      .from("jobs")
      .select("id,title,company_name,job_source_id,external_id,expires_at")
      .eq("id", String(draft.job_id))
      .maybeSingle(),
    serviceClient
      .from("cc_job_apply_intel")
      .select("id,apply_channel,automation_level,apply_email,status,metadata_json")
      .eq("id", String(draft.apply_intel_id))
      .maybeSingle(),
    serviceClient
      .from("cc_application_events")
      .select("id,event_type,from_status,to_status,triggered_by,created_at,metadata_json")
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false }),
  ]);

  const firstError = jobRes.error ?? applyIntelRes.error ?? eventsRes.error;
  if (firstError) {
    return json(500, { ok: false, error: "related_lookup_failed", message: firstError.message }, headers);
  }

  let sourceName: string | null = null;
  const job = jobRes.data as unknown as Record<string, unknown> | null;
  const applyIntel = applyIntelRes.data as unknown as Record<string, unknown> | null;
  const jobSourceId = typeof job?.job_source_id === "string" ? job.job_source_id : "";

  if (isUuid(jobSourceId)) {
    const sourceRes = await serviceClient
      .from("job_sources")
      .select("name")
      .eq("id", jobSourceId)
      .maybeSingle();

    if (sourceRes.error) {
      return json(500, { ok: false, error: "source_lookup_failed", message: sourceRes.error.message }, headers);
    }

    sourceName = typeof sourceRes.data?.name === "string" ? sourceRes.data.name : null;
  }

  const profileRes = await serviceClient
    .from("profiles")
    .select("cv_file_path,cv_filename,cv_updated_at")
    .eq("user_id", String(draft.user_id))
    .maybeSingle();

  if (profileRes.error) {
    return json(500, { ok: false, error: "profile_cv_lookup_failed", message: profileRes.error.message }, headers);
  }

  const profile = profileRes.data as unknown as Record<string, unknown> | null;
  const cvPath = typeof profile?.cv_file_path === "string" && profile.cv_file_path.trim()
    ? profile.cv_file_path.trim()
    : null;
  let cvSignedUrl: string | null = null;
  let cvUrlError: string | null = null;

  if (cvPath) {
    const signedUrlRes = await serviceClient.storage.from("cvs").createSignedUrl(cvPath, 3600);
    if (signedUrlRes.error || !signedUrlRes.data?.signedUrl) {
      cvUrlError = signedUrlRes.error?.message ?? "signed_url_unavailable";
    } else {
      cvSignedUrl = signedUrlRes.data.signedUrl;
    }
  }

  const deadline = pickDeadline(draft, applyIntel, job);

  return json(200, {
    ok: true,
    scope: "capcarriere_draft_review_b1_read_only",
    data: {
      draft,
      job: job
        ? {
          id: job.id,
          title: job.title,
          company_name: job.company_name,
          source_name: sourceName,
          external_id: job.external_id,
          expires_at: job.expires_at,
        }
        : null,
      apply_intel: applyIntel,
      events: eventsRes.data ?? [],
      deadline,
      cv: {
        signed_url: cvSignedUrl,
        filename: typeof profile?.cv_filename === "string" ? profile.cv_filename : null,
        updated_at: typeof profile?.cv_updated_at === "string" ? profile.cv_updated_at : null,
        source: cvPath ? "profiles.cv_file_path" : "not_found",
        storage_path_found: Boolean(cvPath),
        signed_url_expires_in_seconds: cvSignedUrl ? 3600 : null,
        error: cvUrlError,
      },
      safety: {
        read_only: true,
        internal_only: true,
        email_sent: draft.sent_at != null,
        human_review_required: true,
        cv_needs_update_before_send: true,
      },
    },
  }, headers);
});
