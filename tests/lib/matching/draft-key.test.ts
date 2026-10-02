import { describe, expect, it } from "vitest";
import { draftKey, KNOWN_BRANDS } from "@/lib/matching/draft-key";

const brands = ["Sony", "Samsung", "Anker"];
const key = (title: string) => draftKey({ title, brands });
// Full list: needed whenever the brand under test (Logitech, Anessa, Bobby, Moony, Nike…) is not in `brands`.
const fullKey = (title: string) => draftKey({ title, brands: [...KNOWN_BRANDS] });

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
    expect(fullKey("Chuột Logitech không dây 2.4GHz")).toBeNull();
    expect(fullKey("Kem chống nắng Anessa SPF50 PA++++")).toBeNull();
    expect(key("Tai nghe Sony Bluetooth5.3 WH1000XM5")).toBe("sony|wh1000xm5");
  });

  it("pack counts are not models; size letters are kept", () => {
    expect(fullKey("Tã quần Bobby 168 miếng size L")).toBeNull();
    expect(fullKey("Bỉm Moony M58 size M")).toBe("moony|m58|sz=m");
    expect(fullKey("Bỉm Moony M58 size L")).toBe("moony|m58|sz=l");
  });

  it("numeric sizes are keyed as sz and are not models", () => {
    const a = fullKey("Giày Nike Air Max 270 size 40");
    const b = fullKey("Giày Nike Air Max 270 size 41");
    expect(a).toMatch(/\|sz=40$/);
    expect(b).toMatch(/\|sz=41$/);
    expect(a).not.toBe(b);
    expect(fullKey("Giày Nike Air Max size 270")).toBeNull();
  });

  it("'bao gồm' is not an accessory; excluded bundles hide their inner phrases", () => {
    expect(key("Samsung S24 bao gồm sạc")).toBe("samsung|s24");
    expect(key("Ốp lưng Samsung S24 kèm kính cường lực")?.startsWith("acc(op-lung):")).toBe(true);
    expect(key("Samsung S24 kèm kính cường lực")).toBe("samsung|s24");
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

describe("draftKey — capacities and network generation", () => {
  it("every capacity is part of the key", () => {
    const a = key("Samsung Galaxy A15 8GB 128GB");
    const b = key("Samsung Galaxy A15 8GB 256GB");
    expect(a).toBe("samsung|a15|cap=8+128");
    expect(a).not.toBe(b);
    expect(key("Samsung Galaxy A15 8GB/128GB")).toBe(a);
  });

  it("network generation is part of the key and never a unit or model", () => {
    const g4 = key("Samsung Galaxy A15 4G");
    const g5 = key("Samsung Galaxy A15 5G");
    expect(g5).toBe("samsung|a15|net=5g");
    expect(g4).toBe("samsung|a15|net=4g");
    expect(key("Samsung Galaxy A15 LTE")).toBe("samsung|a15|net=lte");
  });
});

describe("draftKey — condition, combos and replacement parts", () => {
  it("used / refurbished / display items are never clustered", () => {
    expect(key("Tai nghe Sony WH-1000XM5 like new 99%")).toBeNull();
    expect(key("Tai nghe Sony WH-1000XM5 cũ")).toBeNull();
    expect(key("Samsung Galaxy S24 refurbished")).toBeNull();
    expect(key("Samsung Galaxy S24 đã qua sử dụng")).toBeNull();
    expect(key("Samsung Galaxy S24 hàng trưng bày")).toBeNull();
    expect(key("Samsung Galaxy S24 98%")).toBeNull();
    expect(key("Samsung Galaxy S24 second hand")).toBeNull();
  });

  it("'cu' only counts as a whole word and not in 'cu sac'", () => {
    // Unchanged from before the condition words existed.
    expect(key("Kính cường lực Samsung S24")).toBe("acc(kinh-cuong-luc):samsung|lucs24");
    expect(key("Củ sạc Anker 737")).toBe("acc(cu-sac):anker|737");
  });

  it("combos and multi-packs are never clustered", () => {
    expect(fullKey("Combo 2 chuột Logitech G304")).toBeNull();
    expect(fullKey("Bộ 2 chuột Logitech G304")).toBeNull();
    expect(fullKey("Chuột Logitech G304 set 3")).toBeNull();
    expect(fullKey("2 cái chuột Logitech G304")).toBeNull();
    expect(fullKey("Chuột Logitech G304 x2")).toBeNull();
  });

  it("replacement parts get an accessory key", () => {
    expect(key("Đệm tai thay thế Sony WH-1000XM5")).not.toBe(key("Tai nghe Sony WH-1000XM5"));
    expect(key("Đệm tai thay thế Sony WH-1000XM5")?.startsWith("acc(")).toBe(true);
    expect(key("Pin thay thế Samsung S24 Ultra")?.startsWith("acc(")).toBe(true);
    expect(fullKey("Keycap Logitech G915")?.startsWith("acc(keycap):")).toBe(true);
  });
});
