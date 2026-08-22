import { db } from '../db.js';

/**
 * Format various Firestore timestamp formats into ISO 8601 string.
 * @param {any} val
 * @returns {string|null}
 */
export function formatTimestamp(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') {
    return val.toDate().toISOString();
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'number') {
    return new Date(val).toISOString();
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d.toISOString();
  }
  return null;
}

/**
 * Get unresolved messages from ControlRoom.
 * @param {Object} params
 * @param {number} [params.limit=20]
 * @param {string} [params.priority]
 * @param {string} [params.since]
 * @param {string} [params.app]
 */
export async function getUnresolvedMessages({ limit = 20, priority, since, app } = {}) {
  try {
    const feedbackRef = db.collection('feedback');
    // Fetch recent documents ordered by createdAt desc where possible
    const snapshot = await feedbackRef.orderBy('createdAt', 'desc').limit(200).get();

    let messages = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const status = (data.status || 'unresolved').toLowerCase();

      // Exclude resolved messages
      if (status === 'resolved') {
        return;
      }

      const isoTime = formatTimestamp(data.createdAt);

      // Filter by 'since' ISO timestamp if specified
      if (since && isoTime) {
        if (new Date(isoTime).getTime() < new Date(since).getTime()) {
          return;
        }
      }

      // Filter by priority if specified (case-insensitive)
      const itemPriority = (data.priority || 'normal').toLowerCase();
      if (priority && itemPriority !== priority.toLowerCase()) {
        return;
      }

      // Filter by app if specified (case-insensitive match)
      if (app && data.app) {
        if (!data.app.toLowerCase().includes(app.toLowerCase())) {
          return;
        }
      }

      const messageText = data.message || '';
      const snippet = messageText.length > 120 ? messageText.slice(0, 117) + '...' : messageText;
      const subject = data.title || data.subject || (messageText ? messageText.slice(0, 80) : 'No subject');

      messages.push({
        message_id: doc.id,
        app: data.app || 'Unknown App',
        sender: data.user || data.sender || data.email || 'Anonymous',
        subject: subject,
        snippet: snippet,
        timestamp: isoTime,
        priority: data.priority || 'normal',
        status: data.status || 'unresolved',
        type: data.type || 'feedback'
      });
    });

    if (limit && limit > 0) {
      messages = messages.slice(0, limit);
    }

    return {
      count: messages.length,
      total_retrieved: messages.length,
      messages: messages
    };
  } catch (error) {
    console.error('[ControlRoom MCP] Error fetching unresolved messages:', error);
    throw new Error(`Failed to fetch unresolved messages: ${error.message}`);
  }
}

/**
 * Retrieve detailed message context by ID.
 * @param {string} messageId
 */
export async function getMessageDetails(messageId) {
  if (!messageId || typeof messageId !== 'string') {
    throw new Error('A valid message_id string is required.');
  }

  try {
    const docRef = db.collection('feedback').doc(messageId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new Error(`Message with ID "${messageId}" not found in ControlRoom.`);
    }

    const data = docSnap.data();
    const rawCreatedAt = formatTimestamp(data.createdAt);
    const rawResolvedAt = formatTimestamp(data.resolvedAt);

    // Extract tags if any
    let tags = [];
    if (Array.isArray(data.tags)) {
      tags = data.tags;
    } else if (typeof data.tags === 'string') {
      tags = [data.tags];
    } else {
      if (data.type) tags.push(data.type);
      if (data.app) tags.push(data.app);
    }

    // Extract thread/history if any
    let thread = [];
    if (Array.isArray(data.thread)) {
      thread = data.thread;
    } else if (Array.isArray(data.history)) {
      thread = data.history;
    }

    // Identify standard fields to separate custom metadata
    const standardKeys = new Set([
      'app', 'user', 'sender', 'email', 'type', 'priority', 'status',
      'message', 'createdAt', 'resolvedAt', 'resolutionNotes', 'notes',
      'tags', 'thread', 'history', 'title', 'subject'
    ]);

    const metadata = {};
    for (const [key, value] of Object.entries(data)) {
      if (!standardKeys.has(key)) {
        metadata[key] = value;
      }
    }

    return {
      message_id: docSnap.id,
      app: data.app || 'Unknown App',
      sender: data.user || data.sender || data.email || 'Anonymous',
      type: data.type || 'feedback',
      priority: data.priority || 'normal',
      status: data.status || 'unresolved',
      subject: data.title || data.subject || (data.message ? data.message.slice(0, 80) : 'No subject'),
      message: data.message || '',
      timestamp: rawCreatedAt,
      resolvedAt: rawResolvedAt,
      resolutionNotes: data.resolutionNotes || data.notes || null,
      tags: tags,
      thread: thread,
      metadata: Object.keys(metadata).length > 0 ? metadata : null
    };
  } catch (error) {
    console.error(`[ControlRoom MCP] Error retrieving message ${messageId}:`, error);
    throw error;
  }
}

/**
 * Mark a message as resolved.
 * @param {string} messageId
 * @param {string} [notes]
 */
export async function resolveMessage(messageId, notes) {
  if (!messageId || typeof messageId !== 'string') {
    throw new Error('A valid message_id string is required.');
  }

  try {
    const docRef = db.collection('feedback').doc(messageId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new Error(`Message with ID "${messageId}" not found in ControlRoom.`);
    }

    const resolvedAt = new Date();
    const updatePayload = {
      status: 'resolved',
      resolvedAt: resolvedAt
    };

    if (notes !== undefined && notes !== null) {
      updatePayload.resolutionNotes = notes;
    }

    await docRef.update(updatePayload);

    return {
      success: true,
      message_id: messageId,
      status: 'resolved',
      resolvedAt: resolvedAt.toISOString(),
      notes: notes || null
    };
  } catch (error) {
    console.error(`[ControlRoom MCP] Error resolving message ${messageId}:`, error);
    throw error;
  }
}
