"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ExternalIcon, RefreshIcon, TicketIcon } from "@/components/ui/icons";
import { UpdatedAt } from "@/components/product/updated-at";
import { marketplaceStyle } from "@/components/product/marketplace";
import { formatVnd } from "@/lib/format";
import { bestCombination, totalsFor } from "@/lib/vouchers/select";
import type { VoucherGroup, VoucherItem } from "@/lib/vouchers/types";

export type { VoucherGroup, VoucherItem } from "@/lib/vouchers/types";

interface VoucherPickerProps {
  productPrice: number | null;
  platform: string;
  /** Voucher groups collected from the marketplace (toGroups). Empty → honest "not collected" card; never generated. */
  groups: VoucherGroup[];
  /** When the vouchers were collected (ISO). */
  collectedAt?: string | null;
  /** Estimated shipping fee, only when known. */
  shipFee?: number | null;
  /** `/go/…` link (click tracking + affiliate); never the raw listing URL. */
  goHref?: string | null;
  /** Offer whose listing the vouchers belong to; enables "Làm mới" (POST /api/vouchers/refresh). */
  refreshOfferId?: string | null;
}

export function VoucherPicker({ productPrice, platform, groups, collectedAt, shipFee, goHref, refreshOfferId }: VoucherPickerProps) {
  const price = productPrice != null && productPrice > 0 ? productPrice : null;
  if (groups.length === 0 || price == null) return <NoVoucherData platform={platform} goHref={goHref} />;
  return (
    <VoucherGroups
      price={price}
      platform={platform}
      groups={groups}
      collectedAt={collectedAt}
      shipFee={shipFee ?? 0}
      goHref={goHref}
      refreshOfferId={refreshOfferId}
    />
  );
}

/** Honest empty state: no voucher of this listing has been collected (or none is active now). */
function NoVoucherData({ platform, goHref }: { platform: string; goHref?: string | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
      <div className="flex items-start gap-3">
        <TicketIcon className="mt-1 size-5.5 shrink-0 text-ink-3" />
        <div className="space-y-1">
          <h2 id="voucher-title" className="display text-h3 font-bold tracking-tight text-ink">
            Mã giảm giá
          </h2>
          <p className="max-w-[68ch] text-body-sm leading-relaxed text-ink-2">
            Kairo chưa thu thập chi tiết mã giảm giá cho sản phẩm này. Giá ở trên là giá chưa áp mã; hãy xem mã đang có
            trên {platform} trước khi thanh toán.
          </p>
        </div>
      </div>
      {goHref && (
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <a
            href={goHref}
            rel="sponsored nofollow noopener"
            target="_blank"
            className={`flex h-11 items-center gap-2 rounded-md px-4 text-body-sm font-semibold transition-colors ${marketplaceStyle(platform).secondaryBtn}`}
          >
            Xem mã trên {platform}
            <ExternalIcon className="size-4" />
          </a>
          <span className="text-micro text-ink-3">Liên kết tiếp thị</span>
        </div>
      )}
    </div>
  );
}

const REFRESH_ERRORS: Record<string, string> = {
  not_configured: "Kairo chưa kết nối được nguồn dữ liệu của sàn để làm mới mã.",
  rate_limited: "Bạn đã làm mới quá nhiều lần. Thử lại sau ít phút.",
  upstream_unavailable: "Sàn chưa phản hồi. Thử lại sau ít phút.",
};

