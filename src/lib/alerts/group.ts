import type { Channel } from "@/lib/account/notification-settings";
import { MAX_DELIVERY_ATTEMPTS, RETRY_DELAYS_MINUTES } from "@/lib/watch/constants";

export interface ClaimedDelivery {
  deliveryId: string;
  channel: Channel;
  attempts: number;
  alertEventId: string;
  watchId: string;
  userId: string;
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
