const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");

const { initializeApp, getApps, cert, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

let initError = null;
if (getApps().length > 0) {
  for (const app of getApps()) {
    deleteApp(app).catch(console.error);
  }
}

let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
let clientEmail = process.env.GOOGLE_CLIENT_EMAIL || '';
clientEmail = clientEmail.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
if (clientEmail.length > 80 || !clientEmail.includes('@')) {
  clientEmail = 'firebase-adminsdk-fbsvc@your-journey-your-tools.iam.gserviceaccount.com';
}
privateKey = privateKey.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
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

let analyticsDataClient = null;
try {
  const propertyId = process.env.VITE_GA_PROPERTY_ID;
  if (propertyId && clientEmail && privateKey) {
    analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      }
    });
  }
} catch (err) {
  console.error("Analytics init error:", err);
}

let handlerPromise = null;

async function setupServer() {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server({ name: "ControlRoom", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_analytics",
          description: "Fetch Google Analytics data including new users and top pages from the last 7 days.",
          inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
          name: "send_notification",
          description: "Send a push notification to PlexMePlease users using Firebase Cloud Messaging.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "The title of the notification" },
              body: { type: "string", description: "The main text body of the notification" }
            },
            required: ["title", "body"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_analytics") {
      if (!analyticsDataClient) return { content: [{ type: "text", text: "Error: GA client not initialized." }], isError: true };
      const propertyId = process.env.VITE_GA_PROPERTY_ID;
      try {
        const [usersResponse] = await analyticsDataClient.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          metrics: [{ name: 'newUsers' }]
        });
        const newUsers = usersResponse.rows && usersResponse.rows.length > 0 ? parseInt(usersResponse.rows[0].metricValues[0].value, 10) : 0;

        const [pagesResponse] = await analyticsDataClient.runReport({
          property: `properties/${propertyId}`,
          dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metrics: [{ name: 'screenPageViews' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 5
        });
        const topPages = (pagesResponse.rows || []).map(row => ({
          path: row.dimensionValues[0].value,
          title: row.dimensionValues[1].value,
          views: parseInt(row.metricValues[0].value, 10)
        }));

        return { content: [{ type: "text", text: JSON.stringify({ newUsersLast7Days: newUsers, topPages }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error fetching analytics: ${error.message}` }], isError: true };
      }
    }

    if (request.params.name === "send_notification") {
      if (initError) return { content: [{ type: "text", text: `Firebase Init Error: ${initError.message}` }], isError: true };
      const { title, body } = request.params.arguments;
      if (!title || !body) return { content: [{ type: "text", text: "Error: Missing title or body" }], isError: true };

      try {
        const db = getFirestore();
        await db.collection('broadcasts').add({ title, body, app: 'PlexMePlease', createdAt: new Date() });
        const tokensSnapshot = await db.collection('fcm_tokens').where('app', '==', 'PlexMePlease').get();
        if (tokensSnapshot.empty) return { content: [{ type: "text", text: "No subscribed users found." }] };

        const tokens = [];
        tokensSnapshot.forEach(doc => { if (doc.data().token) tokens.push(doc.data().token); });
        if (tokens.length === 0) return { content: [{ type: "text", text: "No valid tokens found." }] };

        const message = {
          notification: { title, body },
          webpush: { notification: { icon: '/icons/icon-192x192.png', click_action: 'https://plexreq.netlify.app' } },
          tokens: tokens
        };

        const response = await getMessaging().sendEachForMulticast(message);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, sent: response.successCount, failed: response.failureCount }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error sending notification: ${error.message}` }], isError: true };
      }
    }

    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
  });

  let transport = null;
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/mcp", async (req, res) => {
    transport = new SSEServerTransport("/mcp/messages", res);
    await server.connect(transport);
  });

  app.post("/mcp/messages", async (req, res) => {
    if (!transport) {
      res.status(503).send("MCP transport not initialized on this server instance. Please reconnect to /mcp.");
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  return serverless(app);
}

exports.handler = async (event, context) => {
  if (!handlerPromise) {
    handlerPromise = setupServer();
  }
  const expressHandler = await handlerPromise;
  return expressHandler(event, context);
};
