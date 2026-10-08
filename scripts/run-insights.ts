/**
 * Recompute seller price profiles + category season stats once locally (pg_cron cannot reach a dev machine).
 * Run: pnpm insights:run
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { requireLocalSupabase } from "./guard-env";
import { recomputeSellerProfiles } from "@/lib/sellers/profile-job";
import { recomputeCategorySeasons } from "@/lib/seasons/job";

async function main() {
  requireLocalSupabase("run-insights");
  const now = new Date();
  const deadline = Date.now() + 10 * 60_000;
  const sellers = await recomputeSellerProfiles({ now, deadline });
  const seasons = await recomputeCategorySeasons({ now, deadline });
  console.log({ sellers, seasons });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
