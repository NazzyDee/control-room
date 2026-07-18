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

exports.handler = async (event, context) => {
  if (initError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Init Error", details: initError.message })
    };
  }
  
  const envDebug = {
    emailLength: process.env.GOOGLE_CLIENT_EMAIL?.length,
    keyLength: process.env.GOOGLE_PRIVATE_KEY?.length
  };
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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

  try {
    const { title, body, icon, click_action } = JSON.parse(event.body);

    if (!title || !body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing title or body' })
      };
    }

    const db = getFirestore();
    
    // Save the broadcast to Firestore so it appears in the PlexMePlease Inbox
    try {
      await db.collection('broadcasts').add({
        title: title,
        body: body,
        app: 'PlexMePlease',
        createdAt: new Date()
      });
      console.log('Saved to broadcasts collection');
    } catch (dbError) {
      console.error('Firestore save error:', dbError);
      throw new Error(`Firestore Error: ${dbError.message}`);
    }

    // Fetch all subscribed tokens from PlexMePlease
    let tokensSnapshot;
    try {
      tokensSnapshot = await db.collection('fcm_tokens').where('app', '==', 'PlexMePlease').get();
      console.log('Fetched fcm_tokens');
    } catch (dbError) {
      console.error('Firestore fetch error:', dbError);
      throw new Error(`Firestore Fetch Error: ${dbError.message}`);
    }
    
    if (tokensSnapshot.empty) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'No subscribed users found.' })
      };
    }

    const tokens = [];
    tokensSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.token) {
        tokens.push(data.token);
      }
    });

    if (tokens.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'No valid tokens found.' })
      };
    }

    // Prepare message payload
    const message = {
      notification: {
        title: title,
        body: body
      },
      webpush: {
        notification: {
          icon: icon || '/icons/icon-192x192.png',
          click_action: click_action || 'https://plexreq.netlify.app' // TODO: replace with actual URL if known, or let frontend pass it
        }
      },
      tokens: tokens
    };

    // Send multicast message
    let response;
    try {
      response = await getMessaging().sendEachForMulticast(message);
      console.log('Sent push notifications');
    } catch (msgError) {
      console.error('Messaging send error:', msgError);
      throw new Error(`Messaging Error: ${msgError.message}`);
    }
    
    // Cleanup invalid tokens (e.g. uninstalled apps)
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });
      console.log('List of tokens that caused failures: ' + failedTokens);
      // Optional: Delete these failed tokens from Firestore
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        sent: response.successCount, 
        failed: response.failureCount 
      })
    };
  } catch (error) {
    console.error('Error sending notification:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send notification', 
        details: error.message,
        envDebug: envDebug
      })
    };
  }
};
