/**
 * Run one collector pass locally — pg_cron cannot reach a dev machine.
 * Needs SHOPEE_CLIENT=fake in .env.local until the Shopee API exists (otherwise it skips).
 * Run: pnpm collector:run
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { runCollector } from "@/lib/collector/run";

async function main() {
  const limit = Number(process.argv[2] ?? 200);
  const result = await runCollector({ now: new Date(), limit });
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
