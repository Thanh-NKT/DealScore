/**
 * Theo redirect cho URL rút gọn của Shopee với kiểm tra bảo mật SSRF chặt chẽ.
 *
 * Người dùng cung cấp URL và server đi gọi nó. Mỗi hop đều phải qua:
 * https, cổng mặc định, host nằm CHÍNH XÁC trong allowlist dùng chung với
 * parse-url.ts. Không bao giờ trả body của response về client.
 */
import { parseShopeeUrl, SHOPEE_HOSTS, SHORT_HOSTS } from "@/lib/shopee/parse-url";

const MAX_HOPS = 3;
const HOP_TIMEOUT_MS = 3000;

function isHostAllowed(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  // url.port rỗng = cổng mặc định của scheme (443). Cổng khác là dấu hiệu
  // đang bị dắt tới một dịch vụ nội bộ.
  return url.port === "" && (SHOPEE_HOSTS.has(h) || SHORT_HOSTS.has(h));
}

export async function resolveShopeeRedirect(
  initialUrl: string,
): Promise<
  | { ok: true; finalUrl: string }
  | {
      ok: false;
      reason:
        | "host_not_allowed"
        | "too_many_hops"
        | "timeout"
        | "insecure"
        | "error";
    }
> {
  let currentUrl = initialUrl;

  // hop = số request đã gửi. Kiểm tra URL hiện tại TRƯỚC mỗi request, và
  // kiểm tra cả URL đích cuối cùng sau request thứ MAX_HOPS.
  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: "error" };
    }

    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "insecure" };
    }
    if (!isHostAllowed(parsed)) {
      return { ok: false, reason: "host_not_allowed" };
    }

    // Đã tới URL sản phẩm đọc được — dừng, không gọi thêm request thừa.
    if (parseShopeeUrl(currentUrl).ok) {
      return { ok: true, finalUrl: currentUrl };
    }

    if (hop >= MAX_HOPS) {
      return { ok: false, reason: "too_many_hops" };
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "error" };
    }

    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) {
      // Không redirect nữa: URL hiện tại là đích.
      return { ok: true, finalUrl: currentUrl };
    }

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      return { ok: false, reason: "error" };
    }
  }
}
