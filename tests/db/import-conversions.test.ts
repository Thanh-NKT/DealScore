import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { upsertNormalizedConversions } from "@/lib/affiliate/import";
import type { NormalizedConversion } from "@/lib/affiliate/normalize";
import { admin } from "./helpers";

const prefix = `IMP-${randomUUID()}`;
afterAll(async () => {
  await admin.from("conversions").delete().like("order_id", `${prefix}%`);
});

const row = (i: number): NormalizedConversion => ({
  order_id: `${prefix}-${i}`,
  item_id: "1",
  model_id: "",
  click_event_id: null,
  sub_ids: [],
  source_channel: "unknown",
  purchase_time: new Date().toISOString(),
  complete_time: null,
  status: "pending",
  raw_status: "PENDING",
  item_price: 1,
  quantity: 1,
  order_value: 1,
  commission: 0,
  import_source: "csv",
  raw: {},
});

describe("upsertNormalizedConversions", () => {
  it("batches of 500 with accumulated results", async () => {
    const rows = Array.from({ length: 1203 }, (_, i) => row(i));
    const r1 = await upsertNormalizedConversions(rows, admin);
    expect(r1).toEqual({ inserted: 1203, updated: 0, matched: 0 });
    const r2 = await upsertNormalizedConversions(rows, admin);
    expect(r2).toEqual({ inserted: 0, updated: 1203, matched: 0 });
  });
});
