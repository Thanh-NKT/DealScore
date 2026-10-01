"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lookupErrorMessage, type LookupErrorCode } from "@/lib/lookup/messages";
import { normalizeLookupInput } from "@/lib/shopee/parse-url";
import { parseProductUrl } from "@/lib/marketplaces";

export type LookupProblem = {
  code: LookupErrorCode | "timeout" | "offline";
  retryAfter?: number;
  /** Marketplace we recognised but don't read yet ("TikTok Shop", "Lazada"…). */
  market?: string;
};

/** Give up after this; a first-time ingest usually answers well within it. */
const TIMEOUT_MS = 25_000;

const OTHER_MARKETS: Array<[RegExp, string]> = [
  [/(^|\.)tiktok\.com$/i, "TikTok Shop"],
  [/(^|\.)lazada\.vn$|(^|\.)lzd\.co$/i, "Lazada"],
  [/(^|\.)tiki\.vn$/i, "Tiki"],
  [/(^|\.)sendo\.vn$/i, "Sendo"],
];

export function marketOf(input: string): string | undefined {
  try {
    const host = new URL(normalizeLookupInput(input)).hostname;
    return OTHER_MARKETS.find(([re]) => re.test(host))?.[1];
  } catch {
    return undefined;
  }
}

/** Does this input look like a link at all (so it must not be sent to keyword search)? */
export function looksLikeLink(input: string): boolean {
  const t = input.trim();
  return /https?:\/\//i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(t);
}

/** true when the input is a product link or short link of a marketplace Kairo recognises (the server decides if it can read it). */
export function isLookupable(input: string): boolean {
  if (!input.trim()) return false;
  const parsed = parseProductUrl(normalizeLookupInput(input));
  return parsed.ok || parsed.reason === "needs_redirect";
}

/** Client-side syntax check before calling the server; null when the link may be sent. */
export function precheckLookup(raw: string): LookupProblem | null {
  const parsed = parseProductUrl(normalizeLookupInput(raw));
  if (parsed.ok || parsed.reason === "needs_redirect") return null;
  const market = marketOf(raw);
  // A non-product link on a marketplace we don't read (TikTok video, Lazada category…) is "not Shopee", not a bad Shopee link.
  const code: LookupErrorCode =
    parsed.reason === "not_supported"
      ? looksLikeLink(raw) ? "not_shopee" : "not_a_url"
      : parsed.reason === "unrecognized_format" && market
        ? "not_shopee"
        : parsed.reason;
  return { code, market: code === "not_shopee" ? market : undefined };
}

/** What went wrong, then what to do next — one calm sentence each. */
export function explainLookup(p: LookupProblem): { what: string; next: string | null } {
  switch (p.code) {
    case "not_a_url":
      return { what: "Đây chưa phải một đường dẫn.", next: "Dán link sản phẩm, ví dụ shopee.vn/… hoặc shope.ee/…, hoặc tìm theo tên sản phẩm." };
    case "not_shopee":
      return {
        what: p.market ? `Kairo hiện mới đọc được link Shopee, chưa đọc được link ${p.market}.` : lookupErrorMessage("not_shopee"),
        next: "Bạn có thể tìm sản phẩm này theo tên.",
      };
    case "unrecognized_format":
      return {
        what: "Đây là link Shopee nhưng không trỏ tới một sản phẩm (có thể là link cửa hàng hoặc danh mục).",
        next: "Trong ứng dụng Shopee, mở sản phẩm → Chia sẻ → Sao chép liên kết, rồi dán lại.",
      };
    case "rate_limited":
      return { what: lookupErrorMessage("rate_limited", p.retryAfter), next: null };
    case "upstream_unavailable":
      return {
        what: "Chưa lấy được dữ liệu sản phẩm từ Shopee.",
        next: "Sản phẩm có thể đã bị gỡ, hoặc Shopee đang phản hồi chậm. Thử lại sau ít phút.",
      };
    case "timeout":
      return { what: "Shopee phản hồi quá lâu nên Kairo đã dừng chờ.", next: "Thử lại sau ít phút; lần sau thường nhanh hơn." };
    case "offline":
      return { what: "Máy bạn đang mất kết nối mạng.", next: "Kiểm tra kết nối rồi thử lại." };
    default:
      return { what: "Chưa kiểm tra được đường dẫn này do lỗi hệ thống.", next: "Thử lại, hoặc tìm sản phẩm theo tên." };
  }
}

/** A function, not an inline check, so TypeScript doesn't narrow onLine across the await. */
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export const RETRYABLE_LOOKUP = new Set<LookupProblem["code"]>(["upstream_unavailable", "timeout", "offline", "internal"]);

/**
 * Paste-a-link lookup shared by the home form and the search box: client-side check first,
 * then /api/lookup with a cancellable timeout and staged "still working" messages.
 */
export function useLookup() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState<0 | 1 | 2>(0);
  const [problem, setProblem] = useState<LookupProblem | null>(null);
  const [navigating, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // Abandon an in-flight lookup when the component goes away.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const finish = (p: LookupProblem | null) => {
    clearTimers();
    abortRef.current = null;
    setLoading(false);
    setSlow(0);
    setProblem(p);
  };

  const run = async (input: string) => {
    const raw = input.trim();
    if (!raw || abortRef.current) return;

    const pre = precheckLookup(raw);
    if (pre) {
      setProblem(pre);
      return;
    }
    if (isOffline()) {
      setProblem({ code: "offline" });
      return;
    }

    setLoading(true);
    setProblem(null);
    const controller = new AbortController();
    abortRef.current = controller;
    timers.current = [
      window.setTimeout(() => setSlow(1), 2_000),
      window.setTimeout(() => setSlow(2), 10_000),
      window.setTimeout(() => controller.abort("timeout"), TIMEOUT_MS),
    ];

    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data && (data.status === "ok" || data.status === "ingested") && typeof data.productUrl === "string") {
        clearTimers();
        abortRef.current = null;
        startTransition(() => router.push(data.productUrl));
        return;
      }
      const retryHeader = Number(res.headers.get("Retry-After"));
      finish({
        code: (data?.code as LookupErrorCode) ?? (res.status === 429 ? "rate_limited" : "internal"),
        retryAfter: data?.retryAfter ?? (retryHeader > 0 ? retryHeader : undefined),
        market: typeof data?.market === "string" ? data.market : undefined,
      });
    } catch {
      if (controller.signal.aborted) {
        // Cancelled by the user: back to idle, no error. Timed out: say so.
        finish(controller.signal.reason === "timeout" ? { code: "timeout" } : null);
        return;
      }
      finish({ code: isOffline() ? "offline" : "internal" });
    }
  };

  return {
    loading,
    navigating,
    slow,
    problem,
    run,
    cancel: () => abortRef.current?.abort("cancel"),
    clearProblem: () => setProblem(null),
    showProblem: setProblem,
  };
}

export function slowMessage(slow: 0 | 1 | 2): string {
  return slow === 0
    ? "Đang kiểm tra đường dẫn…"
    : slow === 1
      ? "Lần đầu theo dõi sản phẩm này, Kairo đang lấy dữ liệu từ Shopee…"
      : "Vẫn đang chờ Shopee trả dữ liệu. Bạn có thể chờ thêm hoặc bấm Hủy.";
}
