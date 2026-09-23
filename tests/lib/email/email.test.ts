import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
// Plain function, not an arrow: Resend is called with `new`.
vi.mock("resend", () => ({ Resend: vi.fn(function () { return { emails: { send } }; }) }));

const { sendEmail, EmailSendError } = await import("@/lib/email");
const { escapeHtml, formatVnDate } = await import("@/lib/email/escape");
const { renderAccountDeletionEmail } = await import("@/lib/email/templates/account-deletion");

const msg = { to: "an@kairo.vn", subject: "S", html: "<p>H</p>", text: "T" };

afterEach(() => {
  vi.unstubAllEnvs();
  send.mockReset();
});

describe("sendEmail", () => {
  it("with a key → sends via Resend with EMAIL_FROM", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("EMAIL_FROM", "Kairo <a@kairo.vn>");
    send.mockResolvedValue({ data: { id: "m1" }, error: null });
    await expect(sendEmail(msg)).resolves.toEqual({ id: "m1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: "Kairo <a@kairo.vn>", to: "an@kairo.vn" }));
  });

  it("Resend returns an error → EmailSendError", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("EMAIL_FROM", "Kairo <a@kairo.vn>");
    send.mockResolvedValue({ data: null, error: { message: "bad" } });
    await expect(sendEmail(msg)).rejects.toBeInstanceOf(EmailSendError);
  });

  it("no key in dev → prints to console, id null", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(sendEmail(msg)).resolves.toEqual({ id: null });
    expect(info).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("no key in production → throws", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail(msg)).rejects.toBeInstanceOf(EmailSendError);
  });
});

describe("escape / date", () => {
  it("escapes all 5 characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("formats dates in Vietnam time", () => {
    // 20:00Z on the 22nd = 03:00 Vietnam time on the 23rd
    expect(formatVnDate(new Date("2026-10-22T20:00:00Z"))).toBe("23/10/2026");
  });
});

describe("renderAccountDeletionEmail", () => {
  it("has the hard-deletion date, login link, click notice; html escaped", () => {
    const e = renderAccountDeletionEmail({
      purgeDate: new Date("2026-10-23T03:00:00Z"),
      siteUrl: "https://kairo.vn/<x>",
    });
    expect(e.subject).toContain("xóa");
    expect(e.text).toContain("23/10/2026");
    expect(e.text).toContain("https://kairo.vn/<x>/login");
    expect(e.html).toContain("&lt;x&gt;");
    expect(e.html).not.toContain("<x>");
    expect(e.text).toMatch(/click/i);
  });
});
