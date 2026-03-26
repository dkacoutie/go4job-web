import { supabase } from "./supabaseClient";

export async function fetchIsAdminUser() {
  const { data, error } = await supabase.rpc("is_admin_user");
  return !error && data === true;
}

export async function fetchIsSuperAdmin() {
  const { data, error } = await supabase.rpc("is_super_admin");
  return !error && data === true;
}
