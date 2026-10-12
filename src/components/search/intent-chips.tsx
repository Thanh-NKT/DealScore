import Link from "next/link";
import type { IntentChip } from "@/lib/intent/types";
import { removeChip } from "@/lib/intent/merge";
import { toSearchParams, type SearchParams } from "@/lib/search";

interface IntentChipsProps {
  /** Chips that were actually applied to the search. */
  applied: IntentChip[];
  /** Search params AFTER applyIntent — removal links are built from these. */
  params: SearchParams;
  /** What the user typed, before intent extraction. */
  originalQuery: string;
  /** The filtered search found nothing and the page shows plain-text results instead. */
  fallback: boolean;
}

function searchHref(sp: URLSearchParams): string {
  const qs = sp.toString();
  return qs ? `/search?${qs}` : "/search";
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true" className="size-3 shrink-0">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * "Đã hiểu:" row — what query intent read from the search text (spec §3). Server component, no JS:
 * every chip is a plain link to the same search without that condition (and `intent=0`, so the
 * remaining words aren't re-parsed). The link is a 40px-tall hit area around a 32px visual chip.
 */
export function IntentChips({ applied, params, originalQuery, fallback }: IntentChipsProps) {
  if (applied.length === 0) return null;

  // Keeps the "Theo sở thích của tôi" toggle: it is a mode, not a condition read from the text.
  const exactHref = searchHref(toSearchParams({ q: originalQuery, intent: false, prefs: params.prefs }));

  return (
    <div className="space-y-2">
      {fallback && (
        <p role="status" className="rounded-tile bg-wait-soft px-4 py-2.5 text-body-sm text-wait">
          Không có sản phẩm khớp đủ các điều kiện — đây là kết quả gần đúng cho &ldquo;{originalQuery}&rdquo;.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-1.5">
        <span className="text-micro font-semibold text-ink-2">Đã hiểu:</span>
        {applied.map((chip, i) => (
          <Link
            key={`${chip.kind}-${i}`}
            href={searchHref(toSearchParams({ ...removeChip(params, chip.kind), page: 1 }))}
            scroll={false}
            aria-label={`Bỏ điều kiện ${chip.label}`}
            className="group/chip inline-flex min-h-10 max-w-full items-center rounded-full"
          >
            <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-surface-2 pl-3 pr-2 text-micro font-semibold text-ink transition-colors duration-150 ease-out group-hover/chip:bg-primary group-hover/chip:text-on-primary">
              <span className="num min-w-0 truncate">{chip.label}</span>
              <CrossIcon />
            </span>
          </Link>
        ))}
        {!fallback && (
          <Link href={exactHref} className="ml-1 inline-flex min-h-10 items-center text-micro font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
            Tìm đúng chữ &ldquo;{originalQuery}&rdquo;
          </Link>
        )}
      </div>
    </div>
  );
}
