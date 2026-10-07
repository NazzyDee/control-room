/**
 * ntfyAlert.cjs
 * Netlify Function to dispatch push notifications to Nathan's phone via ntfy.sh
 * Callable from client apps, webhooks, or Control Room services.
 */

const DEFAULT_TOPIC = process.env.NTFY_TOPIC || 'cr-admin-nathan-alerts';
const DEFAULT_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, _context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }

    const {
      title,
      message,
      app = 'Control Room',
      sender,
      priority = 'default',
      tags = [],
      topic = DEFAULT_TOPIC,
      clickUrl = 'https://controlroomadmin.netlify.app'
    } = payload;

    if (!message && !title) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing title or message' })
      };
    }

    const targetTopic = topic.trim().replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_TOPIC;
    const endpoint = `${DEFAULT_SERVER.replace(/\/+$/, '')}/${targetTopic}`;

    const ntfyHeaders = {
      'Title': title || `New message in ${app}`,
      'Priority': priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : 'default',
    };

    const tagList = Array.isArray(tags) ? [...tags] : (tags ? [tags] : []);
    if (!tagList.length) {
      tagList.push('envelope', 'bell');
    }
    ntfyHeaders['Tags'] = tagList.join(',');

    if (clickUrl) {
      ntfyHeaders['Click'] = clickUrl;
      ntfyHeaders['Actions'] = `view, Open Control Room, ${clickUrl}, clear=true`;
    }

    const bodyText = sender 
      ? `From: ${sender}\n\n${message || ''}` 
      : (message || title);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: ntfyHeaders,
      body: bodyText
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: 'ntfy upstream error', details: errText })
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, topic: targetTopic, ntfyResponse: data })
    };
  } catch (error) {
    console.error('ntfyAlert error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message })
    };
  }
};
