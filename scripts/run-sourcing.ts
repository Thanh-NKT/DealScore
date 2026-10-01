/**
 * Run one sourcing pass locally — pg_cron cannot reach a dev machine.
 * Run: pnpm sourcing:run [marketplace]   (default: every configured marketplace)
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredMarketplaces } from "@/lib/marketplaces/sources";
import { runSourcing, supabaseSourcingDeps } from "@/lib/sourcing/run";
import type { MarketplaceId } from "@/lib/marketplaces/types";

async function main() {
  const only = process.argv[2] as MarketplaceId | undefined;
  const admin = createAdminClient();
  for (const m of only ? [only] : configuredMarketplaces()) {
    console.log(m, await runSourcing({ marketplace: m }, supabaseSourcingDeps(admin, m)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
