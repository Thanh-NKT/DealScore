/**
 * Vouchers (spec 2026-09-26 §1). Mirrors `public.vouchers` in camelCase. Pure types only, so the
 * client-side VoucherPicker can import them.
 */

export type VoucherKind = "shop" | "platform" | "shipping" | "payment";
export type VoucherDiscountType = "percent" | "amount";
export type VoucherSource = "api" | "extension" | "seed";

export const VOUCHER_KINDS: readonly VoucherKind[] = ["shop", "platform", "shipping", "payment"];

/** A voucher as read from a source, before it is stored (no id / timestamps / reporters). */
export interface VoucherInput {
  marketplace: string;
  kind: VoucherKind;
  sellerId: string | null;
  listingId: string | null;
  /** Null when the marketplace does not show a code ("save the voucher on the marketplace"). */
  code: string | null;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscount: number | null;
  minSpend: number;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface Voucher extends VoucherInput {
  id: string;
  source: VoucherSource;
  /** Hashed extension contributors who saw it (source 'extension' only). */
  reporters: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** The fields the discount math needs; serializable, so it can travel to the client. */
export type VoucherTerms = Pick<Voucher, "id" | "kind" | "discountType" | "discountValue" | "maxDiscount" | "minSpend">;

/** Trusted scope a voucher is bound to (from our own listing row, never from the source). */
export interface VoucherScope {
  marketplace: string;
  listingId: string;
  sellerId: string | null;
}

// ---------------------------------------------------------------------------------------------
// VoucherPicker view model (the component re-exports these).
// ---------------------------------------------------------------------------------------------

export type VoucherGroupId = "shop" | "platform" | "ship" | "pay";

export interface VoucherItem {
  id: string;
  /** Null: the marketplace shows no code — the picker links to it ("Lưu mã trên …") instead. */
  code: string | null;
  big: string;
  small: string;
  title: string;
  cond: string;
  exp: string;
  /** Share of uses left, if the marketplace exposes it. Not rendered: a scarcity bar is a pressure device (DESIGN.md). */
  leftPct?: number | null;
  /** Discount at the current price (discountOf), for display. */
  amount: number;
  minSpend: number;
  isShipping?: boolean;
  /** Raw terms: the picker recomputes totals with the same pure functions as the server. */
  terms: VoucherTerms;
}

export interface VoucherGroup {
  id: VoucherGroupId;
  name: string;
  rule: string;
  stubBg: string;
  stubFg: string;
  items: VoucherItem[];
}
