const https = require('https');

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      ...headers
    };

    const req = https.get(url, { headers: defaultHeaders, timeout: 8000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// Parse Google News XML RSS items into structured JSON
function parseRssXml(xmlString) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlString)) !== null && items.length < 9) {
    const itemContent = match[1];

    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemContent);
    const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(itemContent);
    const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemContent);
    const descMatch = /<description>([\s\S]*?)<\/description>/.exec(itemContent);
    const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(itemContent);

    let title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    let link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    let pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    let rawDesc = descMatch ? descMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    let source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';

    // Strip HTML tags from description snippet
    let snippet = rawDesc.replace(/<[^>]*>?/gm, '').trim();

    // Clean title if source is repeated at the end (e.g. "Title - Fox Sports")
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }

    if (title && link) {
      items.push({
        title,
        link,
        pubDate,
        contentSnippet: snippet,
        source: source || 'NRL News'
      });
    }
  }

  return items;
}

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 1. Fetch Draw / Fixtures (latest matches)
    // First fetch current draw data to identify current and previous round
    let drawRaw = null;
    try {
      drawRaw = await fetchUrl('https://www.nrl.com/draw/data');
    } catch (e) {
      console.warn('Direct draw fetch error:', e.message);
    }

    let drawJson = null;
    let previousRoundJson = null;

    if (drawRaw) {
      try {
        drawJson = JSON.parse(drawRaw);
        const selectedRoundId = drawJson.selectedRoundId;

        // If the current round only has upcoming matches, also fetch the previous round to get the latest completed scores
        if (selectedRoundId && selectedRoundId > 1) {
          const prevRoundId = selectedRoundId - 1;
          try {
            const prevRaw = await fetchUrl(`https://www.nrl.com/draw/data?round=${prevRoundId}`);
            previousRoundJson = JSON.parse(prevRaw);
          } catch (e) {
            console.warn('Previous round fetch error:', e.message);
          }
        }
      } catch (e) {
        console.warn('Error parsing draw JSON:', e.message);
      }
    }

    // 2. Fetch Ladder Standings
    let ladderRaw = null;
    try {
      ladderRaw = await fetchUrl('https://www.nrl.com/ladder/data');
    } catch (e) {
      console.warn('Direct ladder fetch error:', e.message);
    }

    let ladderJson = null;
    if (ladderRaw) {
      try {
        ladderJson = JSON.parse(ladderRaw);
      } catch (e) {
        console.warn('Error parsing ladder JSON:', e.message);
      }
    }

    // 3. Fetch NRL Breaking News RSS from Google News
    let newsItems = [];
    try {
      const rssRaw = await fetchUrl('https://news.google.com/rss/search?q=NRL+rugby+league&hl=en-AU&gl=AU&ceid=AU:en');
      newsItems = parseRssXml(rssRaw);
    } catch (e) {
      console.warn('Error fetching NRL RSS news:', e.message);
    }

    // Process Match Fixtures
    // Combine latest completed matches and upcoming fixtures
    let completedMatches = [];
    let upcomingMatches = [];
    let activeRoundTitle = drawJson?.fixtures?.[0]?.roundTitle || 'NRL Premiership';

    // Helper to format fixture
    const formatFixture = (f) => ({
      matchId: f.matchCentreUrl || `${f.homeTeam?.nickName}-v-${f.awayTeam?.nickName}`,
      roundTitle: f.roundTitle,
      venue: f.venue || 'Stadium',
      venueCity: f.venueCity || '',
      matchState: f.matchState || (f.matchMode === 'Post' ? 'FullTime' : 'Upcoming'),
      kickOff: f.clock?.kickOffTimeLong || null,
      gameTime: f.clock?.gameTime || '',
      matchCentreUrl: f.matchCentreUrl ? (f.matchCentreUrl.startsWith('http') ? f.matchCentreUrl : `https://www.nrl.com${f.matchCentreUrl}`) : null,
      homeTeam: {
        name: f.homeTeam?.nickName || f.homeTeam?.theme?.key || 'Home',
        score: f.homeTeam?.score !== undefined ? f.homeTeam.score : null,
        key: f.homeTeam?.theme?.key || f.homeTeam?.nickName?.toLowerCase() || '',
        position: f.homeTeam?.teamPosition || '',
        odds: f.homeTeam?.odds || ''
      },
      awayTeam: {
        name: f.awayTeam?.nickName || f.awayTeam?.theme?.key || 'Away',
        score: f.awayTeam?.score !== undefined ? f.awayTeam.score : null,
        key: f.awayTeam?.theme?.key || f.awayTeam?.nickName?.toLowerCase() || '',
        position: f.awayTeam?.teamPosition || '',
        odds: f.awayTeam?.odds || ''
      }
    });

    // Check current round fixtures
    if (Array.isArray(drawJson?.fixtures)) {
      drawJson.fixtures.forEach(f => {
        const formatted = formatFixture(f);
        if (formatted.matchState === 'FullTime' || formatted.homeTeam.score !== null) {
          completedMatches.push(formatted);
        } else {
          upcomingMatches.push(formatted);
        }
      });
    }

    // If current round had mostly upcoming matches, populate completedMatches from previous round
    if (previousRoundJson && Array.isArray(previousRoundJson.fixtures) && completedMatches.length === 0) {
      previousRoundJson.fixtures.forEach(f => {
        const formatted = formatFixture(f);
        completedMatches.push(formatted);
      });
    }

    // Process Ladder positions (top 8 or all 17)
    let ladderStandings = [];
    if (Array.isArray(ladderJson?.positions)) {
      ladderStandings = ladderJson.positions.map((pos, idx) => ({
        position: idx + 1,
        teamName: pos.teamNickname || pos.theme?.key || 'Team',
        key: pos.theme?.key || (pos.teamNickname ? pos.teamNickname.toLowerCase() : ''),
        played: pos.stats?.played || 0,
        wins: pos.stats?.wins || 0,
        losses: pos.stats?.lost || 0,
        draws: pos.stats?.drawn || 0,
        pointsDifference: pos.stats?.['points difference'] !== undefined ? pos.stats['points difference'] : 0,
        points: pos.stats?.points || 0,
        streak: pos.stats?.streak || '',
        form: pos.stats?.form || '',
        profileUrl: pos.clubProfileUrl ? `https://www.nrl.com${pos.clubProfileUrl}` : null
      }));
    }

    const payload = {
      success: true,
      lastFetched: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      currentRound: activeRoundTitle,
      completedMatches,
      upcomingMatches,
      ladder: ladderStandings,
      news: newsItems
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(payload)
    };

  } catch (error) {
    console.error('fetchNRL error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
