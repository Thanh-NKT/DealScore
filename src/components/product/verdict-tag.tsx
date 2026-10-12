import type { CSSProperties } from "react";
import type { Recommendation } from "@/lib/pricing/deal-score";
import {
  CheckCircleIcon,
  CheckIcon,
  DashIcon,
  DottedQuestionIcon,
  HourglassIcon,
  OctagonMinusIcon,
} from "@/components/ui/icons";

/**
 * The verdict always carries three channels (distinct icon, words, colour), so it still reads
 * correctly in greyscale or for colour-blind users. "Chưa đủ dữ liệu" is the only dashed one
 * (dashed = not enough to conclude).
 */
const VERDICT = {
  buy: {
    text: "Nên mua",
    Icon: CheckCircleIcon,
    tone: "text-buy bg-buy-soft border-transparent",
    fg: "var(--buy)",
    solid: "bg-buy text-canvas",
    badgeBg: "bg-buy text-canvas",
  },
  wait: {
    text: "Có thể chờ",
    Icon: HourglassIcon,
    tone: "text-wait bg-wait-soft border-transparent",
    fg: "var(--wait)",
    solid: "bg-wait text-canvas",
    badgeBg: "bg-wait text-canvas",
  },
  avoid: {
    text: "Chưa nên mua",
    Icon: OctagonMinusIcon,
    tone: "text-avoid bg-avoid-soft border-transparent",
    fg: "var(--avoid)",
    solid: "bg-avoid text-canvas",
    badgeBg: "bg-avoid text-canvas",
  },
  insufficient_data: {
    text: "Chưa đủ dữ liệu",
    Icon: DottedQuestionIcon,
    tone: "text-unknown bg-transparent border-line-strong/70 border-dashed",
    fg: "var(--ink-3)",
    solid: "border border-dashed border-line-strong text-ink-3",
    badgeBg: "bg-surface-2 text-ink-3",
  },
} as const;

type VerdictKey = keyof typeof VERDICT;
const keyOf = (r: Recommendation | null | undefined): VerdictKey => (r && r in VERDICT ? r : "insufficient_data");

interface VerdictTagProps {
  /** null / unknown values fall back to "Chưa đủ dữ liệu" — never guess a verdict. */
  recommendation: Recommendation | null | undefined;
  size?: "sm" | "lg";
  /** Optional one-sentence reason under the words (large size only). */
  note?: string;
  className?: string;
}

export function verdictText(recommendation: Recommendation | null | undefined): string {
  return VERDICT[keyOf(recommendation)].text;
}

export function VerdictTag({ recommendation, size = "sm", note, className = "" }: VerdictTagProps) {
  const key = keyOf(recommendation);
  const { text, Icon, tone, solid } = VERDICT[key];

  if (size === "sm") {
    return (
      <span
        className={`inline-flex min-h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border py-1 pl-1.5 pr-2.5 text-label font-semibold leading-tight ${tone} ${className}`}
      >
        <Icon className="size-4 shrink-0" strokeWidth={2.2} />
        {text}
      </span>
    );
  }

  return (
    <div className={`verdict-in flex items-center gap-3.5 rounded-tile border p-3.5 pr-4 ${tone} ${className}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${solid}`}>
        <Icon className="size-5.5" strokeWidth={2.2} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="display text-h4 font-bold leading-tight">{text}</span>
        {note && <span className="text-body-sm font-normal leading-relaxed text-ink-2">{note}</span>}
      </div>
    </div>
  );
}

interface ScoreRingProps {
  /** 0–100, or null when the engine had too little data to score. */
  score: number | null | undefined;
  recommendation: Recommendation | null | undefined;
  size?: "sm" | "md" | "lg";
  /** Show corner status icon badge (✓ / ⏳ / − / ?) so the gauge stands on its own without text. */
  showBadge?: boolean;
  /** Render on a dark night panel (`bg-night`). */
  night?: boolean;
  className?: string;
}

/*
 * Gauge geometry (viewBox 0 0 100 100): a 240° arc around (50, 54), open at the bottom — the same
 * gauge as the logo. pathLength=100 makes the dash length equal the score. On the large gauge the
 * track is split into the three score zones the engine uses (< 50, 50–74, ≥ 75).
 */
