const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
let app;
function getDb() {
  if (getApps().length === 0) {
    let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
    let clientEmail = process.env.GOOGLE_CLIENT_EMAIL || '';
    const projectId = process.env.GOOGLE_PROJECT_ID || 'your-journey-your-tools';

    // Sanitize clientEmail
    clientEmail = clientEmail.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
    if (!clientEmail || clientEmail.length > 80 || !clientEmail.includes('@')) {
      clientEmail = 'firebase-adminsdk-fbsvc@your-journey-your-tools.iam.gserviceaccount.com';
    }

    // Sanitize privateKey
    privateKey = privateKey.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
    privateKey = privateKey.replace(/\\n/g, '\n');

    if (!privateKey.includes('\n') && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKey = privateKey.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n');
      privateKey = privateKey.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
      const parts = privateKey.split('\n');
      if (parts.length === 3) {
        parts[1] = parts[1].replace(/\s+/g, '\n');
        privateKey = parts.join('\n');
      }
    }

    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
  } else {
    app = getApps()[0];
  }
  return getFirestore(app);
}

function formatTimestamp(val) {
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

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Authentication check if CONTROLROOM_API_KEY is configured
  const configuredApiKey = process.env.CONTROLROOM_API_KEY;
  if (configuredApiKey) {
    const reqApiKey = event.headers['x-api-key'] || event.headers['X-API-KEY'];
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    if (reqApiKey !== configuredApiKey && bearerToken !== configuredApiKey) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'Unauthorized: Invalid or missing API key in x-api-key header or Bearer token'
        })
      };
    }
  }

  try {
    const db = getDb();
    const queryParams = event.queryStringParameters || {};

    // --- GET Message Details by ID ---
    if (event.httpMethod === 'GET' && queryParams.message_id) {
      const messageId = queryParams.message_id;
      const docRef = db.collection('feedback').doc(messageId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: `Message with ID "${messageId}" not found in ControlRoom.` })
        };
      }

      const data = docSnap.data();
      const rawCreatedAt = formatTimestamp(data.createdAt);
      const rawResolvedAt = formatTimestamp(data.resolvedAt);

      let tags = [];
      if (Array.isArray(data.tags)) {
        tags = data.tags;
      } else if (typeof data.tags === 'string') {
        tags = [data.tags];
      } else {
        if (data.type) tags.push(data.type);
        if (data.app) tags.push(data.app);
      }

      let thread = [];
      if (Array.isArray(data.thread)) {
        thread = data.thread;
      } else if (Array.isArray(data.history)) {
        thread = data.history;
      }

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
        statusCode: 200,
        headers,
        body: JSON.stringify({
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
        })
      };
    }

    // --- GET Unresolved Messages List ---
    if (event.httpMethod === 'GET') {
      const limitParam = parseInt(queryParams.limit || '20', 10);
      const limit = isNaN(limitParam) ? 20 : Math.min(Math.max(limitParam, 1), 100);
      const priority = queryParams.priority;
      const since = queryParams.since;
      const appFilter = queryParams.app;
      const statusFilter = (queryParams.status || 'unresolved').toLowerCase();

      const feedbackRef = db.collection('feedback');
      const snapshot = await feedbackRef.orderBy('createdAt', 'desc').limit(200).get();

      let messages = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        const docStatus = (data.status || 'unresolved').toLowerCase();

        // Status filter: default to only unresolved (unless 'all' is requested)
        if (statusFilter === 'unresolved' && docStatus === 'resolved') {
          return;
        } else if (statusFilter !== 'unresolved' && statusFilter !== 'all' && docStatus !== statusFilter) {
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
        if (appFilter && data.app) {
          if (!data.app.toLowerCase().includes(appFilter.toLowerCase())) {
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

      if (limit > 0) {
        messages = messages.slice(0, limit);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          count: messages.length,
          total_retrieved: messages.length,
          messages: messages
        })
      };
    }

    // --- POST Resolve Message ---
    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid JSON payload in request body' })
        };
      }

      const { action = 'resolve', message_id, notes } = body;

      if (!message_id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing required field: message_id' })
        };
      }

      if (action === 'resolve') {
        const docRef = db.collection('feedback').doc(message_id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: `Message with ID "${message_id}" not found in ControlRoom.` })
          };
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
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message_id: message_id,
            status: 'resolved',
            resolvedAt: resolvedAt.toISOString(),
            notes: notes || null
          })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Unknown action "${action}". Supported actions: "resolve"` })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: `Method ${event.httpMethod} Not Allowed` })
    };

  } catch (error) {
    console.error('Error in messages function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
