import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey;

if (supabaseConfigError) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in the frontend environment.");
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || "https://missing-supabase-url.invalid",
  supabaseAnonKey || "missing-vite-supabase-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "go4job.auth",
    },
  },
);

if (import.meta.env.DEV) {
  type SupabaseWindow = typeof window & { supabase?: SupabaseClient };
  (window as SupabaseWindow).supabase = supabase;
}
