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

const actions = await import("@/actions/account");

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
  it("consent not ticked → error on agree, nothing written", async () => {
    const r = await actions.acceptConsent({ status: "idle" }, form({ next: "/" }));
    expect(r).toEqual({ status: "error", errors: { agree: expect.any(String) } });
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("consent → writes the current version via admin, then redirects to next", async () => {
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
  it("invalid data → per-field errors", async () => {
    const r = await actions.updateNotificationSettings({ status: "idle" }, form({ frequency: "x", digestHour: "8" }));
    expect(r.status).toBe("error");
    expect(serverUpdate).not.toHaveBeenCalled();
  });
  it("valid → written via the server client", async () => {
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

describe("updateNotificationSettings — weekly digest", () => {
  it("writes frequency weekly_digest and digest_weekday", async () => {
    const r = await actions.updateNotificationSettings(
      { status: "idle" },
      form({ emailEnabled: "on", frequency: "weekly_digest", digestHour: "19", digestWeekday: "6" }),
    );
    expect(r).toEqual({ status: "saved" });
    expect(serverUpdate).toHaveBeenCalledWith(
      "notification_settings",
      expect.objectContaining({ frequency: "weekly_digest", digest_hour: 19, digest_weekday: 6 }),
    );
  });
  it("invalid weekday → error on digestWeekday, nothing written", async () => {
    const r = await actions.updateNotificationSettings(
      { status: "idle" },
      form({ frequency: "weekly_digest", digestHour: "8", digestWeekday: "9" }),
    );
    expect(r).toEqual({ status: "error", errors: { digestWeekday: expect.any(String) } });
    expect(serverUpdate).not.toHaveBeenCalled();
  });
});

describe("requestAccountDeletion", () => {
  it("wrong confirmation word → error", async () => {
    const r = await actions.requestAccountDeletion({ status: "idle" }, form({ confirm: "xoa" }));
    expect(r).toEqual({ status: "error", errors: { confirm: expect.any(String) } });
  });

  it("strict order: write deleted_at → send email → sign out everywhere → redirect", async () => {
    await expect(actions.requestAccountDeletion({ status: "idle" }, form({ confirm: " xóa " }))).rejects.toMatchObject({
      url: "/?account=deleted",
    });
    expect(calls).toEqual([
      "admin.update:users",
      "sendEmail",
      `signOut:${JSON.stringify({ scope: "global" })}`,
      "redirect:/?account=deleted",
    ]);
  });

  it("email failure still deletes and signs out", async () => {
    const { sendEmail } = await import("@/lib/email");
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(actions.requestAccountDeletion({ status: "idle" }, form({ confirm: "XÓA" }))).rejects.toMatchObject({
      url: "/?account=deleted",
    });
    expect(calls).toContain(`signOut:${JSON.stringify({ scope: "global" })}`);
  });
});
