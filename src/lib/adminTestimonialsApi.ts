import { supabase } from "./supabaseClient";
import type { MyTestimonial } from "./testimonialsApi";

// JR-testimonials-20260816 : moderation admin des avis. Meme convention que
// adminPartnersApi.ts -- RPC SECURITY DEFINER qui verifient is_admin_user()
// en interne, aucun acces direct a la table `testimonials`. Voir
// supabase/migrations/20260816120000_jr_testimonials_table_and_rpc.sql.

export type AdminTestimonialRow = MyTestimonial;

function ensureNoError<T>(error: { message?: string } | null, data: T, fallbackMessage: string): T {
  if (error) throw new Error(error.message || fallbackMessage);
  if (data === null || data === undefined) throw new Error(fallbackMessage);
  return data;
}

export async function fetchAdminTestimonials(): Promise<AdminTestimonialRow[]> {
  const { data, error } = await supabase.rpc("jobradar_admin_testimonials_list");
  if (error) throw new Error(error.message || "Impossible de charger les avis.");
  return (data ?? []) as AdminTestimonialRow[];
}

export async function moderateTestimonial(
  testimonialId: string,
  status: "approved" | "rejected"
): Promise<AdminTestimonialRow> {
  const { data, error } = await supabase.rpc("jobradar_admin_testimonials_moderate", {
    p_testimonial_id: testimonialId,
    p_status: status,
  });
  return ensureNoError(error, data as AdminTestimonialRow, "Impossible de mettre a jour cet avis.");
}
