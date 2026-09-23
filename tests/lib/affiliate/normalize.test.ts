import { describe, expect, it } from "vitest";
import {
  normalizeApiRow,
  normalizeCsvRow,
  normalizeStatus,
  parseMoney,
  parseTime,
} from "@/lib/affiliate/normalize";

const HEX = "3f2a1b4c5d6e4f708a9b0c1d2e3f4a5b";
const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("normalizeStatus", () => {
  it.each([
    ["PENDING", "pending"],
    [" to_ship ", "pending"],
    ["Completed", "completed"],
    ["SETTLED", "completed"],
    ["Cancelled", "cancelled"],
    ["refunded", "cancelled"],
    ["???", "unknown"],
  ])("%s → %s", (raw, want) => expect(normalizeStatus(raw)).toBe(want));
});

describe("parseMoney", () => {
  it.each([
    [1250000, 1250000],
    ["1250000", 1250000],
    ["1.250.000", 1250000],
    ["1,250,000.00", 1250000],
    ["₫1.250.000", 1250000],
    ["12.5", 12.5],
    ["", null],
    ["abc", null],
    [null, null],
  ])("%j → %j", (raw, want) => expect(parseMoney(raw)).toBe(want));
});

describe("parseTime", () => {
  it("ISO, epoch giây, epoch ms, dd/MM/yyyy HH:mm:ss (giờ VN)", () => {
    expect(parseTime("2026-09-23T03:00:00Z")).toBe("2026-09-23T03:00:00.000Z");
    expect(parseTime(1_790_000_000)).toBe(new Date(1_790_000_000_000).toISOString());
    expect(parseTime(1_790_000_000_000)).toBe(new Date(1_790_000_000_000).toISOString());
    expect(parseTime("1790000000")).toBe(new Date(1_790_000_000_000).toISOString());
    expect(parseTime("23/09/2026 10:00:00")).toBe("2026-09-23T03:00:00.000Z");
    expect(parseTime("23/09/2026 10:00")).toBe("2026-09-23T03:00:00.000Z");
  });
  it("rác → null", () => {
    expect(parseTime("hôm qua")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});

describe("normalizeApiRow", () => {
  const order = { orderId: "O1", orderStatus: "COMPLETED", purchaseTime: 1_790_000_000, utmContent: `${HEX}-email` };
  const item = { itemId: 111, modelId: 222, itemPrice: "250000", qty: 2, itemTotalCommission: "12500" };

  it("đủ trường; order_value suy từ giá × số lượng; click + nguồn từ utmContent", () => {
    const r = normalizeApiRow(order, item);
    expect(r).toMatchObject({
      ok: true,
      row: {
        order_id: "O1",
        item_id: "111",
        model_id: "222",
        click_event_id: ID,
        source_channel: "email",
        status: "completed",
        raw_status: "COMPLETED",
        item_price: 250000,
        quantity: 2,
        order_value: 500000,
        commission: 12500,
        import_source: "api",
      },
    });
    if (r.ok) expect(r.row.raw).toEqual({ order, item });
  });

  it("thiếu orderId → lỗi kèm lý do", () => {
    const r = normalizeApiRow({ ...order, orderId: undefined }, item);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("order") });
  });

  it("itemStatus ưu tiên hơn orderStatus", () => {
    const r = normalizeApiRow(order, { ...item, displayItemStatus: "Cancelled" });
    expect(r.ok && r.row.status).toBe("cancelled");
  });
});

describe("normalizeCsvRow", () => {
  it("khớp tên cột không phân biệt hoa thường; sub_id tách theo cột", () => {
    const r = normalizeCsvRow({
      "order id": "O9",
      "ITEM ID": "5",
      "Purchase Time": "23/09/2026 10:00:00",
      "Order Status": "Pending",
      "Item Price": "1.250.000",
      Qty: "1",
      "Item Total Commission": "62.500",
      Sub_id1: HEX,
      Sub_id2: "push",
    });
    expect(r).toMatchObject({
      ok: true,
      row: {
        order_id: "O9",
        item_id: "5",
        model_id: "",
        purchase_time: "2026-09-23T03:00:00.000Z",
        status: "pending",
        item_price: 1250000,
        commission: 62500,
        click_event_id: ID,
        source_channel: "push",
        sub_ids: [HEX, "push"],
        import_source: "csv",
      },
    });
  });

  it("thiếu purchase_time → lỗi", () => {
    expect(normalizeCsvRow({ "Order ID": "O", "Item ID": "1", "Order Status": "Pending" }).ok).toBe(false);
  });
});
