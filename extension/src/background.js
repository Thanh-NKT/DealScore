/**
 * Kairo extension — service worker. The ONLY place that talks to Kairo: it has host permission for
 * the Kairo origin, so requests carry the user's Kairo session cookie, and Kairo only accepts calls
 * whose Origin is this extension (src/lib/extension/http.ts).
 */
/* global chrome */
"use strict";

const DEFAULT_ORIGIN = "https://kairo.vn";
/** Don't resend the same product's prices more often than this. */
const CONTRIBUTE_EVERY_MS = 30 * 60 * 1000;

async function kairoOrigin() {
  const { kairoOrigin } = await chrome.storage.local.get("kairoOrigin");
  return kairoOrigin || DEFAULT_ORIGIN;
}

async function api(path, init) {
  const origin = await kairoOrigin();
  const res = await fetch(origin + path, {
    ...(init || {}),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, origin };
}

/** Sharing is opt-in (popup), and each product is sent at most once per CONTRIBUTE_EVERY_MS. */
async function contribute(observation) {
  const { shareObservations } = await chrome.storage.sync.get("shareObservations");
  if (!shareObservations) return { status: 0, skipped: "no_consent" };

  const key = "sent:" + observation.item;
  const store = await chrome.storage.session.get(key);
  if (store[key] && Date.now() - store[key] < CONTRIBUTE_EVERY_MS) return { status: 0, skipped: "recent" };
  await chrome.storage.session.set({ [key]: Date.now() });

  return api("/api/extension/observations", {
    method: "POST",
    body: JSON.stringify({ ...observation, observedAt: new Date().toISOString() }),
  });
}

async function handle(msg) {
  switch (msg && msg.type) {
    case "lookup": {
      const q = new URLSearchParams({ marketplace: "shopee", item: msg.item });
      if (msg.model) q.set("model", msg.model);
      return api("/api/extension/product?" + q.toString());
    }
    case "watch":
      return api("/api/extension/watch", {
        method: "POST",
        body: JSON.stringify({ variantId: msg.variantId, targetPrice: msg.targetPrice }),
      });
    case "contribute":
      return contribute(msg.observation);
    case "me":
      return api("/api/extension/me");
    case "origin":
      return { origin: await kairoOrigin() };
    default:
      return { status: 400, error: "unknown_message" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) => sendResponse({ status: 0, error: String(err) }));
  return true; // async response
});
