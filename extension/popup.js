/* global chrome */
"use strict";

(async function () {
  const share = document.getElementById("share");
  const account = document.getElementById("account");
  const origin = document.getElementById("origin");
  const open = document.getElementById("open");

  const { shareObservations } = await chrome.storage.sync.get("shareObservations");
  share.checked = Boolean(shareObservations);
  share.addEventListener("change", () => chrome.storage.sync.set({ shareObservations: share.checked }));

  const { dealscoreOrigin } = await chrome.storage.local.get("dealscoreOrigin");
  origin.value = dealscoreOrigin || "https://dealscore.vn";
  open.href = origin.value;
  origin.addEventListener("change", async () => {
    await chrome.storage.local.set({ dealscoreOrigin: origin.value });
    open.href = origin.value;
    checkAccount();
  });

  function checkAccount() {
    account.textContent = "Đang kiểm tra…";
    chrome.runtime.sendMessage({ type: "me" }, (res) => {
      if (!res || res.status !== 200) {
        account.textContent = "Chưa kết nối được DealScore.";
        return;
      }
      if (res.body && res.body.signedIn) {
        account.textContent = "Đã đăng nhập. Bạn có thể đặt theo dõi giá ngay trên trang Shopee.";
      } else {
        account.textContent = "";
        const a = document.createElement("a");
        a.href = res.origin + "/login";
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Đăng nhập DealScore";
        account.append(a, " để đặt theo dõi giá.");
      }
    });
  }
  checkAccount();
})();
