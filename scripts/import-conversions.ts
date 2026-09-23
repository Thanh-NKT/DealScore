/**
 * Import a conversion report downloaded from the Shopee Affiliate dashboard.
 *   pnpm conversions:import <file.csv> [--dry-run] [--yes]
 *
 * Works against production too — importing real orders is its purpose. So it does NOT
 * use requireLocalSupabase; instead it asks for confirmation when the URL is not local.
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parse } from "csv-parse/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingCsvFields, normalizeCsvRow, type NormalizedConversion } from "@/lib/affiliate/normalize";
import { upsertNormalizedConversions } from "@/lib/affiliate/import";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  if (!file) {
    console.error("Usage: pnpm conversions:import <file.csv> [--dry-run] [--yes]");
    process.exit(1);
  }

  const records = parse(readFileSync(file), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  const missing = missingCsvFields(headers);
  if (missing.length > 0) {
    // Print the actual headers so CSV_COLUMNS (G5) can be fixed quickly.
    console.error(`Missing required columns: ${missing.join(", ")}\nColumns in file: ${headers.join(" | ")}`);
    process.exit(1);
  }

  const valid: NormalizedConversion[] = [];
  const errors: string[] = [];
  for (const r of records) {
    const n = normalizeCsvRow(r);
    if (n.ok) valid.push(n.row);
    else errors.push(n.reason);
  }
  const withClick = valid.filter((r) => r.click_event_id);
  console.log(`Valid: ${valid.length} · Errors: ${errors.length} · With recognizable sub_id: ${withClick.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  - ${e}`);

  const admin = createAdminClient();

  if (dryRun) {
    const ids = [...new Set(withClick.map((r) => r.click_event_id!))];
    let matched = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await admin.from("click_events").select("id").in("id", ids.slice(i, i + 500));
      if (error) throw error;
      matched += data?.length ?? 0;
    }
    console.log(`Matched existing clicks: ${matched}. --dry-run: nothing written.`);
    process.exit(0);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
  if (!isLocal && !yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Write ${valid.length} rows to ${url}? Type "yes" to continue: `);
    rl.close();
    if (answer.trim() !== "yes") {
      console.log("Cancelled.");
      process.exit(1);
    }
  }

  const result = await upsertNormalizedConversions(valid, admin);
  console.log(`Inserted: ${result.inserted} · Updated: ${result.updated} · Matched clicks: ${result.matched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
