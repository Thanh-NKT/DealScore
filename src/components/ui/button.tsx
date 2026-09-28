import type { ComponentProps } from "react";
import Link from "next/link";
import { marketplaceStyle } from "@/components/product/marketplace";

/**
 * DESIGN.md "Buttons". One place for the action styles so screens cannot drift apart.
 *
 * - primary: the one petrol action per area.
 * - secondary: outlined, for the second action.
 * - ink: night fill, for confirmations inside dialogs.
 * - accent: lime, only for "đang theo dõi" states.
 * - danger: outlined red, for destructive actions (xóa) that sit next to a primary.
 * - marketplace: the exit button to a marketplace, coloured by marketplaceStyle(code).
 *
 * Sizes: sm 40px (dense rows, dialogs), md 44px (default), lg 52px (the main action of a card or page).
 * Disabled and busy are built in; focus comes from the global :focus-visible ring.
 */
export type ButtonVariant = "primary" | "secondary" | "ink" | "accent" | "danger" | "marketplace";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-colors duration-150 ease-out cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3.5 text-label",
  md: "min-h-11 px-5 text-control",
  lg: "min-h-13 px-6 text-body",
};

const DISABLED = "disabled:border-line disabled:bg-surface-2 disabled:text-ink-3 disabled:shadow-none";

const VARIANT: Record<Exclude<ButtonVariant, "marketplace">, string> = {
  primary: `bg-primary text-on-primary hover:bg-primary-hover ${DISABLED}`,
  secondary: `border border-line-strong bg-surface text-ink hover:bg-surface-2 ${DISABLED}`,
  ink: `bg-night text-night-ink hover:opacity-90 ${DISABLED}`,
  accent: `border border-accent bg-accent text-on-accent hover:opacity-92 ${DISABLED}`,
  danger: `border border-avoid bg-surface text-avoid hover:bg-avoid-soft ${DISABLED}`,
};

export interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width of the container. */
  block?: boolean;
  /** Corner step: md (default); inner/sm only for a button nested inside a rounded field. */
  rounded?: "sm" | "inner" | "md";
  /** Marketplace code for variant="marketplace" (shopee, lazada…). */
  marketplace?: string | null;
  className?: string;
}

/** The class string, for elements that are not <button>/<Link> (e.g. <summary>, form buttons in shared constants). */
// `className` is for layout only (margins, flex, responsive tweaks): never pass padding, gap, height,
// radius or colour here, Tailwind does not guarantee which of two conflicting classes wins.
export function buttonClass({ variant = "primary", size = "md", block = false, rounded = "md", marketplace, className = "" }: ButtonStyle = {}): string {
  const tone = variant === "marketplace" ? `${marketplaceStyle(marketplace).primaryBtn} ${DISABLED}` : VARIANT[variant];
  return [BASE, `rounded-${rounded}`, SIZE[size], tone, block ? "w-full" : "", className].filter(Boolean).join(" ");
}

type ButtonProps = ButtonStyle &
  Omit<ComponentProps<"button">, "className"> & {
    /** Shows the busy state: disabled, aria-busy. Pass the busy label as children ("Đang lưu…"). */
    busy?: boolean;
  };

export function Button({ variant, size, block, rounded, marketplace, className, busy = false, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass({ variant, size, block, rounded, marketplace, className })}
      {...rest}
    />
  );
}

type ButtonLinkProps = ButtonStyle & Omit<ComponentProps<typeof Link>, "className">;

export function ButtonLink({ variant, size, block, rounded, marketplace, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass({ variant, size, block, rounded, marketplace, className })} {...rest} />;
}
