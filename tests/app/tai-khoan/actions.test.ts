import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const user = { id: "u1", email: "an@kairo.vn", consentVersion: null, marketingOptIn: false, deletedAt: null };

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(async () => user) }));

const adminUpdate = vi.fn();
function adminChain(table: string) {
  return {
    update: (values: Record<string, unknown>) => {
      adminUpdate(table, values);
      calls.push(`admin.update:${table}`);
      const chain = {
        eq: () => chain,
        is: () => chain,
        then: (res: (v: { error: null }) => void) => res({ error: null }),
      };
      return chain;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: adminChain }) }));

const serverUpdate = vi.fn();
const signOut = vi.fn(async (opts: unknown) => {
  calls.push(`signOut:${JSON.stringify(opts)}`);
  return { error: null };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signOut },
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        serverUpdate(table, values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => {
    calls.push("sendEmail");
    return { id: null };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    calls.push(`redirect:${url}`);
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const actions = await import("@/app/tai-khoan/actions");

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("acceptConsent", () => {
  it("không tick đồng ý → lỗi ở agree, không ghi gì", async () => {
    const r = await actions.acceptConsent({ status: "idle" }, form({ next: "/" }));
    expect(r).toEqual({ status: "error", errors: { agree: expect.any(String) } });
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("đồng ý → ghi phiên bản hiện hành bằng admin rồi redirect next", async () => {
    await expect(
      actions.acceptConsent({ status: "idle" }, form({ agree: "on", marketing: "on", next: "/ssd/a" })),
    ).rejects.toMatchObject({ url: "/ssd/a" });
    expect(adminUpdate).toHaveBeenCalledWith(
      "users",
      expect.objectContaining({ consent_version: "2026-09-23", marketing_opt_in: true }),
    );
  });
});

describe("updateNotificationSettings", () => {
  it("dữ liệu sai → trả lỗi theo trường", async () => {
    const r = await actions.updateNotificationSettings({ status: "idle" }, form({ frequency: "x", digestHour: "8" }));
    expect(r.status).toBe("error");
    expect(serverUpdate).not.toHaveBeenCalled();
  });
  it("hợp lệ → ghi bằng server client", async () => {
    const r = await actions.updateNotificationSettings(
      { status: "idle" },
      form({ emailEnabled: "on", frequency: "instant", digestHour: "8" }),
    );
    expect(r).toEqual({ status: "saved" });
    expect(serverUpdate).toHaveBeenCalledWith(
      "notification_settings",
      expect.objectContaining({ email_enabled: true, frequency: "instant" }),
    );
  });
});

describe("requestAccountDeletion", () => {
  it("gõ sai chữ xác nhận → lỗi", async () => {
    const r = await actions.requestAccountDeletion({ status: "idle" }, form({ confirm: "xoa" }));
    expect(r).toEqual({ status: "error", errors: { confirm: expect.any(String) } });
  });

  it("đúng thứ tự: ghi deleted_at → gửi email → đăng xuất mọi nơi → redirect", async () => {
    await expect(actions.requestAccountDeletion({ status: "idle" }, form({ confirm: " xóa " }))).rejects.toMatchObject({
      url: "/?tai-khoan=da-xoa",
    });
    expect(calls).toEqual([
      "admin.update:users",
      "sendEmail",
      `signOut:${JSON.stringify({ scope: "global" })}`,
      "redirect:/?tai-khoan=da-xoa",
    ]);
  });

  it("gửi email lỗi vẫn xóa và đăng xuất", async () => {
    const { sendEmail } = await import("@/lib/email");
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(actions.requestAccountDeletion({ status: "idle" }, form({ confirm: "XÓA" }))).rejects.toMatchObject({
      url: "/?tai-khoan=da-xoa",
    });
    expect(calls).toContain(`signOut:${JSON.stringify({ scope: "global" })}`);
  });
});
