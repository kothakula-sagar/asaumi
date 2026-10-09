// Minimal service worker: makes Asaumi installable and lets notifications open the app.
// It deliberately does not cache private data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const hash = { message: "#chat", call: "#home", memory: "#memories", movement: "#asaumi", game: "#games" }[e.notification.tag] || "";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = all.find(c => c.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      if (hash) open.navigate?.(self.registration.scope + hash).catch(() => {});
      return;
    }
    return self.clients.openWindow(self.registration.scope + hash);
  })());
});
