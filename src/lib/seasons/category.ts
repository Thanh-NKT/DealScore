import type { SeasonEventKey } from "@/lib/seasons/events";
import { SEASON_KEYS, SEASON_LABEL } from "@/lib/seasons/events";
import { median, type SeasonOccurrence } from "@/lib/seasons/calendar";
import { SEASON_LOWER_RATIO, SEASON_MIN_VARIANTS_CATEGORY } from "@/lib/seasons/constants";

/** Category-level season stats (spec §8.1): one ratio per variant per event = its latest occurrence. Pure. */
export interface CategorySeasonRow {
  key: SeasonEventKey;
  variantsCounted: number;
  occurrences: number;
  medianRatio: number;
  shareLower: number;
}
export type CategorySeasonView =
  | { status: "insufficient"; best: number; min: number }
  | { status: "ok"; events: CategorySeasonRow[] };

export function aggregateCategorySeason(perVariant: SeasonOccurrence[][]): CategorySeasonRow[] {
  const rows: CategorySeasonRow[] = [];
  for (const key of SEASON_KEYS) {
    const latest: number[] = [];
    let occurrences = 0;
    for (const occ of perVariant) {
      const mine = occ.filter((o) => o.key === key).sort((a, b) => a.year - b.year);
      if (mine.length === 0) continue;
      occurrences += mine.length;
      latest.push(mine[mine.length - 1].ratio);
    }
    if (latest.length === 0) continue;
    rows.push({
      key,
      variantsCounted: latest.length,
      occurrences,
      medianRatio: Math.round(median(latest)! * 10_000) / 10_000,
      shareLower: Math.round((latest.filter((r) => r <= SEASON_LOWER_RATIO).length / latest.length) * 10_000) / 10_000,
    });
  }
  return rows;
}

export function categorySeasonView(rows: CategorySeasonRow[]): CategorySeasonView | null {
  if (rows.length === 0) return null; // the strip is hidden entirely
  const events = rows.filter((r) => r.variantsCounted >= SEASON_MIN_VARIANTS_CATEGORY).sort((a, b) => a.medianRatio - b.medianRatio);
  if (events.length === 0) {
    return { status: "insufficient", best: Math.max(...rows.map((r) => r.variantsCounted)), min: SEASON_MIN_VARIANTS_CATEGORY };
  }
  return { status: "ok", events };
}

/** "11.11: trung bình thấp hơn 8% · 60% sản phẩm giảm ≥ 5% (12 sản phẩm)". Pure. */
export function categorySeasonRowCopy(r: CategorySeasonRow): string {
  const pct = Math.round(Math.abs(1 - r.medianRatio) * 100);
  const vs = pct === 0 ? "bằng trung vị" : `${r.medianRatio < 1 ? "thấp hơn" : "cao hơn"} ${pct}%`;
  return `${SEASON_LABEL[r.key]}: trung bình ${vs} · ${Math.round(r.shareLower * 100)}% sản phẩm giảm ≥ 5% (${r.variantsCounted} sản phẩm)`;
}
