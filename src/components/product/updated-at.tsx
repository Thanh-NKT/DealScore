"use client";

import { useSyncExternalStore } from "react";

interface UpdatedAtProps {
  iso: string | null;
  isStale?: boolean;
}

function timeAgo(dateString: string): string {
  const d = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 60) return "vừa xong";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} ngày trước`;
  return d.toLocaleDateString("vi-VN");
}

function formatAbsolute(dateString: string): string {
  try {
    const d = new Date(dateString);
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return dateString;
  }
}

const emptySubscribe = () => () => {};

export function UpdatedAt({ iso, isStale = false }: UpdatedAtProps) {
  // useSyncExternalStore detects client mount without cascading renders or a hydration mismatch
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  if (!iso) {
    return <span>Chưa có dữ liệu</span>;
  }

  const absolute = formatAbsolute(iso);
  const textToShow = isMounted ? timeAgo(iso) : absolute;

  return (
    <time
      dateTime={iso}
      title={`Cập nhật lúc ${absolute}`}
      className={`inline-flex items-center gap-1 ${
        isStale ? "font-medium text-warn" : ""
      }`}
    >
      <span>{textToShow}</span>
      {isStale && (
        <span className="text-[10px] text-warn opacity-90">
          (Dữ liệu có thể đã cũ)
        </span>
      )}
    </time>
  );
}
