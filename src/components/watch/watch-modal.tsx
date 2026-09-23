"use client";

import { useActionState, useState } from "react";
import {
  saveWatch,
  setWatchStatus,
  deleteWatch,
  type WatchActionResult,
} from "@/actions/watch";
import { formatVnd } from "@/lib/format";
import { suggestTargetPrice } from "@/lib/watch/form";
import type { WatchConfig } from "@/lib/watch/types";

interface WatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  variantKey: string;
  variantId: string;
  currentPrice: number | null;
  existingWatch?: {
    id: string;
    config: WatchConfig;
    status: string;
  } | null;
  currentPath: string;
}

export function WatchModal({
  isOpen,
  onClose,
  productName,
  variantKey,
  variantId,
  currentPrice,
  existingWatch,
  currentPath,
}: WatchModalProps) {
  const [state, formAction, isSaving] = useActionState(
    saveWatch,
    { status: "idle" } as WatchActionResult,
  );

  const [isDeleting, setIsDeleting] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  // Khởi tạo các trạng thái checkbox điều kiện
  const initialConfig = existingWatch?.config;
  const suggestedTarget = suggestTargetPrice(currentPrice);

  const [enableTarget, setEnableTarget] = useState(
    initialConfig ? initialConfig.targetPrice !== null : true,
  );
  const [targetPrice, setTargetPrice] = useState<string>(
    initialConfig?.targetPrice
      ? String(initialConfig.targetPrice)
      : suggestedTarget
        ? String(suggestedTarget)
        : "",
  );

  const [enableDropPct, setEnableDropPct] = useState(
    initialConfig ? initialConfig.dropPct !== null : false,
  );
  const [dropPct, setDropPct] = useState<string>(
    initialConfig?.dropPct ? String(initialConfig.dropPct) : "10",
  );

  const [notifyLow, setNotifyLow] = useState(
    initialConfig ? initialConfig.notifyLow : false,
  );

  const [enableScore, setEnableScore] = useState(
    initialConfig ? initialConfig.minDealScore !== null : false,
  );
  const [minDealScore, setMinDealScore] = useState<string>(
    initialConfig?.minDealScore ? String(initialConfig.minDealScore) : "80",
  );

  const [notifyBackInStock, setNotifyBackInStock] = useState(
    initialConfig ? initialConfig.notifyBackInStock : false,
  );

  const [channelMode, setChannelMode] = useState<string>(() => {
    if (!initialConfig?.channels) return "account";
    if (
      initialConfig.channels.includes("email") &&
      initialConfig.channels.includes("push")
    )
      return "both";
    if (initialConfig.channels.includes("email")) return "email";
    if (initialConfig.channels.includes("push")) return "push";
    return "account";
  });

  if (!isOpen) return null;

  const errors = state.status === "error" ? state.errors : {};
  const isSaved = state.status === "saved";

  const handleDelete = async () => {
    if (!existingWatch) return;
    if (confirm("Bạn có chắc chắn muốn xóa theo dõi sản phẩm này không?")) {
      setIsDeleting(true);
      try {
        await deleteWatch(existingWatch.id);
        onClose();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Lỗi khi xóa");
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const handleToggleStatus = async (newStatus: "active" | "paused" | "done") => {
    if (!existingWatch) return;
    setIsTogglingStatus(true);
    try {
      await setWatchStatus(existingWatch.id, newStatus);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi cập nhật trạng thái");
    } finally {
      setIsTogglingStatus(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="watch-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-border bg-background p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Nút đóng */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-1.5 text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          aria-label="Đóng"
        >
          ✕
        </button>

        <div className="space-y-1 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔔</span>
            <h2
              id="watch-modal-title"
              className="text-lg font-bold tracking-tight text-foreground sm:text-xl"
            >
              {existingWatch ? "Chỉnh sửa theo dõi giá" : "Theo dõi giá sản phẩm"}
            </h2>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            <span className="font-semibold text-foreground">{productName}</span>
            {variantKey && ` · Phiên bản: ${variantKey}`}
          </p>
          {currentPrice && (
            <p className="text-xs text-muted">
              Giá hiện tại:{" "}
              <strong className="text-foreground">
                {formatVnd(currentPrice)}
              </strong>
            </p>
          )}
        </div>

        {isSaved ? (
          <div className="space-y-6 text-center py-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-2xl font-bold">
              ✓
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-foreground">
                Đã lưu theo dõi giá thành công!
              </h3>
              <p className="text-xs text-muted">
                Hệ thống sẽ tự động theo dõi và gửi thông báo khi giá đạt điều
                kiện bạn đã đặt.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-foreground px-6 py-2 text-xs font-semibold text-background hover:opacity-90"
            >
              Hoàn tất
            </button>
          </div>
        ) : (
          <form action={formAction} className="space-y-6">
            <input type="hidden" name="variantId" value={variantId} />
            <input type="hidden" name="path" value={currentPath} />

            {/* Báo lỗi tổng quát */}
            {errors._form && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-medium text-red-600 dark:text-red-400">
                {errors._form}
              </div>
            )}

            {/* Các điều kiện báo giá */}
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Điều kiện nhận thông báo (chọn ít nhất 1)
              </span>

              {/* 1. Giá mục tiêu */}
              <div className="rounded-2xl border border-border p-3.5 space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableTarget}
                    onChange={(e) => setEnableTarget(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-foreground accent-foreground"
                  />
                  <span className="text-xs font-semibold text-foreground">
                    Khi giá xuống dưới mức mục tiêu
                  </span>
                </label>
                {enableTarget && (
                  <div className="pl-7 space-y-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        name="targetPrice"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        placeholder="Ví dụ: 1.200.000"
                        className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                      />
                      <span className="text-xs text-muted shrink-0">₫</span>
                    </div>
                    {suggestedTarget && (
                      <p className="text-[11px] text-muted">
                        Gợi ý (−10%): {formatVnd(suggestedTarget)}
                      </p>
                    )}
                    {errors.targetPrice && (
                      <p className="text-xs text-red-500">
                        {errors.targetPrice}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 2. Giảm theo % */}
              <div className="rounded-2xl border border-border p-3.5 space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableDropPct}
                    onChange={(e) => setEnableDropPct(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-foreground accent-foreground"
                  />
                  <span className="text-xs font-semibold text-foreground">
                    Khi giá giảm thêm theo %
                  </span>
                </label>
                {enableDropPct && (
                  <div className="pl-7 space-y-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        name="dropPct"
                        min={1}
                        max={90}
                        value={dropPct}
                        onChange={(e) => setDropPct(e.target.value)}
                        placeholder="10"
                        className="w-24 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                      />
                      <span className="text-xs text-muted">
                        % so với lúc tạo theo dõi
                      </span>
                    </div>
                    {errors.dropPct && (
                      <p className="text-xs text-red-500">{errors.dropPct}</p>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Chạm đáy 90 ngày */}
              <div className="rounded-2xl border border-border p-3.5">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="notifyLow"
                    checked={notifyLow}
                    onChange={(e) => setNotifyLow(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-foreground accent-foreground"
                  />
                  <div>
                    <span className="text-xs font-semibold text-foreground">
                      Chạm mức giá đáy 90 ngày
                    </span>
                    <p className="text-[11px] text-muted">
                      Chỉ báo khi có tối thiểu 14 ngày và 10 quan sát lịch sử giá
                    </p>
                  </div>
                </label>
              </div>

              {/* 4. Deal Score */}
              <div className="rounded-2xl border border-border p-3.5 space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableScore}
                    onChange={(e) => setEnableScore(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-foreground accent-foreground"
                  />
                  <span className="text-xs font-semibold text-foreground">
                    Khi Deal Score đạt mức cao
                  </span>
                </label>
                {enableScore && (
                  <div className="pl-7 space-y-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        name="minDealScore"
                        min={1}
                        max={100}
                        value={minDealScore}
                        onChange={(e) => setMinDealScore(e.target.value)}
                        placeholder="80"
                        className="w-24 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                      />
                      <span className="text-xs text-muted">/ 100 điểm</span>
                    </div>
                    {errors.minDealScore && (
                      <p className="text-xs text-red-500">
                        {errors.minDealScore}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 5. Có hàng lại */}
              <div className="rounded-2xl border border-border p-3.5">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="notifyBackInStock"
                    checked={notifyBackInStock}
                    onChange={(e) => setNotifyBackInStock(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-foreground accent-foreground"
                  />
                  <div>
                    <span className="text-xs font-semibold text-foreground">
                      Khi có hàng trở lại
                    </span>
                    <p className="text-[11px] text-muted">
                      Báo khi sản phẩm từ trạng thái hết hàng chuyển sang còn
                      hàng
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Kênh thông báo ghi đè */}
            <div className="space-y-2 pt-2 border-t border-border">
              <label className="text-xs font-bold uppercase tracking-wider text-muted">
                Kênh nhận cảnh báo
              </label>
              <select
                value={channelMode}
                onChange={(e) => setChannelMode(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                <option value="account">
                  Theo cài đặt tài khoản (Mặc định)
                </option>
                <option value="email">Chỉ gửi qua Email</option>
                <option value="push">Chỉ gửi qua Web Push</option>
                <option value="both">Gửi cả Email và Web Push</option>
              </select>

              {/* Input ngầm gửi channel theo mode */}
              {channelMode === "account" && (
                <input type="hidden" name="channel" value="account" />
              )}
              {channelMode === "email" && (
                <input type="hidden" name="channel" value="email" />
              )}
              {channelMode === "push" && (
                <input type="hidden" name="channel" value="push" />
              )}
              {channelMode === "both" && (
                <>
                  <input type="hidden" name="channel" value="email" />
                  <input type="hidden" name="channel" value="push" />
                </>
              )}
            </div>

            {/* Các nút bấm */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">
              {existingWatch ? (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {existingWatch.status === "active" ? (
                    <button
                      type="button"
                      disabled={isTogglingStatus}
                      onClick={() => handleToggleStatus("paused")}
                      className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground"
                    >
                      Tạm dừng
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isTogglingStatus}
                      onClick={() => handleToggleStatus("active")}
                      className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                    >
                      Kích hoạt lại
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={handleDelete}
                    className="rounded-xl border border-red-500/20 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10"
                  >
                    Xóa
                  </button>
                </div>
              ) : (
                <div></div>
              )}

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted hover:text-foreground"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-xl bg-foreground px-5 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50"
                >
                  {isSaving ? "Đang lưu..." : "Lưu theo dõi"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
