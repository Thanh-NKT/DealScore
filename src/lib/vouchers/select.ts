/**
 * Voucher math (spec 2026-09-26 §1). Pure and DB-free: the product page and the VoucherPicker
 * (client) use the same functions, so the estimate shown always matches this file.
 */
import { formatVnd, toVnDate } from "@/lib/format";
import type { Voucher, VoucherGroup, VoucherGroupId, VoucherItem, VoucherKind, VoucherTerms } from "@/lib/vouchers/types";

/** A voucher not seen again for this long is treated as gone. */
export const VOUCHER_FRESH_DAYS = 7;
/** Extension-only vouchers need this many distinct reporters (like price corroboration). */
export const MIN_EXTENSION_REPORTERS = 2;

const DAY_MS = 86_400_000;

export interface ActiveVoucherContext {
  now: Date;
  /** Marketplace of the listing; platform/shipping/payment vouchers must match it. */
  marketplace: string;
  listingId: string;
  sellerId: string | null;
}

/**
 * Vouchers that apply to this listing right now: in their validity window, seen within the last
 * VOUCHER_FRESH_DAYS, scoped to this listing / its seller / its marketplace, and — for vouchers only
 * the extension reported — confirmed by at least MIN_EXTENSION_REPORTERS contributors.
 */
export function activeVouchers<T extends Voucher>(list: readonly T[], ctx: ActiveVoucherContext): T[] {
  const now = ctx.now.getTime();
  return list.filter((v) => {
    if (v.marketplace !== ctx.marketplace) return false;
    if (v.expiresAt && Date.parse(v.expiresAt) <= now) return false;
    if (v.startsAt && Date.parse(v.startsAt) > now) return false;
    const seen = Date.parse(v.lastSeenAt);
    if (!Number.isFinite(seen) || now - seen > VOUCHER_FRESH_DAYS * DAY_MS) return false;
    if (v.listingId != null && v.listingId !== ctx.listingId) return false;
    if (v.sellerId != null && v.sellerId !== ctx.sellerId) return false;
    if (v.kind === "shop" && v.sellerId == null) return false;
    if (v.source === "extension" && new Set(v.reporters).size < MIN_EXTENSION_REPORTERS) return false;
    return true;
  });
}

/**
 * How much this voucher takes off, in whole đồng (rounded down: never overstate a saving).
 * Below min spend → 0. Shipping vouchers are capped by the shipping fee (0 when the fee is unknown).
 */
export function discountOf(v: VoucherTerms, price: number, shipFee: number): number {
  if (!(price > 0) || price < v.minSpend) return 0;
  let d = v.discountType === "percent" ? (price * v.discountValue) / 100 : v.discountValue;
  if (v.discountType === "percent" && v.maxDiscount != null) d = Math.min(d, v.maxDiscount);
  d = v.kind === "shipping" ? Math.min(d, Math.max(0, shipFee)) : Math.min(d, price);
  return Math.max(0, Math.floor(d));
}

export interface ComboLine<T extends VoucherTerms = VoucherTerms> {
  voucher: T;
  amount: number;
}

export interface Combination<T extends VoucherTerms = VoucherTerms> {
  picks: ComboLine<T>[];
  totalDiscount: number;
  estimatedTotal: number;
}

/**
 * Totals for a chosen set (at most one per kind — later picks of the same kind are ignored).
 * The total never exceeds what there is to pay.
 */
export function totalsFor<T extends VoucherTerms>(chosen: readonly T[], price: number, shipFee: number): Combination<T> {
  const fee = Math.max(0, shipFee);
  const kinds = new Set<VoucherKind>();
  const picks: ComboLine<T>[] = [];
  for (const v of chosen) {
    if (kinds.has(v.kind)) continue;
    kinds.add(v.kind);
    picks.push({ voucher: v, amount: discountOf(v, price, fee) });
  }
  const gross = Math.max(0, price) + fee;
  const totalDiscount = Math.min(gross, picks.reduce((s, p) => s + p.amount, 0));
  return { picks, totalDiscount, estimatedTotal: Math.max(0, gross - totalDiscount) };
}

/**
 * The combination with the largest total discount, at most one voucher per kind. Each discount is
 * computed on the same price, so the per-kind maxima are the optimum. Vouchers that give nothing
 * (e.g. below min spend) are never picked. Ties keep the input order.
 */
