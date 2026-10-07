"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, unstable_rethrow } from "next/navigation";
import Image from "next/image";
import { formatVnd } from "@/lib/format";
import { setWatchStatus, deleteWatch } from "@/actions/watch";
import { WatchModal } from "@/components/watch/watch-modal";
import type { MyWatchItem } from "@/lib/watch/queries";
import { watchGoHref } from "@/lib/watch/links";
import { changeLabel, countDropped7d } from "@/components/watch/change-label";
import { marketplaceName } from "@/components/product/marketplace";
import { variantLabel } from "@/components/product/variant-label";
import { verdictText } from "@/components/product/verdict-tag";
import { groupByFolder, type WatchFolder } from "@/lib/watch/folders";
import type { NotificationSettings } from "@/lib/account/notification-settings";
import { ALL, FolderNav, UNFILED, type FolderFilter } from "@/components/watch/folder-nav";
import { WatchNotifyBox } from "@/components/watch/watch-notify-box";
import { buttonClass } from "@/components/ui/button";
import { segmentClass, segmentTrack } from "@/components/ui/segmented";
import {
  BellIcon,
  BellOffIcon,
  ChartIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  DashIcon,
  ExternalIcon,
  FolderIcon,
  HourglassIcon,
  LinkIcon,
  PencilIcon,
  SearchIcon,
  TargetIcon,
  TrashIcon,
  TrendDownIcon,
} from "@/components/ui/icons";

interface WatchListProps {
  initialItems: MyWatchItem[];
  folders: WatchFolder[];
  settings: NotificationSettings;
}

type Tab = "active" | "paused" | "done";

const TABS: Array<{ key: Tab; label: string; empty: string; hint: string }> = [
  {
    key: "active",
    label: "Đang theo dõi",
    empty: "Bạn chưa theo dõi sản phẩm nào.",
    hint: "Mở một sản phẩm và bấm “Theo dõi giá” để DealScore báo khi giá xuống.",
  },
  {
    key: "paused",
    label: "Tạm dừng",
    empty: "Không có theo dõi nào đang tạm dừng.",
    hint: "Theo dõi bạn tạm dừng sẽ nằm ở đây.",
  },
  {
    key: "done",
    label: "Đã mua",
    empty: "Chưa có sản phẩm nào được đánh dấu đã mua.",
    hint: "Bấm “Đã mua” ở một theo dõi để chuyển nó vào đây.",
  },
];

const TINTS = ["var(--tint-peach)", "var(--tint-lilac)", "var(--tint-sky)", "var(--primary-soft)", "var(--wait-soft)", "var(--buy-soft)"];

function getTint(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash + id.charCodeAt(i)) % TINTS.length;
  }
  return TINTS[hash];
}

