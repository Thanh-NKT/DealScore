"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatVnd } from "@/lib/format";
import { saveWatch } from "@/actions/watch";
import type { WatchConfig } from "@/lib/watch/types";
import { CheckIcon, TargetIcon } from "@/components/ui/icons";
import { parseVndInput } from "@/components/watch/price-input";

interface PriceAlertCardProps {
  variantId: string;
  currentPrice: number | null;
  /** Lowest price DealScore recorded in the last 90 days; null when there is no history. */
  lowestPrice?: number | null;
  /** The user's existing watch config for this variant: its other conditions are kept on save. */
  existingConfig?: WatchConfig | null;
  isLoggedIn: boolean;
  currentPath: string;
}

const DEAL_SCORE_THRESHOLD = 75;

const roundTo10k = (v: number) => Math.round(v / 10000) * 10000;
const asInput = (v: number) => formatVnd(v).replace(/đ$/, "");

/**
 * "Đặt giá mong muốn": a quick way to create or update the price watch for this variant.
 * Saves through the same saveWatch() action as the watch dialog and only reports success when the
 * server confirms it. Without a current price or history it never invents one.
 */
export function PriceAlertCard({
  variantId,
  currentPrice,
  lowestPrice,
  existingConfig,
  isLoggedIn,
  currentPath,
}: PriceAlertCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const cur = currentPrice != null && currentPrice > 0 ? currentPrice : null;
  const low = lowestPrice != null && lowestPrice > 0 ? lowestPrice : null;

  const defaultTarget =
    existingConfig?.targetPrice && existingConfig.targetPrice > 0
      ? existingConfig.targetPrice
      : cur != null
        ? roundTo10k(cur * 0.95)
        : null;
  const [targetVal, setTargetVal] = useState<number | null>(defaultTarget);
  const [targetStr, setTargetStr] = useState<string>(defaultTarget != null ? asInput(defaultTarget) : "");
  const [withDealScore, setWithDealScore] = useState<boolean>(
    existingConfig ? existingConfig.minDealScore != null : true,
  );
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({ kind: "idle" });

  const gap = cur != null && targetVal != null ? cur - targetVal : null;
  const gapPct = gap != null && cur ? (gap / cur) * 100 : null;
  const closePct = gapPct != null ? Math.min(100, Math.max(0, Math.round(100 - gapPct))) : 0;

  const pick = (value: number) => {
    setTargetVal(value);
    setTargetStr(asInput(value));
    setStatus({ kind: "idle" });
  };

  const handleInputChange = (raw: string) => {
    setTargetStr(raw);
    setStatus({ kind: "idle" });
    const parsed = parseVndInput(raw);
    setTargetVal(parsed.ok && parsed.value > 0 ? parsed.value : null);
  };

  const handleSave = () => {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(currentPath)}`);
      return;
    }
    if (targetVal == null) {
      setStatus({ kind: "error", message: "Nhập giá mong muốn, ví dụ 2.399.000 hoặc 2tr4." });
      return;
    }

    const form = new FormData();
    form.set("variantId", variantId);
    form.set("path", currentPath);
    form.set("targetPrice", String(targetVal));
    if (withDealScore) form.set("minDealScore", String(DEAL_SCORE_THRESHOLD));
    // Keep the conditions and channels set in the watch dialog; this card only edits its own two.
    if (existingConfig) {
      if (existingConfig.dropPct != null) form.set("dropPct", String(existingConfig.dropPct));
      if (existingConfig.notifyLow) form.set("notifyLow", "true");
      if (existingConfig.notifyBackInStock) form.set("notifyBackInStock", "true");
      if (!withDealScore && existingConfig.minDealScore != null && existingConfig.minDealScore !== DEAL_SCORE_THRESHOLD) {
        form.set("minDealScore", String(existingConfig.minDealScore));
      }
      for (const c of existingConfig.channels ?? []) form.append("channels", c);
    }

    startTransition(async () => {
      try {
        const result = await saveWatch({ status: "idle" }, form);
        if (result.status === "saved") {
          setStatus({ kind: "saved" });
          router.refresh();
        } else if (result.status === "error") {
          const first = Object.values(result.errors)[0];
          setStatus({ kind: "error", message: first ?? "Chưa lưu được. Thử lại sau ít phút." });
        }
      } catch {
        setStatus({ kind: "error", message: "Chưa lưu được do lỗi kết nối. Kiểm tra mạng rồi thử lại." });
      }
    });
  };

  let note: string | null = null;
  if (gap != null && gapPct != null && targetVal != null) {
    if (gap <= 0) note = "Giá hiện tại đã thấp hơn hoặc bằng mức này. DealScore sẽ báo ở lần kiểm tra giá tới.";
    else if (low != null && targetVal >= low)
      note = `Cần giảm khoảng ${Math.max(1, Math.round(gapPct))}% nữa. Trong 90 ngày qua, giá từng xuống tới mức này.`;
    else if (low != null)
      note = `Cần giảm khoảng ${Math.max(1, Math.round(gapPct))}% nữa. Mức này thấp hơn giá thấp nhất DealScore ghi nhận trong 90 ngày, nên có thể phải chờ lâu.`;
    else note = `Cần giảm khoảng ${Math.max(1, Math.round(gapPct))}% nữa.`;
  }

  const PILL =
    "h-10 flex-1 rounded-full border border-line bg-surface-2/55 px-3 text-label font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2 cursor-pointer";

  return (
    <div className="flex flex-col gap-4.5 rounded-lg border border-line bg-surface p-6 text-ink sm:p-7">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <TargetIcon className="size-5.5" strokeWidth={2.4} />
        </span>
        <div className="flex flex-col">
          <h2 className="display text-h3 font-bold tracking-tight text-ink">Đặt giá mong muốn</h2>
          <span className="text-label text-ink-3">DealScore báo cho bạn khi giá xuống tới mức này</span>
        </div>
      </div>

      {/* Target Price Input */}
      <div className="flex h-[58px] items-center rounded-md border border-line-strong bg-surface-2/45 px-4.5 text-ink transition-all focus-within:border-primary focus-within:bg-surface focus-within:ring-1 focus-within:ring-primary">
        <label htmlFor="target-price-input" className="sr-only">
          Giá mong muốn
        </label>
        <input
          id="target-price-input"
          type="text"
          inputMode="numeric"
          value={targetStr}
          placeholder="Ví dụ: 2.399.000"
          onChange={(e) => handleInputChange(e.target.value)}
          className="num display w-full min-w-0 flex-1 border-none bg-transparent text-price-input font-bold tracking-tight text-ink outline-none placeholder:text-body placeholder:font-medium placeholder:text-ink-3"
        />
        <span className="text-title font-bold text-ink-2">đ</span>
      </div>

      {/* Presets: only from real numbers */}
      {(cur != null || low != null) && (
        <div className="flex flex-wrap gap-2">
          {cur != null && (
            <>
              <button type="button" onClick={() => pick(roundTo10k(cur * 0.95))} className={PILL}>
                −5%
              </button>
              <button type="button" onClick={() => pick(roundTo10k(cur * 0.9))} className={PILL}>
                −10%
              </button>
            </>
          )}
          {low != null && (
            <button type="button" onClick={() => pick(low)} className={`${PILL} flex-[1.4]`}>
              Bằng giá thấp nhất 90 ngày
            </button>
          )}
        </div>
      )}

      {/* Target Progress / Status Box */}
      {cur != null && (
        <div className="flex flex-col gap-2 rounded-md border border-line/80 bg-surface-2/45 p-3.5 text-label sm:p-4">
          <div className="flex justify-between">
            <span className="text-ink-2">Giá hiện tại</span>
            <strong className="num font-bold text-ink">{formatVnd(cur)}</strong>
          </div>
          {gap != null && (
            <div className="flex justify-between">
              <span className="text-ink-2">{gap > 0 ? "Cần giảm thêm" : "Đã đạt mức giá này"}</span>
              <strong className={`num font-bold ${gap > 0 ? "text-primary" : "text-buy"}`}>
                {gap > 0 ? formatVnd(gap) : "Đã đạt"}
              </strong>
            </div>
          )}

          <div
            role="progressbar"
            aria-label="Mức gần với giá mong muốn"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={closePct}
            className="h-1.5 w-full overflow-hidden rounded-full bg-line"
          >
            <div style={{ width: `${closePct}%` }} className="h-full rounded-full bg-primary transition-all duration-300" />
          </div>

          {note && <span className="text-micro leading-relaxed text-ink-3">{note}</span>}
        </div>
      )}

      {/* Extra condition + where notifications go */}
      <div className="flex flex-col gap-1 text-label text-ink-2">
        <label className="flex min-h-10 items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={withDealScore}
            onChange={(e) => {
              setWithDealScore(e.target.checked);
              setStatus({ kind: "idle" });
            }}
            className="size-4.5 rounded-xs accent-primary cursor-pointer"
          />
          <span>Báo cả khi Deal Score từ {DEAL_SCORE_THRESHOLD} trở lên</span>
        </label>
        <p className="text-micro leading-relaxed text-ink-3">
          Thông báo gửi qua email hoặc trình duyệt theo{" "}
          <Link href="/account/notifications" className="font-semibold text-primary underline-offset-4 hover:underline">
            cài đặt thông báo
          </Link>{" "}
          của bạn.
        </p>
      </div>

      {status.kind === "error" && status.message && (
        <p role="alert" className="text-label font-semibold text-avoid">
          {status.message}
        </p>
      )}

      {/* CTA Button */}
      <button
        type="button"
        disabled={pending}
        onClick={handleSave}
        className="flex h-13 w-full items-center justify-center gap-2 rounded-md bg-primary px-6 text-body font-bold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover cursor-pointer disabled:opacity-50"
      >
        {status.kind === "saved" ? (
          <>
            <CheckIcon className="size-4.5" strokeWidth={2.5} />
            Đã lưu thông báo giá
          </>
        ) : pending ? (
          "Đang lưu…"
        ) : !isLoggedIn ? (
          "Đăng nhập để nhận thông báo giá"
        ) : existingConfig ? (
          "Cập nhật thông báo giá"
        ) : (
          "Bật thông báo giá"
        )}
      </button>
      <span role="status" className="sr-only">
        {status.kind === "saved" ? "Đã lưu thông báo giá." : ""}
      </span>
    </div>
  );
}
