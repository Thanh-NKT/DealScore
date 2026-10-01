import { describe, expect, it } from "vitest";
import { draftKey, KNOWN_BRANDS } from "@/lib/matching/draft-key";

const brands = ["Sony", "Samsung", "Anker"];
const key = (title: string) => draftKey({ title, brands });

describe("draftKey", () => {
  it("same product written differently by two shops → same key", () => {
    const a = key("Tai nghe Sony WH-1000XM5 chính hãng");
    expect(a).toBe("sony|wh1000xm5");
    expect(key("[CHÍNH HÃNG] Tai Nghe Bluetooth Sony WH1000XM5 Chống Ồn")).toBe(a);
  });

  it("model suffixes split S24 from S24 Ultra", () => {
    expect(key("Samsung Galaxy S24")).toBe("samsung|s24");
    expect(key("Samsung Galaxy S24 Ultra")).toBe("samsung|s24ultra");
  });

  it("accessories never share a key with the device", () => {
    expect(key("Ốp lưng Samsung S24")).toBe("acc:samsung|s24");
  });

  it("capacity is part of the key", () => {
    const one = key("SSD Samsung 990 Pro 1TB");
    const two = key("SSD Samsung 990 Pro 2TB");
    expect(one).toMatch(/^samsung\|ssd990pro\|cap=\d+$/);
    expect(two).toMatch(/^samsung\|ssd990pro\|cap=\d+$/);
    expect(one).not.toBe(two);
  });

  it("units, years and stopword prefixes are not model tokens", () => {
    expect(key("Sạc dự phòng Anker 20000mAh 65W")).toBeNull();
    expect(key("Samsung S24 mẫu mới 2024")).toBe("samsung|s24");
    expect(key("Ốp lưng cho Samsung S24")).toBe("acc:samsung|s24");
  });

  it("no brand or no model token → null", () => {
    expect(key("Tai nghe bluetooth chống ồn WH1000XM5")).toBeNull();
    expect(key("Sony tai nghe chống ồn chính hãng")).toBeNull();
  });

  it("known brands list is non-trivial and includes common makers", () => {
    expect(KNOWN_BRANDS.length).toBeGreaterThanOrEqual(80);
    for (const b of ["Samsung", "Sony", "Xiaomi", "Logitech", "Philips", "La Roche-Posay"]) expect(KNOWN_BRANDS).toContain(b);
  });
});
