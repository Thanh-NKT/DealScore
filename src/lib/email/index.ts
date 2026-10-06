import "server-only";
import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  /**
   * Sent as Resend's Idempotency-Key (kept 24h): a retry with the same key and payload is not sent
   * again; the same key with a different payload fails with code "invalid_idempotent_request".
   */
  idempotencyKey?: string;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    /** Resend error name, when Resend answered with one. */
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function sendEmail(
  msg: EmailMessage,
): Promise<{ id: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  const isProduction = process.env.NODE_ENV === "production";

  if (!apiKey) {
    if (isProduction) {
      throw new EmailSendError(
        "RESEND_API_KEY is not configured in the production environment.",
      );
    }
    // Development mode: print the email to the console
    console.info("--- [SEND EMAIL (DEV CONSOLE)] ---");
    console.info(`To: ${msg.to}`);
    console.info(`Subject: ${msg.subject}`);
    console.info(`Text:\n${msg.text}`);
    console.info("----------------------------------");
    return { id: null };
  }

  // Sending with a default address when the sender is missing means sending from a possibly unverified domain.
  const from = process.env.EMAIL_FROM;
  if (!from) throw new EmailSendError("Missing EMAIL_FROM");

  const resend = new Resend(apiKey);

  try {
    const payload = {
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: msg.headers,
      tags: msg.tags,
    };
    const res = msg.idempotencyKey
      ? await resend.emails.send(payload, { idempotencyKey: msg.idempotencyKey })
      : await resend.emails.send(payload);

    if (res.error) {
      throw new EmailSendError(
        `Resend email error: ${res.error.message}`,
        res.error.name,
      );
    }

    return { id: res.data?.id ?? null };
  } catch (err) {
    if (err instanceof EmailSendError) throw err;
    throw new EmailSendError(
      `Could not send email: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
