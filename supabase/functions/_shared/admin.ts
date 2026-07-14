import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Client com service_role — USO EXCLUSIVO dentro das Edge Functions.
 * Passa por cima do RLS; jamais expor esta chave fora do servidor.
 */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no runtime");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
