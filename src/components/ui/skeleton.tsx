/**
 * Loading placeholder block (DESIGN.md "Trạng thái tải"): a `surface-2` shape that pulses gently,
 * static under prefers-reduced-motion. Always decorative; the surrounding region carries
 * aria-busy and one sr-only "Đang tải…" line.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none ${className}`} />;
}

/** The region wrapper for a loading screen: one announcement, then the shapes. */
export function LoadingRegion({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
