const https = require('https');
const Parser = require('rss-parser');
const rssParser = new Parser();

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ControlRoom/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

exports.handler = async (event, _context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let raceData = null;
  let top5 = [];
  let f1News = [];

  // 1. Fetch Latest Race Results
  try {
    const json = await fetchJson('https://api.jolpi.ca/ergast/f1/current/last/results.json');
    const race = json?.MRData?.RaceTable?.Races?.[0];
    if (race) {
      raceData = {
        season: race.season,
        round: race.round,
        raceName: race.raceName,
        circuitName: race.Circuit?.circuitName || '',
        locality: race.Circuit?.Location?.locality || '',
        country: race.Circuit?.Location?.country || '',
        date: race.date,
        time: race.time
      };

      top5 = (race.Results || []).slice(0, 5).map(r => ({
        pos: r.position,
        driverName: `${r.Driver?.givenName || ''} ${r.Driver?.familyName || ''}`.trim(),
        driverCode: r.Driver?.code || '',
        driverNumber: r.Driver?.permanentNumber || r.number || '',
        constructorName: r.Constructor?.name || 'Unknown Team',
        time: r.Time?.time || r.status || '',
        points: r.points || '0',
        laps: r.laps || '',
        isFastestLap: r.FastestLap?.rank === '1'
      }));
    }
  } catch (err) {
    console.error('Error fetching F1 race results:', err);
  }

  // 2. Fetch BBC Sport F1 RSS News
  try {
    const feed = await rssParser.parseURL('https://feeds.bbci.co.uk/sport/formula1/rss.xml');
    if (feed && Array.isArray(feed.items)) {
      f1News = feed.items.slice(0, 10).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        contentSnippet: item.contentSnippet || item.content || ''
      }));
    }
  } catch (err) {
    console.error('Error fetching F1 RSS:', err);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      race: raceData,
      top5,
      news: f1News,
      lastFetched: new Date().toISOString()
    })
  };
};
