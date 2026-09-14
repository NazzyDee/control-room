// NRL (National Rugby League) Service
// Fetches live scores, round fixtures, ladder standings, and Google News RSS feed

export const NRL_TEAM_COLORS = {
  panthers: { primary: '#007A87', accent: '#000000', text: '#22d3ee' },
  storm: { primary: '#4c1d95', accent: '#fbbf24', text: '#c084fc' },
  roosters: { primary: '#002B49', accent: '#dc2626', text: '#f87171' },
  sharks: { primary: '#0284c7', accent: '#000000', text: '#38bdf8' },
  cowboys: { primary: '#1e3a8a', accent: '#eab308', text: '#facc15' },
  bulldogs: { primary: '#2563eb', accent: '#ffffff', text: '#60a5fa' },
  seaeagles: { primary: '#831843', accent: '#ffffff', text: '#f472b6' },
  knights: { primary: '#dc2626', accent: '#2563eb', text: '#f87171' },
  raiders: { primary: '#65a30d', accent: '#ffffff', text: '#a3e635' },
  dolphins: { primary: '#b91c1c', accent: '#d97706', text: '#fbbf24' },
  dragons: { primary: '#dc2626', accent: '#ffffff', text: '#f87171' },
  broncos: { primary: '#701a75', accent: '#d97706', text: '#fbbf24' },
  warriors: { primary: '#0369a1', accent: '#059669', text: '#38bdf8' },
  titans: { primary: '#0284c7', accent: '#ca8a04', text: '#38bdf8' },
  eels: { primary: '#1d4ed8', accent: '#eab308', text: '#facc15' },
  rabbitohs: { primary: '#047857', accent: '#dc2626', text: '#34d399' },
  tigers: { primary: '#ea580c', accent: '#000000', text: '#fb923c' }
};

export function getNrlTeamColor(keyOrName) {
  if (!keyOrName) return { primary: '#3b82f6', accent: '#ffffff', text: '#60a5fa' };
  const clean = keyOrName.toLowerCase().replace(/[^a-z]/g, '');
  
  for (const [key, color] of Object.entries(NRL_TEAM_COLORS)) {
    if (clean.includes(key) || key.includes(clean)) {
      return color;
    }
  }

  return { primary: '#0284c7', accent: '#ffffff', text: '#38bdf8' };
}

const CACHE_KEY = 'control_room_nrl_cache';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export async function fetchNrlData(forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL && data) {
          return data;
        }
      }
    } catch (e) {
      console.warn('Error reading NRL cache:', e);
    }
  }

  // Strategy 1: Call Netlify Function
  try {
    const res = await fetch('/.netlify/functions/fetchNRL');
    if (res.ok) {
      const payload = await res.json();
      if (payload && payload.success) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          timestamp: Date.now(),
          data: payload
        }));
        return payload;
      }
    }
  } catch (err) {
    console.warn('Netlify function fetchNRL unavailable, falling back:', err.message);
  }

  // Strategy 2: Direct Client-Side Fallback via CORS proxy
  try {
    const proxyUrl = 'https://api.allorigins.win/raw?url=';
    const [drawRes, ladderRes, rssRes] = await Promise.allSettled([
      fetch(`${proxyUrl}${encodeURIComponent('https://www.nrl.com/draw/data')}`),
      fetch(`${proxyUrl}${encodeURIComponent('https://www.nrl.com/ladder/data')}`),
      fetch(`${proxyUrl}${encodeURIComponent('https://news.google.com/rss/search?q=NRL+rugby+league&hl=en-AU&gl=AU&ceid=AU:en')}`)
    ]);

    let completedMatches = [];
    let upcomingMatches = [];
    let currentRound = 'NRL Premiership';
    let ladder = [];
    let news = [];

    if (drawRes.status === 'fulfilled' && drawRes.value.ok) {
      const drawJson = await drawRes.value.json();
      currentRound = drawJson?.fixtures?.[0]?.roundTitle || 'NRL Premiership';
      if (Array.isArray(drawJson?.fixtures)) {
        drawJson.fixtures.forEach(f => {
          const item = {
            matchId: f.matchCentreUrl || `${f.homeTeam?.nickName}-v-${f.awayTeam?.nickName}`,
            roundTitle: f.roundTitle,
            venue: f.venue || 'Stadium',
            venueCity: f.venueCity || '',
            matchState: f.matchState || (f.matchMode === 'Post' ? 'FullTime' : 'Upcoming'),
            kickOff: f.clock?.kickOffTimeLong || null,
            gameTime: f.clock?.gameTime || '',
            matchCentreUrl: f.matchCentreUrl ? `https://www.nrl.com${f.matchCentreUrl}` : null,
            homeTeam: {
              name: f.homeTeam?.nickName || 'Home',
              score: f.homeTeam?.score !== undefined ? f.homeTeam.score : null,
              key: f.homeTeam?.theme?.key || f.homeTeam?.nickName?.toLowerCase() || ''
            },
            awayTeam: {
              name: f.awayTeam?.nickName || 'Away',
              score: f.awayTeam?.score !== undefined ? f.awayTeam.score : null,
              key: f.awayTeam?.theme?.key || f.awayTeam?.nickName?.toLowerCase() || ''
            }
          };

          if (item.matchState === 'FullTime' || item.homeTeam.score !== null) {
            completedMatches.push(item);
          } else {
            upcomingMatches.push(item);
          }
        });
      }
    }

    if (ladderRes.status === 'fulfilled' && ladderRes.value.ok) {
      const ladderJson = await ladderRes.value.json();
      if (Array.isArray(ladderJson?.positions)) {
        ladder = ladderJson.positions.map((pos, idx) => ({
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
    }

    if (rssRes.status === 'fulfilled' && rssRes.value.ok) {
      const xml = await rssRes.value.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, 'text/xml');
      const items = Array.from(xmlDoc.querySelectorAll('item')).slice(0, 9);
      news = items.map(item => ({
        title: item.querySelector('title')?.textContent || '',
        link: item.querySelector('link')?.textContent || '',
        pubDate: item.querySelector('pubDate')?.textContent || '',
        contentSnippet: (item.querySelector('description')?.textContent || '').replace(/<[^>]*>?/gm, '').trim(),
        source: item.querySelector('source')?.textContent || 'NRL News'
      }));
    }

    const payload = {
      success: true,
      lastFetched: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      currentRound,
      completedMatches,
      upcomingMatches,
      ladder,
      news
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data: payload
    }));

    return payload;
  } catch (err) {
    console.error('All NRL fetch strategies failed:', err);

    // Return cached data if available regardless of expiration
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached).data;
    }

    throw new Error('Unable to retrieve NRL scores or ladder at this time.');
  }
}
