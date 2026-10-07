/**
 * pwaNotificationService.js
 * Native Web Push & Notification service for the Control Room PWA.
 * Works directly in mobile browsers and installed home screen PWAs (iOS 16.4+ & Android)
 * with zero App Store or Play Store requirements.
 */

/**
 * Check current notification permission status.
 */
export function getPwaNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Request notification permission from the user on this device.
 */
export async function requestPwaNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { success: false, permission: 'unsupported', error: 'Notifications not supported in this browser' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      // Send welcome / test notification
      await sendPwaNotification({
        title: '🔔 Control Room Notifications Active',
        body: 'This PWA will now alert you whenever a new message arrives!',
        tag: 'welcome-notification'
      });
      return { success: true, permission: 'granted' };
    }
    return { success: false, permission };
  } catch (err) {
    console.error('[pwaNotificationService] Error requesting permission:', err);
    return { success: false, permission: Notification.permission, error: err.message };
  }
}

/**
 * Dispatch a native notification on this device via Service Worker (preferred for PWAs) or Notification API.
 */
export async function sendPwaNotification({
  title = '📩 Control Room Alert',
  body = 'You have received a new message.',
  icon = '/pwa-192x192.jpg',
  badge = '/pwa-192x192.jpg',
  tag,
  url
} = {}) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }

  const targetUrl = url || window.location.origin;
  const options = {
    body,
    icon,
    badge,
    tag: tag || `cr-msg-${Date.now()}`,
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: targetUrl }
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    }

    // Fallback to standard Notification constructor
    new Notification(title, options);
    return true;
  } catch (err) {
    console.error('[pwaNotificationService] Failed to display notification:', err);
    try {
      new Notification(title, options);
      return true;
    } catch (fallbackErr) {
      console.error('[pwaNotificationService] Fallback Notification failed:', fallbackErr);
      return false;
    }
  }
}
