import type { Channel } from "@/lib/account/notification-settings";
import type { WatchConfig } from "@/lib/watch/types";

export type WatchField =
  | "variantId"
  | "targetPrice"
  | "dropPct"
  | "minDealScore"
  | "channels"
  | "_form";

/**
 * Default target price suggestion:
 * current price − 10%, rounded down to 1,000 ₫.
 * Returns null when there is no price yet.
 */
export function suggestTargetPrice(currentPrice: number | null): number | null {
  if (currentPrice === null || currentPrice <= 0) return null;
  const suggested = Math.floor((currentPrice * 0.9) / 1000) * 1000;
  return suggested > 0 ? suggested : 1000;
}

export function parseWatchForm(
  form: FormData | Record<string, string | string[] | undefined>,
):
  | { ok: true; variantId: string; config: WatchConfig }
  | { ok: false; errors: Partial<Record<WatchField, string>> } {
  const getSingle = (key: string): string | undefined => {
    if (form instanceof FormData) {
      const val = form.get(key);
      return typeof val === "string" ? val : undefined;
    }
    const val = form[key];
    return Array.isArray(val) ? val[0] : val;
  };

  const getAll = (key: string): string[] => {
    if (form instanceof FormData) {
      return form.getAll(key).filter((v): v is string => typeof v === "string");
    }
    const val = form[key];
    if (Array.isArray(val)) return val;
    if (typeof val === "string") return [val];
    return [];
  };

  const errors: Partial<Record<WatchField, string>> = {};

  // 1. variantId (must be a UUID)
  const variantId = getSingle("variantId")?.trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!variantId || !uuidRegex.test(variantId)) {
    errors.variantId = "Chưa lưu được theo dõi. Tải lại trang sản phẩm rồi thử lại.";
  }

  // 2. targetPrice (positive integer, dot thousands separators accepted)
  let targetPrice: number | null = null;
  const targetPriceRaw = getSingle("targetPrice")?.trim();
  if (targetPriceRaw && targetPriceRaw !== "") {
    const cleaned = targetPriceRaw.replace(/\./g, "").replace(/,/g, "");
    const parsed = Number(cleaned);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.targetPrice = "Giá mong muốn phải là một số tiền lớn hơn 0đ.";
    } else {
      targetPrice = parsed;
    }
  }

  // 3. dropPct (1-90)
  let dropPct: number | null = null;
  const dropPctRaw = getSingle("dropPct")?.trim();
  if (dropPctRaw && dropPctRaw !== "") {
    const parsed = Number(dropPctRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
      errors.dropPct = "Phần trăm giảm giá phải từ 1% đến 90%.";
    } else {
      dropPct = parsed;
    }
  }

  // 4. notifyLow (hits the low)
  const notifyLowVal = getSingle("notifyLow");
  const notifyLow = notifyLowVal === "on" || notifyLowVal === "true";

  // 5. minDealScore (1-100)
  let minDealScore: number | null = null;
  const minDealScoreRaw = getSingle("minDealScore")?.trim();
  if (minDealScoreRaw && minDealScoreRaw !== "") {
    const parsed = Number(minDealScoreRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      errors.minDealScore = "Deal Score phải từ 1 đến 100.";
    } else {
      minDealScore = parsed;
    }
  }

  // 6. notifyBackInStock (back in stock)
  const notifyBackInStockVal = getSingle("notifyBackInStock");
  const notifyBackInStock =
    notifyBackInStockVal === "on" || notifyBackInStockVal === "true";

  // 6b. notifyPriceHike ("Giá bị đẩy lên bất thường", opt-in)
  const notifyPriceHikeVal = getSingle("notifyPriceHike");
  const notifyPriceHike = notifyPriceHikeVal === "on" || notifyPriceHikeVal === "true";

  // Require at least one condition
  const hasCondition =
    targetPrice !== null ||
    dropPct !== null ||
    notifyLow ||
    minDealScore !== null ||
    notifyBackInStock ||
    notifyPriceHike;

  if (!hasCondition) {
    errors._form = "Chọn ít nhất một điều kiện để DealScore biết khi nào cần báo.";
  }

  // 7. channels
  const rawChannels = getAll("channels").concat(getAll("channel"));
  let channels: Channel[] | null = null;

  if (rawChannels.some((c) => c !== "email" && c !== "push" && c !== "account")) {
    // Don't silently turn an unknown value into "follow the account": that could
    // re-enable a channel the user wanted excluded from this Watch.
    errors.channels = "Chưa lưu được cách nhận thông báo. Tải lại trang rồi thử lại.";
  } else if (rawChannels.includes("account") || rawChannels.length === 0) {
    channels = null;
  } else {
    const validChannels: Channel[] = [];
    if (rawChannels.includes("email")) validChannels.push("email");
    if (rawChannels.includes("push")) validChannels.push("push");
    if (validChannels.length > 0) {
      channels = validChannels;
    } else {
      channels = null;
    }
  }

  if (Object.keys(errors).length > 0 || !variantId) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    variantId,
    config: {
      targetPrice,
      dropPct,
      notifyLow,
      minDealScore,
      notifyBackInStock,
      channels,
      notifyPriceHike,
    },
  };
}
