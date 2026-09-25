/**
 * Rewrite the whole Deal Score cache (variant_deal_scores). The collector already recomputes
 * the variants it touched after each run; use this after seeding or changing the scoring.
 * Run: pnpm scores:recompute
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { recomputeDealScores } from "../src/lib/pricing/recompute-scores";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const db = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { scored, tally } = await recomputeDealScores(db);
  console.log(`Scored ${scored} variants.`);
  for (const [k, n] of Object.entries(tally).sort()) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
