/**
 * Run one sourcing pass locally — pg_cron cannot reach a dev machine.
 * Run: pnpm sourcing:run [marketplace|all] [demand]
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredMarketplaces } from "@/lib/marketplaces/sources";
import { runSourcing, supabaseSourcingDeps } from "@/lib/sourcing/run";
import type { MarketplaceId } from "@/lib/marketplaces/types";
import type { SourcingMode } from "@/lib/sourcing/plan";

async function main() {
  const only = process.argv[2] && process.argv[2] !== "all" ? (process.argv[2] as MarketplaceId) : undefined;
  const mode: SourcingMode = process.argv[3] === "demand" ? "demand" : "all";
  const admin = createAdminClient();
  for (const m of only ? [only] : configuredMarketplaces()) {
    console.log(m, await runSourcing({ marketplace: m, mode }, supabaseSourcingDeps(admin, m)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
