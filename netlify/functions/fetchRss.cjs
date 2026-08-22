const Parser = require('rss-parser');
const parser = new Parser();

exports.handler = async (event, context) => {
  // Only allow GET or POST requests
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  let rssUrl = '';

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      rssUrl = body.url;
    } catch (e) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body' })
      };
    }
  } else {
    rssUrl = event.queryStringParameters.url;
  }

  if (!rssUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing RSS URL' })
    };
  }

  try {
    const feed = await parser.parseURL(rssUrl);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(feed)
    };
  } catch (error) {
    console.error('Error fetching/parsing RSS:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch or parse RSS feed' })
    };
  }
};
