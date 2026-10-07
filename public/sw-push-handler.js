/**
 * sw-push-handler.js
 * PWA Service Worker push event and notificationclick listener for Control Room.
 * Enables push notifications on standalone mobile PWAs (iOS 16.4+ and Android Chrome).
 */

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = {
        title: 'Control Room: New Message',
        body: event.data.text()
      };
    }
  }

  const notification = data.notification || {};
  const payloadData = data.data || {};

  const title = notification.title || data.title || '📩 New Message in Control Room';
  const options = {
    body: notification.body || data.body || data.message || 'A new support message or ticket has arrived.',
    icon: notification.icon || data.icon || '/pwa-192x192.jpg',
    badge: '/pwa-192x192.jpg',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || `msg-${Date.now()}`,
    renotify: true,
    data: {
      url: payloadData.url || data.click_action || data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If Control Room is already open, focus it
      for (let client of windowClients) {
        if ('focus' in client) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
      }
      // If not open, open a new window/tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
