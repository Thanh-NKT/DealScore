import { formatVnd } from "@/lib/format";
import type { WatchView } from "@/lib/watch/describe";

/** Pure copy for the "thay đổi giá" column of the watch list (roadmap P1 item 4). */

export interface ChangeLabel {
  text: string;
  /** Price direction colour (buy = cheaper, avoid = dearer) — the column's existing convention, not a verdict. */
  tone: "buy" | "avoid" | "neutral";
  /** Secondary line under the label (the since-tracking change when there is no 7-day number yet). */
  sub: string | null;
  /** Tooltip: what the 7-day number compares against. */
  title: string | null;
}

const arrow = (amount: number) => (amount < 0 ? "↓" : "↑");

export function changeLabel(view: Pick<WatchView, "change7d" | "changeSinceStart">): ChangeLabel {
  const c = view.change7d;
  if (c) {
    const title = `So với ${formatVnd(c.refPrice)} cách đây ${c.days} ngày`;
    if (c.amount === 0) return { text: `Không đổi · ${c.days} ngày`, tone: "neutral", sub: null, title };
    return {
      text: `${arrow(c.amount)} ${formatVnd(Math.abs(c.amount))} · ${c.days} ngày`,
      tone: c.amount < 0 ? "buy" : "avoid",
      sub: null,
      title,
    };
  }
  const s = view.changeSinceStart;
  if (!s) return { text: "Chưa có giá để so", tone: "neutral", sub: null, title: null };
  return {
    text: "Chưa đủ 7 ngày",
    tone: "neutral",
    sub: s.amount !== 0 ? `${arrow(s.amount)} ${formatVnd(Math.abs(s.amount))} từ lúc theo dõi` : null,
    title: null,
  };
}

/** Watches other than "Đã mua" whose price is lower than 7 days ago. */
export function countDropped7d(items: ReadonlyArray<{ status: string; view: Pick<WatchView, "change7d"> }>): number {
  return items.filter((i) => i.status !== "done" && i.view.change7d != null && i.view.change7d.amount < 0).length;
}
