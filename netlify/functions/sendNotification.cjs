const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: "your-journey-your-tools",
        clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
        // Replace escaped newlines with actual newlines
        privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
  } catch (error) {
    console.error('Firebase Admin initialization error', error);
  }
}

exports.handler = async (event, context) => {
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

    const db = admin.firestore();
    // Fetch all subscribed tokens from PlexMePlease
    const tokensSnapshot = await db.collection('fcm_tokens').where('app', '==', 'PlexMePlease').get();
    
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
    const response = await admin.messaging().sendEachForMulticast(message);
    
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
      body: JSON.stringify({ error: 'Failed to send notification', details: error.message })
    };
  }
};
