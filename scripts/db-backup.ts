/**
 * Off-site logical backup (1.10): schema, roles-free data dump of the database in SUPABASE_DB_URL
 * (Dashboard → Connect → Session pooler URI). Complements Supabase's own daily backups / PITR:
 * this one lives outside Supabase, so a lost project or account can still be restored.
 * Run: pnpm db:backup   → backups/kairo-YYYYMMDD-HHmm-{schema,data}.sql
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function dump(dbUrl: string, file: string, extra: string[]) {
  const r = spawnSync("npx", ["supabase", "db", "dump", "--db-url", dbUrl, "-f", file, ...extra], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`supabase db dump failed (${file})`);
}

function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("Missing SUPABASE_DB_URL");
  const dir = "backups";
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `kairo-${stamp(new Date())}`);
  dump(dbUrl, `${base}-schema.sql`, []);
  dump(dbUrl, `${base}-data.sql`, ["--data-only", "--use-copy"]);
  console.log(`Backup written: ${base}-{schema,data}.sql — store it outside this machine.`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
