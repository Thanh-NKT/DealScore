"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { submitDataReport, type ReportResult } from "@/actions/report";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { AlertIcon, CheckCircleIcon, FlagIcon } from "@/components/ui/icons";
import { marketplaceName } from "@/components/product/marketplace";
import { formatVnd } from "@/lib/format";
import { REPORT_KINDS, REPORT_KIND_LABEL, REPORT_MESSAGE_MAX, type ReportKind } from "@/lib/reports/constants";

export interface ReportOffer {
  offerId: string;
  marketplace: string;
  sellerName: string | null;
  price: number | null;
}

interface DataReportDialogProps {
  productId: string;
  productName: string;
  variantId: string | null;
  /** Offers of the selected variant, already on the page (pricing.offers). */
  offers: ReportOffer[];
}

/** Inline error for a failed submit (UI spec §7). null = no error to show. */
export function reportErrorText(result: ReportResult | "network"): string | null {
  if (result === "network") return "Chưa gửi được. Thử lại sau ít phút.";
  if (result.ok) return null;
  if (result.error === "rate_limited") return "Bạn đã gửi nhiều góp ý trong giờ qua. Thử lại sau nhé.";
  if (result.error === "invalid") return "Góp ý chưa hợp lệ. Kiểm tra lại loại góp ý và phần mô tả.";
  return "Chưa gửi được. Thử lại sau ít phút.";
}

const offerLabel = (o: ReportOffer) =>
  [marketplaceName(o.marketplace), o.sellerName?.trim() || null, o.price != null ? formatVnd(o.price) : null]
    .filter(Boolean)
    .join(" · ");

/**
 * "Góp ý dữ liệu" (roadmap P2 item 6): a tertiary trigger + native <dialog> (focus trap, Esc, focus return).
 * Works signed out. Success is shown only after the server confirms; nothing personal is asked for.
 */
export function DataReportDialog({ productId, productName, variantId, offers }: DataReportDialogProps) {
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [offerId, setOfferId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ duplicate: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const reset = () => {
    setKind(null);
    setOfferId("");
    setMessage("");
    setError(null);
    setDone(null);
  };
  // Not while a submit is pending: its result would land in the next opening ("Cảm ơn bạn!" or an error).
  const close = () => {
    if (pending) return;
    setOpen(false);
    reset();
  };

  const messageRequired = kind === "other";
  const trimmed = message.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) {
      setError("Chọn điều bạn thấy chưa đúng.");
      dialogRef.current?.querySelector<HTMLInputElement>('input[name="kind"]')?.focus();
      return;
    }
    if (messageRequired && trimmed === "") {
      setError("Mô tả điều chưa đúng để DealScore kiểm tra.");
      document.getElementById(`${uid}-message`)?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitDataReport({
          productId,
          variantId,
          offerId: offerId || null,
          kind,
          message: trimmed || null,
        });
        if (result.ok) setDone({ duplicate: result.duplicate });
        else setError(reportErrorText(result));
      } catch {
        setError(reportErrorText("network"));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-label font-semibold text-ink-2 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink"
      >
        <FlagIcon className="size-4" />
        Góp ý dữ liệu
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`${uid}-title`}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close(); // backdrop
        }}
        className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-hero border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-night/50 backdrop:backdrop-blur-sm max-[760px]:mb-0 max-[760px]:w-full max-[760px]:rounded-b-none"
      >
        <div className="flex max-h-[90dvh] flex-col">
          <div className="shrink-0 border-b border-line px-6 pb-4 pt-5 max-[760px]:px-4">
            <h2 id={`${uid}-title`} className="display text-h4 font-semibold text-ink">
              Góp ý dữ liệu
            </h2>
            <p className="mt-1 line-clamp-2 text-body-sm text-ink-2 [overflow-wrap:anywhere]">
              Bạn thấy điều gì chưa đúng về {productName}?
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 max-[760px]:px-4">
            {done ? (
              <div role="status" className="flex flex-col items-start gap-3 py-2">
                <CheckCircleIcon className="size-7 text-buy" />
                <p className="text-body text-ink">Cảm ơn bạn! DealScore sẽ kiểm tra và sửa nếu dữ liệu sai.</p>
                {done.duplicate && (
                  <p className="text-body-sm text-ink-2">Bạn đã góp ý điều này hôm nay — DealScore đã ghi nhận.</p>
                )}
                <Button variant="secondary" size="md" onClick={close} autoFocus>
                  Đóng
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                <fieldset
                  aria-invalid={error != null && !kind ? true : undefined}
                  aria-describedby={error != null && !kind ? `${uid}-error` : undefined}
                >
                  <legend className="mb-2 text-control font-bold text-ink">Điều chưa đúng</legend>
                  <div className="flex flex-col gap-1">
                    {REPORT_KINDS.map((k) => (
                      <label
                        key={k}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-body-sm text-ink hover:bg-surface-2"
                      >
                        <input
                          type="radio"
                          name="kind"
                          value={k}
                          checked={kind === k}
                          onChange={() => {
                            setKind(k);
                            setError(null);
                          }}
                          className="size-4.5 shrink-0 accent-primary"
                        />
                        <span>{REPORT_KIND_LABEL[k]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${uid}-offer`} className="text-control font-bold text-ink">
                    Nơi bán nào?
                  </label>
                  <select
                    id={`${uid}-offer`}
                    value={offerId}
                    onChange={(e) => setOfferId(e.target.value)}
                    className={inputClass({ size: "md", text: "control" })}
                  >
                    <option value="">Không rõ / cả sản phẩm</option>
                    {offers.map((o) => (
                      <option key={o.offerId} value={o.offerId}>
                        {offerLabel(o)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${uid}-message`} className="text-control font-bold text-ink">
                    {messageRequired ? "Mô tả (bắt buộc)" : "Mô tả thêm (không bắt buộc)"}
                  </label>
                  <textarea
                    id={`${uid}-message`}
                    rows={3}
                    maxLength={REPORT_MESSAGE_MAX}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    aria-describedby={`${uid}-hint`}
                    aria-required={messageRequired}
                    className="w-full min-w-0 rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-body-sm text-ink placeholder:text-ink-3 transition-colors duration-150 ease-out focus:border-primary focus:ring-1 focus:ring-primary focus-visible:outline-none"
                  />
                  <div id={`${uid}-hint`} className="flex justify-between gap-3 text-micro text-ink-3">
                    <span>Đừng ghi email, số điện thoại hay thông tin cá nhân.</span>
                    <span className="num shrink-0">
                      {message.length}/{REPORT_MESSAGE_MAX}
                    </span>
                  </div>
                </div>

                {error && (
                  <p id={`${uid}-error`} role="alert" className="flex items-start gap-1.5 text-body-sm font-semibold text-avoid">
                    <AlertIcon className="mt-0.5 size-4" />
                    <span>{error}</span>
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2 max-[420px]:[&>*]:flex-1">
                  <Button variant="secondary" size="md" onClick={close} disabled={pending}>
                    Hủy
                  </Button>
                  <Button type="submit" size="md" busy={pending}>
                    {pending ? "Đang gửi…" : "Gửi góp ý"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
