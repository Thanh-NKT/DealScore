import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
import { targetEvidenceCopy } from "@/components/product/target-evidence-copy";
import type { TargetEvidence } from "@/lib/watch/target-evidence";

const ev = (o: Partial<TargetEvidence> = {}): TargetEvidence => ({
  windowDays: 90,
  dataDays: 60,
  hitDays: 6,
  episodes: 4,
  lastHitDay: "2026-06-03",
  daysSinceLastHit: 12,
  low: 900_000,
  ...o,
});
const text = (c: ReturnType<typeof targetEvidenceCopy>) => `${c.lead}${c.count ?? ""}${c.tail}`;

describe("targetEvidenceCopy", () => {
  it("episodes + last hit + remaining gap", () => {
    const c = targetEvidenceCopy(ev(), 7.4);
    expect(c.count).toBe("4 lần");
    expect(text(c)).toBe("90 ngày qua giá xuống tới mức này 4 lần, lần gần nhất 12 ngày trước. Cần giảm khoảng 7% nữa.");
  });
  it("last hit today", () => {
    expect(text(targetEvidenceCopy(ev({ daysSinceLastHit: 0 }), 3))).toContain(", gần nhất hôm nay.");
  });
  it("never reached → the 90-day low, no bold count", () => {
    const c = targetEvidenceCopy(ev({ episodes: 0, hitDays: 0, lastHitDay: null, daysSinceLastHit: null }), 20);
    expect(c.count).toBeNull();
    expect(text(c)).toBe(
      `90 ngày qua giá chưa xuống tới mức này (thấp nhất ${formatVnd(900_000)}), nên có thể phải chờ lâu. Cần giảm khoảng 20% nữa.`,
    );
  });
  it("already at the target", () => {
    expect(text(targetEvidenceCopy(ev(), -2))).toContain("Giá hiện tại đã thấp hơn hoặc bằng mức này.");
  });
});
