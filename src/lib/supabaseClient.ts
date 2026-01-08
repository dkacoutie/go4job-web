// src/SupabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // garde la session (localStorage)
    autoRefreshToken: true,     // refresh auto
    detectSessionInUrl: true,   // utile si OAuth redirect
    storageKey: "go4job.auth",  // clé stable dans localStorage
  },
});

// DEV only: expose supabase in browser console (window.supabase)
if (import.meta.env.DEV) {
  type SupabaseWindow = typeof window & { supabase?: SupabaseClient };
  (window as SupabaseWindow).supabase = supabase;
}
