// Service worker tối thiểu cho web push (1.4). Không cache, không offline.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Kairo", {
      body: data.body || "",
      tag: data.tag || "kairo-alert",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  // Chỉ mở URL cùng origin.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url === target.href && "focus" in c) return c.focus();
      return self.clients.openWindow(target.href);
    }),
  );
});
