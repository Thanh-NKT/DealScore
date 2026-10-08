import { SHARE_DISPLAY_NAME_MAX, SHARE_TITLE_MAX } from "@/lib/share-folder/constants";

export interface ShareSettings {
  title: string | null;
  displayName: string | null;
  showPrices: boolean;
  showTarget: boolean;
  showNotes: boolean;
  includeDone: boolean;
}

export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  title: null,
  displayName: null,
  showPrices: true,
  showTarget: false,
  showNotes: false,
  includeDone: false,
};

export type ShareSettingsErrors = Partial<Record<"title" | "displayName", string>>;

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  return s || null;
};

/**
 * Settings of a public share. Display name rejects "@" and 6+ digit runs (same spirit as demandKeyword): no
 * e-mail or phone number on a public page. Pure.
 */
export function validateShareSettings(input: unknown): { ok: true; value: ShareSettings } | { ok: false; errors: ShareSettingsErrors } {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: ShareSettingsErrors = {};
  const title = clean(r.title);
  if (title && title.length > SHARE_TITLE_MAX) errors.title = `Tiêu đề tối đa ${SHARE_TITLE_MAX} ký tự.`;
  const displayName = clean(r.displayName);
  if (displayName) {
    if (displayName.length > SHARE_DISPLAY_NAME_MAX) errors.displayName = `Tên tối đa ${SHARE_DISPLAY_NAME_MAX} ký tự.`;
    else if (displayName.includes("@") || /\d{6,}/.test(displayName.replace(/[\s.\-()+]/g, ""))) {
      errors.displayName = "Không ghi email hay số điện thoại.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    ok: true,
    value: {
      title,
      displayName,
      showPrices: bool(r.showPrices, DEFAULT_SHARE_SETTINGS.showPrices),
      showTarget: bool(r.showTarget, DEFAULT_SHARE_SETTINGS.showTarget),
      showNotes: bool(r.showNotes, DEFAULT_SHARE_SETTINGS.showNotes),
      includeDone: bool(r.includeDone, DEFAULT_SHARE_SETTINGS.includeDone),
    },
  };
}

/** DB columns of watch_folder_shares for these settings. */
export function shareSettingsRow(s: ShareSettings) {
  return {
    title: s.title,
    display_name: s.displayName,
    show_prices: s.showPrices,
    show_target: s.showTarget,
    show_notes: s.showNotes,
    include_done: s.includeDone,
  };
}

export function shareSettingsFromRow(r: {
  title: string | null;
  display_name: string | null;
  show_prices: boolean;
  show_target: boolean;
  show_notes: boolean;
  include_done: boolean;
}): ShareSettings {
  return {
    title: r.title,
    displayName: r.display_name,
    showPrices: r.show_prices,
    showTarget: r.show_target,
    showNotes: r.show_notes,
    includeDone: r.include_done,
  };
}
