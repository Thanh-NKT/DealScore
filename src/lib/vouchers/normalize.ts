/**
 * Validate one voucher from an untrusted source (Shopee API payload or the Chrome extension).
 * Pure. Anything out of bounds returns null: a dropped voucher is better than a wrong one shown
 * as a saving (PRODUCT.md "Trung thực hơn tự tin").
 */
import { VOUCHER_KINDS, type VoucherDiscountType, type VoucherInput, type VoucherKind, type VoucherScope } from "@/lib/vouchers/types";

export const MAX_VOUCHER_AMOUNT = 10_000_000_000;
const CODE_RE = /^[A-Z0-9]{3,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKETPLACE_RE = /^[a-z]{2,20}$/;
// Dates outside this window are parser noise, not real voucher periods.
const MIN_DATE = Date.UTC(2020, 0, 1);
const MAX_DATE = Date.UTC(2100, 0, 1);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const absent = (v: unknown) => v === undefined || v === null;

/** A finite number in (0, MAX] (or [0, MAX] when zero is allowed), rounded to 2 decimals. */
function money(v: unknown, allowZero = false): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v > MAX_VOUCHER_AMOUNT || v < 0 || (!allowZero && v === 0)) return null;
  return Math.round(v * 100) / 100;
}

/** ISO string or epoch ms → ISO; `undefined` when invalid (distinct from an absent null). */
function date(v: unknown): string | null | undefined {
  if (absent(v) || v === "") return null;
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || ms < MIN_DATE || ms > MAX_DATE) return undefined;
  return new Date(ms).toISOString();
}

function uuid(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * `scope` (trusted, from our own listing row) binds the voucher: marketplace and seller always come
 * from it, and the voucher is tied to that listing only when the source says so (`listingOnly: true`).
 * Without a scope, ids in `raw` are accepted only when they are well-formed uuids.
 */
export function normalizeVoucher(raw: unknown, scope?: VoucherScope): VoucherInput | null {
  if (!isObj(raw)) return null;

  const kind = raw.kind as VoucherKind;
  if (!VOUCHER_KINDS.includes(kind)) return null;

  const discountType = raw.discountType as VoucherDiscountType;
  if (discountType !== "percent" && discountType !== "amount") return null;

  const discountValue = money(raw.discountValue);
  if (discountValue == null) return null;
  if (discountType === "percent" && discountValue > 100) return null;

  let maxDiscount: number | null = null;
  if (!absent(raw.maxDiscount)) {
    maxDiscount = money(raw.maxDiscount);
    if (maxDiscount == null) return null;
  }
  // A cap only means something on a percentage.
  if (discountType === "amount") maxDiscount = null;

  let minSpend = 0;
  if (!absent(raw.minSpend)) {
    const m = money(raw.minSpend, true);
    if (m == null) return null;
    minSpend = m;
  }

  let code: string | null = null;
  if (!absent(raw.code) && raw.code !== "") {
    if (typeof raw.code !== "string") return null;
    const c = raw.code.trim().toUpperCase();
    if (!CODE_RE.test(c)) return null;
    code = c;
  }

  const startsAt = date(raw.startsAt);
  const expiresAt = date(raw.expiresAt);
  if (startsAt === undefined || expiresAt === undefined) return null;
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) return null;

  let marketplace: string;
  let sellerId: string | null;
  let listingId: string | null;
  if (scope) {
    marketplace = scope.marketplace;
    sellerId = kind === "shop" ? scope.sellerId : null;
    listingId = raw.listingOnly === true ? scope.listingId : null;
  } else {
    if (typeof raw.marketplace !== "string" || !MARKETPLACE_RE.test(raw.marketplace)) return null;
    marketplace = raw.marketplace;
    sellerId = uuid(raw.sellerId);
    listingId = uuid(raw.listingId);
  }
  // Same rule as the table's check: a shop voucher belongs to a seller.
  if (kind === "shop" && !sellerId) return null;

  return {
    marketplace,
    kind,
    sellerId,
    listingId,
    code,
    discountType,
    discountValue,
    maxDiscount,
    minSpend,
    startsAt,
    expiresAt,
  };
}

/** Normalize a list, dropping invalid entries and duplicates (same natural key), capped at `max`. */
export function normalizeVouchers(raw: unknown, scope: VoucherScope | undefined, max: number): VoucherInput[] {
  if (!Array.isArray(raw)) return [];
  const out: VoucherInput[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, max)) {
    const v = normalizeVoucher(r, scope);
    if (!v) continue;
    const key = [v.marketplace, v.kind, v.sellerId, v.listingId, v.code, v.discountType, v.discountValue, v.minSpend].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
