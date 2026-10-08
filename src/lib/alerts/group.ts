import type { Channel } from "@/lib/account/notification-settings";
import { MAX_DELIVERY_ATTEMPTS, RETRY_DELAYS_MINUTES } from "@/lib/watch/constants";
import type { TriggerType } from "@/lib/watch/types";

export interface ClaimedDelivery {
  deliveryId: string;
  channel: Channel;
  attempts: number;
  alertEventId: string;
  /** null for a discovery alert (saved search / demand follow, 0061). */
  watchId: string | null;
  userId: string;
  /** Source of the alert: `w:{watch}` | `s:{saved search}` | `d:{follow}`. Absent → `w:{watchId}`. */
  sourceKey?: string;
}

/** Group by (userId, channel), in order of first appearance. */
export function groupDeliveries(
  rows: ClaimedDelivery[],
): Array<{ userId: string; channel: Channel; deliveries: ClaimedDelivery[] }> {
  const map = new Map<string, { userId: string; channel: Channel; deliveries: ClaimedDelivery[] }>();
  for (const r of rows) {
    const key = `${r.channel}:${r.userId}`;
    const g = map.get(key) ?? { userId: r.userId, channel: r.channel, deliveries: [] };
    g.deliveries.push(r);
    map.set(key, g);
  }
  // email before push: if a run runs short on time, email — the channel that surely arrives — goes first.
  return [...map.values()].sort((a, b) => (a.channel === b.channel ? 0 : a.channel === "email" ? -1 : 1));
}

/** After failure number `attempts` (1-based). null = out of attempts → failed. */
export function nextRetryAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * A digest (daily, and especially weekly) can hold several alerts for the same Watch: the 24h cooldown
 * allows one per day. Keep only the newest alert per (user, channel, source — a Watch, saved search or follow) and report the older ones,
 * so one email / push never lists the same product twice. `createdAt` gives each alert event's time.
 */
export function latestPerWatch(
  rows: ClaimedDelivery[],
  createdAt: (alertEventId: string) => string,
): Array<{ keep: ClaimedDelivery; older: ClaimedDelivery[] }> {
  const map = new Map<string, ClaimedDelivery[]>();
  for (const r of rows) {
    const key = `${r.channel}:${r.userId}:${r.sourceKey ?? `w:${r.watchId}`}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return [...map.values()].map((list) => {
    // Newest first; ties keep claim order so the result is deterministic.
    const sorted = list
      .map((d, i) => ({ d, i, t: Date.parse(createdAt(d.alertEventId)) || 0 }))
      .sort((a, b) => b.t - a.t || a.i - b.i)
      .map((x) => x.d);
    return { keep: sorted[0], older: sorted.slice(1) };
  });
}

/**
 * Triggers of the kept (newest) alert of a Watch after latestPerWatch, with the older alerts' triggers merged in —
 * never across kinds: a "price_hike" ("chưa nên mua") and a price drop in one item would contradict each other
 * (and the hike % would come from the wrong event). Newest is a drop → older drop triggers join, older hikes are
 * dropped. Newest is a hike → it stays alone (the price is high now; older drop news is stale).
 */
export function mergeDigestTriggers(keep: readonly TriggerType[], older: readonly (readonly TriggerType[])[]): TriggerType[] {
  const drops = keep.filter((t) => t !== "price_hike");
  if (drops.length === 0) return [...new Set(keep)];
  const out = new Set<TriggerType>(drops);
  for (const list of older) for (const t of list) if (t !== "price_hike") out.add(t);
  return [...out];
}
