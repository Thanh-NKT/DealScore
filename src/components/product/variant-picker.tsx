import Link from "next/link";
import { formatVnd } from "@/lib/format";
import type { VariantVerdict } from "@/lib/pricing/variant-verdict";
import { verdictText } from "./verdict-tag";
import { variantLabel } from "./variant-label";

type Variant = {
  id: string;
  variantKey: string;
  price: number | null;
  inStock: boolean;
  /** Deal Score label of this variant (variantVerdict); { kind: "none" } shows nothing. */
  verdict: VariantVerdict;
};

const DOT = { buy: "bg-buy", wait: "bg-wait", avoid: "bg-avoid" } as const;

function chipTitle(label: string, note: string, verdict: VariantVerdict): string {
  const base = `${label} (${note})`;
  if (verdict.kind === "score") return `${base} · Deal Score ${verdict.score}/100 — ${verdictText(verdict.recommendation)}`;
  if (verdict.kind === "insufficient") return `${base} · Chưa đủ dữ liệu để chấm điểm`;
  return base;
}

/** Small verdict line inside a chip: the dot is the verdict colour, so green/red/grey still mean only the verdict. */
function VerdictLine({ verdict, selected }: { verdict: VariantVerdict; selected: boolean }) {
  if (verdict.kind === "none") return null;
  const ink = selected ? "text-night-ink-2" : verdict.kind === "score" ? "text-ink-2" : "text-ink-3";
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-micro font-semibold ${ink}`}>
      {verdict.kind === "score" ? (
        <>
          <span className={`size-2 shrink-0 rounded-full ${DOT[verdict.recommendation]}`} />
          <span>
            {verdictText(verdict.recommendation)} · <span className="num">{verdict.score}</span>
          </span>
        </>
      ) : (
        <>
          <span className="size-2 shrink-0 rounded-full border border-ink-3" />
          <span>Chưa đủ dữ liệu</span>
        </>
      )}
    </span>
  );
}

interface VariantPickerProps {
  variants: Variant[];
  selectedId: string;
  range: 7 | 30 | 90;
}

/** Chips shown before the rest fold into a no-JS <details> (fashion listings can carry 50+ size × colour combos). */
const VISIBLE_CHIPS = 12;

function priceNote(v: Variant): string {
  if (!v.inStock) return "Hết hàng";
  return v.price != null && Number.isFinite(v.price) && v.price > 0 ? formatVnd(v.price) : "Chưa có giá";
}

function Chip({ v, selected, range }: { v: Variant; selected: boolean; range: number }) {
  const label = variantLabel(v.variantKey);
  const note = priceNote(v);
  const title = chipTitle(label, note, v.verdict);
  const hasVerdict = v.verdict.kind !== "none";
  return (
    <Link
      href={`?variant=${encodeURIComponent(v.id)}&range=${range}`}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      title={title}
      aria-label={hasVerdict ? title : undefined}
      className={`inline-flex min-h-11 max-w-full items-center gap-x-2 gap-y-0.5 rounded-md border px-4 py-1.5 text-body-sm font-semibold transition-colors duration-150 ease-out ${
        hasVerdict ? "max-sm:max-h-14 max-sm:flex-col max-sm:items-start max-sm:justify-center" : ""
      } ${
        selected
          ? "border-night bg-night text-night-ink"
          : "border-line-strong bg-surface text-ink hover:bg-surface-2"
      }`}
    >
      <span className="inline-flex min-w-0 max-w-full items-center gap-2">
        <span className="min-w-0 truncate">{label}</span>
        <span
          className={`shrink-0 whitespace-nowrap text-label font-medium ${v.inStock && note !== "Chưa có giá" ? "num" : ""} ${
            selected ? "text-night-ink-2" : "text-ink-3"
          }`}
        >
          {note}
        </span>
      </span>
      <VerdictLine verdict={v.verdict} selected={selected} />
    </Link>
  );
}

/**
 * Variant chooser: 12px-radius option buttons, the selected one on `night` (DESIGN.md). Shows readable values instead of raw keys, truncates long model names (full text
 * in `title`), keeps out-of-stock variants legible (words, not a faded chip), and folds long lists
 * into a <details> that works without JavaScript, always keeping the selected variant visible.
 */
export function VariantPicker({ variants, selectedId, range }: VariantPickerProps) {
  const list = (variants ?? []).filter((v) => v?.id);
  if (list.length < 2) return null;

  const selectedIndex = list.findIndex((v) => v.id === selectedId);
  let head = list.slice(0, VISIBLE_CHIPS);
  let rest = list.slice(VISIBLE_CHIPS);
  // Keep the selected variant in the visible part even when it sits deep in the list.
  if (selectedIndex >= VISIBLE_CHIPS) {
    head = [...list.slice(0, VISIBLE_CHIPS - 1), list[selectedIndex]];
    rest = list.filter((v, i) => i >= VISIBLE_CHIPS - 1 && i !== selectedIndex);
  }

  return (
    <nav aria-labelledby="variant-picker-heading" className="space-y-2">
      <h2 id="variant-picker-heading" className="text-label font-bold text-ink-2">
        Chọn phiên bản <span className="num font-semibold text-ink-3">({list.length})</span>
      </h2>
      {/* Phones: one swipeable row instead of stacked rows, so the price and verdict stay in the first screen. */}
      <div className="flex flex-wrap gap-2.5 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[scrollbar-width:none] max-sm:[&>*]:shrink-0">
        {head.map((v) => (
          <Chip key={v.id} v={v} selected={v.id === selectedId} range={range} />
        ))}
      </div>
      {rest.length > 0 && (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-body-sm font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary-hover hover:decoration-primary-hover [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Xem thêm {rest.length} phiên bản</span>
            <span className="hidden group-open:inline">Thu gọn</span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {rest.map((v) => (
              <Chip key={v.id} v={v} selected={v.id === selectedId} range={range} />
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}
