"use client";

import { useSyncExternalStore } from "react";
import { STALE_HOURS } from "@/lib/watch/constants";
import { AlertIcon, ClockIcon } from "@/components/ui/icons";

interface UpdatedAtProps {
  iso: string | null;
  /** Server's verdict (pricing.isStale). When omitted, staleness is judged from the client clock. */
  isStale?: boolean;
  /** "compact": one short line for cards; "default": the freshness stamp beside the product name. */
  variant?: "default" | "compact";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** After this the price is shown as "may have changed" (aging state). */
const AGING_HOURS = 6;

// Minute-resolution clock shared by every stamp: re-renders once a minute, never per frame.
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, MINUTE);
  return () => window.clearInterval(id);
}
const clientMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const serverMinute = () => null;

function parse(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatAbsolute(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** "5 phút trước", "3 giờ trước", "2 ngày trước"; older than 30 days → "ngày 12/08/2026". */
function relative(d: Date, now: number): string {
  const diff = now - d.getTime();
  // A timestamp slightly in the future is clock skew between servers, not time travel.
  if (diff < MINUTE) return "vừa xong";
  const min = Math.floor(diff / MINUTE);
  if (min < 60) return `${min} phút trước`;
  const hours = Math.floor(diff / HOUR);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} ngày trước`;
  return `ngày ${formatDate(d)}`;
}

/**
 * Freshness stamp (PRODUCT.md: always say when data was updated). Three states, told by words and
 * stroke rather than a warning colour:
 * fresh (clock, ink-3) → aging after 6h ("giá có thể đã thay đổi") → stale after 48h (dashed box,
 * alert icon, "hãy kiểm tra lại trên sàn"). The server renders the absolute time; the client swaps
 * in relative time after hydration and keeps it current once a minute.
 */
export function UpdatedAt({ iso, isStale, variant = "default" }: UpdatedAtProps) {
  const now = useSyncExternalStore(subscribeClock, clientMinute, serverMinute);
  const date = parse(iso);

  if (!date) {
    return <span className="text-ink-3">{iso ? "Chưa rõ thời điểm cập nhật" : "Chưa có dữ liệu cập nhật"}</span>;
  }

  const absolute = formatAbsolute(date);
  const ageHours = now != null ? (now - date.getTime()) / HOUR : null;
  const stale = isStale ?? (ageHours != null && ageHours > STALE_HOURS);
  const aging = !stale && ageHours != null && ageHours > AGING_HOURS;
  const when = now != null ? relative(date, now) : `lúc ${absolute}`;
  const time = (
    <time dateTime={date.toISOString()} title={`Cập nhật lúc ${absolute}`}>
      Cập nhật {when}
    </time>
  );

  if (variant === "compact") {
    return (
      <span className={`inline-flex items-center gap-1 ${stale ? "text-ink-2" : ""}`}>
        {stale && <AlertIcon className="size-3.5" />}
        {time}
        {stale && <span>· có thể đã cũ</span>}
      </span>
    );
  }

  if (stale) {
    return (
      <span role="status" className="inline-flex items-start gap-1.5 rounded-sm border-[1.5px] border-dashed border-line-strong bg-surface px-2.5 py-1.5 text-label font-medium text-ink">
        <AlertIcon className="mt-0.5 size-4" />
        <span>
          {time}. Giá có thể đã khác, hãy kiểm tra lại trên sàn.
        </span>
      </span>
    );
  }

  return (
    // Icon + one text run, so a narrow column wraps it as a sentence instead of two side-by-side columns.
    <span className={`inline-grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-label ${aging ? "text-ink-2" : "text-ink-3"}`}>
      <ClockIcon className="mt-px size-4" />
      <span>
        {time}
        {aging && " · giá có thể đã thay đổi"}
      </span>
    </span>
  );
}