function timeVN(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMinutes = Math.round((now - d.getTime()) / 60000);
  if (diffMinutes < 1) return "vừa xong";
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} ngày trước`;
}

export function WatchList({ initialItems, folders, settings }: WatchListProps) {
  const router = useRouter();
  const items = useMemo(() => initialItems ?? [], [initialItems]);
  const [activeTab, setActiveTab] = useState<Tab>("active");
  const [selectedFolder, setSelectedFolder] = useState<FolderFilter>(ALL);
  const [pasteUrl, setPasteUrl] = useState("");

  const [editing, setEditing] = useState<MyWatchItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Alert emails link to /account/watch#{watchId}: switch to that watch's tab, then scroll to it.
  useEffect(() => {
    const list = initialItems ?? [];
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const target = id ? list.find((i) => i.id === id) : null;
      if (!target) return;
      setActiveTab(target.status);
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    const raf = requestAnimationFrame(openFromHash);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [initialItems]);

  const run = (id: string, work: () => Promise<void>, fallback: string) => {
    setPendingId(id);
    setRowError(null);
    startTransition(async () => {
      try {
        await work();
        setConfirmDelete(null);
      } catch (err) {
        unstable_rethrow(err);
        setRowError({ id, message: err instanceof Error && err.message.startsWith("Bạn đang theo dõi đủ") ? err.message : fallback });
      } finally {
        setPendingId(null);
      }
    });
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteUrl.trim()) return;
    router.push(`/search?q=${encodeURIComponent(pasteUrl.trim())}`);
  };

  // Filter items by Tab and by Folder
  const tabItems = useMemo(
    () => items.filter((i) => i.status === activeTab),
    [items, activeTab]
  );

  const groups = useMemo(() => groupByFolder(tabItems, folders), [tabItems, folders]);
  const folderCounts = {
    all: groups.all.count,
    unfiled: groups.unfiled.count,
    byFolder: Object.fromEntries(groups.byFolder.map((g) => [g.folder.id, g.count])),
  };
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));

  // A folder deleted elsewhere falls back to "Tất cả".
  const activeFolder =
    selectedFolder === ALL || selectedFolder === UNFILED || folderNameById.has(selectedFolder) ? selectedFolder : ALL;
  const folderFilteredItems =
    activeFolder === ALL
      ? groups.all.items
      : activeFolder === UNFILED
        ? groups.unfiled.items
        : (groups.byFolder.find((g) => g.folder.id === activeFolder)?.items ?? []);

  // Overall statistics for top summary tiles
  const trackedItems = items.filter((i) => i.status !== "done");
  const reachedCount = trackedItems.filter((i) => i.view.target?.reached).length;
  const droppedCount = countDropped7d(items);
  const goodDealsCount = trackedItems.filter(
    (i) => i.view.deal?.recommendation === "buy"
  ).length;
  const alertsOnCount = items.filter((i) => i.status === "active").length;

  const currentTabInfo = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="grid grid-cols-1 items-start gap-8 min-[1080px]:grid-cols-[260px_1fr]">
      {/* Left: Folders & Notification Settings Sidebar */}
      <aside className="flex flex-col gap-6">
        <FolderNav
          folders={folders}
          counts={folderCounts}
          selected={activeFolder}
          onSelect={setSelectedFolder}
        />
        <WatchNotifyBox initialSettings={settings} />
      </aside>

      {/* Main Area: Top Bar, 3 Tiles, Table */}
      <main className="flex min-w-0 flex-col gap-6">
        {/* Header Row: Title & Paste Link Search */}
        <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="display text-stat font-extrabold leading-[1.1] tracking-[-0.02em] text-ink sm:text-price-md">
              Đang theo dõi
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-label font-medium text-ink-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 shadow-xs">
                <span className="display font-bold text-ink">
                  {items.length}
                </span>
                <span>sản phẩm</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-soft bg-primary-soft/60 px-2.5 py-0.5 text-primary-hover">
                <BellIcon className="size-3.5" strokeWidth={2.2} fill="currentColor" />
                <span className="display font-bold">
                  {alertsOnCount}
                </span>
                <span>đang bật thông báo</span>
              </span>
            </div>
          </div>

          <form
            onSubmit={handlePasteSubmit}
            className="flex w-full max-w-[500px] items-center gap-2.5 rounded-md border border-line-strong bg-surface p-1.5 pl-3.5 shadow-sm transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink-3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <label htmlFor="w-url" className="sr-only">
              Dán link sản phẩm để theo dõi
            </label>
            <input
              id="w-url"
              type="text"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              placeholder="Dán link sản phẩm Shopee…"
              className="h-10 min-w-0 flex-1 border-none bg-transparent text-body-sm text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="submit"
              className={buttonClass({ size: "sm", rounded: "sm", className: "shrink-0" })}
            >
              <BellIcon className="size-4" strokeWidth={2.2} />
              <span>Theo dõi giá</span>
            </button>
          </form>
        </div>

        {/* 3 Summary Tiles */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-xs">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-wait-soft text-wait">
              <TargetIcon className="size-4" strokeWidth={2.2} />
            </span>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="display text-h3 font-extrabold leading-none text-ink">
                {reachedCount}
              </span>
              <span className="truncate text-label font-medium text-ink-2">
                Đã chạm giá mong muốn
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-xs">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary-soft text-primary-hover">
              <TrendDownIcon className="size-4" strokeWidth={2.2} />
            </span>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="display text-h3 font-extrabold leading-none text-ink">
                {droppedCount}
              </span>
              <span className="truncate text-label font-medium text-ink-2" title="sản phẩm giảm giá trong 7 ngày qua">
                sản phẩm giảm giá trong 7 ngày qua
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-xs">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-buy-soft text-buy">
              <CheckCircleIcon className="size-4" strokeWidth={2.2} />
            </span>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="display text-h3 font-extrabold leading-none text-ink">
                {goodDealsCount}
              </span>
              <span className="truncate text-label font-medium text-ink-2">
                Đang ở mức Nên mua
              </span>
            </div>
          </div>
        </div>

        {/* Status Tab Switcher (Đang theo dõi / Tạm dừng / Đã mua) */}
        <div
          role="group"
          aria-label="Lọc theo trạng thái"
          className={segmentTrack({ className: "flex-wrap self-start" })}
        >
          {TABS.map((t) => {
            const count = items.filter((i) => i.status === t.key).length;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveTab(t.key)}
                className={segmentClass(isActive)}
              >
                {t.key === "active" ? (
                  <BellIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
                ) : t.key === "paused" ? (
                  <BellOffIcon className="size-3.5 shrink-0" strokeWidth={2} />
                ) : (
                  <CheckIcon className="size-3.5 shrink-0" strokeWidth={2.4} />
                )}
                <span>{t.label}</span>
                <span
                  className={`display inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-nano font-bold ${
                    isActive
                      ? "bg-primary-soft text-primary-hover"
                      : "bg-surface text-ink-3"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tracked Items Table */}
        {folderFilteredItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface p-12 text-center">
            <p className="display text-h4 font-bold text-ink">
              {currentTabInfo.empty}
            </p>
            <p className="mx-auto mt-2 max-w-[46ch] text-control text-ink-2">
              {currentTabInfo.hint}
            </p>
            {activeTab === "active" && (
              <Link
                href="/search"
                className={buttonClass({ size: "md", className: "mt-5" })}
              >
                <SearchIcon className="size-[18px]" />
                <span>Tìm sản phẩm</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            {/* Table Header */}
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,2.8fr)_minmax(0,1.15fr)_104px_minmax(0,1.55fr)_240px] gap-4 border-b border-line bg-canvas px-6 py-3.5 text-label font-bold text-ink-3 min-[1080px]:grid"
            >
              <span>Sản phẩm</span>
              <span>Giá hiện tại</span>
              <span className="text-center">Deal Score</span>
              <span>Giá mong muốn</span>
              <span className="sr-only">Hành động</span>
            </div>

            {/* Table Rows */}
            <div className="divide-y divide-line">
              {folderFilteredItems.map((item) => {
                const { product, variant, view } = item;
                const name = product.name?.trim() || "Sản phẩm chưa có tên";
                const href = `/${product.categorySlug}/${product.slug}?variant=${encodeURIComponent(variant.id)}`;
                const busy = pendingId === item.id;
                const alertOn = item.status === "active";
                const updatedAgo = view.observedAt ? timeVN(view.observedAt) : null;
                const folderName = item.folderId ? folderNameById.get(item.folderId) : undefined;
                const tintBg = getTint(product.slug || item.id);

                const price = view.price != null && view.price > 0 ? view.price : null;
                const chg = changeLabel(view);
                const chgColor = chg.tone === "buy" ? "text-buy" : chg.tone === "avoid" ? "text-avoid" : "text-ink-3";
                const goHref = watchGoHref(item);
                const buy = goHref ? item.buy : null;

                // Deal Score visual gauge
                const rawScore = view.deal?.score;
                const score =
                  rawScore != null && Number.isFinite(rawScore)
                    ? Math.min(100, Math.max(0, Math.round(rawScore)))
                    : null;
                const recKey = score == null ? "insufficient_data" : (view.deal?.recommendation ?? "insufficient_data");
                const vConfig = {
                  buy: { fg: "var(--buy)", badgeBg: "bg-buy text-canvas" },
                  wait: { fg: "var(--wait)", badgeBg: "bg-wait text-canvas" },
                  avoid: { fg: "var(--avoid)", badgeBg: "bg-avoid text-canvas" },
                  insufficient_data: { fg: "var(--ink-3)", badgeBg: "bg-surface-2 text-ink-3" },
                }[recKey];
                const ringCircumference = 122.5; // 2 * Math.PI * 19.5
                const ringDash =
                  score != null
                    ? `${Math.max(6, Math.round((score / 100) * ringCircumference))} ${ringCircumference}`
                    : "0 122.5";
                const scoreTooltip =
                  score != null
                    ? `Deal Score: ${score}/100 — ${verdictText(recKey)}`
                    : `Deal Score: ${verdictText("insufficient_data")}`;

                // Target status
                const target = view.target;
                const hasTarget = target != null && target.amount > 0;
                const reached = hasTarget && target.reached;
                const gap = hasTarget && price != null ? price - target.amount : 0;
                const closePct = !hasTarget
                  ? 0
                  : reached
                    ? 100
                    : Math.max(0, Math.round((1 - Math.min(1, gap / (price || 1) / 0.3)) * 100));

                const alertTitle = busy
                  ? "Đang xử lý…"
                  : alertOn
                    ? view.alertStatus.kind === "scheduled"
                      ? `Thông báo đang bật (${view.alertStatus.text}). Bấm để tạm dừng`
                      : "Thông báo đang bật. Bấm để tạm dừng"
                    : "Thông báo đang tắt. Bấm để bật lại";

                return (
                  <div
                    key={item.id}
                    id={item.id}
                    className="grid grid-cols-1 items-center gap-4 p-5 min-[1080px]:grid-cols-[minmax(0,2.8fr)_minmax(0,1.15fr)_104px_minmax(0,1.55fr)_240px] min-[1080px]:px-6 min-[1080px]:py-4"
                  >
                    {/* Col 1: Product info */}
                    <div className="flex min-w-0 items-center gap-3.5">
                      <div
                        className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md"
                        style={{ backgroundColor: tintBg }}
                      >
                        {product.image ? (
                          <Image
                            src={product.image}
                            alt=""
                            width={44}
                            height={44}
                            className="size-11 object-contain"
                            unoptimized
                          />
                        ) : (
                          <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--ink)"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 10h20M9 6c0-1 1-2 3-2s3 1 3 2" />
                          </svg>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          href={href}
                          title={name}
                          className="line-clamp-1 text-body-sm font-semibold leading-snug text-ink hover:underline"
                        >
                          {name}
                        </Link>
                        {(variant.key || folderName) && (
                          <div className="flex flex-wrap items-center gap-2 text-micro text-ink-3">
                            {variant.key && (
                              <span className="inline-flex h-5 min-w-[56px] items-center justify-center rounded-sm bg-surface-2 px-2 text-micro font-semibold text-ink-2">
                                {variantLabel(variant.key)}
                              </span>
                            )}
                            {folderName && (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                <FolderIcon className="size-3.5 text-ink-3" />
                                <span>{folderName}</span>
                              </span>
                            )}
                          </div>
                        )}
                        <span
                          className="inline-flex items-center gap-1 whitespace-nowrap text-micro text-ink-3"
                          title={updatedAgo ? `Cập nhật ${updatedAgo}` : undefined}
                        >
                          <ClockIcon className="size-3.5 text-ink-3" />
                          <span>{updatedAgo ?? "Chưa rõ thời điểm cập nhật"}</span>
                        </span>
                      </div>
                    </div>

                    {/* Col 2: Current price */}
                    <div className="flex flex-col gap-0.5">
                      <span className="display whitespace-nowrap text-title font-bold text-ink">
                        {price != null ? formatVnd(price) : "—"}
                      </span>
                      <span
                        title={chg.title ?? undefined}
                        className={`num whitespace-nowrap text-micro font-semibold ${chgColor}`}
                      >
                        {chg.text}
                      </span>
                      {chg.sub && <span className="num whitespace-nowrap text-micro text-ink-3">{chg.sub}</span>}
                    </div>

                    {/* Col 3: Deal Score (Visual Progress Ring + Status Badge) */}
                    <div className="flex items-center min-[1080px]:justify-center">
                      <div
                        role="img"
                        aria-label={scoreTooltip}
                        title={scoreTooltip}
                        className="relative inline-flex size-12 shrink-0 items-center justify-center"
                      >
                        <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" className="size-12">
                          <circle
                            cx="24"
                            cy="24"
                            r="19.5"
                            fill="none"
                            stroke={recKey === "insufficient_data" ? "var(--line-strong)" : "var(--surface-2)"}
                            strokeWidth="3.5"
                            strokeDasharray={recKey === "insufficient_data" ? "3 3" : undefined}
                          />
                          {score != null && (
                            <circle
                              cx="24"
                              cy="24"
                              r="19.5"
                              fill="none"
                              stroke={vConfig.fg}
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              strokeDasharray={ringDash}
                              transform="rotate(-90 24 24)"
                            />
                          )}
                        </svg>
                        <span
                          className={`display absolute text-control font-extrabold leading-none ${
                            score != null ? "text-ink" : "text-ink-3"
                          }`}
                        >
                          {score != null ? score : "—"}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full ring-2 ring-surface ${vConfig.badgeBg}`}
                        >
                          {recKey === "buy" ? (
                            <CheckIcon className="size-2.5" strokeWidth={3} />
                          ) : recKey === "wait" ? (
                            <HourglassIcon className="size-2.5" strokeWidth={2.5} />
                          ) : recKey === "avoid" ? (
                            <DashIcon className="size-2.5" strokeWidth={3} />
                          ) : (
                            <span className="text-nano font-bold leading-none">?</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Col 4: Target price & progress bar */}
                    <div className="flex flex-col justify-center gap-1.5">
                      {hasTarget ? (
                        <>
                          <div className="flex items-baseline justify-between gap-2 text-label">
                            <span className="display whitespace-nowrap font-bold text-ink">
                              {formatVnd(target.amount)}
                            </span>
                            <span
                              title={reached ? "Đã đạt giá mong muốn" : `Còn cách giá mong muốn ${formatVnd(gap)}`}
                              className={`inline-flex items-center gap-0.5 whitespace-nowrap text-micro font-semibold ${
                                reached ? "text-buy" : "text-ink-3"
                              }`}
                            >
                              {reached && <CheckIcon className="size-3.5" strokeWidth={2.6} />}
                              {reached ? "Đã đạt" : `-${formatVnd(gap)}`}
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${closePct}%`,
                                backgroundColor: reached ? "var(--buy)" : "var(--primary)",
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(item)}
                          className="inline-flex h-10 items-center gap-1.5 self-start whitespace-nowrap rounded-md border border-dashed border-line-strong px-3 text-label font-semibold text-ink-2 transition-colors hover:border-ink hover:bg-canvas hover:text-ink"
                        >
                          <TargetIcon className="size-4 shrink-0" />
                          <span>Đặt giá mong muốn</span>
                        </button>
                      )}
                    </div>

                    {/* Col 5: CTA & icon actions. Target reached on a fresh, in-stock price → "Đến {sàn}" takes the
                        whole first row and "Xem chi tiết giá" joins the icons; otherwise [Xem giá] [🔔] [✏️] [🗑️]. */}
                    <div className="flex flex-col gap-1.5">
                    {buy && goHref && (
                      <div className="flex flex-col items-stretch gap-1">
                        <a
                          href={goHref}
                          target="_blank"
                          rel="nofollow sponsored noopener"
                          className={buttonClass({ variant: "marketplace", marketplace: buy.marketplace, size: "sm", className: "flex-1" })}
                        >
                          <span>Đến {marketplaceName(buy.marketplace)}</span>
                          <ExternalIcon className="size-4" strokeWidth={2} />
                          <span className="sr-only">(mở trong thẻ mới{buy.affiliate ? ", liên kết tiếp thị" : ""})</span>
                        </a>
                        {buy.affiliate && (
                          <span
                            aria-hidden="true"
                            className="inline-flex items-center justify-center gap-1 text-center text-micro font-semibold text-ink-3"
                          >
                            <LinkIcon className="size-3.5" />
                            Liên kết tiếp thị
                          </span>
                        )}
                      </div>
                    )}
                    <div className={`flex items-center gap-1.5 ${buy ? "justify-end" : ""}`}>
                      {buy ? (
                        <Link
                          href={href}
                          aria-label={`Xem chi tiết giá ${name}`}
                          title="Xem chi tiết giá"
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-canvas hover:text-ink"
                        >
                          <ChartIcon className="size-4" />
                        </Link>
                      ) : (
                        <Link
                          href={href}
                          className={buttonClass({ variant: reached ? "primary" : "secondary", size: "sm", className: "flex-1" })}
                        >
                          {reached ? "Xem giá mới" : "Xem giá"}
                        </Link>
                      )}
                      <button
                        type="button"
                        aria-pressed={alertOn}
                        aria-label={alertTitle}
                        title={alertTitle}
                        disabled={busy}
                        onClick={() =>
                          run(
                            item.id,
                            () => setWatchStatus(item.id, alertOn ? "paused" : "active"),
                            "Chưa đổi được trạng thái."
                          )
                        }
                        className={`relative inline-flex size-10 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          alertOn
                            ? "border-primary-soft bg-primary-soft text-primary-hover hover:bg-primary-soft/80"
                            : "border-line-strong bg-surface text-ink-3 hover:bg-canvas hover:text-ink"
                        }`}
                      >
                        {alertOn ? (
                          <BellIcon className="size-4" strokeWidth={2.2} fill="currentColor" />
                        ) : (
                          <BellOffIcon className="size-4" />
                        )}
                        {alertOn && view.alertStatus.kind === "scheduled" && (
                          <span
                            aria-hidden="true"
                            className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-surface"
                          />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(item)}
                        aria-label={`Sửa theo dõi ${name}`}
                        title="Sửa"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-canvas hover:text-ink"
                      >
                        <PencilIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(item.id)}
                        aria-label={`Xóa theo dõi ${name}`}
                        title="Xóa"
                        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-2 transition-colors hover:border-avoid hover:bg-avoid-soft hover:text-avoid"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/60 p-4">
            <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lift">
              <h3 className="display text-h4 font-bold text-ink">
                {(() => {
                  const target = items.find((i) => i.id === confirmDelete)?.product.name?.trim();
                  return target ? `Xóa theo dõi “${target}”?` : "Xóa theo dõi sản phẩm này?";
                })()}
              </h3>
              <p className="mt-2 text-body-sm text-ink-2">
                Bạn sẽ không nhận thông báo khi giá sản phẩm này giảm nữa.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="h-10 rounded-md border border-line-strong px-4 text-body-sm font-semibold text-ink"
                >
                  Giữ lại
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(
                      confirmDelete,
                      () => deleteWatch(confirmDelete),
                      "Chưa xóa được theo dõi."
                    )
                  }
                  className="h-10 rounded-md bg-avoid px-4 text-body-sm font-semibold text-canvas"
                >
                  Xóa theo dõi
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Watch Modal */}
        {editing && (
          <WatchModal
            isOpen
            onClose={() => setEditing(null)}
            productName={editing.product.name}
            variantKey={editing.variant.key}
            variantId={editing.variant.id}
            currentPrice={editing.view.price}
            existingWatch={{
              id: editing.id,
              config: editing.config,
              status: editing.status,
              folderId: editing.folderId,
            }}
            folders={folders}
            currentPath="/account/watch"
          />
        )}

        {rowError && (
          <p role="alert" className="text-body-sm font-semibold text-avoid">
            {rowError.message}
          </p>
        )}

        <p className="max-w-[75ch] text-label leading-[1.45] text-ink-3">
          Nếu bạn mua qua liên kết, DealScore có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả.
        </p>
      </main>
    </div>
  );
}
