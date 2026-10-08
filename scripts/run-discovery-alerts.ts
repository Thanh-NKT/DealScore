/**
 * Run the saved-search + demand-follow pass once locally (pg_cron cannot reach a dev machine). Creates alert
 * events only; `pnpm alerts:run` dispatches them.
 * Run: pnpm alerts:discovery
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { requireLocalSupabase } from "./guard-env";
import { evaluateSavedSearches } from "@/lib/saved-search/evaluate";
import { checkDemandFollows } from "@/lib/demand-follow/check";

async function main() {
  requireLocalSupabase("run-discovery-alerts");
  const now = new Date();
  const savedSearches = await evaluateSavedSearches({ now });
  const demandFollows = await checkDemandFollows({ now });
  console.log({ savedSearches, demandFollows });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
