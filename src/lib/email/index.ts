import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export class EmailSendError extends Error {}

export async function sendEmail(
  msg: EmailMessage,
): Promise<{ id: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  const isProduction = process.env.NODE_ENV === "production";

  if (!apiKey) {
    if (isProduction) {
      throw new EmailSendError(
        "RESEND_API_KEY chưa được cấu hình trong môi trường production.",
      );
    }
    // Chế độ phát triển: in email ra console
    console.info("--- [GỬI EMAIL (DEV CONSOLE)] ---");
    console.info(`To: ${msg.to}`);
    console.info(`Subject: ${msg.subject}`);
    console.info(`Text:\n${msg.text}`);
    console.info("----------------------------------");
    return { id: null };
  }

  // Thiếu người gửi mà vẫn gửi bằng địa chỉ mặc định là gửi từ domain có thể chưa xác minh.
  const from = process.env.EMAIL_FROM;
  if (!from) throw new EmailSendError("Thiếu EMAIL_FROM");

  const resend = new Resend(apiKey);

  try {
    const res = await resend.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.headers,
      tags: msg.tags,
    });

    if (res.error) {
      throw new EmailSendError(
        `Lỗi gửi email qua Resend: ${res.error.message}`,
      );
    }

    return { id: res.data?.id ?? null };
  } catch (err) {
    if (err instanceof EmailSendError) throw err;
    throw new EmailSendError(
      `Không thể gửi email: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
