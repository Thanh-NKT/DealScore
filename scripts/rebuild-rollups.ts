/**
 * Rebuild every variant's daily history (variant_daily_prices) and current price under the history rule
 * (offer_in_history(), migration 0022), in batches: rebuild_variant_rollups() (0028) rebuilds the next
 * `--batch` variants by id in its own transaction, so readers never see an empty history and a stopped
 * run can be resumed. Afterwards run `pnpm scores:recompute` (the history behind the verdicts changed).
 *
 * Run: pnpm rollup:rebuild [--batch 500] [--after <variant uuid>]
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { createAdminClient } from "@/lib/supabase/admin";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const client = createAdminClient();
  const batch = Number(arg("batch") ?? 500);
  if (!Number.isInteger(batch) || batch < 1) throw new Error("--batch must be a positive integer");
  let after: string | null = arg("after") ?? null;
  let total = 0;
  for (;;) {
    const started = Date.now();
    const { data, error } = await client.rpc("rebuild_variant_rollups", {
      p_limit: batch,
      ...(after ? { p_after: after } : {}),
    });
    if (error) {
      // Resume from the last finished batch.
      throw new Error(`rebuild_variant_rollups failed after ${after ?? "the start"}: ${error.message}. Resume with --after ${after ?? ""}`.trim());
    }
    const r = data as { processed: number; last_id: string | null; done: boolean };
    total += r.processed;
    if (r.last_id) after = r.last_id;
    console.log(`rebuilt ${r.processed} variants (total ${total}) in ${Date.now() - started} ms, last ${after ?? "—"}`);
    if (r.done) break;
  }
  console.log(`Done: ${total} variants. Next: pnpm scores:recompute`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
