"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { rotateFolderShare, shareFolder, unshareFolder, updateFolderShare, type ShareFolderResult } from "@/actions/share-folder";
import { DEFAULT_SHARE_SETTINGS, type ShareSettings } from "@/lib/share-folder/validate";
import { SHARE_DISPLAY_NAME_MAX, SHARE_TITLE_MAX } from "@/lib/share-folder/constants";
import type { WatchFolder } from "@/lib/watch/folders";
import { Button } from "@/components/ui/button";
import { TextField, inputClass } from "@/components/ui/field";

const ERROR_TEXT: Record<string, string> = {
  unauthenticated: "Phiên đăng nhập đã hết. Hãy đăng nhập lại.",
  not_found: "Không tìm thấy thư mục này.",
  invalid: "Kiểm tra lại các ô bên trên.",
  unavailable: "Chưa lưu được. Thử lại sau ít phút.",
};

/** Share a watch folder by a secret link (roadmap P4 J, UI spec §2.1). Every state change waits for the server. */
export function ShareFolderDialog({ folder, open, onClose }: { folder: WatchFolder; open: boolean; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<ShareSettings>(folder.share?.settings ?? DEFAULT_SHARE_SETTINGS);
  const [url, setUrl] = useState<string | null>(folder.share?.url ?? null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; displayName?: string }>({});
  const [confirm, setConfirm] = useState<null | "rotate" | "stop">(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const run = (work: () => Promise<ShareFolderResult>, onOk: (r: { url?: string }) => void) => {
    setError(null);
    setFieldErrors({});
    setNotice(null);
    startTransition(async () => {
      try {
        const r = await work();
        if (!r.ok) {
          setError(ERROR_TEXT[r.error] ?? ERROR_TEXT.unavailable);
          if (r.fieldErrors) setFieldErrors(r.fieldErrors);
          return;
        }
        onOk(r);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(ERROR_TEXT.unavailable);
      }
    });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Không sao chép được. Hãy chọn link và sao chép thủ công.");
    }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const toggle = (key: keyof ShareSettings, label: string, hint?: React.ReactNode) => (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-2">
      <input
        type="checkbox"
        checked={settings[key] as boolean}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span className="text-body-sm text-ink">
        {label}
        {hint}
      </span>
    </label>
  );

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
      className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-hero border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-night/50 backdrop:backdrop-blur-sm max-[760px]:mb-0 max-[760px]:w-full max-[760px]:max-w-full max-[760px]:rounded-b-none"
    >
      <div className="space-y-4 p-6 max-[760px]:p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${uid}-title`} className="display text-h4 font-semibold leading-tight">
            Chia sẻ “{folder.name}”
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Đóng"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className="size-5">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {url ? (
          <div className="space-y-2">
            <label htmlFor={`${uid}-url`} className="text-body-sm font-semibold text-ink">
              Link xem danh sách
            </label>
            <input id={`${uid}-url`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={inputClass({ size: "md", className: "num" })} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={copy}>
                {copied ? "Đã sao chép" : "Sao chép"}
              </Button>
              {canShare ? (
                <Button variant="secondary" size="sm" onClick={() => navigator.share({ url, title: settings.title ?? folder.name }).catch(() => undefined)}>
                  Chia sẻ
                </Button>
              ) : null}
            </div>
            <p aria-live="polite" className="sr-only">
              {copied ? "Đã sao chép link" : ""}
            </p>
          </div>
        ) : (
          <p className="text-body-sm text-ink-2">Tạo một link để người khác xem danh sách này mà không cần tài khoản.</p>
        )}

        <TextField
          id={`${uid}-title-input`}
          label="Tiêu đề hiển thị"
          size="md"
          placeholder={folder.name}
          maxLength={SHARE_TITLE_MAX + 10}
          value={settings.title ?? ""}
          onChange={(e) => setSettings({ ...settings, title: e.target.value })}
          error={fieldErrors.title}
          hint={`${(settings.title ?? "").trim().length}/${SHARE_TITLE_MAX}`}
        />
        <TextField
          id={`${uid}-name`}
          label="Tên của bạn (không bắt buộc)"
          size="md"
          maxLength={SHARE_DISPLAY_NAME_MAX + 10}
          value={settings.displayName ?? ""}
          onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
          error={fieldErrors.displayName}
          hint="Không ghi email hay số điện thoại."
        />
        <div className="space-y-1">
          {toggle("showPrices", "Hiện giá hiện tại và nhận định Deal Score")}
          {toggle("showTarget", "Hiện giá mong muốn của bạn")}
          {toggle(
            "showNotes",
            "Hiện ghi chú",
            settings.showNotes ? <span className="block text-body-sm text-wait">Ghi chú có thể chứa thông tin riêng.</span> : null,
          )}
          {toggle("includeDone", "Gồm cả sản phẩm đã mua")}
        </div>

        {error ? (
          <p role="alert" className="text-body-sm font-semibold text-avoid">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-body-sm text-buy">
            {notice}
          </p>
        ) : null}

        {!url ? (
          <Button block busy={pending} onClick={() => run(() => shareFolder(folder.id, settings), (r) => setUrl(r.url ?? null))}>
            Tạo link
          </Button>
        ) : confirm ? (
          <div role="alert" className="space-y-3 rounded-md bg-surface-2 p-3">
            <p className="text-body-sm text-ink">
              {confirm === "rotate" ? "Link cũ sẽ không mở được nữa." : "Link sẽ ngừng hoạt động ngay. Người đã có link không xem được nữa."}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setConfirm(null)} disabled={pending}>
                Giữ nguyên
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                busy={pending}
                onClick={() =>
                  confirm === "rotate"
                    ? run(() => rotateFolderShare(folder.id), (r) => {
                        setUrl(r.url ?? null);
                        setConfirm(null);
                        setNotice("Đã đổi link.");
                      })
                    : run(() => unshareFolder(folder.id), () => {
                        setUrl(null);
                        setConfirm(null);
                        setSettings(DEFAULT_SHARE_SETTINGS);
                        setNotice("Đã ngừng chia sẻ.");
                      })
                }
              >
                {confirm === "rotate" ? "Đổi link" : "Ngừng chia sẻ"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button block busy={pending} onClick={() => run(() => updateFolderShare(folder.id, settings), () => setNotice("Đã lưu thay đổi."))}>
              Lưu thay đổi
            </Button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirm("rotate")} className="min-h-10 px-2 text-body-sm font-semibold text-avoid underline-offset-2 hover:underline">
                Đổi link
              </button>
              <button type="button" onClick={() => setConfirm("stop")} className="min-h-10 px-2 text-body-sm font-semibold text-avoid underline-offset-2 hover:underline">
                Ngừng chia sẻ
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
