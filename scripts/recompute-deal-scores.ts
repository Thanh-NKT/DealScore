/**
 * Ghi cache Deal Score cho danh sách tìm kiếm (quyết định Đ5).
 *
 * Trang chi tiết vẫn tính live từ rollup và là nguồn sự thật; bảng
 * variant_deal_scores chỉ tồn tại vì không thể sort theo điểm trước khi phân
 * trang nếu điểm chỉ có trong Node.
 *
 * BẮT BUỘC dùng computeDealScore() từ src/lib/pricing/deal-score.ts. Cấm cài đặt lại
 * logic tính điểm bằng SQL — hai bản cài đặt sẽ trôi khỏi nhau.
 *
 * Không truyền bestOffer, giống hệt điểm đầu trang (Đ7) — nếu khác thì danh
 * sách và trang chi tiết sẽ hiện hai con số khác nhau cho cùng một sản phẩm.
 *
 * Chạy sau mỗi collector run: pnpm scores:recompute
 */

import { createClient } from "@supabase/supabase-js";
import { computeDealScore } from "../src/lib/pricing/deal-score";
import { expandRollup, type DailyPriceRow } from "../src/lib/pricing/price-history";
import { toVnDate } from "../src/lib/format";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const WINDOW_DAYS = 90;
const BATCH = 500;

async function main() {
  const { data: current, error: curErr } = await db
    .from("variant_current_price")
    .select("variant_id, price");
  if (curErr) throw curErr;

  // Một mốc now cho cả lượt chạy; cửa sổ theo ngày lịch VN, giống trang chi tiết.
  const now = new Date();
  const since = toVnDate(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));

  const rows: Record<string, unknown>[] = [];
  const tally: Record<string, number> = {};

  for (const v of current ?? []) {
    if (v.price == null) continue;

    const { data: history, error: hErr } = await db
      .from("variant_daily_prices")
      .select("*")
      .eq("variant_id", v.variant_id)
      .gte("day", since)
      .order("day", { ascending: true });
    if (hErr) throw hErr;

    const result = computeDealScore({
      price: v.price,
      history: expandRollup((history ?? []) as DailyPriceRow[]),
      now,
    });

    tally[result.recommendation] = (tally[result.recommendation] ?? 0) + 1;

    rows.push({
      variant_id: v.variant_id,
      score: result.score,
      recommendation: result.recommendation,
      price_at_compute: v.price,
      computed_at: now.toISOString(),
    });
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db
      .from("variant_deal_scores")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "variant_id" });
    if (error) throw error;
  }

  console.log(`Đã tính điểm cho ${rows.length} variant.`);
  for (const [k, n] of Object.entries(tally).sort()) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
