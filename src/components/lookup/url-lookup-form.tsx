"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { lookupErrorMessage, type LookupErrorCode } from "@/lib/lookup/messages";

interface UrlLookupFormProps {
  autoFocus?: boolean;
}

type ErrorCode = LookupErrorCode;

export function UrlLookupForm({ autoFocus = false }: UrlLookupFormProps) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSlow, setIsSlow] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{
    code: ErrorCode;
    message: string;
    retryAfter?: number;
  } | null>(null);
  const [, startTransition] = useTransition();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setErrorInfo(null);
    setIsSlow(false);

    // After 2 seconds, show a "needs more time" notice in case an ingest is required
    const slowTimer = setTimeout(() => {
      setIsSlow(true);
    }, 2000);

    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      clearTimeout(slowTimer);
      const data = await res.json();

      if (res.ok && (data.status === "ok" || data.status === "ingested")) {
        startTransition(() => {
          router.push(data.productUrl);
        });
      } else {
        setLoading(false);
        setIsSlow(false);
        setErrorInfo({
          code: data.code || "internal",
          message: data.message || "Có lỗi xảy ra. Vui lòng thử lại.",
          retryAfter: data.retryAfter,
        });
      }
    } catch {
      clearTimeout(slowTimer);
      setLoading(false);
      setIsSlow(false);
      setErrorInfo({
        code: "internal",
        message: "Có lỗi xảy ra. Vui lòng thử lại.",
      });
    }
  };

  const getErrorMessage = () => {
    if (!errorInfo) return null;
    // "internal" and unknown codes: use the server-provided message if any.
    if (errorInfo.code === "internal" && errorInfo.message) return errorInfo.message;
    return lookupErrorMessage(errorInfo.code, errorInfo.retryAfter);
  };

  return (
    <div className="w-full space-y-3">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (errorInfo) setErrorInfo(null);
          }}
          autoFocus={autoFocus}
          placeholder="Dán link sản phẩm Shopee (vd: shopee.vn/... hoặc shope.ee/...)"
          disabled={loading}
          className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-1 focus:ring-foreground disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Đang kiểm tra…" : "Kiểm tra giá"}
        </button>
      </form>

      {/* Progress notice when the ingest needs more time */}
      {isSlow && loading && (
        <p className="text-xs text-muted animate-pulse">
          Lần đầu theo dõi sản phẩm này, cần thêm chút thời gian…
        </p>
      )}

      {/* Detailed error area */}
      {errorInfo && (
        <div
          role="alert"
          className="rounded-xl border border-rec-avoid/30 bg-rec-avoid-bg p-3 text-xs text-rec-avoid space-y-2"
        >
          <p className="font-semibold">{getErrorMessage()}</p>
        </div>
      )}
    </div>
  );
}
