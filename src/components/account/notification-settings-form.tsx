"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { updateNotificationSettings, type ActionResult } from "@/actions/account";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type Frequency,
  type IsoWeekday,
  type NotificationSettings,
  type SettingsField,
} from "@/lib/account/notification-settings";
import { AlertIcon, CheckIcon, InfoIcon } from "@/components/ui/icons";
import { PushSetup } from "./push-setup";
import { buttonClass } from "@/components/ui/button";

interface NotificationSettingsFormProps {
  initialSettings: NotificationSettings;
}

type Result = ActionResult<SettingsField>;

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

async function submit(prev: Result, form: FormData): Promise<Result> {
  try {
    return await updateNotificationSettings(prev, form);
  } catch (err) {
    unstable_rethrow(err); // expired session → login
    return { status: "error", errors: {} };
  }
}

const SELECT =
  "min-h-11 rounded-md border border-line-strong bg-surface px-3 text-body text-ink transition-colors duration-150 ease-out focus:border-primary focus:ring-1 focus:ring-primary focus-visible:outline-none aria-[invalid=true]:border-2 aria-[invalid=true]:border-avoid";

type Form = {
  email: boolean;
  push: boolean;
  frequency: Frequency;
  digestHour: number;
  digestWeekday: IsoWeekday;
  quiet: boolean;
  quietStart: number;
  quietEnd: number;
};

function fromSettings(s: NotificationSettings): Form {
  return {
    email: s.emailEnabled,
    push: s.pushEnabled,
    frequency: s.frequency,
    digestHour: s.digestHour,
    digestWeekday: s.digestWeekday,
    quiet: s.quietStart !== null && s.quietEnd !== null,
    quietStart: s.quietStart ?? 22,
    quietEnd: s.quietEnd ?? 7,
  };
}

const same = (a: Form, b: Form) => (Object.keys(a) as Array<keyof Form>).every((k) => a[k] === b[k]);

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex basis-full items-start gap-1.5 text-body-sm font-semibold text-avoid">
      <AlertIcon className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

/**
 * Notification preferences with an explicit saved / unsaved / error state: the form tracks what is on
 * the server, marks unsaved edits (and warns before leaving the page with them), gently warns when
 * every channel is off, and keeps everything typed when saving fails.
 */
