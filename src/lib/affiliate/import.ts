import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NormalizedConversion } from "@/lib/affiliate/normalize";

export const UPSERT_BATCH = 500;

export async function upsertNormalizedConversions(
  rows: NormalizedConversion[],
  client: SupabaseClient<Database> = createAdminClient(),
): Promise<{ inserted: number; updated: number; matched: number }> {
  const total = { inserted: 0, updated: 0, matched: 0 };
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { data, error } = await client.rpc("upsert_conversions", {
      p_rows: rows.slice(i, i + UPSERT_BATCH) as never,
    });
    if (error) throw new Error(`upsert_conversions thất bại: ${error.message}`);
    const r = data?.[0];
    total.inserted += r?.inserted ?? 0;
    total.updated += r?.updated ?? 0;
    total.matched += r?.matched ?? 0;
  }
  return total;
}
