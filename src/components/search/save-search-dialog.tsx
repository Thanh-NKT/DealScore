"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { saveSearch, updateSavedSearch } from "@/actions/saved-search";
import { parseVndInput, formatTyping } from "@/components/watch/price-input";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { BellIcon } from "@/components/ui/icons";
import { SAVED_SEARCH_NAME_MAX } from "@/lib/saved-search/constants";

const RESULT_TEXT: Record<string, string> = {
  limit: "Bạn đã lưu 10 tìm kiếm. Xóa bớt ở trang Tìm kiếm đã lưu.",
  duplicate: "Bạn đã lưu đúng tìm kiếm này rồi.",
  unavailable: "Chưa lưu được. Thử lại sau ít phút.",
  unauthenticated: "Phiên đăng nhập đã hết. Hãy đăng nhập lại.",
  not_found: "Không tìm thấy tìm kiếm này.",
  no_scope: "Tìm kiếm cần có từ khóa, danh mục hoặc hãng.",
  too_broad: "Tìm kiếm này khớp quá nhiều sản phẩm. Hạ giá tối đa hoặc chọn thêm hãng, danh mục rồi lưu lại.",
  invalid: "Kiểm tra lại các ô bên trên.",
};
const CONDITION_ERROR = "Chọn giá tối đa hoặc “Chỉ khi Nên mua” để tránh báo quá nhiều.";

export interface SaveSearchDialogProps {
  /** create: from /search (the query string the page searched with); edit: an existing saved search. */
  mode: { kind: "create"; query: string } | { kind: "edit"; id: string; name: string };
  parts: string[];
  defaultName: string;
  maxPrice: number | null;
  onlyBuy: boolean;
  open: boolean;
  onClose: () => void;
}

/** "Báo cho tôi khi có sản phẩm mới" (UI spec §1.1). Native dialog; bottom sheet on phones. */
export function SaveSearchDialog({ mode, parts, defaultName, maxPrice, onlyBuy, open, onClose }: SaveSearchDialogProps) {
  const uid = useId();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [price, setPrice] = useState(maxPrice != null ? formatTyping(String(maxPrice)) : "");
  const [buy, setBuy] = useState(onlyBuy);
  const [name, setName] = useState(mode.kind === "edit" ? mode.name : "");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const submit = () => {
    setError(null);
    setFieldError(null);
    const parsed = price.trim() ? parseVndInput(price) : null;
    if (parsed && !parsed.ok) {
      setFieldError("Nhập giá như 1.500.000 hoặc 1,5 triệu.");
      return;
    }
    const max = parsed && parsed.ok ? parsed.value : null;
    if (max == null && !buy) {
      setFieldError(CONDITION_ERROR);
      return;
    }
    startTransition(async () => {
      try {
        const r =
          mode.kind === "create"
            ? await saveSearch({ query: mode.query, name, maxPrice: max, onlyBuy: buy })
            : await updateSavedSearch(mode.id, { name: name.trim() || defaultName, maxPrice: max, onlyBuy: buy });
        if (!r.ok) {
          if (r.error === "no_condition") setFieldError(CONDITION_ERROR);
          else setError(RESULT_TEXT[r.error] ?? RESULT_TEXT.unavailable);
          return;
        }
        if (mode.kind === "edit") {
          router.refresh();
          onClose();
          return;
        }
        setDone(true);
      } catch (err) {
        unstable_rethrow(err);
        setError(RESULT_TEXT.unavailable);
      }
    });
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-title`}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !pending) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-night/60 max-[760px]:mb-0 max-[760px]:w-full max-[760px]:max-w-full max-[760px]:rounded-b-none"
    >
      <div className="space-y-4 p-6 max-[760px]:p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${uid}-title`} className="display text-h4 font-bold leading-tight">
            {mode.kind === "create" ? "Báo cho tôi khi có sản phẩm mới" : "Sửa tìm kiếm đã lưu"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Đóng"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className="size-5">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {done ? (
          <div role="status" className="space-y-3">
            <p className="text-body text-ink">Đã lưu. Xem và chỉnh ở Tài khoản › Tìm kiếm đã lưu.</p>
            <Link href="/account/searches" className="inline-flex min-h-10 items-center font-semibold text-primary underline underline-offset-4">
              Mở Tìm kiếm đã lưu
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-4"
          >
            {parts.length > 0 ? (
              <ul aria-label="Tìm kiếm này" className="flex flex-wrap gap-2">
                {parts.map((p) => (
                  <li key={p} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-label text-ink-2">
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
            {mode.kind === "edit" ? <p className="text-body-sm text-ink-3">Đổi điều kiện sẽ bắt đầu lại từ kết quả hiện tại.</p> : null}
            <TextField
              id={`${uid}-price`}
              label="Giá tối đa"
              size="md"
              inputMode="numeric"
              placeholder="Ví dụ: 1.500.000"
              value={price}
              onChange={(e) => {
                setPrice(formatTyping(e.target.value));
                setFieldError(null);
              }}
              className="num"
            />
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={buy}
                onChange={(e) => {
                  setBuy(e.target.checked);
                  setFieldError(null);
                }}
                className="size-5 shrink-0 accent-primary"
              />
              <span className="text-body-sm text-ink">
                Chỉ khi DealScore đánh giá <strong>Nên mua</strong>
              </span>
            </label>
            {fieldError ? (
              <p role="alert" className="text-body-sm font-semibold text-avoid">
                {fieldError}
              </p>
            ) : null}
            <TextField
              id={`${uid}-name`}
              label="Tên (không bắt buộc)"
              size="md"
              placeholder={defaultName}
              maxLength={SAVED_SEARCH_NAME_MAX + 10}
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint={`${name.trim().length}/${SAVED_SEARCH_NAME_MAX}`}
            />
            <p className="text-micro text-ink-3">
              Sản phẩm đang hiện lúc này sẽ không được báo lại. Tối đa 1 tin mỗi ngày cho mỗi tìm kiếm.
            </p>
            {error ? (
              <p role="alert" className="text-body-sm font-semibold text-avoid">
                {error}
              </p>
            ) : null}
            <Button type="submit" block busy={pending}>
              {mode.kind === "create" ? "Lưu và nhận báo" : "Lưu thay đổi"}
            </Button>
          </form>
        )}
      </div>
    </dialog>
  );
}

/** "Lưu tìm kiếm" in the results header. Signed out → login link back to this page. */
export function SaveSearchButton(props: Omit<SaveSearchDialogProps, "open" | "onClose" | "mode"> & { query: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  if (!props.signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/search?${props.query}`)}`}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-body-sm font-semibold text-ink hover:bg-surface-2"
      >
        <BellIcon className="size-[18px]" />
        Lưu tìm kiếm
      </Link>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <BellIcon className="size-[18px]" />
        Lưu tìm kiếm
      </Button>
      <SaveSearchDialog key={key} {...props} mode={{ kind: "create", query: props.query }} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
