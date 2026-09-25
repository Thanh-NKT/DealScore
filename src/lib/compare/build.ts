/**
 * Product comparison A vs B (Phase 2). Pure: takes two already-loaded product pages and returns
 * display rows. Never invents a value — a missing side shows "—" and has no winner.
 */
import type { ProductPageData } from "@/lib/product/page-data";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { formatVnd } from "@/lib/format";

export type Winner = "a" | "b" | "tie" | null;

export interface CompareRow {
  key: string;
  label: string;
  a: string;
  b: string;
  winner: Winner;
}

export interface CompareSide {
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  price: number | null;
  score: number | null;
  recommendation: Recommendation | null;
  /** Product page of the compared variant. */
  href: string;
}

export interface Comparison {
  a: CompareSide;
  b: CompareSide;
  rows: CompareRow[];
  specRows: CompareRow[];
}

const TIE_RATIO = 0.01;
const DASH = "—";

const VERDICT_RANK: Record<Recommendation, number | null> = { buy: 3, wait: 2, avoid: 1, insufficient_data: null };
const VERDICT_TEXT: Record<Recommendation, string> = {
  buy: "Nên mua",
  wait: "Có thể chờ",
  avoid: "Chưa nên mua",
  insufficient_data: "Chưa đủ dữ liệu",
};

/** Compare two numbers; `better` says which direction wins. */
function pick(a: number | null, b: number | null, better: "lower" | "higher", tieRatio = TIE_RATIO): Winner {
  if (a == null || b == null) return null;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0 || Math.abs(a - b) / scale < tieRatio) return "tie";
  const aWins = better === "lower" ? a < b : a > b;
  return aWins ? "a" : "b";
}

function side(p: ProductPageData): CompareSide {
  const h = p.pricing.headline;
  return {
    slug: p.product.slug,
    name: p.product.canonicalName,
    brand: p.product.brand,
    image: p.product.image,
    price: p.pricing.cheapest?.price ?? null,
    score: h?.score ?? null,
    recommendation: h ? (h.score != null ? h.recommendation : "insufficient_data") : null,
    href: `/${p.product.categorySlug}/${p.product.slug}?variant=${p.selectedVariantId}`,
  };
}

function vsMedian(price: number | null, median: number | null): number | null {
  return price != null && median != null && median > 0 ? (price - median) / median : null;
}

function signedPct(x: number | null): string {
  if (x == null) return DASH;
  const n = Math.round(x * 100);
  return n === 0 ? "0%" : n > 0 ? `+${n}%` : `−${Math.abs(n)}%`;
}

function specText(v: unknown): string {
  if (v == null || v === "") return DASH;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function buildComparison(pa: ProductPageData, pb: ProductPageData): Comparison {
  const a = side(pa);
  const b = side(pb);
  const sa = pa.pricing.stats;
  const sb = pb.pricing.stats;
  const ma = vsMedian(a.price, sa.median);
  const mb = vsMedian(b.price, sb.median);

  const rankA = a.recommendation ? VERDICT_RANK[a.recommendation] : null;
  const rankB = b.recommendation ? VERDICT_RANK[b.recommendation] : null;

  const rows: CompareRow[] = [
    { key: "price", label: "Giá thấp nhất hôm nay", a: formatVnd(a.price), b: formatVnd(b.price), winner: pick(a.price, b.price, "lower") },
    {
      key: "score",
      label: "Deal Score",
      a: a.score == null ? DASH : `${a.score}/100`,
      b: b.score == null ? DASH : `${b.score}/100`,
      winner: pick(a.score, b.score, "higher", 0),
    },
    {
      key: "verdict",
      label: "Khuyến nghị",
      a: a.recommendation ? VERDICT_TEXT[a.recommendation] : DASH,
      b: b.recommendation ? VERDICT_TEXT[b.recommendation] : DASH,
      winner: pick(rankA, rankB, "higher", 0),
    },
    { key: "vs_median", label: "So với trung vị 90 ngày", a: signedPct(ma), b: signedPct(mb), winner: pick(ma, mb, "lower", 0) },
    { key: "low", label: "Đáy 90 ngày", a: formatVnd(sa.low), b: formatVnd(sb.low), winner: null },
    { key: "median", label: "Trung vị 90 ngày", a: formatVnd(sa.median), b: formatVnd(sb.median), winner: null },
    {
      key: "offers",
      label: "Số nơi bán",
      a: String(pa.pricing.offers.length),
      b: String(pb.pricing.offers.length),
      winner: pick(pa.pricing.offers.length, pb.pricing.offers.length, "higher", 0),
    },
    {
      key: "tracking",
      label: "Kairo theo dõi từ",
      a: pa.pricing.trackingSince ?? DASH,
      b: pb.pricing.trackingSince ?? DASH,
      winner: null,
    },
    {
      key: "fake_sale",
      label: "Dấu hiệu giảm giá ảo",
      a: pa.pricing.fakeSaleMessage ? "Có" : "Không",
      b: pb.pricing.fakeSaleMessage ? "Có" : "Không",
      winner: null,
    },
  ];

  const keys = [...new Set([...Object.keys(pa.product.specs), ...Object.keys(pb.product.specs)])].sort((x, y) =>
    x.localeCompare(y, "vi"),
  );
  const specRows: CompareRow[] = keys.map((k) => ({
    key: `spec:${k}`,
    label: k,
    a: specText(pa.product.specs[k]),
    b: specText(pb.product.specs[k]),
    winner: null,
  }));

  return { a, b, rows, specRows };
}
