/**
 * Kairo extension — read a Shopee product page. Pure functions over plain strings, so they are
 * unit-tested (tests/extension/parse-shopee.test.ts) without a browser.
 *
 * ASSUMPTION E1 (like G1–G6 for the API): Shopee renders prices as "₫2.390.000", a range
 * "₫1.990.000 - ₫2.390.000" until a variation is chosen, the list price just after the price with a
 * "-NN%" badge, stock as "N sản phẩm có sẵn". Verify on the live site before publishing; when a
 * page doesn't match, the parser returns nothing rather than a guess.
 *
 * Loaded as a classic content script (window.KairoShopee) and as a CommonJS module in tests.
 */
(function (root) {
  "use strict";

  var PRODUCT_PATH = /\/product\/(\d+)\/(\d+)/;
  var SLUG_PATH = /-i\.(\d+)\.(\d+)/;
  var SHOPEE_HOSTS = ["shopee.vn", "www.shopee.vn"];

  /** "https://shopee.vn/Ten-i.111.222?sp=1" → "111_222" (listings.external_item_id), else null. */
  function itemIdFromUrl(href) {
    var url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (SHOPEE_HOSTS.indexOf(url.hostname.toLowerCase()) < 0) return null;
    var m = url.pathname.match(PRODUCT_PATH) || url.pathname.match(SLUG_PATH);
    return m ? m[1] + "_" + m[2] : null;
  }

  function toNumber(digits) {
    var n = Number(String(digits).replace(/\./g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  var PRICE = "₫\\s?([\\d.]{3,})";

  /**
   * Price block from the visible page text. Returns { price, originalPrice } or null when the page
   * shows a price RANGE (no variation chosen yet) or no price at all.
   */
  function parsePrice(text) {
    var t = String(text || "").slice(0, 20000);
    var first = new RegExp(PRICE).exec(t);
    if (!first) return null;
    var after = t.slice(first.index + first[0].length, first.index + first[0].length + 60);
    // "₫1.990.000 - ₫2.390.000" right after the first price = a range, not a price.
    if (new RegExp("^\\s*[-–]\\s*" + PRICE).test(after)) return null;
    var price = toNumber(first[1]);
    if (price == null) return null;
    var next = new RegExp(PRICE).exec(after);
    var original = next ? toNumber(next[1]) : null;
    var hasBadge = /-\s?\d{1,2}%/.test(after);
    return { price: price, originalPrice: original != null && original > price && hasBadge ? original : null };
  }

  function parseStock(text) {
    var m = /(\d[\d.]*)\s*sản phẩm có sẵn/i.exec(String(text || ""));
    return m ? Number(m[1].replace(/\./g, "")) : null;
  }

  function parseFreeShipping(text) {
    return /miễn phí vận chuyển|freeship/i.test(String(text || "")) ? true : null;
  }

  function parseVoucher(text) {
    return /mã giảm giá của shop|voucher của shop/i.test(String(text || "")) ? true : null;
  }

  /**
   * "50k" → 50000, "1tr" / "1,5tr" → 1000000 / 1500000, "50.000" → 50000. Null when unreadable.
   */
  function parseAmount(raw) {
    var m = /^(\d+(?:[.,]\d+)*)\s*(k|tr|triệu)?$/i.exec(String(raw || "").trim());
    if (!m) return null;
    var n;
    if (m[2]) {
      n = Number(m[1].replace(",", ".")) * (m[2].toLowerCase() === "k" ? 1000 : 1000000);
    } else {
      n = Number(m[1].replace(/[.,]/g, ""));
    }
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  var MONEY = "₫\\s?(\\d[\\d.,]*\\s*(?:k|tr|triệu)?)";
  var MAX_VOUCHERS = 20;

  /**
   * ASSUMPTION E2: the shop voucher block follows a "Mã Giảm Giá Của Shop" heading and lists labels
   * like "Giảm ₫50k", "Giảm 8% Giảm tối đa ₫150k", "Đơn tối thiểu ₫1tr". Returns voucher terms only
   * (kind 'shop', never a code); [] when the block is not there.
   */
  function parseVouchers(text) {
    var t = String(text || "").slice(0, 20000);
    var head = /mã giảm giá của shop|voucher của shop/i.exec(t);
    if (!head) return [];
    var section = t.slice(head.index + head[0].length, head.index + head[0].length + 1500);
    var starts = [];
    var re = new RegExp("Giảm\\s+(?!tối đa)(?:" + MONEY + "|(\\d{1,3})\\s*%)", "gi");
    var m;
    while ((m = re.exec(section)) && starts.length < MAX_VOUCHERS) starts.push({ index: m.index, amount: m[1], pct: m[2] });
    var out = [];
    for (var i = 0; i < starts.length; i++) {
      var entry = section.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : section.length);
      var min = new RegExp("Đơn tối thiểu\\s+" + MONEY, "i").exec(entry);
      var minSpend = min ? parseAmount(min[1]) : 0;
      if (min && minSpend == null) continue;
      if (starts[i].pct) {
        var pct = Number(starts[i].pct);
        if (!(pct > 0 && pct <= 100)) continue;
        var cap = new RegExp("tối đa\\s+" + MONEY, "i").exec(entry);
        out.push({ kind: "shop", discountType: "percent", discountValue: pct, maxDiscount: cap ? parseAmount(cap[1]) : null, minSpend: minSpend });
      } else {
        var amount = parseAmount(starts[i].amount);
        if (amount == null) continue;
        out.push({ kind: "shop", discountType: "amount", discountValue: amount, maxDiscount: null, minSpend: minSpend });
      }
    }
    return out;
  }

  var IMAGE_HOST = /^https:\/\/([a-z0-9-]+\.)*(susercontent\.com|cf\.shopee\.vn|cvf\.shopee\.vn)\//i;
  var MAX_IMAGES = 12;

  /**
   * Gallery image URLs: https on Shopee's image CDN only, thumbnail suffix ("_tn") dropped so the
   * full image is stored, deduplicated, at most 12. The server re-checks every URL.
   */
  function pickGalleryImages(srcs) {
    var out = [];
    (srcs || []).forEach(function (src) {
      if (out.length >= MAX_IMAGES || typeof src !== "string" || !IMAGE_HOST.test(src)) return;
      var clean = src.split("#")[0].replace(/_tn(\.webp)?$/, "");
      if (out.indexOf(clean) < 0) out.push(clean);
    });
    return out;
  }

  /**
   * Everything the extension may send for one page: never personal data, only the product facts.
   * input = { href, text, selectedOptions: string[], imageUrls?: string[] }. Returns null when
   * nothing is reliable. `vouchers` / `images` are only included when the page had some.
   */
  function readProductPage(input) {
    var item = itemIdFromUrl(input.href);
    if (!item) return null;
    var price = parsePrice(input.text);
    var name = (input.selectedOptions || [])
      .map(function (s) {
        return String(s).trim();
      })
      .filter(Boolean)
      .join(", ")
      .slice(0, 100);
    var observation = null;
    if (price) {
      observation = {
        marketplace: "shopee",
        item: item,
        models: [{ modelId: null, name: name, price: price.price, originalPrice: price.originalPrice, stock: parseStock(input.text) }],
        freeShipping: parseFreeShipping(input.text),
        hasVoucher: parseVoucher(input.text),
      };
      var vouchers = parseVouchers(input.text);
      if (vouchers.length) observation.vouchers = vouchers;
      var images = pickGalleryImages(input.imageUrls);
      if (images.length) observation.images = images;
    }
    return { item: item, modelName: name || null, observation: observation };
  }

  var api = {
    itemIdFromUrl: itemIdFromUrl,
    parsePrice: parsePrice,
    parseStock: parseStock,
    parseAmount: parseAmount,
    parseVouchers: parseVouchers,
    pickGalleryImages: pickGalleryImages,
    readProductPage: readProductPage,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KairoShopee = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
