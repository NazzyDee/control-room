// Formula 1 Data & RSS Service
// Fetches the latest Grand Prix results and top 5 finishes

export const CONSTRUCTOR_COLORS = {
  'mercedes': '#00D2BE',
  'red bull': '#3671C6',
  'red bull racing': '#3671C6',
  'ferrari': '#E80020',
  'mclaren': '#FF8000',
  'aston martin': '#229971',
  'alpine': '#0093CC',
  'williams': '#64C4FF',
  'haas': '#B6BABD',
  'haas f1 team': '#B6BABD',
  'sauber': '#52E252',
  'kick sauber': '#52E252',
  'rb': '#6692FF',
  'racing bulls': '#6692FF'
};

export function getConstructorColor(name) {
  if (!name) return '#e10600';
  const key = name.toLowerCase().trim();
  return CONSTRUCTOR_COLORS[key] || '#e10600';
}

// Fetch latest race results from Netlify function or direct Jolpica API
export async function fetchLatestF1Race() {
  const cacheKey = 'control_room_f1_last_race';
  const cacheTimeKey = 'control_room_f1_last_race_time';

  // Strategy 1: Call Netlify Function (if deployed)
  if (typeof window !== 'undefined' && window.location) {
    try {
      const res = await fetch(`/.netlify/functions/fetchF1?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.race) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheTimeKey, String(Date.now()));
          } catch {}
          return data;
        }
      }
    } catch {
      // Fallback to direct client fetch
    }
  }

  // Strategy 2: Direct fetch to Jolpica F1 API
  try {
    const res = await fetch('https://api.jolpi.ca/ergast/f1/current/last/results.json', {
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const json = await res.json();
      const race = json?.MRData?.RaceTable?.Races?.[0];
      if (race) {
        const top5 = (race.Results || []).slice(0, 5).map(r => ({
          pos: r.position,
          driverName: `${r.Driver?.givenName || ''} ${r.Driver?.familyName || ''}`.trim(),
          driverCode: r.Driver?.code || '',
          driverNumber: r.Driver?.permanentNumber || r.number || '',
          constructorName: r.Constructor?.name || 'Unknown Team',
          constructorId: r.Constructor?.constructorId || '',
          teamColor: getConstructorColor(r.Constructor?.name),
          time: r.Time?.time || r.status || '',
          points: r.points || '0',
          laps: r.laps || '',
          isFastestLap: r.FastestLap?.rank === '1'
        }));

        const result = {
          success: true,
          race: {
            season: race.season,
            round: race.round,
            raceName: race.raceName,
            circuitName: race.Circuit?.circuitName || '',
            locality: race.Circuit?.Location?.locality || '',
            country: race.Circuit?.Location?.country || '',
            date: race.date,
            time: race.time
          },
          top5,
          news: data?.news || [],
          lastFetched: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        try {
          localStorage.setItem(cacheKey, JSON.stringify(result));
          localStorage.setItem(cacheTimeKey, String(Date.now()));
        } catch {}

        return result;
      }
    }
  } catch (err) {
    console.debug('Direct F1 API fetch error, checking cache:', err);
  }

  // Fallback: Cached response from localStorage
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  throw new Error('Could not fetch Formula 1 race results.');
}
