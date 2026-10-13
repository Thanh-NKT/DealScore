/**
 * The DealScore mark: an iris tile with two price bars side by side, the lower one ticked — "the same
 * product, compared, and the better price picked". Same drawing as app/icon.svg and app/apple-icon.tsx.
 */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-inner bg-primary text-on-primary ${className}`}>
      <svg viewBox="0 0 32 32" className="size-full" fill="none">
        <rect x="8.5" y="9" width="6" height="15" rx="3" fill="currentColor" fillOpacity="0.42" />
        <rect x="17.5" y="14.5" width="6" height="9.5" rx="3" fill="currentColor" />
        <path d="M17.6 9.3l2.1 2.1 3.7-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Logo mark + wordmark ("Deal" in ink, "Score" in iris). `tone="night"` for dark bands (footer). */
/** `markOnlyOnNarrow`: below 360px only the mark shows (header: wordmark + actions don't fit one row at 320px). */
export function Wordmark({
  tone = "light",
  compact = false,
  markOnlyOnNarrow = false,
}: {
  tone?: "light" | "night";
  compact?: boolean;
  markOnlyOnNarrow?: boolean;
}) {
  return (
    <span className={`flex items-center gap-2.5 max-[440px]:gap-2 ${tone === "night" ? "text-night-ink" : "text-ink"}`}>
      <LogoMark className={compact ? "size-8" : "size-9 max-[440px]:size-8"} />
      <span className={`display font-bold leading-none ${compact ? "text-title" : "text-h4 max-[440px]:text-title"} ${markOnlyOnNarrow ? "max-[359px]:sr-only" : ""}`}>
        Deal<span className={tone === "night" ? "text-night-ink-3" : "text-primary"}>Score</span>
      </span>
    </span>
  );
}
