import { describe, expect, it } from "vitest";
import { parseQueryIntent, type IntentVocab, type QueryIntent } from "@/lib/intent/parse";

const vocab: IntentVocab = {
  categories: [
    { slug: "ssd", name: "Ổ cứng SSD" }, { slug: "ban-phim", name: "Bàn phím" }, { slug: "chuot", name: "Chuột" },
    { slug: "man-hinh", name: "Màn hình" }, { slug: "tai-nghe", name: "Tai nghe" }, { slug: "ram", name: "RAM" },
    { slug: "sac-du-phong", name: "Sạc dự phòng" }, { slug: "webcam", name: "Webcam" },
  ],
  brands: ["Samsung", "WD", "Logitech", "Keychron", "Dell", "Sony", "Anker", "Kingston"],
};

const CASES: Array<[string, Partial<QueryIntent>]> = [
  // Required cases from the brief.
  ["SSD 2TB dưới 3 triệu", { categorySlug: "ssd", capacityGb: 2048, maxPrice: 3_000_000, text: "" }],
  ["ssd 2tb duoi 3tr", { categorySlug: "ssd", capacityGb: 2048, maxPrice: 3_000_000, text: "" }],
  ["chuột không dây chơi game tầm 1 triệu", { categorySlug: "chuot", minPrice: 850_000, maxPrice: 1_150_000, boostTerms: ["wireless", "gaming"], text: "" }],
  ["Samsung 990 Pro", { brands: ["Samsung"], text: "990 Pro" }],
  ["man hinh 27 inch tu 3 den 5 trieu", { categorySlug: "man-hinh", sizeInch: 27, minPrice: 3_000_000, maxPrice: 5_000_000, text: "" }],
  ["bàn phím cơ rẻ nhất trên lazada", { categorySlug: "ban-phim", sort: "price_asc", marketplaces: ["lazada"], boostTerms: ["mechanical"], text: "" }],
  ["WD 1TB có voucher freeship", { brands: ["WD"], capacityGb: 1024, hasVoucher: true, freeShipping: true, text: "" }],
  ["Pro", { text: "Pro", chips: [] }],
  ["mình cần mua tai nghe chống ồn cho văn phòng", { categorySlug: "tai-nghe", boostTerms: ["anc", "office"], text: "" }],
  ["western digital ssd 1tb", { brands: ["WD"], categorySlug: "ssd", capacityGb: 1024 }],
  ["ổ cứng đáng mua", { categorySlug: "ssd", sort: "deal_score", text: "" }],
  ["ssd rẻ nhất sau voucher", { categorySlug: "ssd", sort: "effective_asc" }],
  ["chuột logitech màu đen", { categorySlug: "chuot", brands: ["Logitech"], color: "black", text: "" }],
  ["", { text: "", chips: [] }],

  // Price phrases, with and without diacritics.
  ["ram trên 500k", { categorySlug: "ram", minPrice: 500_000, text: "" }],
  ["ram tren 500k", { categorySlug: "ram", minPrice: 500_000, text: "" }],
  ["tai nghe từ 2 triệu trở lên", { categorySlug: "tai-nghe", minPrice: 2_000_000, text: "" }],
  ["tai nghe khong qua 800 nghin", { categorySlug: "tai-nghe", maxPrice: 800_000, text: "" }],
  ["webcam < 1tr5", { categorySlug: "webcam", maxPrice: 1_500_000, text: "" }],
  ["webcam khoảng 2tr", { categorySlug: "webcam", minPrice: 1_700_000, maxPrice: 2_300_000, text: "" }],
  ["sạc dự phòng 300k-500k", { categorySlug: "sac-du-phong", minPrice: 300_000, maxPrice: 500_000, text: "" }],
  ["Dell 27 inch", { brands: ["Dell"], sizeInch: 27, text: "" }],

  // Capacity / size / color.
  ["kingston 16gb ram", { brands: ["Kingston"], capacityGb: 16, categorySlug: "ram", text: "" }],
  ["ssd 2 tb", { categorySlug: "ssd", capacityGb: 2048, text: "" }],
  ['màn hình 24"', { categorySlug: "man-hinh", sizeInch: 24, text: "" }],
  ["chuot mau trang", { categorySlug: "chuot", color: "white", text: "" }],
  ["tai nghe sony white", { categorySlug: "tai-nghe", brands: ["Sony"], color: "white", text: "" }],
  ["bàn phím màu xanh dương", { categorySlug: "ban-phim", color: "blue", text: "" }],

  ["màn hình 23.8 inch", { categorySlug: "man-hinh", sizeInch: 23.8, text: "" }],
  ["man hinh 23,8 inch", { categorySlug: "man-hinh", sizeInch: 23.8, text: "" }],
  ["ssd 1.5tb", { categorySlug: "ssd", capacityGb: 1536, text: "" }],
  ["Samsung Chính Hãng", { brands: ["Samsung"], text: "" }],

  // Category synonyms.
  ["keyboard keychron", { categorySlug: "ban-phim", brands: ["Keychron"], text: "" }],
  ["mouse logi", { categorySlug: "chuot", brands: ["Logitech"], text: "" }],
  ["monitor dell", { categorySlug: "man-hinh", brands: ["Dell"], text: "" }],
  ["earbuds anker", { categorySlug: "tai-nghe", brands: ["Anker"], text: "" }],
  ["pin dự phòng anker 20000mah", { categorySlug: "sac-du-phong", brands: ["Anker"], text: "20000mah" }],
  ["powerbank nhỏ gọn", { categorySlug: "sac-du-phong", boostTerms: ["portable"], text: "" }],
  ["phím keychron", { categorySlug: "ban-phim", brands: ["Keychron"], text: "" }],

  // Sort / flags / marketplaces.
  ["ssd giá thấp nhất", { categorySlug: "ssd", sort: "price_asc", text: "" }],
  ["tai nghe deal tốt", { categorySlug: "tai-nghe", sort: "deal_score", text: "" }],
  ["chuột sau mã giảm", { categorySlug: "chuot", sort: "effective_asc", text: "" }],
  ["ssd miễn phí vận chuyển", { categorySlug: "ssd", freeShipping: true, text: "" }],
  ["ram kèm voucher", { categorySlug: "ram", hasVoucher: true, text: "" }],
  ["samsung trên shopee", { brands: ["Samsung"], marketplaces: ["shopee"], text: "" }],
  ["tai nghe sony tiktok shop", { categorySlug: "tai-nghe", brands: ["Sony"], marketplaces: ["tiktok"], text: "" }],

  // Needs + filler words.
  ["tai nghe bluetooth", { categorySlug: "tai-nghe", boostTerms: ["bluetooth"], text: "" }],
  ["chuột wireless gaming", { categorySlug: "chuot", boostTerms: ["wireless", "gaming"], text: "" }],
  ["gợi ý giúp em con chuột rẻ", { categorySlug: "chuot", text: "" }],
  ["toi muon tim mot cai man hinh", { categorySlug: "man-hinh", text: "" }],
  ["Galaxy Buds", { text: "Galaxy Buds", chips: [], boostTerms: [] }],
  ["mua gì", { text: "mua gì", chips: [] }],
  ["cái gì tốt nhất cho mình đây", { text: "nhất đây" }],

  // Final review: model words / years after a cue are not prices; no dangling price cue in `text`.
  ["iphone 15 pro max 2023", { text: "iphone 15 pro max 2023", chips: [] }],
  ["loa max 1500", { text: "loa max 1500", chips: [] }],
  ["ssd trên 1tb", { categorySlug: "ssd", capacityGb: 1024, text: "" }],
  ["ssd tren 1tb", { categorySlug: "ssd", capacityGb: 1024, text: "" }],
  ["samsung dưới", { brands: ["Samsung"], text: "" }],
  ["iphone pro max 256gb", { capacityGb: 256, text: "iphone pro max" }],

  // Ambiguous category (same-length tie between different slugs) → no category.
  ["chuột phím", { text: "chuột phím", chips: [] }],
];

describe("parseQueryIntent — labeled set", () => {
  it("has at least 40 cases", () => expect(CASES.length).toBeGreaterThanOrEqual(40));

  it.each(CASES)("%s", (query, expected) => {
    expect(parseQueryIntent(query, vocab)).toMatchObject(expected);
  });

  it("ambiguous category leaves categorySlug unset", () => {
    expect(parseQueryIntent("chuột phím", vocab).categorySlug).toBeUndefined();
  });
});
