"use client";

import { useEffect, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { deletePushSubscription, savePushSubscription } from "@/actions/push";
import { AlertIcon, BellIcon, CheckCircleIcon, InfoIcon } from "@/components/ui/icons";

type State =
  | "checking"
  | "unsupported"
  | "ios_install"
  | "not_configured"
  | "denied"
  | "off"
  | "working"
  | "on"
  | "error";

interface PushSetupProps {
  /** Called after this browser is subscribed, so the account-level push channel can be switched on. */
  onEnabled?: () => void;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const SW_URL = "/sw.js";

/** VAPID public key (base64url) → the byte array PushManager.subscribe expects. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function toPayload(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: json.endpoint ?? sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } };
}

/** What this browser can do right now, before asking anything. */
async function detect(): Promise<{ state: State; sub: PushSubscription | null }> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return { state: isIos() && !isStandalone() ? "ios_install" : "unsupported", sub: null };
  if (!VAPID_PUBLIC_KEY) return { state: "not_configured", sub: null };
  if (Notification.permission === "denied") return { state: "denied", sub: null };
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = (await reg?.pushManager.getSubscription()) ?? null;
  return { state: sub && Notification.permission === "granted" ? "on" : "off", sub };
}

const BTN_SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong/60 bg-surface px-5 text-control font-semibold text-ink transition-colors duration-150 ease-out hover:bg-canvas disabled:cursor-progress disabled:text-ink-3";

/**
 * Turns browser notifications on for THIS device: asks permission, registers /sw.js, subscribes with
 * the VAPID key and stores the subscription (savePushSubscription). Every dead end explains the next
 * step in plain words: unsupported browser, iPhone not yet added to the Home Screen, blocked permission,
 * missing server config, and save errors.
 */
export function PushSetup({ onEnabled }: PushSetupProps) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    detect()
      .then(async ({ state: s, sub }) => {
        if (!alive) return;
        setState(s);
        // Re-sync a live subscription: the server drops ones that failed repeatedly.
        if (s === "on" && sub) await savePushSubscription(toPayload(sub), navigator.userAgent).catch(() => undefined);
      })
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  const enable = async () => {
    setState("working");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;
      const key = keyBytes(VAPID_PUBLIC_KEY);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with an older server key can't be reused: replace it.
      if (sub && sub.options.applicationServerKey) {
        const old = new Uint8Array(sub.options.applicationServerKey);
        if (old.length !== key.length || old.some((b, i) => b !== key[i])) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const res = await savePushSubscription(toPayload(sub), navigator.userAgent);
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setError(res.error);
        setState("error");
        return;
      }
      setState("on");
      onEnabled?.();
    } catch (err) {
      unstable_rethrow(err); // expired session → login
      setError("Chưa bật được thông báo trên trình duyệt này. Hãy thử lại.");
      setState("error");
    }
  };

  const disable = async () => {
    setState("working");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      unstable_rethrow(err);
      setError("Chưa tắt được. Hãy thử lại.");
      setState("on");
    }
  };

  const box = "mt-3 space-y-2.5 rounded-tile bg-surface-2 p-4 text-body-sm text-ink-2";

  switch (state) {
    case "checking":
      return <p className="mt-3 text-body-sm text-ink-3">Đang kiểm tra trình duyệt này…</p>;

    case "unsupported":
      return (
        <p className={`${box} flex items-start gap-2`}>
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-ink-3" />
          Trình duyệt này chưa hỗ trợ thông báo. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới, hoặc nhận thông báo qua email.
        </p>
      );

    case "ios_install":
      return (
        <div className={box}>
          <p className="font-semibold text-ink">Trên iPhone, cần thêm DealScore vào Màn hình chính trước:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Mở trang này bằng Safari, bấm nút Chia sẻ.</li>
            <li>Chọn “Thêm vào MH chính”.</li>
            <li>Mở DealScore từ biểu tượng mới trên Màn hình chính, rồi quay lại trang này để bật thông báo.</li>
          </ol>
          <p className="text-ink-3">Cần iOS 16.4 trở lên.</p>
        </div>
      );

    case "not_configured":
      return (
        <p className={`${box} flex items-start gap-2`}>
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-ink-3" />
          Thông báo trên trình duyệt tạm thời chưa dùng được. Bạn vẫn nhận thông báo giá qua email.
        </p>
      );

    case "denied":
      return (
        <div className={box}>
          <p className="flex items-start gap-2 font-semibold text-avoid">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            Trình duyệt đang chặn thông báo từ DealScore.
          </p>
          <p>
            Bấm biểu tượng ổ khóa (hoặc biểu tượng cài đặt) cạnh địa chỉ trang, chọn Thông báo → Cho phép, rồi tải lại trang. DealScore không thể tự bỏ
            chặn giúp bạn.
          </p>
        </div>
      );

    case "on":
      return (
        <div className={`${box} flex flex-wrap items-center justify-between gap-3`}>
          <p className="flex items-center gap-2 font-medium text-ink">
            <CheckCircleIcon className="size-5 shrink-0" />
            Trình duyệt này đang nhận thông báo.
          </p>
          <button type="button" onClick={disable} className={BTN_SECONDARY}>
            Tắt trên trình duyệt này
          </button>
          {error && <p role="alert" className="flex basis-full items-start gap-2 font-semibold text-avoid"><AlertIcon className="mt-0.5 size-4 shrink-0" />{error}</p>}
        </div>
      );

    case "working":
      return (
        <p className="mt-3 text-body-sm text-ink-2" aria-live="polite">
          Đang xử lý… Nếu trình duyệt hỏi, hãy chọn “Cho phép”.
        </p>
      );

    case "error":
    case "off":
      return (
        <div className={box}>
          {state === "error" && error && (
            <p role="alert" className="flex items-start gap-2 font-semibold text-avoid">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <p>Trình duyệt này chưa nhận thông báo. Bấm nút dưới đây, rồi chọn “Cho phép” khi trình duyệt hỏi.</p>
          <button type="button" onClick={enable} className={BTN_SECONDARY}>
            <BellIcon className="size-[18px]" />
            {state === "error" ? "Thử lại" : "Bật thông báo trên trình duyệt này"}
          </button>
        </div>
      );
  }
}
