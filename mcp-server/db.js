import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attempt to load .env file from workspace root or current directory
const possibleEnvPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '.env')
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      }
    } catch (e) {
      console.error(`[ControlRoom MCP] Notice: failed to load env file from ${envPath}:`, e.message);
    }
  }
}

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

let app;
if (getApps().length === 0) {
  try {
    app = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
  } catch (err) {
    console.error('[ControlRoom MCP] Error initializing Firebase Admin SDK:', err.message);
    throw err;
  }
} else {
  app = getApps()[0];
}

export const db = getFirestore(app);
