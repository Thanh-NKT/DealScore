/**
 * DealScore extension — content script on shopee.vn. Shows DealScore's answer for the product being viewed
 * in a small label in the corner (Shadow DOM: Shopee's CSS never leaks in, ours never leaks out).
 * Reads only product facts from the page (price, stock, free shipping, voucher) — never anything
 * personal — and sends them only if the user turned sharing on (checked in the service worker).
 */
/* global chrome, DealScoreShopee */
(function () {
  "use strict";

  var RENDER_DELAY_MS = 1500;
  var host = null;
  var shadow = null;
  var lastHref = "";
  var dismissedItem = null;

  var VERDICT = {
    buy: { text: "Nên mua", tone: "buy", icon: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16.2 9.4"/>' },
    wait: { text: "Có thể chờ", tone: "wait", icon: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>' },
    avoid: { text: "Chưa nên mua", tone: "avoid", icon: '<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7Z"/><path d="M8 12h8"/>' },
    insufficient_data: {
      text: "Chưa đủ dữ liệu",
      tone: "unknown",
      icon: '<circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M10 9.5a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6M12 16.5h.01"/>',
    },
  };

  var STYLE = [
    ":host{all:initial}",
    ".k{--label:#F3F0E8;--raised:#FBFAF6;--rail:#E6E1D5;--hair:#D5CFC1;--ink:#1C1B19;--ink2:#4F4B43;--ink3:#645F54;--primary:#4B2E83;--on:#FBFAF6;",
    "--buy:#1D6A42;--buy-s:#E1EFE5;--wait:#845600;--wait-s:#F5EBD3;--avoid:#A0261C;--avoid-s:#F6E0DC;--unknown:#5B574F;--unknown-s:#E8E4DA}",
    "@media (prefers-color-scheme:dark){.k{--label:#191815;--raised:#22211E;--rail:#2C2A26;--hair:#3A3833;--ink:#EEEAE1;--ink2:#C3BDB0;--ink3:#A29C8F;--primary:#B9A2E6;--on:#191815;",
    "--buy:#7CCB9C;--buy-s:#1B2E23;--wait:#E3B55C;--wait-s:#33291A;--avoid:#F08F84;--avoid-s:#3A1F1C;--unknown:#B3AEA3;--unknown-s:#2A2925}}",
    ".k{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:300px;max-width:calc(100vw - 32px);box-sizing:border-box;",
    "font:14px/1.45 'Be Vietnam Pro','Segoe UI',system-ui,sans-serif;color:var(--ink);background:var(--raised);border:1px solid var(--hair);border-radius:4px;",
    "box-shadow:0 1px 2px rgb(28 27 25/.08),0 8px 24px rgb(28 27 25/.10);padding:14px 16px}",
    ".top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}",
    ".brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px}",
    ".mark{display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:2px;background:var(--ink);color:var(--label);font-size:12px;font-weight:700}",
    ".x{all:unset;cursor:pointer;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;color:var(--ink3);font-size:20px}",
    ".x:hover{background:var(--rail);color:var(--ink)}",
    ".price{font-weight:800;font-size:24px;line-height:1.1;font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.01em}",
    ".cap{font-size:12px;color:var(--ink3)}",
    ".row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}",
    ".tag{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 6px;border-radius:4px;border:1px solid currentColor;font-weight:700;white-space:nowrap}",
    ".tag svg{width:18px;height:18px;flex:none}",
    ".buy{color:var(--buy);background:var(--buy-s)}.wait{color:var(--wait);background:var(--wait-s)}",
    ".avoid{color:var(--avoid);background:var(--avoid-s)}.unknown{color:var(--unknown);background:var(--unknown-s);border:1.5px dotted currentColor}",
    ".score{font-size:13px;color:var(--ink3)}.score b{font-size:17px;color:var(--ink);font-variant-numeric:tabular-nums}",
    "ul{margin:10px 0 0;padding:0;list-style:none;color:var(--ink2);font-size:13px}li{margin-top:4px}",
    ".stale{margin-top:10px;padding:6px 8px;border:1.5px dashed var(--ink2);border-radius:4px;font-size:12px}",
    ".act{display:grid;gap:8px;margin-top:12px}",
    ".btn{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;min-height:40px;padding:0 12px;border-radius:4px;",
    "font-weight:600;font-size:14px;text-align:center;transition:background-color .16s cubic-bezier(.22,1,.36,1)}",
    ".pri{background:var(--primary);color:var(--on)}.pri:hover{background:color-mix(in oklab,var(--primary) 86%,var(--ink))}",
    ".sec{border:1.5px solid var(--ink2);color:var(--ink)}.sec:hover{background:var(--rail)}",
    ".btn:focus-visible,.x:focus-visible{outline:2px solid var(--primary);outline-offset:2px}",
    ".done{display:flex;align-items:flex-start;justify-content:center;gap:6px;margin:4px 0 0;color:var(--buy);font-weight:600;font-size:13px}",
    ".done svg{flex:none;margin-top:2px}",
    ".msg{color:var(--ink2)}",
  ].join("");

  var CHECK =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function vnd(n) {
    return n == null ? "—" : Number(n).toLocaleString("vi-VN") + "đ";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** Same default as the website (suggestTargetPrice): current price −10%, rounded down to 1.000đ. */
  function suggestTarget(price) {
    if (!price || price <= 0) return null;
    return Math.max(1000, Math.floor((price * 0.9) / 1000) * 1000);
  }

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          resolve(chrome.runtime.lastError ? { status: 0 } : res || { status: 0 });
        });
      } catch {
        resolve({ status: 0 });
      }
    });
  }

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.setAttribute("data-dealscore", "");
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }

  function unmount() {
    if (host) host.remove();
    host = null;
    shadow = null;
  }

  function render(inner, item) {
    mount();
    shadow.innerHTML =
      "<style>" + STYLE + "</style>" +
      '<section class="k" role="complementary" aria-label="DealScore">' +
      '<div class="top"><span class="brand"><span class="mark" aria-hidden="true">K</span>Kairo</span>' +
      '<button class="x" type="button" aria-label="Ẩn khung DealScore cho sản phẩm này">×</button></div>' +
      inner +
      "</section>";
    shadow.querySelector(".x").addEventListener("click", function () {
      dismissedItem = item;
      unmount();
    });
  }

  function tag(rec) {
    var v = VERDICT[rec] || VERDICT.insufficient_data;
    return (
      '<span class="tag ' + v.tone + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      v.icon + "</svg>" + v.text + "</span>"
    );
  }

  function renderFound(res, item) {
    var s = res.body.summary;
    var target = suggestTarget(s.price);
    var watch = res.body.watch;
    var watchBlock = watch
      ? '<p class="done">' + CHECK + "Bạn đang theo dõi giá sản phẩm này</p>"
      : res.body.signedIn
        ? target
          ? '<button class="btn sec" type="button" data-watch>Theo dõi, báo khi ≤ ' + vnd(target) + "</button>"
          : ""
        : '<a class="btn sec" target="_blank" rel="noopener" href="' + esc(res.origin + "/login?next=" + encodeURIComponent(new URL(s.url).pathname + new URL(s.url).search)) + '">Đăng nhập DealScore để theo dõi giá</a>';

    render(
      '<div class="cap">Giá thấp nhất DealScore ghi nhận' + (s.variantKey ? " · " + esc(s.variantKey) : "") + "</div>" +
        '<div class="price">' + vnd(s.price) + "</div>" +
        '<div class="row">' + tag(s.recommendation) +
        (s.score != null ? '<span class="score">Deal Score <b>' + s.score + "</b>/100</span>" : "") + "</div>" +
        (s.reasons.length ? "<ul>" + s.reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" : "") +
        (s.isStale ? '<p class="stale">Giá có thể đã khác, DealScore chưa cập nhật gần đây.</p>' : "") +
        '<div class="act"><a class="btn pri" target="_blank" rel="noopener" href="' + esc(s.url) + '">Xem lịch sử giá trên DealScore</a>' + watchBlock + "</div>",
      item,
    );

    var btn = shadow.querySelector("[data-watch]");
    if (btn) {
      btn.addEventListener("click", function () {
        btn.textContent = "Đang lưu…";
        btn.setAttribute("aria-disabled", "true");
        send({ type: "watch", variantId: s.variantId, targetPrice: target }).then(function (r) {
          if (r.status === 200) btn.outerHTML = '<p class="done">' + CHECK + "Đã theo dõi. DealScore sẽ báo khi giá ≤ " + vnd(target) + "</p>";
          else if (r.status === 401) btn.outerHTML = '<p class="msg">Phiên đăng nhập đã hết. Hãy đăng nhập lại trên DealScore.</p>';
          else if (r.status === 403) btn.outerHTML = '<p class="msg">Mở DealScore để hoàn tất tài khoản (đồng ý điều khoản hoặc khôi phục tài khoản) rồi thử lại.</p>';
          else btn.outerHTML = '<p class="msg">Chưa lưu được. Thử lại sau ít phút.</p>';
        });
      });
    }
  }

  function renderMissing(origin, item) {
    render(
      '<p class="msg">DealScore chưa theo dõi giá sản phẩm này.</p>' +
        '<div class="act"><a class="btn sec" target="_blank" rel="noopener" href="' +
        esc(origin + "/share-target?url=" + encodeURIComponent(location.href)) +
        '">Thêm vào DealScore để theo dõi</a></div>',
      item,
    );
  }

  function readPage() {
    var selected = Array.prototype.slice
      .call(document.querySelectorAll('button[aria-pressed="true"], button[aria-checked="true"]'))
      .map(function (b) {
        return b.textContent || "";
      });
    // ASSUMPTION E2: the product gallery is the block of CDN images near the top of the page;
    // recommendation tiles further down are left out. The server re-checks every URL.
    var imageUrls = Array.prototype.slice
      .call(document.images)
      .filter(function (img) {
        var r = img.getBoundingClientRect();
        return r.top + window.scrollY < 1000 && r.width >= 40 && r.height >= 40;
      })
      .map(function (img) {
        return img.currentSrc || img.src;
      });
    return DealScoreShopee.readProductPage({
      href: location.href,
      text: (document.body && document.body.innerText) || "",
      selectedOptions: selected,
      imageUrls: imageUrls,
    });
  }

  function onPage() {
    var item = DealScoreShopee.itemIdFromUrl(location.href);
    if (!item) {
      unmount();
      return;
    }
    if (item === dismissedItem) return;
    render('<p class="msg">Đang xem lịch sử giá…</p>', item);

    setTimeout(function () {
      var page = readPage();
      if (!page || page.item !== item) return;
      send({ type: "lookup", item: item, model: page.modelName }).then(function (res) {
        if (DealScoreShopee.itemIdFromUrl(location.href) !== item || item === dismissedItem) return;
        if (res.status === 200 && res.body && res.body.found) renderFound(res, item);
        else if (res.status === 200 && res.body) renderMissing(res.origin, item);
        else render('<p class="msg">Chưa kết nối được DealScore. Thử tải lại trang sau.</p>', item);
      });
      if (page.observation) send({ type: "contribute", observation: page.observation });
    }, RENDER_DELAY_MS);
  }

  // Shopee is a single-page app: watch for URL changes instead of relying on page loads.
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onPage();
    }
  }, 1000);
})();
