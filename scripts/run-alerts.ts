/**
 * Chạy Alert Engine một lượt ở local — nơi pg_cron không gọi được máy dev
 * nếu chưa đặt secret kairo_app_url trong Vault.
 * Chạy: pnpm alerts:run
 *
 * Bọc trong main(): tsx biên dịch file .ts sang CJS, không cho await cấp cao nhất.
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
