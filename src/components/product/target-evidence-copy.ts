import { formatVnd } from "@/lib/format";
import type { TargetEvidence } from "@/lib/watch/target-evidence";

/**
 * Copy for the note under "Đặt giá mong muốn" when targetEvidence() has enough history (UI spec §5).
 * `count` is the bold part ("4 lần"), null when the price never reached the target.
 */
export function targetEvidenceCopy(
  ev: TargetEvidence,
  gapPct: number | null,
): { lead: string; count: string | null; tail: string } {
  const gap =
    gapPct != null && gapPct > 0
      ? ` Cần giảm khoảng ${Math.max(1, Math.round(gapPct))}% nữa.`
      : gapPct != null
        ? " Giá hiện tại đã thấp hơn hoặc bằng mức này."
        : "";
  if (ev.episodes === 0) {
    return {
      lead: `${ev.windowDays} ngày qua giá chưa xuống tới mức này (thấp nhất ${formatVnd(ev.low)}), nên có thể phải chờ lâu.${gap}`,
      count: null,
      tail: "",
    };
  }
  const when =
    ev.daysSinceLastHit === 0
      ? ", gần nhất hôm nay."
      : ev.daysSinceLastHit != null
        ? `, lần gần nhất ${ev.daysSinceLastHit} ngày trước.`
        : ".";
  return { lead: `${ev.windowDays} ngày qua giá xuống tới mức này `, count: `${ev.episodes} lần`, tail: `${when}${gap}` };
}
