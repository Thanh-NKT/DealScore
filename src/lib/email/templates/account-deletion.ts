import { escapeHtml, formatVnDate } from "@/lib/email/escape";

export function renderAccountDeletionEmail(input: {
  purgeDate: Date;
  siteUrl: string;
}): { subject: string; html: string; text: string } {
  const { purgeDate, siteUrl } = input;

  const dateStr = formatVnDate(purgeDate);
  // Every value interpolated into HTML must be escaped.
  const hDate = escapeHtml(dateStr);
  const hLogin = escapeHtml(`${siteUrl}/login`);

  const subject = "Xác nhận yêu cầu xóa tài khoản Kairo";

  const text = `Chúng tôi đã nhận được yêu cầu xóa tài khoản Kairo của bạn.

Mọi thông báo và theo dõi giá đã dừng ngay lập tức.
Tài khoản và dữ liệu cá nhân của bạn sẽ bị xóa vĩnh viễn vào ngày ${dateStr}.

Nếu bạn muốn khôi phục tài khoản, vui lòng đăng nhập lại tại:
${siteUrl}/login trước ngày ${dateStr}.

Lưu ý: Lịch sử click liên kết mua sắm được giữ lại độc lập và tách biệt hoàn toàn khỏi danh tính người dùng nhằm phục vụ đối soát hoa hồng với sàn.`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #111; max-width: 500px; margin: 0 auto; padding: 24px;">
  <h2>Xác nhận yêu cầu xóa tài khoản</h2>
  <p>Chúng tôi đã nhận được yêu cầu xóa tài khoản Kairo của bạn.</p>
  <p>Mọi thông báo và theo dõi giá đã được <strong>dừng ngay lập tức</strong>. Toàn bộ thông tin cá nhân và dữ liệu theo dõi sẽ được xóa vĩnh viễn vào ngày <strong>${hDate}</strong>.</p>
  <p>Trong vòng 30 ngày (trước ${hDate}), nếu bạn đổi ý, bạn có thể đăng nhập lại để khôi phục tài khoản nguyên vẹn:</p>
  <p style="margin: 20px 0;">
    <a href="${hLogin}" style="background-color: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">Đăng nhập để khôi phục</a>
  </p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="font-size: 13px; color: #666;">
    Lưu ý: Dữ liệu click mua sắm được lưu giữ ở dạng vô danh nhằm đối soát hoa hồng tiếp thị liên kết và không gắn với bất kỳ danh tính nào.
  </p>
</body>
</html>`;

  return { subject, html, text };
}
