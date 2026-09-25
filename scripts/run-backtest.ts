/**
 * Run the Buy/Wait/Avoid backtest once for Deal Score v0 and v1, stored in backtest_runs.
 * Run: pnpm backtest:run
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { runBacktest } from "@/lib/pricing/backtest-job";

const pct = (correct: number, n: number) => (n === 0 ? "—" : `${((100 * correct) / n).toFixed(1)}%`);

async function main() {
  for (const version of ["v0", "v1"] as const) {
    const { runId, variants, result, accuracy } = await runBacktest(createAdminClient(), { version });
    console.log(`Backtest ${version} ${runId}: ${variants} variants, ${result.samples} samples`);
    console.log(`  buy    ${result.buy.correct}/${result.buy.n}  ${pct(result.buy.correct, result.buy.n)}`);
    console.log(`  wait   ${result.wait.correct}/${result.wait.n}  ${pct(result.wait.correct, result.wait.n)}`);
    console.log(`  avoid  ${result.avoid.correct}/${result.avoid.n}  ${pct(result.avoid.correct, result.avoid.n)}`);
    console.log(`  overall ${accuracy == null ? "—" : `${(accuracy * 100).toFixed(1)}%`} (G2 gate: ≥ 80%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