export function NotificationSettingsForm({ initialSettings }: NotificationSettingsFormProps) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(submit, { status: "idle" } as Result);
  const [values, setValues] = useState<Form>(() => fromSettings(initialSettings));
  const [baseline, setBaseline] = useState<Form>(() => fromSettings(initialSettings));
  const [submitted, setSubmitted] = useState<Form | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // When a save succeeds, what was submitted becomes the new baseline.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.status === "saved" && submitted) {
      setBaseline(submitted);
      setSavedAt(new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    }
  }

  const dirty = !same(values, baseline);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setValues((prev) => ({ ...prev, [k]: v }));

  // Leaving the page with unsaved edits asks first (browser dialog).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const errors = state.status === "error" ? state.errors : {};
  const failed = state.status === "error" && !pending;
  const quietSame = values.quiet && values.quietStart === values.quietEnd;
  const noChannel = !values.email && !values.push;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (quietSame || pending) {
          e.preventDefault();
          return;
        }
        setSubmitted(values);
      }}
      className="space-y-7"
    >
      <section aria-labelledby={`${uid}-channels`} className="space-y-3">
        <h2 id={`${uid}-channels`} className="display text-h4 font-bold leading-tight text-ink">
          Nhận thông báo giá qua
        </h2>
        <div className="divide-y divide-line rounded-md border border-line bg-surface">
          <label className="flex min-h-11 cursor-pointer items-start justify-between gap-4 p-4 transition-colors duration-150 ease-out hover:bg-surface-2">
            <span>
              <span className="block text-control font-semibold text-ink">Email</span>
              <span className="mt-0.5 block text-body-sm text-ink-2">Gửi tới email bạn dùng để đăng nhập.</span>
            </span>
            <input type="checkbox" name="emailEnabled" checked={values.email} onChange={(e) => set("email", e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
          </label>
          <div className="p-4">
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span>
                <span className="block text-control font-semibold text-ink">Thông báo trên trình duyệt</span>
                <span className="mt-0.5 block text-body-sm text-ink-2">
                  Hiện ngay trên máy tính hoặc điện thoại. Trên iPhone cần thêm DealScore vào Màn hình chính (iOS 16.4 trở lên).
                </span>
              </span>
              <input type="checkbox" name="pushEnabled" checked={values.push} onChange={(e) => set("push", e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
            </label>
            {/* The channel above is account-wide; each browser must also be allowed to receive. */}
            <PushSetup onEnabled={() => set("push", true)} />
            {values.push && !baseline.push && (
              <p className="mt-2 text-label text-ink-2">Bấm “Lưu cài đặt” ở cuối trang để bắt đầu nhận thông báo trên trình duyệt.</p>
            )}
          </div>
        </div>
        {noChannel && (
          <p role="status" className="flex items-start gap-2 rounded-md bg-surface-2 p-3.5 text-body-sm text-ink">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Khi tắt cả hai kênh, bạn sẽ không nhận được thông báo giá nào. Các sản phẩm vẫn được theo dõi, và bạn có thể xem giá trong “Đang theo dõi” bất cứ lúc nào.
            </span>
          </p>
        )}
      </section>

      <fieldset className="space-y-3">
        <legend className="display mb-3 text-h4 font-bold leading-tight text-ink">Tần suất</legend>
        <div className="divide-y divide-line rounded-md border border-line bg-surface">
          {(
            [
              ["instant", "Ngay khi có", "Báo ngay khi giá đạt điều kiện bạn đặt."],
              ["daily_digest", "Tóm tắt mỗi ngày", "Gộp mọi thay đổi trong ngày vào một thông báo."],
              ["weekly_digest", "Tóm tắt mỗi tuần", "Gộp mọi thay đổi trong tuần vào một thông báo, vào ngày bạn chọn."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex cursor-pointer items-start gap-3 p-4 transition-colors duration-150 ease-out hover:bg-surface-2">
              <input type="radio" name="frequency" value={value} checked={values.frequency === value} onChange={() => set("frequency", value)} className="mt-0.5 size-5 shrink-0 accent-primary" />
              <span>
                <span className="block text-control font-semibold text-ink">{label}</span>
                <span className="mt-0.5 block text-body-sm text-ink-2">{hint}</span>
              </span>
            </label>
          ))}
          {values.frequency !== "instant" && (
            <div className="flex flex-wrap items-center gap-3 p-4">
              {values.frequency === "weekly_digest" && (
                <>
                  <label htmlFor={`${uid}-weekday`} className="text-control text-ink-2">
                    Ngày nhận
                  </label>
                  <select
                    id={`${uid}-weekday`}
                    name="digestWeekday"
                    value={values.digestWeekday}
                    onChange={(e) => set("digestWeekday", Number(e.target.value) as IsoWeekday)}
                    aria-invalid={Boolean(errors.digestWeekday) || undefined}
                    className={SELECT}
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {WEEKDAY_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label htmlFor={`${uid}-digest`} className="text-control text-ink-2">
                {values.frequency === "weekly_digest" ? "lúc" : "Gửi tóm tắt lúc"}
              </label>
              <select id={`${uid}-digest`} name="digestHour" value={values.digestHour} onChange={(e) => set("digestHour", Number(e.target.value))} className={`${SELECT} num`}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
              <span className="text-label text-ink-3">giờ Việt Nam</span>
              {errors.digestHour && <FieldError>{errors.digestHour}</FieldError>}
              {errors.digestWeekday && <FieldError>{errors.digestWeekday}</FieldError>}
            </div>
          )}
          {/* Keep the saved weekday when another frequency is chosen. */}
          {values.frequency !== "weekly_digest" && <input type="hidden" name="digestWeekday" value={values.digestWeekday} />}
          {values.frequency === "instant" && <input type="hidden" name="digestHour" value={values.digestHour} />}
        </div>
      </fieldset>

      <section aria-labelledby={`${uid}-quiet`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${uid}-quiet`} className="display text-h4 font-bold leading-tight text-ink">
            Giờ im lặng
          </h2>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-control font-semibold text-ink">
            <input type="checkbox" checked={values.quiet} onChange={(e) => set("quiet", e.target.checked)} className="size-5 accent-primary" />
            Bật
          </label>
        </div>
        {values.quiet ? (
          <div className="space-y-3 rounded-md bg-surface-2 p-4">
            <p className="text-body-sm text-ink-2">Thông báo đến trong khoảng này được giữ lại và gửi khi hết giờ im lặng. Khoảng giờ có thể qua nửa đêm, ví dụ 22:00 đến 07:00.</p>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor={`${uid}-qs`} className="text-control text-ink-2">
                Từ
              </label>
              <select id={`${uid}-qs`} name="quietStart" value={values.quietStart} onChange={(e) => set("quietStart", Number(e.target.value))} aria-invalid={quietSame || undefined} className={`${SELECT} num`}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
              <label htmlFor={`${uid}-qe`} className="text-control text-ink-2">
                đến
              </label>
              <select id={`${uid}-qe`} name="quietEnd" value={values.quietEnd} onChange={(e) => set("quietEnd", Number(e.target.value))} aria-invalid={quietSame || undefined} className={`${SELECT} num`}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </div>
            {quietSame && <FieldError>Giờ bắt đầu và giờ kết thúc cần khác nhau.</FieldError>}
            {(errors.quietStart || errors.quietEnd) && <FieldError>{errors.quietStart || errors.quietEnd}</FieldError>}
          </div>
        ) : (
          <p className="rounded-md bg-surface-2 p-4 text-body-sm text-ink-2">Đang tắt: thông báo được gửi vào mọi giờ trong ngày.</p>
        )}
      </section>

      <div className="sticky bottom-0 -mx-7 -mb-7 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-line bg-surface px-7 py-4 max-[760px]:-mx-5 max-[760px]:-mb-5 max-[760px]:px-5">
        <p aria-live="polite" className="text-body-sm">
          {pending ? (
            <span className="text-ink-2">Đang lưu…</span>
          ) : failed ? (
            <span className="inline-flex items-start gap-1.5 font-semibold text-avoid">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              Chưa lưu được. Các lựa chọn của bạn vẫn còn, hãy thử lại.
            </span>
          ) : dirty ? (
            <span className="font-medium text-ink">Có thay đổi chưa lưu</span>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <CheckIcon className="size-4" />
              Đã lưu lúc {savedAt}
            </span>
          ) : (
            <span className="text-ink-3">Chưa có thay đổi</span>
          )}
        </p>
        <button
          type="submit"
          disabled={pending || quietSame || (!dirty && !failed)}
          aria-busy={pending}
          className={buttonClass({ size: "md" })}
        >
          {pending ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
      </div>
    </form>
  );
}
