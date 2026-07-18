const { BetaAnalyticsDataClient } = require('@google-analytics/data');

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const propertyId = process.env.VITE_GA_PROPERTY_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!propertyId || !clientEmail || !privateKey) {
      throw new Error('Missing Google Analytics credentials in environment variables.');
    }

    // Initialize the GA4 client with environment credentials
    const analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: {
        client_email: clientEmail,
        // Replace escaped literal \n with actual newlines for the private key
        private_key: privateKey.replace(/\\n/g, '\n')
      }
    });

    // 1. Fetch New Users (last 7 days)
    const [usersResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'newUsers' }]
    });

    const newUsers = usersResponse.rows && usersResponse.rows.length > 0 
      ? parseInt(usersResponse.rows[0].metricValues[0].value, 10) 
      : 0;

    // 2. Fetch Top Pages (last 7 days)
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        newUsersLast7Days: newUsers,
        topPages: topPages
      })
    };

  } catch (error) {
    console.error('Error in getAnalytics function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
