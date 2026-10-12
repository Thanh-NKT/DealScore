import Link from "next/link";
import type { Comparison, CompareRow, CompareSide } from "@/lib/compare/build";
import { formatVnd } from "@/lib/format";
import { VerdictRow } from "@/components/search/product-card";
import { ProductImage } from "@/components/ui/product-image";
import { CheckIcon, InfoIcon } from "@/components/ui/icons";

/** Rows whose values are numbers get the tabular numeral face. */
const NUMERIC = new Set(["price", "score", "vs_median", "low", "median", "offers", "tracking"]);

/** One compared product as a white card: photo, name, price, then verdict words beside the ring. */
function SideCard({ side, other, position }: { side: CompareSide; other: CompareSide; position: "a" | "b" }) {
  // Drop this side, keep the other: /compare then asks for a replacement.
  const change = position === "a" ? `/compare?b=${encodeURIComponent(other.slug)}` : `/compare?a=${encodeURIComponent(other.slug)}`;
  return (
    <article className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5 max-sm:gap-3 max-sm:p-3.5">
      <div className="flex items-start gap-3.5 max-sm:flex-col max-sm:gap-2.5">
        <div className="w-20 shrink-0 overflow-hidden rounded-tile bg-surface-2 max-sm:w-14">
          <ProductImage src={side.image} className="bg-surface-2! p-2 max-sm:p-1.5" iconClassName="size-7 max-sm:size-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-micro font-semibold text-ink-3">{position === "a" ? "Sản phẩm A" : "Sản phẩm B"}</p>
          <h2 className="line-clamp-3 text-body-sm leading-snug font-semibold text-ink [overflow-wrap:anywhere] max-sm:text-body-sm">
            <Link href={side.href} className="hover:underline hover:decoration-line-strong hover:underline-offset-4">
              {side.name}
            </Link>
          </h2>
        </div>
      </div>
      {side.price != null ? (
        <p className="num text-price-input leading-none font-bold max-sm:text-title">{formatVnd(side.price)}</p>
      ) : (
        <p className="text-body-sm font-semibold text-ink-3">Chưa có giá còn hàng</p>
      )}
      <VerdictRow score={side.score} recommendation={side.recommendation} />
      <Link
        href={change}
        className="mt-auto inline-flex min-h-10 w-fit items-center text-label font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
      >
        Đổi sản phẩm {position.toUpperCase()}
      </Link>
    </article>
  );
}

function Cell({ row, side, numeric }: { row: CompareRow; side: "a" | "b"; numeric: boolean }) {
  const value = row[side];
  const wins = row.winner === side;
  return (
    <td className={`px-5 py-3.5 align-top max-sm:px-2.5 ${numeric ? "num text-title max-sm:text-body" : "text-body-sm max-sm:text-body-sm"}`}>
      <span className={`inline-flex items-start gap-1.5 ${wins ? "font-bold text-ink" : value === "—" ? "text-ink-3" : "font-medium text-ink-2"}`}>
        <span className={`[overflow-wrap:anywhere] ${wins ? "highlight" : ""}`}>{value}</span>
        {wins && (
          <>
            <CheckIcon className="mt-[0.2em] size-[1em] shrink-0 text-buy" strokeWidth={2.5} />
            <span className="sr-only">(tốt hơn)</span>
          </>
        )}
      </span>
    </td>
  );
}

function Table({ caption, rows, a, b }: { caption: string; rows: CompareRow[]; a: CompareSide; b: CompareSide }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="display border-b border-line px-5 py-4 text-left text-h3 font-semibold text-ink max-sm:px-3 max-sm:text-title">
          {caption}
        </caption>
        <colgroup>
          <col className="w-[34%] max-sm:w-[32%]" />
          <col />
          <col />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Tiêu chí</th>
            <th scope="col">{a.name}</th>
            <th scope="col">{b.name}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="px-5 py-3.5 align-top text-label leading-snug font-semibold text-ink-3 max-sm:px-3">
                {row.label}
              </th>
              <Cell row={row} side="a" numeric={NUMERIC.has(row.key)} />
              <Cell row={row} side="b" numeric={NUMERIC.has(row.key)} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Product A vs B (Phase 2). Answer first (summary sentences), then the two product cards side by
 * side, then the criteria tables. The better value carries a tick, bold ink and a screen-reader
 * note — never colour alone; each card pairs its ScoreRing with the verdict words.
 */
export function CompareView({ comparison }: { comparison: Comparison }) {
  const { a, b, rows, specRows, summary } = comparison;
  return (
    <div className="space-y-6">
      {summary.length > 0 && (
        <div className="max-w-[68ch] space-y-1 text-title leading-relaxed text-ink">
          {summary.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[34%_1fr_1fr] sm:gap-0">
        <div className="hidden flex-col justify-end gap-2 pr-5 pb-1 sm:flex">
          <Link
            href={`/compare?a=${encodeURIComponent(b.slug)}&b=${encodeURIComponent(a.slug)}`}
            className="inline-flex min-h-11 w-fit items-center rounded-full border border-line-strong/50 bg-surface px-5 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary"
          >
            Đổi vị trí A ↔ B
          </Link>
        </div>
        <div className="sm:pr-2">
          <SideCard side={a} other={b} position="a" />
        </div>
        <div className="sm:pl-2">
          <SideCard side={b} other={a} position="b" />
        </div>
      </div>

      <Table caption="So sánh theo giá DealScore ghi nhận" rows={rows} a={a} b={b} />
      <Table caption="Thông số" rows={specRows} a={a} b={b} />

      <p className="flex max-w-[75ch] items-start gap-2 text-label leading-[1.45] text-ink-3">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <span>
          Mỗi bên so sánh phiên bản đang chọn. Deal Score và khuyến nghị chấm theo lịch sử giá của chính sản phẩm đó, nên
          hai sản phẩm có thể cùng “Nên mua”. Hoa hồng tiếp thị không nằm trong phép tính.
        </span>
      </p>
    </div>
  );
}
