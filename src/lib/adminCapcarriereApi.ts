import { supabase } from "./supabaseClient";

export type JsonRecord = Record<string, unknown>;

export type AdminCapcarriereDraft = {
  id: string;
  user_id: string;
  job_id: string;
  apply_intel_id: string;
  recipient_email: string | null;
  subject: string | null;
  email_body: string | null;
  cover_letter_body: string | null;
  status: string | null;
  cv_required: boolean | null;
  cover_letter_required: boolean | null;
  send_attempt_count: number | null;
  send_provider: string | null;
  send_provider_message_id: string | null;
  send_error: string | null;
  last_send_attempt_at: string | null;
  user_consent_at: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  metadata_json?: JsonRecord | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AdminCapcarriereJob = {
  id: string;
  title: string | null;
  company_name: string | null;
  source_name: string | null;
  external_id: string | null;
  expires_at: string | null;
};

export type AdminCapcarriereApplyIntel = {
  id: string;
  apply_channel: string | null;
  automation_level: string | null;
  apply_email: string | null;
  status: string | null;
  metadata_json?: JsonRecord | null;
};

export type AdminCapcarriereEvent = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  triggered_by: string | null;
  created_at: string | null;
  metadata_json?: JsonRecord | null;
};

export type AdminCapcarriereDraftReview = {
  draft: AdminCapcarriereDraft;
  job: AdminCapcarriereJob | null;
  apply_intel: AdminCapcarriereApplyIntel | null;
  events: AdminCapcarriereEvent[];
  deadline?: {
    value: string | null;
    source: "draft_metadata" | "apply_intel_metadata" | "job_expires_at" | "not_found";
    label: "offre_validated" | "job_expiration" | "not_found";
  };
  cv?: {
    signed_url: string | null;
    filename: string | null;
    updated_at: string | null;
    source: "profiles.cv_file_path" | "not_found" | string;
    storage_path_found: boolean;
    signed_url_expires_in_seconds: number | null;
    error: string | null;
  };
  safety: {
    read_only: boolean;
    internal_only: boolean;
    email_sent: boolean;
    human_review_required: boolean;
    cv_needs_update_before_send: boolean;
  };
};

type AdminCapcarriereResponse = {
  ok: boolean;
  scope?: string;
  data?: AdminCapcarriereDraftReview;
  error?: string;
  message?: string;
};

async function messageFromFunctionError(error: unknown) {
  const fallback = error instanceof Error ? error.message : "admin_capcarriere_draft_review_failed";
  const context = (error as { context?: unknown })?.context;

  if (context && typeof context === "object" && "json" in context) {
    try {
      const body = await (context as Response).json() as AdminCapcarriereResponse;
      return body.message || body.error || fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export async function fetchAdminCapcarriereDraftReview(draftId: string) {
  const { data, error } = await supabase.functions.invoke<AdminCapcarriereResponse>(
    "admin_capcarriere_draft_review",
    {
      body: { draftId },
    },
  );

  if (error) {
    throw new Error(await messageFromFunctionError(error));
  }

  if (!data?.ok || !data.data) {
    throw new Error(data?.message || data?.error || "admin_capcarriere_draft_review_unavailable");
  }

  return data.data;
}
