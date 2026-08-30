const { initializeApp, getApps, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

let initError = null;

// Clear any existing initialized apps to prevent caching bad credentials in warm containers
if (getApps().length > 0) {
  for (const app of getApps()) {
    deleteApp(app).catch(console.error);
  }
}

let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
let clientEmail = process.env.GOOGLE_CLIENT_EMAIL || '';

// Strip any accidental leading/trailing quotes or whitespace from email
clientEmail = clientEmail.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();

// The subagent accidentally saved an invalid string of 131 characters instead of just the email
if (clientEmail.length > 80 || !clientEmail.includes('@')) {
  clientEmail = 'firebase-adminsdk-fbsvc@your-journey-your-tools.iam.gserviceaccount.com';
}

// Strip any accidental leading or trailing quotes
privateKey = privateKey.replace(/^"|"$/g, '').replace(/^'|'$/g, '');

// Netlify UI sometimes replaces actual newlines with literal '\n'
privateKey = privateKey.replace(/\\n/g, '\n');

// Netlify UI sometimes replaces newlines with spaces. If there are no newlines, fix it.
if (!privateKey.includes('\n') && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
  privateKey = privateKey.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\n');
  privateKey = privateKey.replace('-----END PRIVATE KEY-----', '\n-----END PRIVATE KEY-----');
  // The key body might now be a single line with spaces, remove spaces
  // Wait, spaces inside the key body should just be removed or converted to newlines.
  // It's safer to just replace all spaces between the headers with newlines.
  const parts = privateKey.split('\n');
  if (parts.length === 3) {
    parts[1] = parts[1].replace(/\s+/g, '\n');
    privateKey = parts.join('\n');
  }
}

try {
  initializeApp({
    credential: cert({
      projectId: "your-journey-your-tools",
      clientEmail: clientEmail,
      privateKey: privateKey
    })
  });
} catch (err) {
  initError = err;
  console.error("Firebase init error:", err);
}

exports.handler = async (event, _context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  if (initError) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Firebase Init Error", details: initError.message })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { 
      title, 
      body, 
      app = 'All Apps', 
      category = 'broadcast', // broadcast, alert, update, info, poll
      priority = 'normal',   // normal, high, urgent
      icon, 
      click_action, 
      expiresAt,
      sendPush = true,
      pollOptions = []
    } = payload;

    if (!title || !body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: title or body' })
      };
    }

    const db = getFirestore();
    
    // 1. Save broadcast record into Firestore
    const broadcastData = {
      title: title.trim(),
      body: body.trim(),
      app: app,
      category: category,
      priority: priority,
      sender: 'Control Room Admin',
      createdAt: new Date()
    };

    if (category === 'poll' && Array.isArray(pollOptions)) {
      const sanitizedOptions = pollOptions
        .map(opt => (typeof opt === 'string' ? opt.trim() : ''))
        .filter(opt => opt.length > 0);
      if (sanitizedOptions.length >= 2) {
        broadcastData.pollOptions = sanitizedOptions;
      }
    }
    
    if (click_action) {
      broadcastData.actionUrl = click_action.trim();
    }
    
    if (expiresAt) {
      broadcastData.expiresAt = new Date(expiresAt);
    }
    
    let broadcastDocRef;
    try {
      broadcastDocRef = await db.collection('broadcasts').add(broadcastData);
      console.log('Saved to broadcasts collection with ID:', broadcastDocRef.id);
    } catch (dbError) {
      console.error('Firestore save error:', dbError);
      throw new Error(`Firestore Error: ${dbError.message}`);
    }

    // 2. If sendPush is requested, attempt FCM multicast
    let pushResult = { sent: 0, failed: 0, skipped: false };
    
    if (sendPush) {
      let tokensQuery = db.collection('fcm_tokens');
      if (app && app !== 'All Apps') {
        tokensQuery = tokensQuery.where('app', '==', app);
      }

      let tokensSnapshot;
      try {
        tokensSnapshot = await tokensQuery.get();
      } catch (dbError) {
        console.warn('Could not fetch tokens (collection might be empty):', dbError.message);
      }

      const tokens = [];
      if (tokensSnapshot && !tokensSnapshot.empty) {
        tokensSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.token && typeof data.token === 'string' && !tokens.includes(data.token)) {
            tokens.push(data.token);
          }
        });
      }

      if (tokens.length > 0) {
        const message = {
          notification: {
            title: title,
            body: body
          },
          data: {
            app: app,
            category: category,
            broadcastId: broadcastDocRef.id
          },
          webpush: {
            notification: {
              icon: icon || '/favicon.ico',
              click_action: click_action || 'https://yourjourneyyourtools.com'
            }
          },
          tokens: tokens
        };

        try {
          const response = await getMessaging().sendEachForMulticast(message);
          pushResult = {
            sent: response.successCount,
            failed: response.failureCount,
            skipped: false
          };
          console.log(`Push sent: ${response.successCount} success, ${response.failureCount} failed.`);
        } catch (msgError) {
          console.error('FCM Multicast error:', msgError);
          pushResult = {
            sent: 0,
            failed: tokens.length,
            error: msgError.message,
            skipped: false
          };
        }
      } else {
        pushResult = { sent: 0, failed: 0, message: 'No registered push tokens found', skipped: true };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        broadcastId: broadcastDocRef.id,
        broadcast: broadcastData,
        pushResult: pushResult
      })
    };
  } catch (error) {
    console.error('Error sending notification:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send notification', 
        details: error.message 
      })
    };
  }
};
