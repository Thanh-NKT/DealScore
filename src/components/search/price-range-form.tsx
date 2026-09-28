"use client";

import { useId, useState, type FormEvent } from "react";
import { formatVnd } from "@/lib/format";
import { AlertIcon } from "@/components/ui/icons";
import { parseVndInput } from "@/components/watch/price-input";

interface PriceRangeFormProps {
  /** Every other current search parameter, carried as hidden inputs so applying a price keeps them. */
  hidden: Array<[string, string]>;
  min?: number;
  max?: number;
}

type Check = { value: number | null; error: string | null };

function check(raw: string): Check {
  if (!raw.trim()) return { value: null, error: null };
  const p = parseVndInput(raw);
  if (p.ok) return { value: p.value, error: null };
  if (p.reason === "negative") return { value: null, error: "Giá không thể là số âm." };
  if (p.reason === "zero") return { value: 0, error: null };
  return { value: null, error: "Chưa đọc được số tiền, thử dạng 500.000 hoặc 2tr." };
}

const field =
  "h-11 w-full min-w-0 rounded-[12px] border border-line-strong bg-surface px-3 text-[14px] text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[invalid=true]:border-2 aria-[invalid=true]:border-avoid";

/**
 * Price range with the same input rules as the watch form ("500.000", "2tr", "1,5 triệu").
 * Explains an inverted range instead of silently swapping it, and sends clean integers.
 * Without JavaScript it is a plain GET form; the server still ignores unreadable values and
 * swaps an inverted range.
 */
export function PriceRangeForm({ hidden, min, max }: PriceRangeFormProps) {
  const uid = useId();
  const [minText, setMinText] = useState(min != null ? formatVnd(min).replace(/đ$/, "") : "");
  const [maxText, setMaxText] = useState(max != null ? formatVnd(max).replace(/đ$/, "") : "");
  const [showErrors, setShowErrors] = useState(false);

  const lo = check(minText);
  const hi = check(maxText);
  const inverted = lo.value != null && hi.value != null && lo.value > hi.value;
  const error = lo.error ?? hi.error ?? (inverted ? "Giá “Từ” đang lớn hơn giá “Đến”." : null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (error) {
      e.preventDefault();
      setShowErrors(true);
      return;
    }
    // Send clean integers ("2tr" → 2000000); an empty or 0 bound is dropped from the URL.
    const form = e.currentTarget;
    for (const [name, v] of [["min", lo.value], ["max", hi.value]] as const) {
      const input = form.elements.namedItem(name) as HTMLInputElement | null;
      if (!input) continue;
      if (v != null && v > 0) input.value = String(v);
      else input.removeAttribute("name");
    }
  };

  return (
    <form method="get" action="/search" onSubmit={onSubmit} noValidate className="space-y-2">
      {hidden.map(([k, v], i) => (
        <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
      ))}
      <div className="grid grid-cols-2 gap-2.5">
        <label htmlFor={`${uid}-min`} className="sr-only">
          Giá từ
        </label>
        <input
          id={`${uid}-min`}
          name="min"
          type="text"
          inputMode="decimal"
          value={minText}
          onChange={(e) => {
            setMinText(e.target.value);
            setShowErrors(false);
          }}
          placeholder="Từ"
          aria-invalid={(showErrors && Boolean(lo.error || inverted)) || undefined}
          aria-describedby={`${uid}-msg`}
          className={field}
        />
        <label htmlFor={`${uid}-max`} className="sr-only">
          Giá đến
        </label>
        <input
          id={`${uid}-max`}
          name="max"
          type="text"
          inputMode="decimal"
          value={maxText}
          onChange={(e) => {
            setMaxText(e.target.value);
            setShowErrors(false);
          }}
          placeholder="Đến"
          aria-invalid={(showErrors && Boolean(hi.error || inverted)) || undefined}
          aria-describedby={`${uid}-msg`}
          className={field}
        />
      </div>

      <div id={`${uid}-msg`} aria-live="polite">
        {showErrors && error && (
          <div className="flex items-start gap-1.5 text-[14px] font-medium text-ink">
            <AlertIcon className="mt-0.5 size-4" />
            <span>
              {error}
              {inverted && (
                <button
                  type="button"
                  onClick={() => {
                    setMinText(maxText);
                    setMaxText(minText);
                    setShowErrors(false);
                  }}
                  className="ml-1.5 inline-flex min-h-10 items-center font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  Đổi chỗ hai giá
                </button>
              )}
            </span>
          </div>
        )}
      </div>

      <button
        type="submit"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-strong bg-surface text-[14px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2"
      >
        Áp dụng khoảng giá
      </button>
    </form>
  );
}
