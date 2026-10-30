/**
 * BusGuard's service worker.
 *
 * Handles two things the page cannot: notifications arriving while the tab is
 * closed, and turning a tapped notification into a navigation. Both are
 * standard push behaviour; the detail worth knowing is the version check.
 *
 * `/sw.js` is served from `public/` and therefore has a stable URL, so a browser
 * will keep the *old* worker installed until every tab using it is closed. The
 * `install` step calls `skipWaiting()` and `activate` claims clients, because a
 * tracking app that needs a week to ship a fix to a driver's phone is not
 * deployable in practice.
 */

/* global self, caches */

// Bump on any change to this file. The activation logic below compares it.
const VERSION = "busguard-sw-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop any worker from a previous version, so a stale cache can never
      // answer for the current build.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "BusGuard",
    body: "You have a new notification.",
    href: "/notifications",
    tag: "busguard",
  };

  // `event.data` is absent when the push was sent without a body, and
  // `json()` throws on a body that is not JSON. Either way the generic message
  // is better than an unhandled rejection that shows nothing at all.
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      // Keep the default.
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // `tag` collapses a burst of messages about the same subject into one
      // notification. Without it, three pick-ups in a row would leave three
      // separate alerts and the last one would be the only one read.
      tag: payload.tag ?? "busguard",
      renotify: true,
      // A real logo now exists, so a pick-up alert carries the BusGuard mark
      // instead of the browser's generic globe. `badge` is the small monochrome
      // slot Android draws in the status bar; it renders the same asset as a
      // silhouette, which is exactly what that slot wants.
      icon: "/logo.png",
      badge: "/logo.png",
      data: { href: payload.href ?? "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const href = event.notification.data?.href ?? "/notifications";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reuse an open BusGuard tab rather than piling up new ones: a parent who
      // has been left on the tracking page should land back on it.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(href).catch(() => undefined);
        }
        return;
      }

      await self.clients.openWindow(href);
    })(),
  );
});