export function bestCombination<T extends VoucherTerms>(vouchers: readonly T[], price: number, shipFee: number): Combination<T> {
  const best = new Map<VoucherKind, { v: T; amount: number }>();
  for (const v of vouchers) {
    const amount = discountOf(v, price, shipFee);
    if (amount <= 0) continue;
    const cur = best.get(v.kind);
    if (!cur || amount > cur.amount) best.set(v.kind, { v, amount });
  }
  const order: VoucherKind[] = ["shop", "platform", "shipping", "payment"];
  return totalsFor(
    order.flatMap((k) => (best.has(k) ? [best.get(k)!.v] : [])),
    price,
    shipFee,
  );
}

// ---------------------------------------------------------------------------------------------
// View model for VoucherPicker
// ---------------------------------------------------------------------------------------------

const GROUP_OF: Record<VoucherKind, VoucherGroupId> = { shop: "shop", platform: "platform", shipping: "ship", payment: "pay" };

/** Neutral tints (DESIGN.md: verdict colours are for verdicts only). */
const GROUP_STYLE: Record<VoucherGroupId, { bg: string; fg: string }> = {
  shop: { bg: "var(--tint-peach)", fg: "var(--ink)" },
  platform: { bg: "var(--tint-violet)", fg: "var(--ink)" },
  ship: { bg: "var(--tint-sky)", fg: "var(--ink)" },
  pay: { bg: "var(--tint-lilac)", fg: "var(--ink)" },
};

function groupName(id: VoucherGroupId, platformName: string): string {
  switch (id) {
    case "shop":
      return "Mã của Shop";
    case "platform":
      return `Mã của ${platformName}`;
    case "ship":
      return "Mã vận chuyển";
    case "pay":
      return "Mã thanh toán";
  }
}

/** 50000 → "50K", 1500000 → "1,5TR" (stub label; the exact figure is in the title). */
export function compactVnd(n: number): string {
  const fmt = (x: number) => (Math.round(x * 10) / 10).toString().replace(".", ",");
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)}TR`;
  if (n >= 1_000) return `${fmt(n / 1_000)}K`;
  return `${Math.round(n)}đ`;
}

function titleOf(v: Voucher): string {
  const what =
    v.discountType === "percent"
      ? `Giảm ${v.discountValue}%${v.maxDiscount != null ? `, tối đa ${formatVnd(v.maxDiscount)}` : ""}`
      : `Giảm ${formatVnd(v.discountValue)}`;
  return v.kind === "shipping" ? `${what} phí vận chuyển` : what;
}

function expOf(v: Voucher): string {
  if (!v.expiresAt) return "chưa rõ";
  const [, m, d] = toVnDate(v.expiresAt).split("-");
  return `${d}/${m}`;
}

function toItem(v: Voucher, price: number, shipFee: number): VoucherItem {
  return {
    id: v.id,
    // Only a code the source really showed; never a generated one.
    code: v.code,
    big: v.discountType === "percent" ? `${v.discountValue}%` : compactVnd(v.discountValue),
    small: v.kind === "shipping" ? "Phí ship" : "Giảm",
    title: titleOf(v),
    cond: v.minSpend > 0 ? `Đơn tối thiểu ${formatVnd(v.minSpend)}` : "Không yêu cầu đơn tối thiểu",
    exp: expOf(v),
    amount: discountOf(v, price, shipFee),
    minSpend: v.minSpend,
    isShipping: v.kind === "shipping",
    terms: {
      id: v.id,
      kind: v.kind,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscount: v.maxDiscount,
      minSpend: v.minSpend,
    },
  };
}

/**
 * Groups for VoucherPicker, in a fixed kind order; within a group, the biggest discount at this
 * price first. Empty groups are left out. `platformName` = display name of the marketplace.
 */
export function toGroups(vouchers: readonly Voucher[], price: number, platformName: string, shipFee = 0): VoucherGroup[] {
  const order: VoucherGroupId[] = ["shop", "platform", "ship", "pay"];
  return order
    .map((id) => {
      const items = vouchers
        .filter((v) => GROUP_OF[v.kind] === id)
        .map((v) => toItem(v, price, shipFee))
        .sort((a, b) => b.amount - a.amount || a.minSpend - b.minSpend);
      return {
        id,
        name: groupName(id, platformName),
        rule: "Tối đa 1 mã mỗi loại",
        stubBg: GROUP_STYLE[id].bg,
        stubFg: GROUP_STYLE[id].fg,
        items,
      };
    })
    .filter((g) => g.items.length > 0);
}
