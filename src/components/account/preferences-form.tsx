"use client";

import { useActionState, useId, useState } from "react";
import { savePreferences, type PreferencesActionResult } from "@/actions/preferences";
import { MAX_PREFERENCE_ITEMS, type Preferences } from "@/lib/preferences";
import { formatTyping, parseVndInput } from "@/components/watch/price-input";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";
import { FieldMessage, inputClass } from "@/components/ui/field";

interface PreferencesFormProps {
  initial: Preferences;
  /** Verified brands (intent_vocab) plus any saved brand no longer in that list. */
  brands: string[];
  categories: Array<{ id: string; name: string }>;
  marketplaces: Array<{ id: string; name: string }>;
}

const IDLE: PreferencesActionResult = { status: "idle" };

/** A checkbox styled as a 40px chip; the native input stays in the tab order and submits without JS. */
const CHIP =
  "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-label font-medium text-ink transition-colors duration-150 ease-out hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:font-semibold has-[:checked]:text-primary";

const priceText = (v: number | null) => (v == null ? "" : v.toLocaleString("vi-VN"));

function PriceBox({ id, name, label, initial, error }: { id: string; name: "minPrice" | "maxPrice"; label: string; initial: number | null; error?: string }) {
  const [text, setText] = useState(() => priceText(initial));
  return (
    <div className="min-w-0 flex-1 basis-40">
      <label htmlFor={id} className="mb-1.5 block text-control font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(formatTyping(e.target.value))}
          onBlur={() => {
            const parsed = parseVndInput(text);
            if (parsed.ok) setText(parsed.value.toLocaleString("vi-VN"));
          }}
          placeholder="Ví dụ: 500k hoặc 2tr5"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-msg` : undefined}
          className={inputClass({ className: "num pr-8" })}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body-sm text-ink-3">
          đ
        </span>
      </div>
      <FieldMessage id={`${id}-msg`} error={error} />
    </div>
  );
}

/**
 * Shopping preferences. `savePreferences` is passed to useActionState directly, so the form also
 * saves before hydration / without JS (the result renders from the server). Inputs are uncontrolled
 * except the price boxes and the brand counter, so a no-JS save shows exactly what was posted.
 */
export function PreferencesForm({ initial, brands, categories, marketplaces }: PreferencesFormProps) {
  const uid = useId();
  const [state, formAction, pending] = useActionState(savePreferences, IDLE);
  const [edited, setEdited] = useState(false);
  const [brandCount, setBrandCount] = useState(initial.brands.length);

  const errors = state.status === "error" ? state.errors : {};
  const saved = state.status === "saved" && !pending && !edited;
  const chosenBrands = new Set(initial.brands.map((b) => b.toLowerCase()));
  const brandsFull = brandCount >= MAX_PREFERENCE_ITEMS;

  return (
    <form
      action={formAction}
      onChange={() => setEdited(true)}
      onSubmit={() => setEdited(false)}
      className="space-y-7"
    >
      <fieldset aria-describedby={`${uid}-brands-hint`} className="space-y-3">
        <legend className="display mb-1 text-h4 font-semibold leading-tight text-ink">Hãng yêu thích</legend>
        <p id={`${uid}-brands-hint`} className="text-body-sm text-ink-2">
          Chọn tối đa <span className="num">{MAX_PREFERENCE_ITEMS}</span> hãng.{" "}
          {brandCount > 0 && (
            <span className="text-ink">
              Đã chọn <span className="num font-semibold">{brandCount}</span>.
            </span>
          )}
        </p>
        {brands.length > 0 ? (
          <div
            className="flex max-h-72 flex-wrap gap-2 overflow-y-auto rounded-md border border-line bg-surface-2 p-3"
            onChange={(e) => {
              const box = e.target as HTMLInputElement;
              if (box.name === "brands") setBrandCount((n) => n + (box.checked ? 1 : -1));
            }}
          >
            {brands.map((b) => {
              const checked = chosenBrands.has(b.toLowerCase());
              return (
                <label key={b} className={CHIP}>
                  <input
                    type="checkbox"
                    name="brands"
                    value={b}
                    defaultChecked={checked}
                    // Enforced on the server too; this just stops a 21st pick early when JS runs.
                    onClick={(e) => {
                      if (brandsFull && e.currentTarget.checked) e.preventDefault();
                    }}
                    className="size-4 accent-primary"
                  />
                  {b}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md bg-surface-2 p-4 text-body-sm text-ink-2">Chưa có hãng nào được xác minh trong danh mục.</p>
        )}
        <FieldMessage id={`${uid}-brands-msg`} error={errors.brands} />
      </fieldset>

      <fieldset aria-describedby={`${uid}-cats-hint`} className="space-y-3">
        <legend className="display mb-1 text-h4 font-semibold leading-tight text-ink">Danh mục hay mua</legend>
        <p id={`${uid}-cats-hint`} className="text-body-sm text-ink-2">
          Khi bạn chọn đúng một danh mục, kết quả tìm kiếm sẽ tự lọc theo danh mục đó.
        </p>
        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label key={c.id} className={CHIP}>
                <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={initial.categoryIds.includes(c.id)} className="size-4 accent-primary" />
                {c.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="rounded-md bg-surface-2 p-4 text-body-sm text-ink-2">Chưa có danh mục nào.</p>
        )}
        <FieldMessage id={`${uid}-cats-msg`} error={errors.categoryIds} />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="display mb-1 text-h4 font-semibold leading-tight text-ink">Khoảng giá</legend>
        <p className="text-body-sm text-ink-2">Để trống nếu không muốn giới hạn. Có thể gõ tắt như 500k, 2tr5.</p>
        <div className="flex flex-wrap gap-4">
          <PriceBox id={`${uid}-min`} name="minPrice" label="Từ" initial={initial.minPrice} error={errors.minPrice} />
          <PriceBox id={`${uid}-max`} name="maxPrice" label="Đến" initial={initial.maxPrice} error={errors.maxPrice} />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="display mb-1 text-h4 font-semibold leading-tight text-ink">Sàn hay mua</legend>
        <div className="flex flex-wrap gap-2">
          {marketplaces.map((m) => (
            <label key={m.id} className={CHIP}>
              <input type="checkbox" name="marketplaces" value={m.id} defaultChecked={initial.marketplaces.some((id) => id === m.id)} className="size-4 accent-primary" />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="sticky bottom-0 -mx-7 -mb-7 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-line bg-surface px-7 py-4 max-[760px]:-mx-5 max-[760px]:-mb-5 max-[760px]:px-5">
        <p aria-live="polite" className="text-body-sm">
          {pending ? (
            <span className="text-ink-2">Đang lưu…</span>
          ) : errors.form ? (
            <span className="inline-flex items-start gap-1.5 font-semibold text-avoid">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              {errors.form}
            </span>
          ) : state.status === "error" ? (
            <span className="inline-flex items-start gap-1.5 font-semibold text-avoid">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              Chưa lưu được. Hãy sửa các mục được đánh dấu.
            </span>
          ) : saved ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <CheckIcon className="size-4" />
              Đã lưu sở thích.
            </span>
          ) : edited ? (
            <span className="font-medium text-ink">Có thay đổi chưa lưu</span>
          ) : null}
        </p>
        <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass({ size: "md" })}>
          {pending ? "Đang lưu…" : "Lưu sở thích"}
        </button>
      </div>
    </form>
  );
}
