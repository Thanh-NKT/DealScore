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
   * Everything the extension may send for one page: never personal data, only the product facts.
   * input = { href, text, selectedOptions: string[] }. Returns null when nothing is reliable.
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
    return {
      item: item,
      modelName: name || null,
      observation: price
        ? {
            marketplace: "shopee",
            item: item,
            models: [{ modelId: null, name: name, price: price.price, originalPrice: price.originalPrice, stock: parseStock(input.text) }],
            freeShipping: parseFreeShipping(input.text),
            hasVoucher: parseVoucher(input.text),
          }
        : null,
    };
  }

  var api = {
    itemIdFromUrl: itemIdFromUrl,
    parsePrice: parsePrice,
    parseStock: parseStock,
    readProductPage: readProductPage,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KairoShopee = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
