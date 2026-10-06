import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPushPayload } from "@/lib/push/payload";
import { formatVnd } from "@/lib/format";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

const subs = [
  { id: "s1", endpoint: "https://push/1", p256dh: "k", auth: "a", failure_count: 0 },
  { id: "s2", endpoint: "https://push/2", p256dh: "k", auth: "a", failure_count: 4 },
];
const deleted: string[] = [];
const updated: Array<[string, Record<string, unknown>]> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: subs, error: null }) }),
      delete: () => ({ eq: async (_c: string, id: string) => (deleted.push(id), { error: null }) }),
      update: (v: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => (updated.push([id, v]), { error: null }) }),
    }),
  }),
}));

const { sendPushToUser } = await import("@/lib/push");

beforeEach(() => {
  deleted.length = 0;
  updated.length = 0;
  sendNotification.mockReset();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:a@dealscore.vn");
});

describe("buildPushPayload", () => {
  it("1 item → product page; n items → Watch list", () => {
    expect(buildPushPayload([{ productName: "SSD", price: 1_000_000, url: "https://k/ssd/a?variant=v" }], "https://k")).toEqual({
      title: "SSD",
      body: `Còn ${formatVnd(1_000_000)}`,
      url: "https://k/ssd/a?variant=v",
      tag: "dealscore-alert",
    });
    const many = buildPushPayload(
      [
        { productName: "A", price: 1, url: "u" },
        { productName: "B", price: 1, url: "u" },
        { productName: "C", price: 1, url: "u" },
      ],
      "https://k",
    );
    expect(many).toMatchObject({ title: "3 sản phẩm có tin mới", url: "https://k/account/watch" });
  });
});

describe("sendPushToUser", () => {
  it("410 → delete the subscription; other errors reaching 5 → delete", async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const r = await sendPushToUser("u", { title: "t", body: "b", url: "u", tag: "dealscore-alert" });
    expect(r).toEqual({ delivered: 0, removed: 2, failed: 1 });
    expect(deleted.sort()).toEqual(["s1", "s2"]);
  });

  it("success → updates last_success_at", async () => {
    sendNotification.mockResolvedValue({});
    const r = await sendPushToUser("u", { title: "t", body: "b", url: "u", tag: "dealscore-alert" });
    expect(r.delivered).toBe(2);
    expect(updated.map(([id]) => id).sort()).toEqual(["s1", "s2"]);
  });

  it("missing VAPID keys → throws", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await expect(sendPushToUser("u", { title: "t", body: "b", url: "u", tag: "dealscore-alert" })).rejects.toThrow();
  });
});
