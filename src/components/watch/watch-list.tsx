"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatVnd } from "@/lib/format";
import { setWatchStatus, deleteWatch } from "@/actions/watch";
import { WatchModal } from "@/components/watch/watch-modal";
import type { MyWatchItem } from "@/lib/watch/queries";
import type { ConditionKey } from "@/lib/watch/types";

interface WatchListProps {
  initialItems: MyWatchItem[];
}

const CONDITION_LABELS: Record<ConditionKey, string> = {
  target_price: "Giá mục tiêu",
  drop_pct: "Giảm theo %",
  low: "Đáy 90 ngày",
  deal_score: "Deal Score cao",
  back_in_stock: "Có hàng lại",
};

export function WatchList({ initialItems }: WatchListProps) {
  const [activeTab, setActiveTab] = useState<"active" | "paused" | "done">("active");
  const [editingWatch, setEditingWatch] = useState<MyWatchItem | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredItems = initialItems.filter((item) => item.status === activeTab);

  const activeCount = initialItems.filter((i) => i.status === "active").length;
  const pausedCount = initialItems.filter((i) => i.status === "paused").length;
  const doneCount = initialItems.filter((i) => i.status === "done").length;

  const handleStatusChange = (watchId: string, newStatus: "active" | "paused" | "done") => {
    startTransition(async () => {
      try {
        await setWatchStatus(watchId, newStatus);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Lỗi cập nhật trạng thái");
      }
    });
  };

  const handleDelete = (watchId: string) => {
    if (confirm("Bạn có chắc chắn muốn xóa theo dõi sản phẩm này?")) {
      startTransition(async () => {
        try {
          await deleteWatch(watchId);
        } catch (err) {
          alert(err instanceof Error ? err.message : "Lỗi khi xóa");
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Status tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("active")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "active"
              ? "bg-foreground text-background"
              : "text-muted hover:text-foreground"
          }`}
        >
          <span>Đang theo dõi</span>
          <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-0.5 text-[10px]">
            {activeCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("paused")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "paused"
              ? "bg-foreground text-background"
              : "text-muted hover:text-foreground"
          }`}
        >
          <span>Tạm dừng</span>
          <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-0.5 text-[10px]">
            {pausedCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("done")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
            activeTab === "done"
              ? "bg-foreground text-background"
              : "text-muted hover:text-foreground"
          }`}
        >
          <span>Đã mua</span>
          <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-0.5 text-[10px]">
            {doneCount}
          </span>
        </button>
      </div>

      {/* Watch list */}
      {filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5 text-2xl">
            {activeTab === "active" ? "🔔" : activeTab === "paused" ? "⏸" : "🛍"}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {activeTab === "active"
                ? "Chưa có sản phẩm nào đang theo dõi"
                : activeTab === "paused"
                  ? "Không có sản phẩm nào bị tạm dừng"
                  : "Chưa có sản phẩm nào đánh dấu đã mua"}
            </h3>
            <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
              {activeTab === "active"
                ? "Duyệt tìm sản phẩm và bấm nút 'Theo dõi giá' để nhận thông báo ngay khi giá giảm."
                : "Các sản phẩm bạn tạm dừng nhận cảnh báo hoặc đã mua sẽ xuất hiện tại đây."}
            </p>
          </div>
          {activeTab === "active" && (
            <Link
              href="/search"
              className="inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90"
            >
              Tìm sản phẩm ngay →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredItems.map((item) => {
            const { view, product, variant, config } = item;
            const productHref = `/${product.categorySlug}/${product.slug}?variant=${variant.id}`;

            return (
              <div
                key={item.id}
                // Alert emails link to /account/watch#{watchId} — the anchor scrolls to that Watch.
                id={item.id}
                className="scroll-mt-6 flex flex-col md:flex-row md:items-center justify-between gap-6 rounded-3xl border border-border bg-black/[0.01] p-5 sm:p-6 shadow-sm dark:bg-white/[0.01]"
              >
                {/* Product info */}
                <div className="flex items-start gap-4 flex-1">
                  {product.image && (
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border bg-black/5 dark:bg-white/5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5 flex-1 min-w-0">
                    <Link
                      href={productHref}
                      className="text-sm font-bold text-foreground hover:underline line-clamp-1"
                    >
                      {product.name}
                    </Link>

                    {variant.key && (
                      <p className="text-xs text-muted truncate">
                        Phiên bản: {variant.key}
                      </p>
                    )}

                    {/* Price & distance to target */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {view.price !== null ? (
                        <span className="font-bold text-foreground">
                          {formatVnd(view.price)}
                        </span>
                      ) : (
                        <span className="text-muted font-medium">
                          Tạm hết hàng
                        </span>
                      )}

                      {view.target && (
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            view.target.reached
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-black/5 text-muted dark:bg-white/5"
                          }`}
                        >
                          {view.target.reached
                            ? "✓ Đã đạt giá mục tiêu"
                            : `Còn ${formatVnd(view.target.gap)} (${Math.round(
                                view.target.gapPct * 100,
                              )}%)`}
                        </span>
                      )}

                      {view.changeSinceStart && view.changeSinceStart.amount !== 0 && (
                        <span className="text-[11px] text-muted">
                          {view.changeSinceStart.amount < 0 ? "↓" : "↑"}{" "}
                          {Math.abs(Math.round(view.changeSinceStart.pct * 100))}%
                          từ lúc bắt đầu
                        </span>
                      )}
                    </div>

                    {/* Condition status chips */}
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {view.conditions.map((c) => (
                        <span
                          key={c.key}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                            c.state === true
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : c.state === "unknown"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "bg-black/5 text-muted dark:bg-white/5"
                          }`}
                        >
                          <span>
                            {c.state === true
                              ? "●"
                              : c.state === "unknown"
                                ? "○"
                                : "·"}
                          </span>
                          <span>{CONDITION_LABELS[c.key]}</span>
                        </span>
                      ))}
                    </div>

                    {/* Latest alert status */}
                    <div className="pt-1 text-[11px] text-muted">
                      {view.alertStatus.kind === "sent" ? (
                        <span>
                          Đã gửi cảnh báo qua {view.alertStatus.channels.join(", ")}
                        </span>
                      ) : view.alertStatus.kind === "scheduled" ? (
                        <span>
                          Chờ gửi lúc{" "}
                          {new Date(
                            view.alertStatus.deliverAfter,
                          ).toLocaleTimeString("vi-VN", {
                            timeZone: "Asia/Ho_Chi_Minh",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          ({view.alertStatus.reason === "daily_digest"
                            ? "tóm tắt hằng ngày"
                            : "sau giờ im lặng"})
                        </span>
                      ) : (
                        <span>Chưa có cảnh báo nào</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap md:flex-col items-center md:items-end justify-between gap-2 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-6 shrink-0">
                  {/* Buy on Shopee button */}
                  <a
                    href={`/go/shopee/offer?src=web&watch=${item.id}`}
                    target="_blank"
                    rel="nofollow sponsored noopener"
                    className="inline-flex items-center justify-center rounded-xl bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90 transition-opacity"
                  >
                    Mua trên Shopee ↗
                  </a>

                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setEditingWatch(item)}
                      className="rounded-lg px-2 py-1 text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      Sửa
                    </button>

                    {item.status === "active" ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleStatusChange(item.id, "paused")}
                        className="rounded-lg px-2 py-1 text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        Tạm dừng
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleStatusChange(item.id, "active")}
                        className="rounded-lg px-2 py-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                      >
                        Tiếp tục
                      </button>
                    )}

                    {item.status !== "done" && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleStatusChange(item.id, "done")}
                        className="rounded-lg px-2 py-1 text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        Đã mua
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDelete(item.id)}
                      className="rounded-lg px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Watch modal */}
      {editingWatch && (
        <WatchModal
          isOpen={Boolean(editingWatch)}
          onClose={() => setEditingWatch(null)}
          productName={editingWatch.product.name}
          variantKey={editingWatch.variant.key}
          variantId={editingWatch.variant.id}
          currentPrice={editingWatch.view.price}
          existingWatch={{
            id: editingWatch.id,
            config: editingWatch.config,
            status: editingWatch.status,
          }}
          currentPath="/account/watch"
        />
      )}
    </div>
  );
}
