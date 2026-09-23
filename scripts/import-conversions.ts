/**
 * Nhập conversion report tải từ dashboard Shopee Affiliate.
 *   pnpm conversions:import <file.csv> [--dry-run] [--yes]
 *
 * Chạy được với cả production — nhập đơn thật là mục đích của nó. Vì vậy KHÔNG
 * dùng requireLocalSupabase; thay vào đó hỏi xác nhận khi URL không phải local.
 *
 * Bọc trong main(): tsx biên dịch file .ts sang CJS, không cho await cấp cao nhất.
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
    console.error("Dùng: pnpm conversions:import <file.csv> [--dry-run] [--yes]");
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
    // In tên cột đang có để sửa CSV_COLUMNS (G5) nhanh.
    console.error(`Thiếu cột bắt buộc: ${missing.join(", ")}\nCác cột trong file: ${headers.join(" | ")}`);
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
  console.log(`Hợp lệ: ${valid.length} · Lỗi: ${errors.length} · Có sub_id nhận ra được: ${withClick.length}`);
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
    console.log(`Khớp click có thật: ${matched}. --dry-run: không ghi gì.`);
    process.exit(0);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
  if (!isLocal && !yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Ghi ${valid.length} dòng vào ${url}? Gõ "yes" để tiếp tục: `);
    rl.close();
    if (answer.trim() !== "yes") {
      console.log("Đã hủy.");
      process.exit(1);
    }
  }

  const result = await upsertNormalizedConversions(valid, admin);
  console.log(`Chèn: ${result.inserted} · Cập nhật: ${result.updated} · Khớp click: ${result.matched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
