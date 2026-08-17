import { supabase } from "./supabaseClient";

// JR-testimonials-20260816 : avis utilisateurs affiches sur la page
// d'accueil publique (LandingPage) et "Qui sommes-nous". Meme convention
// que le reste du projet -- aucun acces direct a la table `testimonials`
// depuis le frontend (RLS activee, aucune policy), tout passe par des RPC
// SECURITY DEFINER. Voir supabase/migrations/20260816120000_jr_testimonials_table_and_rpc.sql,
// 20260816120500_jr_testimonials_harden_function_grants.sql et
// 20260816121000_jr_testimonials_get_mine_rpc.sql.

export type PublicTestimonial = {
  id: string;
  author_display_name: string;
  rating: number;
  message: string;
  created_at: string;
};

export type TestimonialsStats = {
  average_rating: number | null;
  approved_count: number;
};

export async function fetchPublicTestimonials(limit = 6): Promise<PublicTestimonial[]> {
  const { data, error } = await supabase.rpc("jobradar_public_testimonials", { p_limit: limit });
  if (error) throw new Error(error.message || "Impossible de charger les avis.");
  return (data ?? []) as PublicTestimonial[];
}

export async function fetchTestimonialsStats(): Promise<TestimonialsStats> {
  const { data, error } = await supabase.rpc("jobradar_public_testimonials_stats");
  if (error) throw new Error(error.message || "Impossible de charger les statistiques d'avis.");
  const rows = (data ?? []) as TestimonialsStats[];
  return rows[0] ?? { average_rating: null, approved_count: 0 };
}

export type TestimonialStatus = "pending" | "approved" | "rejected";

export type MyTestimonial = {
  id: string;
  user_id: string;
  author_display_name: string;
  rating: number;
  message: string;
  status: TestimonialStatus;
  created_at: string;
  updated_at: string;
};

// Lit l'avis de l'utilisateur connecte, s'il en a deja soumis un (RPC
// jobradar_testimonials_get_mine -- il n'y a pas de policy RLS permettant
// une lecture directe de la table, voir commentaire en tete de fichier).
export async function fetchMyTestimonial(): Promise<MyTestimonial | null> {
  const { data, error } = await supabase.rpc("jobradar_testimonials_get_mine");
  if (error) throw new Error(error.message || "Impossible de charger ton avis.");
  return (data as MyTestimonial | null) ?? null;
}

// Cree ou remplace l'avis de l'utilisateur connecte (un seul avis actif par
// utilisateur, contrainte unique cote base) -- repasse toujours en
// 'pending' pour re-verification, y compris en cas de modification d'un
// avis deja approuve.
export async function submitTestimonial(input: {
  message: string;
  rating: number;
  displayName: string;
}): Promise<MyTestimonial> {
  const { data, error } = await supabase.rpc("jobradar_testimonials_submit", {
    p_message: input.message,
    p_rating: input.rating,
    p_display_name: input.displayName,
  });

  if (error) throw new Error(error.message || "Impossible d'enregistrer ton avis.");
  if (!data) throw new Error("Aucune reponse recue apres l'enregistrement de l'avis.");
  return data as MyTestimonial;
}
