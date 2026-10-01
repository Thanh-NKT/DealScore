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
    expect(key("Ốp lưng Samsung S24")).toBe("acc(op-lung):samsung|s24");
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
    expect(key("Ốp lưng cho Samsung S24")).toBe("acc(op-lung):samsung|s24");
  });

  it("no brand or no model token → null", () => {
    expect(key("Tai nghe bluetooth chống ồn WH1000XM5")).toBeNull();
    expect(key("Sony tai nghe chống ồn chính hãng")).toBeNull();
  });

  it("known brands list is non-trivial and includes common makers", () => {
    expect(KNOWN_BRANDS.length).toBeGreaterThanOrEqual(80);
    for (const b of ["Samsung", "Sony", "Xiaomi", "Logitech", "Philips", "La Roche-Posay"]) expect(KNOWN_BRANDS).toContain(b);
  });

  it("spec tokens are not models", () => {
    expect(key("Chuột Logitech không dây 2.4GHz")).toBeNull();
    expect(key("Kem chống nắng Anessa SPF50 PA++++")).toBeNull();
    expect(key("Tai nghe Sony Bluetooth5.3 WH1000XM5")).toBe("sony|wh1000xm5");
  });

  it("pack counts are not models; size letters are kept", () => {
    expect(key("Tã quần Bobby 168 miếng size L")).toBeNull();
    expect(key("Bỉm Moony M58 size L")).toBeNull();
    const m = draftKey({ title: "Bỉm Moony M58 size M", brands: ["Moony"] });
    const l = draftKey({ title: "Bỉm Moony M58 size L", brands: ["Moony"] });
    expect(m).toBe("moony|m58|sz=m");
    expect(l).toBe("moony|m58|sz=l");
  });

  it("horsepower is not the HP brand", () => {
    const k = draftKey({ title: "Điều hòa Daikin 1.5 HP 12000BTU", brands: ["Daikin", "HP"] });
    expect(k?.startsWith("hp|") ?? false).toBe(false);
    expect(draftKey({ title: "Máy lạnh 1.5 HP Inverter 9000BTU", brands: ["HP"] })).toBeNull();
  });

  it("plus sign separates S24+ from S24", () => {
    expect(key("Samsung Galaxy S24+")).toBe("samsung|s24plus");
  });

  it("accessory type is part of the key", () => {
    expect(key("Kính cường lực Samsung S24")).not.toBe(key("Ốp lưng Samsung S24"));
    expect(key("Sạc dự phòng Anker 737")).not.toBe(key("Củ sạc Anker 737"));
  });

  it("sharp-screen and bundled gifts are not accessories", () => {
    expect(key("Màn hình Samsung Odyssey G5 sắc nét")).toBe("samsung|g5");
    expect(key("Điện thoại Samsung S24 tặng ốp lưng")).toBe("samsung|s24");
    expect(key("Máy ảnh Sony A7")).toBe("sony|a7");
  });

  it("ambiguous word-like brands are not known brands", () => {
    for (const b of ["Simple", "Bear", "Lining", "Cocoon"]) expect(KNOWN_BRANDS).not.toContain(b);
  });
});
