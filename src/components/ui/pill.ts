/**
 * Filter chip: a rounded-full chip that toggles on/off (category strips, drop-size filters). 40px tall
 * so it is a real tap target; on = iris fill (light) or a paper fill (night panel).
 * `className` is layout-only.
 */
type PillTone = "light" | "night";

const TONE: Record<PillTone, { on: string; off: string }> = {
  light: {
    on: "border-primary bg-primary font-semibold text-on-primary",
    off: "border-line bg-surface font-medium text-ink-2 hover:border-primary/40 hover:text-ink",
  },
  night: {
    on: "border-night-ink bg-night-ink font-semibold text-night",
    off: "border-night-line font-medium text-night-ink hover:bg-night-2",
  },
};

export function pillClass(active: boolean, { tone = "light", className = "" }: { tone?: PillTone; className?: string } = {}): string {
  const t = TONE[tone];
  return `inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-label transition-colors duration-150 ease-out cursor-pointer ${
    active ? t.on : t.off
  } ${className}`.trim();
}