/** Re-read vouchers from the marketplace, then re-render the server page with the new data. */
function RefreshVouchersButton({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vouchers/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      if (res.ok) {
        startTransition(() => router.refresh());
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(REFRESH_ERRORS[body?.error ?? ""] ?? "Chưa làm mới được. Thử lại sau.");
      }
    } catch {
      setError("Chưa làm mới được. Kiểm tra kết nối mạng.");
    } finally {
      setBusy(false);
    }
  };

  const working = busy || pending;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={working}
        aria-busy={working}
        className="flex h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-body-sm font-semibold text-ink transition-colors hover:bg-surface-2 cursor-pointer disabled:cursor-wait disabled:opacity-70"
      >
        <RefreshIcon className={`size-4 ${working ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {working ? "Đang làm mới…" : "Làm mới"}
      </button>
      {error && (
        <span role="status" className="max-w-[32ch] text-right text-micro text-ink-2">
          {error}
        </span>
      )}
    </div>
  );
}

function VoucherGroups({
  price,
  platform,
  groups,
  collectedAt,
  shipFee,
  goHref,
  refreshOfferId,
}: {
  price: number;
  platform: string;
  groups: VoucherGroup[];
  collectedAt?: string | null;
  shipFee: number;
  goHref?: string | null;
  refreshOfferId?: string | null;
}) {
  const voucherCount = groups.reduce((n, g) => n + g.items.length, 0);
  // Selected voucher IDs per group
  const [selected, setSelected] = useState<Record<string, string | null>>({});

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const toggleSelect = (groupId: string, itemId: string, minSpend: number) => {
    if (price < minSpend) return;
    setSelected((prev) => ({
      ...prev,
      [groupId]: prev[groupId] === itemId ? null : itemId,
    }));
  };

  // item id → its group, to map results of the pure functions back onto the UI.
  const itemIndex = useMemo(() => {
    const m = new Map<string, { groupId: string; groupName: string; item: VoucherItem }>();
    groups.forEach((g) => g.items.forEach((item) => m.set(item.id, { groupId: g.id, groupName: g.name, item })));
    return m;
  }, [groups]);

  // Same math as the server (src/lib/vouchers/select.ts): at most one voucher per kind.
  const pickBestCombo = () => {
    const best: Record<string, string | null> = { shop: null, platform: null, ship: null, pay: null };
    const combo = bestCombination(
      groups.flatMap((g) => g.items.map((i) => i.terms)),
      price,
      shipFee,
    );
    combo.picks.forEach((p) => {
      const found = itemIndex.get(p.voucher.id);
      if (found) best[found.groupId] = p.voucher.id;
    });
    setSelected(best);
  };

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Calculations
  const { activeLines, totalDiscount, estimatedTotal } = useMemo(() => {
    const chosen = groups.flatMap((g) => {
      const id = selected[g.id];
      const found = id ? g.items.find((i) => i.id === id) : undefined;
      return found ? [found.terms] : [];
    });
    const totals = totalsFor(chosen, price, shipFee);
    const lines = totals.picks.flatMap((p) => {
      const found = itemIndex.get(p.voucher.id);
      if (!found) return [];
      return [
        {
          id: p.voucher.id,
          label: found.item.isShipping ? "Freeship" : found.groupName.split("·")[0].trim(),
          amount: p.amount,
          code: found.item.code,
        },
      ];
    });
    return { activeLines: lines, totalDiscount: totals.totalDiscount, estimatedTotal: totals.estimatedTotal };
  }, [groups, itemIndex, selected, price, shipFee]);

  const codeLines = activeLines.flatMap((l) => (l.code != null ? [{ ...l, code: l.code }] : []));
  const needsSaveOnMarketplace = activeLines.some((l) => l.code == null);

  return (
    <section id="ma-giam-gia" aria-labelledby="voucher-title" className="w-full">
      <div className="rounded-lg border border-line bg-surface p-6 sm:p-8">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_400px]">
          {/* Left: Voucher groups */}
          <div className="flex min-w-0 flex-col gap-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <TicketIcon className="size-5.5 text-primary" />
                  <h2 id="voucher-title" className="display text-h3 font-bold tracking-tight text-ink">
                    Mã giảm giá đang có
                  </h2>
                </div>
                <p className="text-body-sm text-ink-2">
                  Lấy từ <strong className="font-semibold text-ink">{platform}</strong>
                  {collectedAt && (
                    <>
                      {" · "}
                      <UpdatedAt iso={collectedAt} variant="compact" />
                    </>
                  )}
                  {" · "}
                  <span className="num">{voucherCount}</span> mã
                </p>
              </div>

              <div className="flex items-start gap-2">
                {refreshOfferId && <RefreshVouchersButton offerId={refreshOfferId} />}
                <button
                  type="button"
                  onClick={pickBestCombo}
                  className="h-11 rounded-md border border-line-strong bg-surface px-4 text-body-sm font-bold text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                >
                  Chọn tổ hợp tốt nhất
                </button>
              </div>
            </div>

            {/* List of Groups */}
            <div className="flex flex-col gap-6">
              {groups.map((g) => (
                <div key={g.id} role="group" aria-label={g.name} className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-body font-bold text-ink">{g.name}</span>
                    <span className="text-micro text-ink-3">{g.rule}</span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {g.items.map((v) => {
                      const isChosen = selected[g.id] === v.id;
                      const isDisabled = price < v.minSpend;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => toggleSelect(g.id, v.id, v.minSpend)}
                          aria-pressed={isChosen}
                          disabled={isDisabled}
                          className={`relative grid grid-cols-[104px_1fr] min-h-[112px] rounded-md text-left overflow-hidden transition-colors border-2 cursor-pointer ${
                            isChosen
                              ? "border-primary bg-primary-soft/10"
                              : isDisabled
                                ? "border-line bg-surface-2 opacity-50 cursor-not-allowed"
                                : "border-line bg-surface hover:border-line-strong"
                          }`}
                        >
                          {/* Stub */}
                          <span
                            style={{ backgroundColor: g.stubBg, color: g.stubFg }}
                            className="flex flex-col items-center justify-center gap-0.5 p-2.5 text-center border-r-2 border-dashed border-line-strong"
                          >
                            <span className="num display text-price-input font-extrabold leading-none tracking-tight">
                              {v.big}
                            </span>
                            <span className="text-micro font-bold leading-tight">{v.small}</span>
                          </span>

                          {/* Info */}
                          <span className="flex flex-col gap-1 p-3 pr-10">
                            <span className="text-body-sm font-bold leading-tight text-ink">{v.title}</span>
                            <span className="text-micro text-ink-2">{v.cond}</span>
                            <span className="flex flex-wrap items-center gap-2 pt-0.5 text-micro">
                              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-semibold text-ink">
                                {v.code ?? `Lưu mã trên ${platform}`}
                              </span>
                              <span className="text-ink-3">HSD {v.exp}</span>
                            </span>
                          </span>

                          {/* Checkmark circle */}
                          <span
                            className={`absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full border-2 transition-colors ${
                              isChosen
                                ? "border-primary bg-primary text-on-primary"
                                : "border-line-strong bg-surface text-transparent"
                            }`}
                          >
                            <CheckIcon className="size-3.5" strokeWidth={3.5} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Sticky Estimation Summary */}
          <aside
            aria-label="Giá ước tính"
            className="flex flex-col gap-4.5 rounded-lg border border-line bg-surface-2/40 p-6 text-ink lg:sticky lg:top-24"
          >
            {/* Box 1: Estimated price banner */}
            <div className="flex flex-col gap-2 rounded-tile border border-dashed border-line-strong bg-surface p-3.5 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-label font-semibold text-ink-2">
                  Giá ước tính với mã đã chọn
                </span>
                <span className="rounded-sm border border-line bg-surface-2 px-2 py-0.5 text-micro font-semibold text-ink-2">
                  Ước tính
                </span>
              </div>
              <span className="num display text-stat font-extrabold leading-none tracking-tight text-ink">
                ~{formatVnd(estimatedTotal)}
              </span>
              {totalDiscount > 0 ? (
                <span className="text-label font-semibold text-buy">
                  Ít hơn khoảng {formatVnd(totalDiscount)} so với không dùng mã
                </span>
              ) : (
                <span className="text-label text-ink-3">
                  Chưa chọn mã nào. Chọn mã trong danh sách hoặc bấm “Chọn tổ hợp tốt nhất”.
                </span>
              )}
            </div>

            {/* Box 2: Breakdown table */}
            <div className="flex flex-col gap-2.5 rounded-tile border border-line bg-surface p-4 text-body-sm">
              <div className="flex justify-between">
                <span className="text-ink-2">Giá sản phẩm</span>
                <span className="num font-semibold text-ink">{formatVnd(price)}</span>
              </div>
              {shipFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-2">Phí vận chuyển ước tính</span>
                  <span className="num font-semibold text-ink">+{formatVnd(shipFee)}</span>
                </div>
              )}
              {activeLines.map((l) => (
                <div key={l.id} className="flex justify-between text-buy">
                  <span className="text-ink-2">{l.label}</span>
                  <span className="num font-semibold">−{formatVnd(l.amount)}</span>
                </div>
              ))}
              <div className="my-1 h-px bg-line" />
              <div className="flex justify-between text-control font-bold">
                <span className="text-ink">Ước tính thanh toán</span>
                <span className="num text-ink">~{formatVnd(estimatedTotal)}</span>
              </div>
            </div>

            {/* Box 3: Copyable codes (only codes the marketplace really showed) */}
            {codeLines.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-micro font-semibold text-ink-2">
                  Mã cần nhập khi thanh toán (bấm để sao chép)
                </span>
                <div className="flex flex-wrap gap-2">
                  {codeLines.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => copyCode(l.code)}
                      className="flex h-10 items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface px-3 text-label font-semibold text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                    >
                      <span>{l.code}</span>
                      <span className="text-micro font-bold text-primary">
                        {copiedCode === l.code ? "Đã sao chép" : "Sao chép"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Vouchers without a code are saved on the marketplace itself, not typed in. */}
            {needsSaveOnMarketplace && goHref && (
              <a
                href={goHref}
                target="_blank"
                rel="sponsored nofollow noopener"
                className="flex h-10 w-fit items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface px-3 text-label font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                Lưu mã trên {platform}
                <ExternalIcon className="size-4 text-primary" />
              </a>
            )}

            {/* CTA */}
            {goHref && (
              <a
                href={goHref}
                target="_blank"
                rel="sponsored nofollow noopener"
                className={`flex h-13 items-center justify-center gap-2.5 rounded-md px-6 text-body font-bold transition-colors ${marketplaceStyle(platform).primaryBtn}`}
              >
                <span>Mở {platform} và áp mã</span>
                <ExternalIcon className="size-4.5" />
              </a>
            )}

            <span className="text-micro leading-relaxed text-ink-3">
              Voucher có thể hết lượt hoặc không áp dụng cho bạn. Giá cuối cùng do sàn tính khi thanh toán. Nếu bạn mua qua liên kết, Kairo có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả.
            </span>
          </aside>
        </div>
      </div>
    </section>
  );
}
