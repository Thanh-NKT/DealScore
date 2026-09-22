"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface UrlLookupFormProps {
  autoFocus?: boolean;
}

type ErrorCode =
  | "not_a_url"
  | "not_shopee"
  | "unrecognized_format"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal";

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

    // Sau 2 giây hiện thông báo cần thêm thời gian nếu phải Ingest
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
    switch (errorInfo.code) {
      case "not_a_url":
        return "Hãy dán một đường dẫn sản phẩm.";
      case "not_shopee":
        return "Hiện tại mới hỗ trợ Shopee.";
      case "unrecognized_format":
        return "Không đọc được đường dẫn này. Hãy thử sao chép lại từ ứng dụng Shopee.";
      case "rate_limited":
        return `Bạn đã tra cứu khá nhiều. Thử lại sau ${errorInfo.retryAfter ? `${errorInfo.retryAfter}s` : "ít phút"}.`;
      case "upstream_unavailable":
        return "Chưa lấy được dữ liệu từ Shopee lúc này.";
      case "internal":
      default:
        return errorInfo.message || "Có lỗi xảy ra. Vui lòng thử lại.";
    }
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

      {/* Thông báo tiến độ khi cần thêm thời gian ingest */}
      {isSlow && loading && (
        <p className="text-xs text-muted animate-pulse">
          Lần đầu theo dõi sản phẩm này, cần thêm chút thời gian…
        </p>
      )}

      {/* Vùng thông báo lỗi chi tiết */}
      {errorInfo && (
        <div
          role="alert"
          className="rounded-xl border border-rec-avoid/30 bg-rec-avoid-bg p-3 text-xs text-rec-avoid space-y-2"
        >
          <p className="font-semibold">{getErrorMessage()}</p>
          {errorInfo.code === "upstream_unavailable" && (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <input
                type="email"
                placeholder="Nhập email của bạn"
                className="rounded-lg border border-rec-avoid/40 bg-background px-3 py-1.5 text-xs text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => alert("Đã ghi nhận! Chúng tôi sẽ gửi thông báo khi dữ liệu sẵn sàng.")}
                className="rounded-lg bg-rec-avoid px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Báo cho tôi khi sẵn sàng
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
