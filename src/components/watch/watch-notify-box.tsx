"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { updateNotificationSettings } from "@/actions/account";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  toFormFields,
  type Frequency,
  type IsoWeekday,
  type NotificationSettings,
} from "@/lib/account/notification-settings";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const FREQUENCY_OPTIONS: Array<[Frequency, string]> = [
  ["instant", "Ngay khi có thay đổi"],
  ["daily_digest", "Tóm tắt mỗi ngày"],
  ["weekly_digest", "Tóm tắt mỗi tuần"],
];

function toFormData(s: NotificationSettings): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(toFormFields(s))) f.set(k, v);
  return f;
}

/**
 * Watch page sidebar card: the account's real notification settings, saved on each change through
 * updateNotificationSettings. Turning browser notifications ON needs the per-device setup
 * (permission + subscription), so it links to the notification settings page instead of flipping the flag.
 */
export function WatchNotifyBox({ initialSettings }: { initialSettings: NotificationSettings }) {
  const uid = useId();
  const [settings, setSettings] = useState(initialSettings);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();

  const save = (patch: Partial<NotificationSettings>) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setStatus("idle");
    startTransition(async () => {
      try {
        const r = await updateNotificationSettings({ status: "idle" }, toFormData(next));
        if (r.status === "saved") setStatus("saved");
        else {
          setSettings(previous);
          setStatus("error");
        }
      } catch (err) {
        unstable_rethrow(err);
        setSettings(previous);
        setStatus("error");
      }
    });
  };

  const iconProps = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  return (
    <section aria-label="Cài đặt thông báo" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
      <span className="display text-title font-bold tracking-[-0.02em] text-ink">
        Nhận thông báo qua
      </span>

      <div className="flex flex-col gap-1 text-body-sm">
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-ink">
          <svg {...iconProps}>
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
          </svg>
          <span className="flex-1">Email</span>
          <input
            type="checkbox"
            checked={settings.emailEnabled}
            disabled={pending}
            onChange={(e) => save({ emailEnabled: e.target.checked })}
            className="size-[18px] cursor-pointer rounded-xs border-line-strong accent-primary"
          />
        </label>

        {settings.pushEnabled ? (
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-ink">
            <svg {...iconProps}>
              <path d="M3 4h18v12H3zM8 20h8M12 16v4" />
            </svg>
            <span className="flex-1">Trình duyệt</span>
            <input
              type="checkbox"
              checked
              disabled={pending}
              onChange={() => save({ pushEnabled: false })}
              className="size-[18px] cursor-pointer rounded-xs border-line-strong accent-primary"
            />
          </label>
        ) : (
          <div className="flex min-h-10 items-center gap-2.5 text-ink">
            <svg {...iconProps}>
              <path d="M3 4h18v12H3zM8 20h8M12 16v4" />
            </svg>
            <span className="flex-1">Trình duyệt</span>
            <Link
              href="/account/notifications"
              aria-label="Bật thông báo trình duyệt trong Cài đặt thông báo"
              className="inline-flex min-h-8 items-center rounded-lg border border-line-strong bg-surface px-2.5 text-micro font-semibold text-ink transition-colors hover:bg-canvas"
            >
              Bật
            </Link>
          </div>
        )}

        <div className="flex min-h-10 items-center gap-2.5 text-ink-3">
          <svg {...iconProps}>
            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
          </svg>
          <span className="flex-1">Telegram</span>
          <span className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-micro font-semibold text-ink-2">Sắp có</span>
        </div>

        <div className="flex min-h-10 items-center gap-2.5 text-ink-3">
          <svg {...iconProps}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="flex-1">Zalo</span>
          <span className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-micro font-semibold text-ink-2">Sắp có</span>
        </div>
      </div>

      <div className="h-px bg-line" />

      <fieldset className="flex flex-col gap-1 border-none p-0 text-body-sm" disabled={pending}>
        <legend className="pb-1 text-body-sm font-bold text-ink">Tần suất</legend>
        {FREQUENCY_OPTIONS.map(([value, label]) => (
          <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              name={`${uid}-freq`}
              checked={settings.frequency === value}
              onChange={() => save({ frequency: value })}
              className="size-[18px] cursor-pointer accent-primary"
            />
            <span>{label}</span>
          </label>
        ))}

        {settings.frequency === "weekly_digest" && (
          <div className="mt-1 flex flex-wrap items-center gap-2 pl-7">
            <label htmlFor={`${uid}-weekday`} className="text-label text-ink-2">
              Ngày nhận
            </label>
            <select
              id={`${uid}-weekday`}
              value={settings.digestWeekday}
              onChange={(e) => save({ digestWeekday: Number(e.target.value) as IsoWeekday })}
              className="h-10 rounded-md border border-line-strong bg-surface px-2 text-body-sm text-ink focus:border-primary focus:ring-1 focus:ring-primary focus-visible:outline-none"
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
        )}
        {settings.frequency !== "instant" && (
          <p className="pl-7 text-micro text-ink-3">
            Gửi lúc <span className="num">{hh(settings.digestHour)}</span> giờ Việt Nam ·{" "}
            <Link href="/account/notifications" className="underline underline-offset-2 hover:text-ink">
              Đổi giờ
            </Link>
          </p>
        )}
      </fieldset>

      <p aria-live="polite" className="min-h-[18px] text-micro">
        {pending ? (
          <span className="text-ink-3">Đang lưu…</span>
        ) : status === "error" ? (
          <span className="font-semibold text-avoid">Chưa lưu được. Hãy thử lại.</span>
        ) : status === "saved" ? (
          <span className="text-ink-3">Đã lưu</span>
        ) : null}
      </p>
    </section>
  );
}
