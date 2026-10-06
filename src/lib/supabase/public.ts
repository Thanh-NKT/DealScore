import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Cookie-less anon client for PUBLIC catalog reads (products, prices, vouchers) inside a shared
 * cache (`unstable_cache`). It carries no session, so a cached result can never hold user-bound
 * data; RLS applies as for any anonymous visitor. Never use it for anything a signed-in user owns.
 * Same pattern as app/sitemap.ts and lib/intent/vocab.ts.
 */
export function createPublicClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
