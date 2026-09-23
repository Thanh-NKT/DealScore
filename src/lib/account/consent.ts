/**
 * Quản lý phiên bản đồng ý Điều khoản sử dụng và Chính sách quyền riêng tư.
 * Đổi giá trị này khi Điều khoản hoặc Chính sách đổi — mọi người dùng phải đồng ý lại.
 */
export const CURRENT_CONSENT_VERSION = "2026-09-23";

export function needsConsent(consentVersion: string | null | undefined): boolean {
  return consentVersion !== CURRENT_CONSENT_VERSION;
}
