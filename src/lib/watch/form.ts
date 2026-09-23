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
 * Gợi ý giá mục tiêu mặc định:
 * Giá hiện tại − 10%, làm tròn xuống tới 1.000 ₫.
 * Trả về null nếu chưa có giá.
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

  // 1. variantId (phải là UUID)
  const variantId = getSingle("variantId")?.trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!variantId || !uuidRegex.test(variantId)) {
    errors.variantId = "ID phiên bản sản phẩm không hợp lệ.";
  }

  // 2. targetPrice (số nguyên dương, chấp nhận dấu chấm ngăn cách)
  let targetPrice: number | null = null;
  const targetPriceRaw = getSingle("targetPrice")?.trim();
  if (targetPriceRaw && targetPriceRaw !== "") {
    const cleaned = targetPriceRaw.replace(/\./g, "").replace(/,/g, "");
    const parsed = Number(cleaned);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.targetPrice = "Giá mục tiêu phải là số tiền dương.";
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

  // 4. notifyLow (chạm đáy)
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

  // 6. notifyBackInStock (có hàng lại)
  const notifyBackInStockVal = getSingle("notifyBackInStock");
  const notifyBackInStock =
    notifyBackInStockVal === "on" || notifyBackInStockVal === "true";

  // Kiểm tra ít nhất 1 điều kiện được chọn
  const hasCondition =
    targetPrice !== null ||
    dropPct !== null ||
    notifyLow ||
    minDealScore !== null ||
    notifyBackInStock;

  if (!hasCondition) {
    errors._form = "Vui lòng chọn ít nhất một điều kiện theo dõi giá.";
  }

  // 7. channels
  const rawChannels = getAll("channels").concat(getAll("channel"));
  let channels: Channel[] | null = null;

  if (rawChannels.some((c) => c !== "email" && c !== "push" && c !== "account")) {
    // Không lặng lẽ đổi giá trị lạ thành "theo tài khoản": làm vậy có thể bật
    // lại một kênh người dùng muốn loại khỏi Watch này.
    errors.channels = "Kênh không hợp lệ.";
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
    },
  };
}
