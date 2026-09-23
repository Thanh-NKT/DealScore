"use client";

import { useActionState, useState } from "react";
import {
  updateNotificationSettings,
  type ActionResult,
} from "@/actions/account";
import type {
  Frequency,
  NotificationSettings,
  SettingsField,
} from "@/lib/account/notification-settings";

interface NotificationSettingsFormProps {
  initialSettings: NotificationSettings;
}

export function NotificationSettingsForm({
  initialSettings,
}: NotificationSettingsFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateNotificationSettings,
    { status: "idle" } as ActionResult<SettingsField>,
  );

  const [frequency, setFrequency] = useState<Frequency>(
    initialSettings.frequency,
  );
  const [hasQuietHours, setHasQuietHours] = useState<boolean>(
    initialSettings.quietStart !== null && initialSettings.quietEnd !== null,
  );

  const errors = state.status === "error" ? state.errors : {};

  return (
    <form action={formAction} className="space-y-8">
      {state.status === "saved" && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        >
          ✓ Cài đặt thông báo đã được lưu thành công.
        </div>
      )}

      {/* 1. Notification channels */}
      <section className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
          1. Kênh nhận thông báo
        </h2>
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm font-semibold text-foreground">
                Email
              </span>
              <p className="text-xs text-muted">
                Nhận thông báo biến động giá qua email đã đăng ký
              </p>
            </div>
            <input
              type="checkbox"
              name="emailEnabled"
              defaultChecked={initialSettings.emailEnabled}
              className="h-4 w-4 rounded border-border text-foreground accent-foreground focus:ring-foreground"
            />
          </label>

          <hr className="border-border" />

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm font-semibold text-foreground">
                Thông báo Web Push
              </span>
              <p className="text-xs text-muted">
                Nhận cảnh báo trực tiếp trên trình duyệt (iPhone yêu cầu thêm vào
                Màn hình chính / PWA iOS 16.4+)
              </p>
            </div>
            <input
              type="checkbox"
              name="pushEnabled"
              defaultChecked={initialSettings.pushEnabled}
              className="h-4 w-4 rounded border-border text-foreground accent-foreground focus:ring-foreground"
            />
          </label>
        </div>
      </section>

      {/* 2. Frequency */}
      <section className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
          2. Tần suất gửi thông báo
        </h2>
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="frequency"
              value="instant"
              checked={frequency === "instant"}
              onChange={() => setFrequency("instant")}
              className="mt-0.5 h-4 w-4 text-foreground accent-foreground"
            />
            <div>
              <span className="text-xs font-semibold text-foreground">
                Tức thì (Khuyến nghị)
              </span>
              <p className="text-xs text-muted">
                Gửi thông báo ngay khi giá biến động đạt điều kiện bạn đã đặt
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="frequency"
              value="daily_digest"
              checked={frequency === "daily_digest"}
              onChange={() => setFrequency("daily_digest")}
              className="mt-0.5 h-4 w-4 text-foreground accent-foreground"
            />
            <div>
              <span className="text-xs font-semibold text-foreground">
                Tóm tắt hằng ngày
              </span>
              <p className="text-xs text-muted">
                Gộp tất cả biến động giá trong ngày vào duy nhất 1 email
              </p>
            </div>
          </label>

          {/* Digest hour (when daily_digest is selected) */}
          {frequency === "daily_digest" && (
            <div className="pt-3 border-t border-border flex items-center gap-3">
              <label htmlFor="digestHour" className="text-xs text-muted">
                Giờ gửi tóm tắt:
              </label>
              <select
                id="digestHour"
                name="digestHour"
                defaultValue={initialSettings.digestHour}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
              >
                {Array.from({ length: 24 }).map((_, i) => (
                  <option key={i} value={i}>
                    {i}:00 (Giờ VN)
                  </option>
                ))}
              </select>
              {errors.digestHour && (
                <span className="text-xs text-red-500">
                  {errors.digestHour}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 3. Quiet hours */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
            3. Giờ im lặng (Tạm hoãn thông báo)
          </h2>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-muted">
            <input
              type="checkbox"
              checked={hasQuietHours}
              onChange={(e) => setHasQuietHours(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-foreground accent-foreground"
            />
            Bật giờ im lặng
          </label>
        </div>

        {hasQuietHours ? (
          <div className="rounded-2xl border border-border p-4 space-y-3">
            <p className="text-xs text-muted leading-relaxed">
              Thông báo phát sinh trong khung giờ này sẽ được giữ lại và gửi sau
              khi hết giờ im lặng (hỗ trợ khung giờ vắt qua nửa đêm, ví dụ 22:00
              đến 07:00).
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="quietStart" className="text-xs text-muted">
                  Từ:
                </label>
                <select
                  id="quietStart"
                  name="quietStart"
                  defaultValue={initialSettings.quietStart ?? 22}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={i}>
                      {i}:00
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="quietEnd" className="text-xs text-muted">
                  Đến:
                </label>
                <select
                  id="quietEnd"
                  name="quietEnd"
                  defaultValue={initialSettings.quietEnd ?? 7}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={i}>
                      {i}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(errors.quietStart || errors.quietEnd) && (
              <p className="text-xs text-red-500">
                {errors.quietStart || errors.quietEnd}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted">
            Chưa bật giờ im lặng. Thông báo sẽ được gửi bất kể thời điểm trong
            ngày.
          </div>
        )}
      </section>

      <button
        type="submit"
        disabled={isPending}
        className="w-full sm:w-auto rounded-xl bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Đang lưu..." : "Lưu cài đặt thông báo"}
      </button>
    </form>
  );
}
