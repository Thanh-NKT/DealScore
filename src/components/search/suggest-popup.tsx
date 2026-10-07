"use client";

import { useEffect, type MouseEvent } from "react";
import { formatVnd } from "@/lib/format";
import { highlightParts } from "@/lib/search/highlight";
import type { SuggestRow, Suggestions } from "@/lib/search/suggest-rows";
import { ClockIcon, FolderIcon, SearchIcon } from "@/components/ui/icons";
import { ProductImage } from "@/components/ui/product-image";

/** Matched words in semibold, accents ignored ("tai nghe" marks "Tai nghe"). */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.match ? (
          <span key={i} className="font-semibold text-ink">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const keepFocus = (e: MouseEvent) => e.preventDefault(); // clicks in the list must not blur the input

function RowBody({ row, query, onRemove }: { row: SuggestRow; query: string; onRemove: (q: string) => void }) {
  switch (row.kind) {
    case "query":
      return (
        <>
          <SearchIcon className="size-4 shrink-0 text-ink-3" />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-body-sm text-ink-2">
              Tìm “<span className="font-semibold text-ink">{row.q}</span>”
            </span>
            {row.chips.map((c) => (
              <span key={c} className="num shrink-0 rounded-sm bg-primary-soft px-2 py-0.5 text-micro font-semibold text-primary">
                {c}
              </span>
            ))}
          </span>
        </>
      );
    case "category":
      return (
        <>
          <FolderIcon className="size-4 shrink-0 text-ink-3" />
          <span className="min-w-0 truncate text-body-sm text-ink-2">
            <Highlight text={row.name} query={query} />
          </span>
        </>
      );
    case "brand":
      return (
        <>
          <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-micro font-bold text-ink-2">
            {row.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 truncate text-body-sm text-ink-2">
            <Highlight text={row.name} query={query} />
          </span>
        </>
      );
    case "recent":
      return (
        <>
          <ClockIcon className="size-4 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{row.q}</span>
          <button
            type="button"
            tabIndex={-1} // keyboard: Delete on the active row
            aria-label={`Xóa “${row.q}” khỏi lịch sử`}
            onMouseDown={keepFocus}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(row.q);
            }}
            className="-mr-1.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-3 transition-colors duration-150 ease-out hover:bg-surface hover:text-ink motion-reduce:transition-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className="size-3.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </>
      );
    case "product": {
      const s = row.item;
      const name = s.name?.trim() || "Sản phẩm chưa có tên";
      const price = s.bestPrice != null && s.bestPrice > 0 ? s.bestPrice : null;
      return (
        <>
          <div className="size-9 shrink-0 overflow-hidden rounded-sm bg-surface-2">
            <ProductImage src={s.image} className="bg-surface-2! p-0.5" iconClassName="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm text-ink-2" title={name}>
              <Highlight text={name} query={query} />
            </p>
            {s.brand?.trim() && <p className="truncate text-micro text-ink-3">{s.brand.trim()}</p>}
          </div>
          {price != null ? (
            <span className="num shrink-0 text-body-sm font-bold text-ink">{formatVnd(price)}</span>
          ) : (
            <span className="shrink-0 text-micro text-ink-3">Chưa có giá</span>
          )}
        </>
      );
    }
  }
}

/**
 * The suggestion popup under a search field: one `listbox` whose sections are `group`s labelled by their
 * heading, every row an `option` with a stable id (`optionId(i)`) for `aria-activedescendant`.
 */
export function SuggestPopup({
  listId,
  optionId,
  suggestions,
  query,
  active,
  pending,
  onHover,
  onPick,
  onRemoveRecent,
  onClearRecent,
}: {
  listId: string;
  optionId: (i: number) => string;
  suggestions: Suggestions;
  /** What is typed now (for the highlight and the empty line). */
  query: string;
  active: number;
  pending: boolean;
  onHover: (i: number) => void;
  onPick: (row: SuggestRow) => void;
  onRemoveRecent: (q: string) => void;
  onClearRecent: () => void;
}) {
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [active, optionId]);

  const shell = "absolute inset-x-0 z-50 mt-2 overflow-hidden rounded-md border border-line bg-surface shadow-lift";

  if (suggestions.groups.length === 0) {
    if (!suggestions.empty) return null;
    return (
      <div className={shell}>
        <p className="px-3.5 py-3 text-body-sm text-ink-2">
          Không có gợi ý — nhấn Enter để tìm “<span className="font-semibold text-ink">{query}</span>”
        </p>
      </div>
    );
  }

  let index = 0;
  const hasRecent = suggestions.groups.some((g) => g.key === "recent");

  return (
    <div className={shell}>
      <div
        id={listId}
        role="listbox"
        aria-label="Gợi ý tìm kiếm"
        aria-busy={pending || undefined}
        className="max-h-96 overflow-y-auto overscroll-contain py-1.5 max-sm:max-h-[60vh]"
      >
        {suggestions.groups.map((g) => {
          const headingId = `${listId}-${g.key}`;
          const options = g.rows.map((row) => {
            const i = index++;
            return (
              <div
                key={`${row.kind}-${row.href}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={keepFocus}
                onClick={() => onPick(row)}
                onMouseEnter={() => onHover(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-1.5 ${i === active ? "bg-surface-2" : ""}`}
              >
                <RowBody row={row} query={query} onRemove={onRemoveRecent} />
              </div>
            );
          });
          const dim = pending && g.key !== "query" ? "opacity-60" : "";
          if (!g.label) {
            return (
              <div key={g.key} role="presentation" className={dim}>
                {options}
              </div>
            );
          }
          return (
            <div
              key={g.key}
              role="group"
              aria-labelledby={headingId}
              className={`transition-opacity duration-150 ease-out motion-reduce:transition-none ${dim}`}
            >
              <div id={headingId} role="presentation" className="px-3.5 pb-1 pt-2.5 text-micro font-semibold text-ink-3">
                {g.label}
              </div>
              {options}
            </div>
          );
        })}
      </div>
      {hasRecent && (
        <div className="flex justify-end border-t border-line/80 px-1.5 py-1">
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={onClearRecent}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-sm px-2.5 text-label font-semibold text-primary transition-colors duration-150 ease-out hover:text-primary-hover hover:underline hover:underline-offset-4 motion-reduce:transition-none"
          >
            Xóa lịch sử
          </button>
        </div>
      )}
    </div>
  );
}
