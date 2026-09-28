import type { ComponentProps, ReactNode } from "react";
import { AlertIcon } from "@/components/ui/icons";

/**
 * DESIGN.md "Inputs / Fields": line-strong outline, surface fill, 12px corners, primary border on
 * focus, a 2px avoid border + icon message when invalid (aria-invalid drives the style).
 *
 * Sizes: sm 40px (dense forms like folder names), md 44px (dialogs), lg 48px (auth, main forms).
 * `className` is layout-only (margins, flex); width, text size and padding are parameters so two
 * conflicting Tailwind classes never meet.
 */
type FieldSize = "sm" | "md" | "lg";

const SIZE: Record<FieldSize, string> = {
  sm: "h-10 px-3",
  md: "min-h-11 px-3",
  lg: "h-12 px-4",
};
const TEXT = { control: "text-control", body: "text-body", title: "num text-title font-bold" } as const;

export function inputClass({
  size = "md",
  text = size === "sm" ? "control" : "body",
  width = "full",
  className = "",
}: {
  size?: FieldSize;
  text?: keyof typeof TEXT;
  /** "full" fills the row; "auto" lets the caller set a width in className (e.g. w-20). */
  width?: "full" | "auto";
  className?: string;
} = {}): string {
  return [
    "min-w-0 rounded-md border border-line-strong bg-surface text-ink placeholder:text-ink-3 transition-colors duration-150 ease-out focus:border-primary aria-[invalid=true]:border-2 aria-[invalid=true]:border-avoid",
    SIZE[size],
    TEXT[text],
    width === "full" ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Error (with icon, avoid) or hint under a field; `id` is what the input's aria-describedby points to. */
export function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: ReactNode }) {
  if (!error && !hint) return null;
  return (
    <div id={id} className="mt-1.5 text-body-sm leading-snug">
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 font-semibold text-avoid">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}

/** Label + input + message, wired for screen readers. Extra input props pass through. */
export function TextField({
  id,
  label,
  error,
  hint,
  size = "lg",
  className = "",
  ...input
}: {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  size?: FieldSize;
  className?: string;
} & Omit<ComponentProps<"input">, "id" | "size" | "className">) {
  const describedBy = error || hint ? `${id}-msg` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-body-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={inputClass({ size, className: "mt-1.5" })}
        {...input}
      />
      <FieldMessage id={`${id}-msg`} error={error} hint={hint} />
    </div>
  );
}
