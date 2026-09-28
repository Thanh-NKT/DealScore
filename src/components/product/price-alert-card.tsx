"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatVnd } from "@/lib/format";
import { TargetIcon } from "@/components/ui/icons";
import { parseVndInput } from "@/components/watch/price-input";

interface PriceAlertCardProps {
  variantId: string;
  currentPrice: number | null;
  lowestPrice?: number | null;
  initialTarget?: number | null;
  isLoggedIn: boolean;
  currentPath: string;
}

export function PriceAlertCard({
  variantId,
  currentPrice,
  lowestPrice,
  initialTarget,
  isLoggedIn,
  currentPath,
}: PriceAlertCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const cur = currentPrice && currentPrice > 0 ? currentPrice : 1600000;
  const lo = lowestPrice && lowestPrice > 0 ? lowestPrice : Math.round(cur * 0.9);

  const defaultTarget = initialTarget && initialTarget > 0 ? initialTarget : Math.round(cur * 0.95);
  const [targetVal, setTargetVal] = useState<number>(defaultTarget);
  const [targetStr, setTargetStr] = useState<string>(formatVnd(defaultTarget).replace(/đ$/, ""));
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Gap calculations
  const gap = cur - targetVal;
  const gapPct = cur > 0 ? (gap / cur) * 100 : 0;
  const closePct = Math.min(100, Math.max(0, Math.round(100 - gapPct)));

  const handleInputChange = (raw: string) => {
    setTargetStr(raw);
    const parsed = parseVndInput(raw);
    if (parsed.ok && parsed.value > 0) {
      setTargetVal(parsed.value);
    }
  };

  const setPreset = (pctDrop: number) => {
    const val = Math.round((cur * (1 - pctDrop)) / 10000) * 10000;
    setTargetVal(val);
    setTargetStr(formatVnd(val).replace(/đ$/, ""));
  };

  const setPresetLowest = () => {
    setTargetVal(lo);
    setTargetStr(formatVnd(lo).replace(/đ$/, ""));
  };

  const handleSave = async () => {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(currentPath)}`);
      return;
    }

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("variantId", variantId);
        formData.set("path", currentPath);
        formData.set("targetPrice", String(targetVal));
        formData.set("triggerDealScore", "true");

        const res = await fetch("/api/extension/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId,
            targetPrice: targetVal,
            triggerDealScore: true,
          }),
        }).catch(() => null);

        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      } catch {
        // fallback
      }
    });
  };

  return (
    <div className="flex flex-col gap-4.5 rounded-[20px] border border-line bg-surface p-6 text-ink sm:p-7">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-soft text-primary">
          <TargetIcon className="size-5.5" strokeWidth={2.4} />
        </span>
        <div className="flex flex-col">
          <h2 className="display text-[22px] font-bold tracking-tight text-ink">Đặt giá mong muốn</h2>
          <span className="text-[13px] text-ink-3">Kairo báo cho bạn khi giá xuống tới mức này</span>
        </div>
      </div>

      {/* Target Price Input */}
      <div className="flex h-[58px] items-center rounded-[12px] border border-line-strong bg-surface-2/45 px-4.5 text-ink transition-all focus-within:border-primary focus-within:bg-surface focus-within:ring-2 focus-within:ring-primary/20">
        <label htmlFor="target-price-input" className="sr-only">
          Giá mong muốn
        </label>
        <input
          id="target-price-input"
          type="text"
          inputMode="numeric"
          value={targetStr}
          onChange={(e) => handleInputChange(e.target.value)}
          className="num display w-full min-w-0 flex-1 border-none bg-transparent text-[24px] font-bold tracking-tight text-ink outline-none"
        />
        <span className="text-[18px] font-bold text-ink-2">đ</span>
      </div>

      {/* Preset Pills */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPreset(0.05)}
          className="h-10 flex-1 rounded-full border border-line bg-surface-2/55 px-3 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2 cursor-pointer"
        >
          −5%
        </button>
        <button
          type="button"
          onClick={() => setPreset(0.1)}
          className="h-10 flex-1 rounded-full border border-line bg-surface-2/55 px-3 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2 cursor-pointer"
        >
          −10%
        </button>
        <button
          type="button"
          onClick={setPresetLowest}
          className="h-10 flex-[1.4] rounded-full border border-line bg-surface-2/55 px-3 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2 cursor-pointer"
        >
          Bằng giá thấp nhất
        </button>
      </div>

      {/* Target Progress / Status Box */}
      <div className="flex flex-col gap-2 rounded-[12px] border border-line/80 bg-surface-2/45 p-3.5 text-[13px] sm:p-4">
        <div className="flex justify-between">
          <span className="text-ink-2">Giá hiện tại</span>
          <strong className="num font-bold text-ink">{formatVnd(cur)}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-2">
            {gap > 0 ? "Cần giảm thêm" : "Đã đạt mức giá này"}
          </span>
          <strong className={`num font-bold ${gap > 0 ? "text-primary" : "text-buy"}`}>
            {gap > 0 ? formatVnd(gap) : "Đạt mục tiêu!"}
          </strong>
        </div>

        {/* Progress Bar */}
        <div
          role="progressbar"
          aria-label="Mức gần với giá mong muốn"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={closePct}
          className="h-1.5 w-full overflow-hidden rounded-full bg-line"
        >
          <div
            style={{ width: `${closePct}%` }}
            className="h-full rounded-full bg-primary transition-all duration-300"
          />
        </div>

        <span className="text-[12px] leading-relaxed text-ink-3">
          {gap > 0
            ? `Cần giảm khoảng ${Math.round(gapPct)}% nữa. Trong 90 ngày qua sản phẩm từng chạm mức này.`
            : "Giá hiện tại đang thấp hơn hoặc bằng mức bạn muốn mua!"}
        </span>
      </div>

      {/* Channel Toggles */}
      <div className="flex flex-col gap-1 text-[13px] text-ink-2">
        <label className="flex min-h-10 items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            defaultChecked
            className="size-4.5 rounded-[4px] accent-primary cursor-pointer"
          />
          <span>Gửi email và thông báo trình duyệt</span>
        </label>
        <label className="flex min-h-10 items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            defaultChecked
            className="size-4.5 rounded-[4px] accent-primary cursor-pointer"
          />
          <span>Báo khi Deal Score từ 75 trở lên</span>
        </label>
      </div>

      {/* CTA Button */}
      <button
        type="button"
        disabled={pending}
        onClick={handleSave}
        className="flex h-[52px] w-full items-center justify-center rounded-[12px] bg-primary px-6 text-[16px] font-bold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover cursor-pointer disabled:opacity-50"
      >
        {savedSuccess
          ? "✓ Đã bật cảnh báo"
          : pending
            ? "Đang lưu…"
            : "Bật cảnh báo giá này"}
      </button>
    </div>
  );
}
