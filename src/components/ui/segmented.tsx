import type { ReactNode } from "react";

/**
 * DESIGN.md "Điều khiển phân đoạn": one look for sort, chart range, tabs, the auth switch and the
 * discovery filter. `surface-2` track (12px corners, 4px padding, no border), segments ≥ 40px tall,
 * the active one petrol with on-primary text.
 *
 * Link-based and tab-based variants use the class helpers directly (they own their own roles);
 * plain button groups use <SegmentedControl>. No "use client": the helpers are called from server
 * components too; <SegmentedControl> itself is only rendered inside client components (it takes onChange).
 *
 * `className` on both helpers is layout-only (margins, overflow, grid columns). Size and display are
 * parameters so two conflicting Tailwind classes never meet.
 */
type TrackDisplay = "inline-flex" | "flex" | "grid";
type SegmentSize = "sm" | "md" | "lg";

const SEGMENT_TEXT: Record<SegmentSize, string> = { sm: "text-label", md: "text-body-sm", lg: "text-control" };

export function segmentTrack({ display = "inline-flex", className = "" }: { display?: TrackDisplay; className?: string } = {}): string {
  return `${display} max-w-full gap-1 rounded-md bg-surface-2 p-1 ${className}`.trim();
}

export function segmentClass(active: boolean, { size = "sm", className = "" }: { size?: SegmentSize; className?: string } = {}): string {
  const base = `inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-3.5 ${SEGMENT_TEXT[size]} transition-colors duration-150 ease-out cursor-pointer disabled:cursor-not-allowed`;
  const tone = active
    ? "bg-primary font-bold text-on-primary shadow-xs"
    : "font-medium text-ink-2 hover:bg-surface/70 hover:text-ink";
  return `${base} ${tone} ${className}`.trim();
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

/** A button group where exactly one option is on (aria-pressed), e.g. chart range or sort order. */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  size = "sm",
  className = "",
  segmentClassName = "",
}: {
  /** Accessible name of the group, e.g. "Khoảng thời gian". */
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: SegmentSize;
  /** Layout-only classes for the track (e.g. overflow-x-auto). */
  className?: string;
  /** Layout-only classes for each segment (e.g. min-w-[68px]). */
  segmentClassName?: string;
}) {
  return (
    <div role="group" aria-label={label} className={segmentTrack({ display: "flex", className })}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={segmentClass(o.value === value, { size, className: segmentClassName })}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
