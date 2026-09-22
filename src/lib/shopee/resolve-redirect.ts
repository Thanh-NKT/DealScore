/**
 * Theo redirect cho URL rút gọn của Shopee với kiểm tra bảo mật SSRF chặt chẽ.
 */

export const SHOPEE_HOST_ALLOWLIST = [
  "shopee.vn",
  "shope.ee",
  "s.shopee.vn",
] as const;

function isHostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return SHOPEE_HOST_ALLOWLIST.some(
    (allowed) => h === allowed || h.endsWith(`.${allowed}`),
  );
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
  const maxHops = 3;

  for (let hop = 0; hop < maxHops; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: "error" };
    }

    // Chỉ chấp nhận HTTPS
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "insecure" };
    }

    // Kiểm tra allowlist
    if (!isHostAllowed(parsed.hostname)) {
      return { ok: false, reason: "host_not_allowed" };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Nếu có redirect status (301, 302, 307, 308)
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return { ok: true, finalUrl: currentUrl };
        }

        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = nextUrl;
      } else {
        // Đã đến URL đích
        return { ok: true, finalUrl: currentUrl };
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "timeout" };
      }
      return { ok: false, reason: "error" };
    }
  }

  // Quá 3 hops
  return { ok: false, reason: "too_many_hops" };
}
