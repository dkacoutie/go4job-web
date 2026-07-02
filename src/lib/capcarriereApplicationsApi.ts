import { supabase } from "./supabaseClient";

export type CapcarriereDraftStatus =
  | "draft"
  | "needs_user_review"
  | "approved_by_user"
  | "cancelled"
  | "blocked"
  | "failed"
  | "sent";

export type CapcarriereJob = {
  id: string;
  title: string | null;
  company_name: string | null;
  location: string | null;
  country: string | null;
  expires_at: string | null;
};

export type CapcarriereDraft = {
  id: string;
  user_id: string;
  job_id: string;
  recipient_email: string | null;
  subject: string | null;
  email_body: string | null;
  cover_letter_body: string | null;
  status: CapcarriereDraftStatus;
  application_channel: string | null;
  cv_required: boolean;
  cover_letter_required: boolean;
  risk_level: string | null;
  risk_flags: string[];
  user_reviewed_at: string | null;
  user_approved_at: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  jobs: CapcarriereJob | null;
};

export type CapcarriereEvent = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  triggered_by: string;
  created_at: string;
};

export type CapcarriereCv = {
  id: string | null;
  filename: string | null;
  status: string | null;
  signedUrl: string | null;
};

type DraftRow = Omit<CapcarriereDraft, "jobs"> & {
  jobs?: CapcarriereJob | CapcarriereJob[] | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function logCapcarriereOptionalError(scope: string, error: unknown) {
  if (!import.meta.env.DEV) return;

  const message = error instanceof Error ? error.message : String(error);
  console.warn("[CapCarriere applications]", scope, { message });
}

export async function fetchCapcarriereDrafts(userId: string): Promise<CapcarriereDraft[]> {
  const { data, error } = await supabase
    .from("cc_application_drafts")
    .select(
      `
        id,
        user_id,
        job_id,
        recipient_email,
        subject,
        email_body,
        cover_letter_body,
        status,
        application_channel,
        cv_required,
        cover_letter_required,
        risk_level,
        risk_flags,
        user_reviewed_at,
        user_approved_at,
        sent_at,
        cancelled_at,
        created_at,
        updated_at,
        jobs:jobs (
          id,
          title,
          company_name,
          location,
          country,
          expires_at
        )
      `,
    )
    .eq("user_id", userId)
    .in("status", ["draft", "needs_user_review", "approved_by_user", "cancelled", "blocked", "failed"])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as DraftRow[]).map((row) => ({
    ...row,
    risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
    jobs: Array.isArray(row.jobs) ? row.jobs[0] ?? null : row.jobs ?? null,
  }));
}

export async function fetchCapcarriereEvents(draftId: string): Promise<CapcarriereEvent[]> {
  const { data, error } = await supabase
    .from("cc_application_events")
    .select("id,event_type,from_status,to_status,triggered_by,created_at")
    .eq("draft_id", draftId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CapcarriereEvent[];
}

export async function fetchCurrentCapcarriereCv(userId: string): Promise<CapcarriereCv | null> {
  const { data, error } = await supabase
    .from("cc_cv_versions")
    .select("id,storage_bucket,storage_path,original_filename,status")
    .eq("user_id", userId)
    .eq("is_current", true)
    .is("revoked_at", null)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: signedData, error: signedError } = await supabase.storage
    .from(data.storage_bucket)
    .createSignedUrl(data.storage_path, 3600);

  return {
    id: data.id,
    filename: data.original_filename,
    status: data.status,
    signedUrl: signedError ? null : signedData.signedUrl,
  };
}

export async function reviewCapcarriereDraft(draftId: string, decision: "approve" | "reject") {
  const { data, error } = await supabase.rpc("cc_review_application_draft", {
    p_draft_id: draftId,
    p_decision: decision,
  });

  if (error) {
    throw new Error(errorMessage(error, "La décision n'a pas pu être enregistrée."));
  }

  return data;
}
