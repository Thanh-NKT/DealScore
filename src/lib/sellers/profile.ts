import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { fakeSaleForPrice } from "@/lib/pricing/variant-pricing";
import {
  SELLER_MIN_CLAIM_OFFERS,
  SELLER_MIN_CLAIM_WEEKS,
  SELLER_MIN_OFFER_DAYS,
  SELLER_MIN_TRACKED_OFFERS,
  SELLER_PROFILE_MAX_AGE_DAYS,
  SELLER_STABLE_SWING,
} from "@/lib/sellers/constants";

/**
 * How one shop's listed prices behaved (spec §6.2), from DealScore's own observations. Discount claims are
 * judged with P2's fakeSaleForPrice() — the verdict the product page would have shown that day — once per
 * offer per Vietnam ISO week, so one long sale cannot dominate. Facts only; never feeds Deal Score / search /
 * alerts. Pure.
 */
export interface OfferDay {
  day: string;
  minPrice: number;
  listPrice: number | null;
}
export interface SellerProfileInput {
  offers: Array<{ offerId: string; variantId: string; days: OfferDay[] }>;
  variantRows: Map<string, DailyPriceRow[]>;
  now: Date;
}
export interface SellerProfileRow {
  offersTracked: number;
  claimWeeks: number;
  claimOffers: number;
  doubtfulWeeks: number;
  hikeWeeks: number;
  medianSwing: number | null;
  stableOffers: number;
}
export type SellerProfileView =
  | { status: "insufficient"; offersTracked: number; minOffers: number; claimWeeks: number; minClaimWeeks: number }
  | {
      status: "ok";
      offersTracked: number;
      stability: { medianSwingPct: number; stableOffers: number } | null;
      discounts: { claimWeeks: number; doubtfulWeeks: number; hikeWeeks: number; doubtfulPct: number } | null;
      computedAt: string;
    };

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** ISO week key of a calendar day ("2026-W41"). Days are Vietnam days already. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Noon in Vietnam on `day`: the "now" the product page would have had that day. */
const vnNoon = (day: string) => new Date(`${day}T05:00:00Z`);

export function computeSellerProfile(i: SellerProfileInput): SellerProfileRow {
  let offersTracked = 0;
  let stableOffers = 0;
  const swings: number[] = [];
  let claimWeeks = 0;
  let doubtfulWeeks = 0;
  let hikeWeeks = 0;
  const claimOfferIds = new Set<string>();

  for (const o of i.offers) {
    const days = o.days.filter((d) => d.minPrice > 0).sort((a, b) => a.day.localeCompare(b.day));
    if (days.length >= SELLER_MIN_OFFER_DAYS) {
      offersTracked++;
      const prices = days.map((d) => d.minPrice);
      const med = median(prices)!;
      const swing = (Math.max(...prices) - Math.min(...prices)) / med;
      swings.push(swing);
      if (swing < SELLER_STABLE_SWING) stableOffers++;
    }
    // One claim per offer per week: the week's LAST day with a struck-through list price that could be checked.
    const rows = i.variantRows.get(o.variantId) ?? [];
    const byWeek = new Map<string, string | null>();
    for (const d of days) {
      if (d.listPrice == null || !(d.listPrice > d.minPrice)) continue;
      const upTo = rows.filter((r) => r.day <= d.day);
      const f = fakeSaleForPrice({ price: d.minPrice, originalPrice: d.listPrice, rows: upTo, now: vnNoon(d.day) });
      if (!f.checked) continue;
      byWeek.set(isoWeek(d.day), f.kind); // later days of the week overwrite earlier ones
    }
    for (const kind of byWeek.values()) {
      claimWeeks++;
      claimOfferIds.add(o.offerId);
      if (kind === "list_inflated") doubtfulWeeks++;
      else if (kind === "pre_sale_hike") hikeWeeks++;
    }
  }
  const ms = median(swings);
  return {
    offersTracked,
    claimWeeks,
    claimOffers: claimOfferIds.size,
    doubtfulWeeks,
    hikeWeeks,
    medianSwing: ms == null ? null : Math.round(ms * 10_000) / 10_000,
    stableOffers,
  };
}

export function sellerProfileView(row: (SellerProfileRow & { computedAt: string }) | null, now: Date): SellerProfileView | null {
  if (!row) return null;
  const age = now.getTime() - Date.parse(row.computedAt);
  if (!Number.isFinite(age) || age > SELLER_PROFILE_MAX_AGE_DAYS * 86_400_000) return null;
  const stability =
    row.offersTracked >= SELLER_MIN_TRACKED_OFFERS && row.medianSwing != null
      ? { medianSwingPct: Math.round(row.medianSwing * 1000) / 10, stableOffers: row.stableOffers }
      : null;
  const discounts =
    row.claimWeeks >= SELLER_MIN_CLAIM_WEEKS && row.claimOffers >= SELLER_MIN_CLAIM_OFFERS
      ? {
          claimWeeks: row.claimWeeks,
          doubtfulWeeks: row.doubtfulWeeks,
          hikeWeeks: row.hikeWeeks,
          doubtfulPct: Math.round((row.doubtfulWeeks / row.claimWeeks) * 100),
        }
      : null;
  if (!stability && !discounts) {
    return {
      status: "insufficient",
      offersTracked: row.offersTracked,
      minOffers: SELLER_MIN_TRACKED_OFFERS,
      claimWeeks: row.claimWeeks,
      minClaimWeeks: SELLER_MIN_CLAIM_WEEKS,
    };
  }
  return { status: "ok", offersTracked: row.offersTracked, stability, discounts, computedAt: row.computedAt };
}

/** Display copy (UI spec §4.1). Pure. */
export function sellerProfileCopy(v: SellerProfileView): {
  insufficient: string | null;
  stability: { big: string; label: string; sub: string } | null;
  discounts: { line: string; doubtfulPct: number | null } | null;
} {
  if (v.status === "insufficient") {
    return {
      insufficient: `Chưa đủ dữ liệu: mới theo dõi ${v.offersTracked}/${v.minOffers} tin bán đủ 14 ngày, ${v.claimWeeks}/${v.minClaimWeeks} lần ghi giảm giá.`,
      stability: null,
      discounts: null,
    };
  }
  return {
    insufficient: null,
    stability: v.stability
      ? {
          big: `${v.stability.medianSwingPct.toLocaleString("vi-VN")}%`,
          label: "mức dao động giá điển hình của mỗi tin bán",
          sub: `${v.stability.stableOffers}/${v.offersTracked} tin bán gần như không đổi giá (dưới 5%)`,
        }
      : null,
    discounts: v.discounts
      ? {
          line: `${v.discounts.claimWeeks} lần ghi giảm giá được DealScore kiểm tra · ${v.discounts.doubtfulWeeks} lần mức giảm chưa thực chất · ${v.discounts.hikeWeeks} lần giá được nâng trước đợt giảm`,
          doubtfulPct: v.discounts.doubtfulPct > 0 ? v.discounts.doubtfulPct : null,
        }
      : null,
  };
}
