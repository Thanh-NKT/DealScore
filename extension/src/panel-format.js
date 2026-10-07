/**
 * DealScore extension — pure text helpers for the panel (roadmap P2 item 5). Unit-tested
 * (tests/lib/extension/panel-format.test.ts) without a browser.
 *
 * Loaded as a classic content script before content.js (window.DealScorePanelFormat) and as a CommonJS
 * module in tests.
 */
(function (root) {
  "use strict";

  /** "vừa xong" | "N phút trước" | "N giờ trước" | "N ngày trước"; null for a missing / bad timestamp. */
  function relativeVi(iso, nowMs) {
    if (!iso) return null;
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var sec = Math.max(0, Math.floor((nowMs - t) / 1000));
    if (sec < 60) return "vừa xong";
    var min = Math.floor(sec / 60);
    if (min < 60) return min + " phút trước";
    var h = Math.floor(min / 60);
    if (h < 24) return h + " giờ trước";
    return Math.floor(h / 24) + " ngày trước";
  }

  function coverageText(days, minDays) {
    return "Mới ghi nhận " + days + "/" + minDays + " ngày";
  }

  var api = { relativeVi: relativeVi, coverageText: coverageText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DealScorePanelFormat = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