const R = 40;
const CX = 50;
const CY = 54;
function polar(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
}
function arc(fromPct: number, toPct: number): string {
  const a0 = 150 + (fromPct / 100) * 240;
  const a1 = 150 + (toPct / 100) * 240;
  const [x0, y0] = polar(a0);
  const [x1, y1] = polar(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
const FULL_ARC = arc(0, 100);
const ZONES: Array<{ d: string; color: string }> = [
  { d: arc(0, 49), color: "var(--avoid)" },
  { d: arc(51, 74), color: "var(--wait)" },
  { d: arc(76, 100), color: "var(--buy)" },
];

function BadgeIcon({ k, small }: { k: VerdictKey; small: boolean }) {
  const cls = small ? "size-2.5" : "size-3.5";
  if (k === "buy") return <CheckIcon className={cls} strokeWidth={3} />;
  if (k === "wait") return <HourglassIcon className={cls} strokeWidth={2.5} />;
  if (k === "avoid") return <DashIcon className={cls} strokeWidth={3} />;
  return <span className={`${small ? "text-nano" : "text-micro"} font-bold leading-none`}>?</span>;
}

/**
 * Deal Score gauge. The arc fills clockwise to the 0–100 score in the verdict colour; the needle tip
 * is a dot in the same colour. Null scores draw a dashed empty track and "—".
 */
export function ScoreRing({
  score,
  recommendation,
  size = "md",
  showBadge = false,
  night = false,
  className = "",
}: ScoreRingProps) {
  const value = score != null && Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null;
  const key = value == null ? "insufficient_data" : keyOf(recommendation);
  const v = VERDICT[key];
  const label = value == null ? `Deal Score: ${v.text}` : `Deal Score: ${value}/100 — ${v.text}`;

  const isLg = size === "lg";
  const box = isLg ? "size-[104px]" : size === "md" ? "size-14" : "size-12";
  const stroke = isLg ? 7 : 10;
  const threeDigits = value === 100;
  const numClass = isLg ? (threeDigits ? "text-h3" : "text-h2") : size === "md" ? (threeDigits ? "text-control" : "text-num-sm") : threeDigits ? "text-label" : "text-control";
  const inkClass = value != null ? (night ? "text-night-ink" : "text-ink") : night ? "text-night-ink-3" : "text-ink-3";
  const emptyTrack = night ? "var(--night-line)" : "var(--line-strong)";
  const baseTrack = night ? "var(--night-2)" : "var(--line)";
  const tip = value != null ? polar(150 + (Math.max(2, value) / 100) * 240) : null;

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={`relative inline-flex ${box} shrink-0 items-center justify-center ${className}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        {value == null ? (
          <path d={FULL_ARC} fill="none" stroke={emptyTrack} strokeWidth={stroke * 0.6} strokeDasharray="4 5" strokeLinecap="round" />
        ) : (
          <>
            <path d={FULL_ARC} fill="none" stroke={baseTrack} strokeWidth={stroke} strokeLinecap="round" />
            {isLg &&
              ZONES.map((z) => (
                <path key={z.d} d={z.d} fill="none" stroke={z.color} strokeOpacity={0.2} strokeWidth={stroke} />
              ))}
            <path
              d={FULL_ARC}
              pathLength={100}
              fill="none"
              stroke={v.fg}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(2, value)} 100`}
              className={isLg ? "gauge-sweep" : undefined}
              style={isLg ? ({ "--gauge-from": value } as CSSProperties) : undefined}
            />
            {isLg && tip && (
              <circle cx={tip[0]} cy={tip[1]} r={stroke * 0.95} fill={night ? "var(--night)" : "var(--surface)"} stroke={v.fg} strokeWidth={3} className="verdict-in" />
            )}
          </>
        )}
      </svg>
      <span className={`relative flex flex-col items-center leading-none ${isLg ? "pt-1.5" : "pt-0.5"}`}>
        <span className={`num ${numClass} font-bold leading-none tracking-tight ${inkClass}`}>{value ?? "—"}</span>
        {isLg && value != null && <span className="eyebrow mt-1.5 leading-none text-ink-3">/100</span>}
      </span>
      {showBadge && (
        <span
          aria-hidden="true"
          className={`absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full ring-2 ${
            night ? "ring-night" : "ring-surface"
          } ${isLg ? "-bottom-1 size-6" : "-bottom-1 size-[18px]"} ${v.badgeBg}`}
        >
          <BadgeIcon k={key} small={!isLg} />
        </span>
      )}
    </div>
  );
}

/**
 * The Deal Score scale as a bar: three zones (0–49, 50–74, 75–100) with a marker at the score.
 * Decorative companion to the gauge; the score itself is announced by ScoreRing / the text beside it.
 */
export function ScoreScale({ score, className = "" }: { score: number | null | undefined; className?: string }) {
  const value = score != null && Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null;
  return (
    <div aria-hidden="true" className={`relative py-1 ${className}`}>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        <span className="basis-[49%] bg-avoid/85" />
        <span className="basis-[25%] bg-wait/85" />
        <span className="basis-[26%] bg-buy/85" />
      </div>
      {value != null && (
        <span
          style={{ left: `${value}%` }}
          className="ruler-in absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-primary shadow-sm"
        />
      )}
    </div>
  );
}
