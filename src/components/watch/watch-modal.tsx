"use client";

import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { saveWatch, setWatchStatus, deleteWatch, moveWatchToFolder, type WatchActionResult } from "@/actions/watch";
import type { WatchFolder } from "@/lib/watch/folders";
import { formatVnd } from "@/lib/format";
import { suggestTargetPrice } from "@/lib/watch/form";
import type { WatchConfig } from "@/lib/watch/types";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "@/components/ui/icons";
import { variantLabel } from "@/components/product/variant-label";
import { formatTyping, parseVndInput, type ParsedPrice } from "./price-input";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

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
    /** Only known where folders are shown (the Watch page). */
    folderId?: string | null;
  } | null;
  currentPath: string;
  /** When given, the modal shows a "Thư mục" select and files the Watch on save. */
  folders?: WatchFolder[];
}

type ChannelMode = "account" | "email" | "push" | "both";

/** Above this a target is almost certainly a typo (an extra zero), not a real price. */
const MAX_TARGET = 10_000_000_000;

const PRICE_ERRORS: Record<Exclude<ParsedPrice, { ok: true }>["reason"], string> = {
  empty: "Nhập giá mong muốn, hoặc bỏ chọn điều kiện này.",
  zero: "Giá mong muốn phải lớn hơn 0đ.",
  negative: "Giá mong muốn không thể là số âm.",
  unreadable: "Chưa đọc được số tiền. Thử dạng 2.399.000 hoặc 2tr4.",
  ambiguous: "Thêm đơn vị để rõ số tiền, ví dụ 2,4 triệu hoặc 2.400.000.",
};

function initialChannel(config: WatchConfig | undefined): ChannelMode {
  const c = config?.channels;
  if (!c || c.length === 0) return "account";
  if (c.includes("email") && c.includes("push")) return "both";
  return c.includes("email") ? "email" : "push";
}


const secondaryBtn = buttonClass({ variant: "secondary", size: "md" });
const primaryBtn = buttonClass({ size: "md" });
const dangerBtn = buttonClass({ variant: "danger", size: "md" });
/** One condition = one inner box on the card surface. */
const conditionBox = "rounded-md bg-surface-2 p-3.5";

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className="size-5">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-body-sm font-semibold text-avoid">
      <AlertIcon className="mt-0.5 size-4" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Watch editor in a native <dialog> (focus trap, Esc, focus return for free). Hardened for real input:
 * the target price accepts "2.399.000", "2tr4", "2,4 triệu" and shows what it understood plus the
 * distance from today's price; closing with unsaved edits asks first; save/pause/delete failures show
 * inline and never lose what was typed.
 */
