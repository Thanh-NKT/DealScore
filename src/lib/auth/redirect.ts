import { needsConsent } from "@/lib/consent";

/**
 * Đường dẫn nội bộ an toàn để quay về sau đăng nhập.
 * Ngăn chặn lỗ hổng Open Redirect. Không hợp lệ → trả về fallback.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = "/",
): string {
  if (!raw || typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\")
  ) {
    return fallback;
  }

  // Kiểm tra ký tự điều khiển (ASCII 0-31 hoặc 127)
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return fallback;
  }

  try {
    const url = new URL(trimmed, "http://kairo.invalid");
    if (url.origin !== "http://kairo.invalid") {
      return fallback;
    }

    // Không chuyển hướng lặp vòng về luồng đăng nhập hoặc xác thực
    const pathname = url.pathname;
    if (
      pathname === "/dang-nhap" ||
      pathname.startsWith("/auth/")
    ) {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export type AuthGate =
  | { kind: "ok" }
  | { kind: "login"; to: string } // /dang-nhap?next=…
  | { kind: "consent"; to: string } // /tai-khoan/dong-y?next=…
  | { kind: "restore"; to: string }; // /tai-khoan/khoi-phuc

export function decideAuthGate(input: {
  userId: string | null;
  profile: { consentVersion: string | null; deletedAt: string | null } | null;
  path: string;
  allowPendingDeletion?: boolean;
  allowMissingConsent?: boolean;
}): AuthGate {
  const {
    userId,
    profile,
    path,
    allowPendingDeletion = false,
    allowMissingConsent = false,
  } = input;

  // 1. Chưa đăng nhập → login
  if (!userId) {
    const safePath = safeNextPath(path, "/");
    return {
      kind: "login",
      to: `/dang-nhap?next=${encodeURIComponent(safePath)}`,
    };
  }

  // 2. Profile null → ném lỗi hạ tầng (trigger phải luôn tạo hồ sơ)
  if (!profile) {
    throw new Error(`Không tìm thấy hồ sơ người dùng cho ID: ${userId}`);
  }

  // 3. Đang chờ xóa (deletedAt != null) và không cho phép → restore
  if (profile.deletedAt && !allowPendingDeletion) {
    return { kind: "restore", to: "/tai-khoan/khoi-phuc" };
  }

  // 4. Cần đồng ý điều khoản mới/lần đầu và không cho phép bỏ qua → consent
  if (needsConsent(profile.consentVersion) && !allowMissingConsent) {
    const safePath = safeNextPath(path, "/tai-khoan");
    return {
      kind: "consent",
      to: `/tai-khoan/dong-y?next=${encodeURIComponent(safePath)}`,
    };
  }

  // 5. Đủ điều kiện truy cập
  return { kind: "ok" };
}
