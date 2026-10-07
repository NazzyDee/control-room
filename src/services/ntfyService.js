/**
 * ntfyService.js
 * Instant mobile push notification service using ntfy.sh for Control Room.
 * Free, lightweight, zero-account setup on iOS and Android.
 */

export const DEFAULT_NTFY_TOPIC = 'cr-admin-nathan-alerts';
export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';

const STORAGE_KEY_ENABLED = 'control_room_ntfy_enabled';
const STORAGE_KEY_TOPIC = 'control_room_ntfy_topic';
const STORAGE_KEY_SERVER = 'control_room_ntfy_server';

/**
 * Retrieve saved ntfy settings from localStorage.
 */
export function getNtfyConfig() {
  const enabledStr = localStorage.getItem(STORAGE_KEY_ENABLED);
  const enabled = enabledStr === null ? true : enabledStr === 'true';
  const topic = localStorage.getItem(STORAGE_KEY_TOPIC) || DEFAULT_NTFY_TOPIC;
  const server = localStorage.getItem(STORAGE_KEY_SERVER) || DEFAULT_NTFY_SERVER;

  return { enabled, topic, server };
}

/**
 * Persist ntfy settings to localStorage.
 */
export function saveNtfyConfig({ enabled, topic, server }) {
  if (enabled !== undefined) {
    localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
  }
  if (topic !== undefined) {
    const cleanTopic = topic.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    localStorage.setItem(STORAGE_KEY_TOPIC, cleanTopic || DEFAULT_NTFY_TOPIC);
  }
  if (server !== undefined) {
    const cleanServer = server.trim().replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEY_SERVER, cleanServer || DEFAULT_NTFY_SERVER);
  }
}

/**
 * Map Control Room message priority to ntfy priority header (1-5 or strings).
 */
function mapPriority(priority) {
  switch (priority?.toLowerCase()) {
    case 'urgent':
      return 'urgent'; // 5
    case 'high':
      return 'high'; // 4
    case 'low':
      return 'low'; // 2
    default:
      return 'default'; // 3
  }
}

/**
 * Send a push notification to your phone via ntfy.sh.
 *
 * @param {Object} options
 * @param {string} [options.topic] - ntfy topic name
 * @param {string} [options.server] - ntfy server URL (defaults to https://ntfy.sh)
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification body text
 * @param {string} [options.app] - Source app name
 * @param {string} [options.priority] - 'normal' | 'high' | 'urgent'
 * @param {string|string[]} [options.tags] - Emojis or tags
 * @param {string} [options.clickUrl] - URL to open when tapped
 */
export async function sendNtfyNotification({
  topic,
  server,
  title,
  message,
  app,
  priority = 'normal',
  tags = [],
  clickUrl
}) {
  const config = getNtfyConfig();
  const targetTopic = (topic || config.topic || DEFAULT_NTFY_TOPIC).trim();
  const targetServer = (server || config.server || DEFAULT_NTFY_SERVER).trim().replace(/\/+$/, '');

  if (!targetTopic) {
    console.warn('[ntfyService] No topic configured, skipping push notification.');
    return { success: false, error: 'Missing ntfy topic' };
  }

  const endpoint = `${targetServer}/${targetTopic}`;

  const headers = {
    'Title': title || `Control Room: New Message${app ? ` (${app})` : ''}`,
    'Priority': mapPriority(priority),
  };

  const tagList = Array.isArray(tags) ? [...tags] : (tags ? [tags] : []);
  if (priority === 'urgent') {
    tagList.push('rotating_light', 'warning');
  } else if (!tagList.length) {
    tagList.push('envelope', 'bell');
  }
  headers['Tags'] = tagList.join(',');

  const actionUrl = clickUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  if (actionUrl) {
    headers['Click'] = actionUrl;
    headers['Actions'] = `view, Open Control Room, ${actionUrl}, clear=true`;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: message || 'You have received a new message in Control Room.',
      headers: headers
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ntfyService] Failed to send push notification:', response.status, errText);
      return { success: false, error: `HTTP ${response.status}: ${errText}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    console.error('[ntfyService] Network or fetch error sending push notification:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send a verification / test alert to the user's phone.
 */
export async function sendTestNtfyNotification({ topic, server } = {}) {
  const config = getNtfyConfig();
  const currentTopic = topic || config.topic;
  const currentServer = server || config.server;

  return sendNtfyNotification({
    topic: currentTopic,
    server: currentServer,
    title: '🔔 Control Room: Phone Alerts Active',
    message: `Test notification successful! Your phone is now paired with topic: "${currentTopic}". You will receive instant push notifications when new messages arrive.`,
    priority: 'high',
    tags: ['white_check_mark', 'iphone', 'bell'],
    clickUrl: typeof window !== 'undefined' ? window.location.href : 'https://ntfy.sh'
  });
}
