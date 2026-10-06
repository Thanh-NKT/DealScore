/**
 * When may a price read by the Chrome extension enter the price history? (Phase 2) Pure.
 *
 * Extension data comes from users' browsers and can be forged: the Origin check on
 * /api/extension/* only stops cross-site requests from web pages, it is NOT authentication (any
 * script can send `Origin: chrome-extension://<id>`). So one report is never enough.
 * A pending observation is promoted when, within WINDOW_HOURS of it:
 *   - "api":  an API/collector price for the offer is within TOLERANCE, or
 *   - "peer": another contributor saw the same offer within TOLERANCE. A peer must differ in BOTH
 *     the contributor id and the network (peerKey = salted hash of the IPv4 /24 or IPv6 /64,
 *     hashNetwork()): one person with an account cookie and without it, or rotating addresses inside
 *     their own /64, is one peer, not two. A peer-only promotion also needs a trusted anchor
 *     (the offer's latest API/collector price) and must stay inside [PEER_BAND_MIN, PEER_BAND_MAX]
 *     of it, so even several colluding networks cannot push an arbitrary price.
 * Observations claimed in the future (beyond CLOCK_SKEW_MS) are never promoted.
 * At most one promotion per offer per DEDUPE_MINUTES, so many viewers of one product don't
 * flood the daily rollup.
 *
 * A promoted row enters the price history. It becomes the CURRENT price (and so reaches the cached
 * verdict and the watch alerts) only once a trusted observation of the offer is within TOLERANCE and
 * WINDOW_HOURS of it — refresh_variant_current_price (migration 0028) keeps the same two constants.
 */

export const TOLERANCE = 0.02;
export const WINDOW_HOURS = 24;
export const DEDUPE_MINUTES = 60;
/** Peer-only promotions must stay within this ratio of the latest trusted price. */
export const PEER_BAND_MIN = 0.5;
export const PEER_BAND_MAX = 1.5;
export const CLOCK_SKEW_MS = 2 * 60_000;

export interface ExtObs {
  id: number;
  offerId: string;
  contributor: string;
  /** Salted network hash of the request (hashNetwork); null when unknown (rows older than migration 0024). */
  peerKey: string | null;
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

/**
 * Peer identity: the stored network key only. A row without one (older than 0024) cannot be a peer —
 * the anonymous id "ip:<hash>" hashes the full address, not the network, so it is not comparable.
 */
export function peerKeyOf(o: Pick<ExtObs, "contributor" | "peerKey">): string | null {
  return o.peerKey || null;
}

function independent(a: ExtObs, b: ExtObs): boolean {
  const ka = peerKeyOf(a);
  const kb = peerKeyOf(b);
  return a.contributor !== b.contributor && ka != null && kb != null && ka !== kb;
}

export function inPeerBand(price: number, anchor: number | null | undefined): boolean {
  return anchor != null && anchor > 0 && price >= anchor * PEER_BAND_MIN && price <= anchor * PEER_BAND_MAX;
}

export function corroborate(input: {
  /** Unpromoted observations to consider. */
  pending: ExtObs[];
  /** All recent extension observations (pending + promoted) — the peers. */
  recentExt: ExtObs[];
  recentApi: ApiObs[];
  /** Latest trusted (API/collector) price per offer, any age. No anchor → no peer-only promotion. */
  anchors?: Record<string, number | null | undefined>;
  /** Latest observed_at already promoted per offer. */
  lastPromotedAt: Record<string, string | null | undefined>;
  now: Date;
}): Promotion[] {
  const windowMs = WINDOW_HOURS * HOUR;
  const nowMs = input.now.getTime();
  const nowIso = input.now.toISOString();
  const notFuture = (o: ExtObs) => Date.parse(o.observedAt) <= nowMs + CLOCK_SKEW_MS;
  const last = { ...input.lastPromotedAt };
  const anchors = input.anchors ?? {};
  const out: Promotion[] = [];

  const candidates = input.pending
    .filter((o) => o.promotedAt == null && notFuture(o) && within(o.observedAt, nowIso, windowMs))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  for (const o of candidates) {
    const prev = last[o.offerId];
    if (prev && within(prev, o.observedAt, DEDUPE_MINUTES * 60_000)) continue;

    const byApi = input.recentApi.some(
      (a) => a.offerId === o.offerId && within(a.observedAt, o.observedAt, windowMs) && close(a.price, o.price),
    );
    const byPeer =
      inPeerBand(o.price, anchors[o.offerId]) &&
      input.recentExt.some(
        (p) =>
          p.id !== o.id &&
          p.offerId === o.offerId &&
          notFuture(p) &&
          independent(p, o) &&
          within(p.observedAt, o.observedAt, windowMs) &&
          close(p.price, o.price),
      );
    if (!byApi && !byPeer) continue;

    out.push({ id: o.id, reason: byApi ? "api" : "peer" });
    last[o.offerId] = o.observedAt;
  }
  return out;
}