export function WatchModal({
  isOpen,
  onClose,
  productName,
  variantKey,
  variantId,
  currentPrice,
  existingWatch,
  currentPath,
  folders,
}: WatchModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const initial = existingWatch?.config;
  const price = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;
  const suggested = suggestTargetPrice(price);
  const initialFolder = existingWatch?.folderId ?? "";
  const [folderChoice, setFolderChoice] = useState<string>(initialFolder);

  const [state, formAction, isSaving] = useActionState(
    async (prev: WatchActionResult, form: FormData): Promise<WatchActionResult> => {
      try {
        const saved = await saveWatch(prev, form);
        // Filing into a folder is its own action (moveWatchToFolder), run once the Watch exists.
        const wanted = form.get("folderId");
        if (saved.status === "saved" && folders && typeof wanted === "string" && wanted !== initialFolder) {
          const moved = await moveWatchToFolder(saved.watchId, wanted === "" ? null : wanted);
          if (moved.status === "error") {
            return { status: "error", errors: { _form: `Đã lưu theo dõi nhưng chưa chuyển được thư mục: ${moved.error}` } };
          }
        }
        return saved;
      } catch (err) {
        unstable_rethrow(err); // let Next handle redirects (e.g. session expired → login)
        return { status: "error", errors: { _form: "Chưa lưu được do lỗi kết nối. Thông tin bạn nhập vẫn còn, hãy thử lại." } };
      }
    },
    { status: "idle" } as WatchActionResult,
  );

  const initialTarget = initial?.targetPrice ?? suggested ?? null;
  const [enableTarget, setEnableTarget] = useState(initial ? initial.targetPrice !== null : true);
  const [targetText, setTargetText] = useState(initialTarget ? formatVnd(initialTarget).replace(/đ$/, "") : "");
  const [enableDropPct, setEnableDropPct] = useState(initial ? initial.dropPct !== null : false);
  const [dropPct, setDropPct] = useState(initial?.dropPct ? String(initial.dropPct) : "10");
  const [notifyLow, setNotifyLow] = useState(initial?.notifyLow ?? false);
  const [enableScore, setEnableScore] = useState(initial ? initial.minDealScore !== null : false);
  const [minDealScore, setMinDealScore] = useState(initial?.minDealScore ? String(initial.minDealScore) : "80");
  const [notifyBackInStock, setNotifyBackInStock] = useState(initial?.notifyBackInStock ?? false);
  const [channelMode, setChannelMode] = useState<ChannelMode>(initialChannel(initial));

  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "status" | "delete">(null);
  const [showPriceError, setShowPriceError] = useState(false);

  // Open / close the native dialog in step with the parent's state.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);

  const parsed = parseVndInput(targetText);
  const target = parsed.ok ? parsed.value : null;
  const priceProblem = !enableTarget
    ? null
    : !parsed.ok
      ? PRICE_ERRORS[parsed.reason]
      : parsed.value > MAX_TARGET
        ? "Số tiền quá lớn. Kiểm tra lại số chữ số 0."
        : null;
  const serverErrors = state.status === "error" ? state.errors : {};
  const isSaved = state.status === "saved" && !dirty;
  const targetError = (showPriceError && priceProblem) || serverErrors.targetPrice || null;

  // A failed save leaves the form unsaved even though "dirty" was reset on submit.
  const unsaved = (dirty || state.status === "error") && !isSaving;

  const requestClose = () => {
    if (unsaved) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    onClose();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (priceProblem) {
      e.preventDefault();
      setShowPriceError(true);
      document.getElementById(`${uid}-target`)?.focus();
      return;
    }
    setDirty(false);
  };

  const runStatus = async (next: "active" | "paused") => {
    if (!existingWatch) return;
    setBusy("status");
    setActionError(null);
    try {
      await setWatchStatus(existingWatch.id, next);
      onClose();
    } catch (err) {
      unstable_rethrow(err);
      setActionError(err instanceof Error && err.message.startsWith("Bạn đang theo dõi đủ") ? err.message : "Chưa đổi được trạng thái. Hãy thử lại.");
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async () => {
    if (!existingWatch) return;
    setBusy("delete");
    setActionError(null);
    try {
      await deleteWatch(existingWatch.id);
      onClose();
    } catch (err) {
      unstable_rethrow(err);
      setActionError("Chưa xóa được theo dõi. Hãy thử lại.");
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  };

  const gap = target != null && price != null ? price - target : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${uid}-title`}
      onCancel={(e) => {
        e.preventDefault(); // Esc: same path as the close button, so unsaved edits are protected
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) requestClose(); // click on the backdrop
      }}
      className="m-auto max-h-[90dvh] w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-night/60"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <div className="shrink-0 border-b border-line bg-surface px-7 pb-4 pt-6 max-[760px]:px-5 max-[760px]:pb-3.5 max-[760px]:pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={`${uid}-title`} className="display text-h3 font-bold leading-tight max-[760px]:text-h4">
                {existingWatch ? "Sửa theo dõi giá" : "Theo dõi giá"}
              </h2>
              <p className="mt-1 line-clamp-2 text-body-sm text-ink-2 [overflow-wrap:anywhere]" title={productName}>
                {productName}
                {variantKey && <span className="text-ink-3"> · {variantLabel(variantKey)}</span>}
              </p>
              <p className="mt-1 text-body-sm text-ink-3">
                Giá hiện tại:{" "}
                {price != null ? <b className="num font-bold text-ink">{formatVnd(price)}</b> : "chưa có giá"}
              </p>
            </div>
            <button type="button" onClick={requestClose} aria-label="Đóng" className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink">
              <CloseIcon />
            </button>
          </div>

          {confirmDiscard && (
            <div role="alert" className="mt-4 rounded-md border border-line-strong bg-surface-2 p-3.5">
              <p className="text-control font-semibold">Bạn có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" className={secondaryBtn} onClick={() => setConfirmDiscard(false)} autoFocus>
                  Tiếp tục sửa
                </button>
                <button
                  type="button"
                  className={secondaryBtn}
                  onClick={() => {
                    setConfirmDiscard(false);
                    setDirty(false);
                    onClose();
                  }}
                >
                  Bỏ thay đổi
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-5 max-[760px]:px-5 max-[760px]:pb-5 max-[760px]:pt-4">
          {isSaved ? (
            <div className="py-6 text-center">
              <span className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-accent text-on-accent">
                <CheckCircleIcon className="size-7" strokeWidth={2} />
              </span>
              <h3 className="display mt-3 text-h3 font-bold">Đã lưu theo dõi</h3>
              <p className="mx-auto mt-1 max-w-[40ch] text-control text-ink-2">
                DealScore sẽ kiểm tra giá định kỳ và báo cho bạn khi có điều kiện được đáp ứng.
              </p>
              <button type="button" onClick={onClose} className={`${primaryBtn} mt-5`}>
                Xong
              </button>
            </div>
          ) : (
            <form action={formAction} onSubmit={onSubmit} onChange={() => setDirty(true)} noValidate className="space-y-5">
            <input type="hidden" name="variantId" value={variantId} />
            <input type="hidden" name="path" value={currentPath} />

            {(serverErrors._form || serverErrors.variantId || serverErrors.channels) && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-avoid-soft p-3 text-body-sm font-semibold text-avoid">
                <AlertIcon className="mt-0.5 size-4" />
                <span>{serverErrors._form ?? serverErrors.variantId ?? serverErrors.channels}</span>
              </p>
            )}

            <fieldset className="space-y-3">
              <legend className="mb-2 text-control font-bold">Báo cho tôi khi (chọn ít nhất 1)</legend>

              {/* 1. Target price */}
              <div className={conditionBox}>
                <label className="flex min-h-6 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={enableTarget} onChange={(e) => setEnableTarget(e.target.checked)} className="size-5 accent-primary" />
                  <span className="text-control font-medium">Giá xuống tới mức tôi đặt</span>
                </label>
                {enableTarget && (
                  <div className="mt-3 pl-8">
                    <label htmlFor={`${uid}-target`} className="sr-only">
                      Giá mong muốn
                    </label>
                    <div className="relative">
                      <input
                        id={`${uid}-target`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={targetText}
                        onChange={(e) => {
                          setTargetText(formatTyping(e.target.value));
                          setShowPriceError(false);
                        }}
                        onBlur={() => {
                          if (target != null) setTargetText(formatVnd(target).replace(/đ$/, ""));
                          setShowPriceError(Boolean(priceProblem));
                        }}
                        placeholder="Ví dụ: 2.399.000 hoặc 2tr4"
                        aria-invalid={Boolean(targetError)}
                        aria-describedby={`${uid}-target-help`}
                        className={inputClass({ text: "title", className: "pr-9" })}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-body text-ink-3">đ</span>
                    </div>
                    {/* The server only accepts digits: send the understood integer, not the typed text. */}
                    <input type="hidden" name="targetPrice" value={target != null && !priceProblem ? String(target) : ""} />

                    <div id={`${uid}-target-help`} aria-live="polite">
                      {targetError ? (
                        <FieldError id={`${uid}-target-error`}>{targetError}</FieldError>
                      ) : target != null ? (
                        <TargetDistance target={target} price={price} gap={gap} typed={targetText} />
                      ) : null}
                    </div>

                    {suggested != null && target !== suggested && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetText(formatVnd(suggested).replace(/đ$/, ""));
                          setDirty(true);
                          setShowPriceError(false);
                        }}
                        className="mt-2.5 inline-flex min-h-10 items-center rounded-md border border-line-strong bg-surface px-3 text-label font-semibold text-ink transition-colors duration-150 ease-out hover:bg-canvas"
                      >
                        Dùng gợi ý {formatVnd(suggested)} (thấp hơn 10%)
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 2. % drop */}
              <div className={conditionBox}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={enableDropPct} onChange={(e) => setEnableDropPct(e.target.checked)} className="size-5 accent-primary" />
                  <span className="text-control font-medium">Giá giảm thêm một tỷ lệ</span>
                </label>
                {enableDropPct && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
                    <label htmlFor={`${uid}-drop`} className="sr-only">
                      Phần trăm giảm
                    </label>
                    <input
                      id={`${uid}-drop`}
                      name="dropPct"
                      type="text"
                      inputMode="numeric"
                      value={dropPct}
                      onChange={(e) => setDropPct(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                      aria-invalid={Boolean(serverErrors.dropPct)}
                      className={inputClass({ width: "auto", className: "num w-20 text-center" })}
                    />
                    <span className="text-body-sm text-ink-2">% so với lúc bắt đầu theo dõi (1–90%)</span>
                    {serverErrors.dropPct && <FieldError id={`${uid}-drop-error`}>{serverErrors.dropPct}</FieldError>}
                  </div>
                )}
              </div>

              {/* 3. Recorded low */}
              <label className={`flex cursor-pointer items-start gap-3 ${conditionBox}`}>
                <input type="checkbox" name="notifyLow" checked={notifyLow} onChange={(e) => setNotifyLow(e.target.checked)} className="mt-0.5 size-5 accent-primary" />
                <span>
                  <span className="block text-control font-medium">Giá chạm mức thấp nhất 90 ngày</span>
                  <span className="block text-label text-ink-3">Chỉ báo khi hệ thống đã ghi nhận đủ 14 ngày giá.</span>
                </span>
              </label>

              {/* 4. Deal Score */}
              <div className={conditionBox}>
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={enableScore} onChange={(e) => setEnableScore(e.target.checked)} className="size-5 accent-primary" />
                  <span className="text-control font-medium">Deal Score đạt từ mức tôi chọn</span>
                </label>
                {enableScore && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
                    <label htmlFor={`${uid}-score`} className="sr-only">
                      Deal Score tối thiểu
                    </label>
                    <input
                      id={`${uid}-score`}
                      name="minDealScore"
                      type="text"
                      inputMode="numeric"
                      value={minDealScore}
                      onChange={(e) => setMinDealScore(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                      aria-invalid={Boolean(serverErrors.minDealScore)}
                      className={inputClass({ width: "auto", className: "num w-20 text-center" })}
                    />
                    <span className="text-body-sm text-ink-2">/100 điểm</span>
                    {serverErrors.minDealScore && <FieldError id={`${uid}-score-error`}>{serverErrors.minDealScore}</FieldError>}
                  </div>
                )}
              </div>

              {/* 5. Back in stock */}
              <label className={`flex cursor-pointer items-start gap-3 ${conditionBox}`}>
                <input type="checkbox" name="notifyBackInStock" checked={notifyBackInStock} onChange={(e) => setNotifyBackInStock(e.target.checked)} className="mt-0.5 size-5 accent-primary" />
                <span>
                  <span className="block text-control font-medium">Có hàng trở lại</span>
                  <span className="block text-label text-ink-3">Báo khi sản phẩm chuyển từ hết hàng sang còn hàng.</span>
                </span>
              </label>
            </fieldset>

            {folders && (
              <div>
                <label htmlFor={`${uid}-folder`} className="text-control font-bold">
                  Thư mục
                </label>
                <select
                  id={`${uid}-folder`}
                  name="folderId"
                  value={folderChoice}
                  onChange={(e) => setFolderChoice(e.target.value)}
                  className={inputClass({ className: "mt-1.5" })}
                >
                  <option value="">Chưa xếp thư mục</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor={`${uid}-channel`} className="text-control font-bold">
                Nhận thông báo qua
              </label>
              <select
                id={`${uid}-channel`}
                value={channelMode}
                onChange={(e) => setChannelMode(e.target.value as ChannelMode)}
                className={inputClass({ className: "mt-1.5" })}
              >
                <option value="account">Theo cài đặt tài khoản</option>
                <option value="email">Chỉ email</option>
                <option value="push">Chỉ thông báo trình duyệt</option>
                <option value="both">Cả email và thông báo trình duyệt</option>
              </select>
              {channelMode === "both" ? (
                <>
                  <input type="hidden" name="channel" value="email" />
                  <input type="hidden" name="channel" value="push" />
                </>
              ) : (
                <input type="hidden" name="channel" value={channelMode} />
              )}
            </div>

            {actionError && (
              <p role="alert" className="flex items-start gap-2 text-body-sm font-semibold text-avoid">
                <AlertIcon className="mt-0.5 size-4" />
                {actionError}
              </p>
            )}

            {existingWatch && confirmDelete && (
              <div role="alert" className="rounded-md border border-avoid bg-surface p-3.5">
                <p className="text-control font-semibold">Xóa theo dõi này? Bạn sẽ không nhận thông báo giá cho sản phẩm này nữa.</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" className={secondaryBtn} onClick={() => setConfirmDelete(false)} autoFocus>
                    Giữ lại
                  </button>
                  <button type="button" className={dangerBtn} disabled={busy === "delete"} onClick={runDelete}>
                    {busy === "delete" ? "Đang xóa…" : "Xóa theo dõi"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              {existingWatch ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busy != null || isSaving}
                    onClick={() => runStatus(existingWatch.status === "active" ? "paused" : "active")}
                  >
                    {busy === "status" ? "Đang cập nhật…" : existingWatch.status === "active" ? "Tạm dừng" : "Theo dõi lại"}
                  </button>
                  <button type="button" className={secondaryBtn} disabled={busy != null || isSaving} onClick={() => setConfirmDelete(true)}>
                    Xóa
                  </button>
                </div>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap gap-2 max-[420px]:w-full max-[420px]:[&>*]:flex-1">
                <button type="button" onClick={requestClose} className={secondaryBtn}>
                  Hủy
                </button>
                <button type="submit" disabled={isSaving || busy != null} aria-busy={isSaving} className={primaryBtn}>
                  {isSaving ? "Đang lưu…" : "Lưu theo dõi"}
                </button>
              </div>
            </div>
          </form>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** What the input was understood as, and how far it is from today's price, in words first. */
function TargetDistance({ target, price, gap, typed }: { target: number; price: number | null; gap: number | null; typed: string }) {
  const understood = /[a-zà-ỹ]/i.test(typed) ? (
    <span>
      Hiểu là <b className="num text-ink">{formatVnd(target)}</b>.{" "}
    </span>
  ) : null;

  if (price == null || gap == null) {
    return <p className="mt-1.5 text-body-sm text-ink-2">{understood}Chưa có giá hiện tại để so sánh.</p>;
  }
  if (gap <= 0) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-body-sm text-ink">
        <InfoIcon className="mt-0.5 size-4 text-ink-2" />
        <span>
          {understood}
          {gap === 0 ? "Bằng" : "Cao hơn"} giá hiện tại, nên bạn sẽ được báo ngay ở lần kiểm tra giá tới. Muốn chờ giá giảm, hãy đặt thấp hơn{" "}
          <span className="num font-semibold">{formatVnd(price)}</span>.
        </span>
      </p>
    );
  }
  const pct = Math.round((gap / price) * 100);
  return (
    <p className="mt-1.5 text-body-sm text-ink-2">
      {understood}
      Còn <b className="num text-body text-ink">{formatVnd(gap)}</b> nữa{" "}
      <span className="text-ink-3">({pct < 1 ? "chưa tới 1%" : `giảm thêm ${pct}%`} so với giá hiện tại)</span>
      {pct >= 60 && <span className="mt-1 block text-ink">Mức này thấp hơn nhiều so với giá hiện tại. Kiểm tra lại số chữ số 0.</span>}
    </p>
  );
}
