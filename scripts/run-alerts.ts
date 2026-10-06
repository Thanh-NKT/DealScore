/**
 * Run the Alert Engine once locally — pg_cron cannot reach a dev machine
 * unless the dealscore_app_url secret is set in Vault.
 * Run: pnpm alerts:run
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { requireLocalSupabase } from "./guard-env";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { dispatchDueDeliveries } from "@/lib/alerts/dispatch";
import { sendPushToUser } from "@/lib/push";

async function main() {
  requireLocalSupabase("run-alerts");
  const now = new Date();
  const evaluate = await evaluateWatches({ now });
  const dispatch = await dispatchDueDeliveries({ now }, undefined, sendPushToUser);
  console.log({ evaluate, dispatch });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
