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
 * DESIGN.md "Kết luận": the verdict always carries three channels (distinct icon, words,
 * colour), so it still reads correctly in greyscale or for colour-blind users.
 * "Chưa đủ dữ liệu" is the only dashed one (dashed = not enough to conclude).
 */
const VERDICT = {
  buy: {
    text: "Nên mua",
    Icon: CheckCircleIcon,
    tone: "text-buy bg-buy-soft border-buy/35 border-solid",
    fg: "var(--buy)",
    badgeBg: "bg-buy text-canvas",
  },
  wait: {
    text: "Có thể chờ",
    Icon: HourglassIcon,
    tone: "text-wait bg-wait-soft border-wait/35 border-solid",
    fg: "var(--wait)",
    badgeBg: "bg-wait text-canvas",
  },
  avoid: {
    text: "Chưa nên mua",
    Icon: OctagonMinusIcon,
    tone: "text-avoid bg-avoid-soft border-avoid/35 border-solid",
    fg: "var(--avoid)",
    badgeBg: "bg-avoid text-canvas",
  },
  insufficient_data: {
    text: "Chưa đủ dữ liệu",
    Icon: DottedQuestionIcon,
    tone: "text-unknown bg-unknown-soft border-unknown border-dashed",
    fg: "var(--ink-3)",
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
  const { text, Icon, tone } = VERDICT[key];

  if (size === "sm") {
    return (
      <span
        className={`inline-flex min-h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border py-1 pl-2 pr-3 text-[13px] font-semibold leading-tight ${tone} ${className}`}
      >
        <Icon className="size-4 shrink-0" strokeWidth={2.2} />
        {text}
      </span>
    );
  }

  return (
    <div
      className={`verdict-in flex items-start gap-3 rounded-[14px] border px-4 py-3 text-[16px] font-bold leading-snug ${tone} ${className}`}
    >
      <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={2.2} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span>{text}</span>
        {note && (
          <span className="text-[13.5px] font-normal leading-relaxed text-ink-2">{note}</span>
        )}
      </div>
    </div>
  );
}

interface ScoreRingProps {
  /** 0–100, or null when the engine had too little data to score. */
  score: number | null | undefined;
  recommendation: Recommendation | null | undefined;
  size?: "sm" | "md" | "lg";
  /** Show corner status icon badge (✓ / ⏳ / − / ?) so the ring stands on its own without text. */
  showBadge?: boolean;
  /** Render on a dark night panel (`bg-night`). */
  night?: boolean;
  className?: string;
}

/**
 * Deal Score SVG progress ring. Fills clockwise proportionally to the 0–100 score.
 * When `showBadge` is true, a small status icon badge is attached at the bottom-right corner.
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
  const label =
    value == null
      ? `Deal Score: ${v.text}`
      : `Deal Score: ${value}/100 — ${v.text}`;

  if (size === "lg") {
    const trackColor = key === "insufficient_data" ? "var(--line-strong)" : "var(--surface-2)";
    const trackDash = key === "insufficient_data" ? "5 5" : "none";
    const circumference = 296; // 2 * Math.PI * 47 ≈ 295.3
    const dashArray = value != null ? `${Math.round((value / 100) * circumference)} ${circumference}` : "0 296";

    return (
      <div
        className={`relative flex size-[88px] shrink-0 items-center justify-center ${className}`}
        aria-label={label}
        title={label}
        role="img"
      >
        <svg width="88" height="88" viewBox="0 0 112 112" aria-hidden="true" className="absolute left-0 top-0 size-full">
          <circle
            cx="56"
            cy="56"
            r="47"
            fill="none"
            stroke={trackColor}
            strokeWidth="10"
            strokeDasharray={trackDash}
          />
          {value != null && (
            <circle
              cx="56"
              cy="56"
              r="47"
              fill="none"
              stroke={v.fg}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={dashArray}
              transform="rotate(-90 56 56)"
            />
          )}
        </svg>
        <div className="relative z-10 flex flex-col items-center justify-center">
          <span className="num display text-[28px] font-extrabold leading-none tracking-tight text-ink">
            {value != null ? String(value) : "—"}
          </span>
          {value != null && (
            <span className="num mt-0.5 text-[11px] font-semibold leading-none text-ink-3">/100</span>
          )}
        </div>
        {showBadge && (
          <span
            aria-hidden="true"
            className={`absolute -bottom-0.5 -right-0.5 z-20 flex size-6.5 items-center justify-center rounded-full ring-2 ring-surface shadow-xs ${v.badgeBg}`}
          >
            {key === "buy" ? (
              <CheckIcon className="size-3.5" strokeWidth={3} />
            ) : key === "wait" ? (
              <HourglassIcon className="size-3.5" strokeWidth={2.5} />
            ) : key === "avoid" ? (
              <DashIcon className="size-3.5" strokeWidth={3} />
            ) : (
              <span className="text-[12px] font-bold leading-none">?</span>
            )}
          </span>
        )}
      </div>
    );
  }

  const isSm = size === "sm";
  const boxClass = isSm ? "size-12" : "size-13";
  const textClass = isSm ? "text-[15px]" : "text-[17px]";
  const circumference = 122.5; // 2 * Math.PI * 19.5
  const dashArray =
    value != null
      ? `${Math.max(6, Math.round((value / 100) * circumference))} ${circumference}`
      : "0 122.5";
  const trackStroke =
    key === "insufficient_data"
      ? night
        ? "var(--night-line)"
        : "var(--line-strong)"
      : night
        ? "var(--night-2)"
        : "var(--surface-2)";

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className={`relative inline-flex ${boxClass} shrink-0 items-center justify-center ${className}`}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" className="size-full">
        <circle
          cx="24"
          cy="24"
          r="19.5"
          fill="none"
          stroke={trackStroke}
          strokeWidth="3.5"
          strokeDasharray={key === "insufficient_data" ? "3 3" : undefined}
        />
        {value != null && (
          <circle
            cx="24"
            cy="24"
            r="19.5"
            fill="none"
            stroke={v.fg}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            transform="rotate(-90 24 24)"
          />
        )}
      </svg>
      <span
        className={`num absolute ${textClass} font-extrabold leading-none ${
          value != null
            ? night
              ? "text-night-ink"
              : "text-ink"
            : night
              ? "text-night-ink-3"
              : "text-ink-3"
        }`}
      >
        {value ?? "—"}
      </span>
      {showBadge && (
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full ring-2 ${
            night ? "ring-night" : "ring-surface"
          } ${v.badgeBg}`}
        >
          {key === "buy" ? (
            <CheckIcon className="size-2.5" strokeWidth={3} />
          ) : key === "wait" ? (
            <HourglassIcon className="size-2.5" strokeWidth={2.5} />
          ) : key === "avoid" ? (
            <DashIcon className="size-2.5" strokeWidth={3} />
          ) : (
            <span className="text-[10px] font-bold leading-none">?</span>
          )}
        </span>
      )}
    </div>
  );
}


