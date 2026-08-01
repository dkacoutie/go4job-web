const JOBRADAR_SW_VERSION = "jobradar-sw-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "JobRadar",
      body: event.data ? event.data.text() : "De nouvelles offres peuvent t'intéresser.",
    };
  }

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "JobRadar";
  const options = {
    body:
      typeof payload.body === "string" && payload.body.trim()
        ? payload.body
        : "De nouvelles offres peuvent t'intéresser.",
    icon: "/icons/jobradar-icon-192.png",
    badge: "/icons/jobradar-icon-192.png",
    data: {
      url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/jobradar/feed",
      version: JOBRADAR_SW_VERSION,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/jobradar/feed";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.includes(self.location.origin)) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
