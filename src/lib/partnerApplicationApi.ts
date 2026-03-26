import { supabase } from "./supabaseClient";
import type { PartnerAccountRow } from "./adminPartnersApi";

type PartnerProfilePrefill = {
  full_name: string | null;
};

export type PartnerInvitationContext = {
  partner_id: string;
  display_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  partner_status: PartnerAccountRow["status"];
  expires_at: string;
};

export type PartnerApplicationInput = {
  invitationToken: string;
  displayName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  applicationMessage?: string | null;
  termsVersion: string;
};

function ensureNoError<T>(error: { message?: string } | null, data: T | null, fallback: string): T {
  if (error) throw new Error(error.message || fallback);
  if (data === null) throw new Error(fallback);
  return data;
}

export async function fetchOwnPartnerAccount(userId: string): Promise<PartnerAccountRow | null> {
  const { data, error } = await supabase.from("partner_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message || "Impossible de charger le compte partenaire.");
  return (data as PartnerAccountRow | null) ?? null;
}

export async function fetchOwnPartnerProfile(userId: string): Promise<PartnerProfilePrefill | null> {
  const { data, error } = await supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message || "Impossible de charger le profil.");
  return (data as PartnerProfilePrefill | null) ?? null;
}

export async function validatePartnerInvitation(invitationToken: string): Promise<PartnerInvitationContext> {
  const { data, error } = await supabase.rpc("partner_validate_invitation", {
    p_invitation_token: invitationToken,
  });

  return ensureNoError(error, data as PartnerInvitationContext | null, "Impossible de verifier l'invitation partenaire.");
}

export async function submitPartnerApplication(input: PartnerApplicationInput): Promise<PartnerAccountRow> {
  const { data, error } = await supabase.rpc("partner_request_apply", {
    p_invitation_token: input.invitationToken,
    p_display_name: input.displayName,
    p_contact_name: input.contactName || null,
    p_contact_email: input.contactEmail || null,
    p_application_message: input.applicationMessage || null,
    p_terms_version: input.termsVersion,
  });

  return ensureNoError(error, data as PartnerAccountRow | null, "Impossible d'activer le compte partenaire.");
}
