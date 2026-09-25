/**
 * When may a price read by the Chrome extension enter the price history? (Phase 2) Pure.
 *
 * Extension data comes from users' browsers and can be forged, so one report is never enough.
 * A pending observation is promoted when, within WINDOW_HOURS of it:
 *   - "peer": another contributor saw the same offer within TOLERANCE, or
 *   - "api":  an API/collector price for the offer is within TOLERANCE.
 * At most one promotion per offer per DEDUPE_MINUTES, so many viewers of one product don't
 * flood the daily rollup.
 */

export const TOLERANCE = 0.02;
export const WINDOW_HOURS = 24;
export const DEDUPE_MINUTES = 60;

export interface ExtObs {
  id: number;
  offerId: string;
  contributor: string;
  observedAt: string;
  price: number;
  promotedAt: string | null;
}

export interface ApiObs {
  offerId: string;
  observedAt: string;
  price: number;
}

export interface Promotion {
  id: number;
  reason: "peer" | "api";
}

const HOUR = 3_600_000;
const close = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) <= TOLERANCE;
const within = (a: string, b: string, ms: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= ms;

export function corroborate(input: {
  /** Unpromoted observations to consider. */
  pending: ExtObs[];
  /** All recent extension observations (pending + promoted) — the peers. */
  recentExt: ExtObs[];
  recentApi: ApiObs[];
  /** Latest observed_at already promoted per offer. */
  lastPromotedAt: Record<string, string | null | undefined>;
  now: Date;
}): Promotion[] {
  const windowMs = WINDOW_HOURS * HOUR;
  const nowIso = input.now.toISOString();
  const last = { ...input.lastPromotedAt };
  const out: Promotion[] = [];

  const candidates = input.pending
    .filter((o) => o.promotedAt == null && within(o.observedAt, nowIso, windowMs))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  for (const o of candidates) {
    const prev = last[o.offerId];
    if (prev && within(prev, o.observedAt, DEDUPE_MINUTES * 60_000)) continue;

    const byApi = input.recentApi.some(
      (a) => a.offerId === o.offerId && within(a.observedAt, o.observedAt, windowMs) && close(a.price, o.price),
    );
    const byPeer = input.recentExt.some(
      (p) =>
        p.id !== o.id &&
        p.offerId === o.offerId &&
        p.contributor !== o.contributor &&
        within(p.observedAt, o.observedAt, windowMs) &&
        close(p.price, o.price),
    );
    if (!byApi && !byPeer) continue;

    out.push({ id: o.id, reason: byApi ? "api" : "peer" });
    last[o.offerId] = o.observedAt;
  }
  return out;
}
