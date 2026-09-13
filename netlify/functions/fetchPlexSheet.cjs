const https = require('https');

// Default spreadsheet ID from user's URL:
// https://docs.google.com/spreadsheets/d/1_Sq0dbOPbTSjiUCUOfkIyHjXfLSskKTjpHFIh7sM734/edit?usp=sharing
const DEFAULT_SPREADSHEET_ID = '1_Sq0dbOPbTSjiUCUOfkIyHjXfLSskKTjpHFIh7sM734';

// Helper to fetch text over HTTPS with automatic redirect following
function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    https.get(url, (res) => {
      // Follow 301, 302, 307 redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Convert DD/MM/YYYY or YYYY-MM-DD to YYYY-MM-DD
function normalizeDate(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      let day = parseInt(parts[0], 10);
      let month = parseInt(parts[1], 10);
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  if (str.includes('-')) {
    const parts = str.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return str;
    }
  }
  return str;
}

// Parse currency string like "$10.00", "$360.00", "-$240.00"
function parseMoney(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// Parse CSV text into 2D string matrix
function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/);
  return lines.map(line => {
    const row = [];
    let inQuotes = false;
    let curr = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(curr.trim());
        curr = '';
      } else {
        curr += char;
      }
    }
    row.push(curr.trim());
    return row;
  });
}

// Parse the 2D matrix matching the exact Plex Tracker Google Sheet structure:
// 1. Clients: Rows under "Person Name" header until blank row or "Item Name"
// 2. Spent: Rows under "Item Name" header with cost > 0
// 3. Past Clients: Under "Client Name" in col 3 or col 4 (Johnny, Michael Loyd)
function parsePlexSheetMatrix(matrix) {
  const clients = [];
  const expenses = [];
  const pastClients = [];

  let section = 'clients'; // 'clients' | 'spent'

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();
    const col2 = String(row[2] || '').trim();
    const col3 = String(row[3] || '').trim();
    const col4 = String(row[4] || '').trim();
    const col5 = String(row[5] || '').trim();
    const col6 = String(row[6] || '').trim();
    const col7 = String(row[7] || '').trim();

    // Detect section transitions
    if (col0.toLowerCase() === 'person name') {
      section = 'clients';
      continue;
    }

    if (col0.toLowerCase() === 'item name') {
      section = 'spent';
      continue;
    }

    // Active Clients table
    if (section === 'clients' && col0) {
      if (!col0.toLowerCase().includes('item name') && !col0.toLowerCase().includes('spent')) {
        clients.push({
          name: col0,
          email: col1,
          startDate: normalizeDate(col2),
          lastPaymentDate: normalizeDate(col3),
          nextPaymentDue: normalizeDate(col4),
          monthlyAmount: parseMoney(col6) || 10.00,
          totalPaid: parseMoney(col7) || 0,
          notes: ''
        });
      }
    }

    // Hardware Spent table (col 0: Item Name, col 1: Cost, col 2: Purchase Date)
    if (section === 'spent' && col0 && col0.toLowerCase() !== 'item name') {
      const cost = parseMoney(col1);
      if (cost > 0) {
        expenses.push({
          itemName: col0,
          cost: cost,
          purchaseDate: normalizeDate(col2)
        });
      }
    }

    // Past Clients table (found in col 3: Client Name, col 4: Email, col 5: Total Received)
    if (col3 && col3.toLowerCase() !== 'client name' && col3.toLowerCase() !== 'item name') {
      const totalRecv = parseMoney(col5);
      if (col4.includes('@') || totalRecv > 0) {
        pastClients.push({
          name: col3,
          email: col4,
          totalRecv: totalRecv
        });
      }
    }
  }

  return { clients, expenses, pastClients };
}

// Fallback: Parse GViz JSON response if CSV is unavailable
function parseGvizResponse(rawText) {
  const match = rawText.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?$/);
  let jsonString = match ? match[1] : rawText;
  const parsed = JSON.parse(jsonString);
  const rows = parsed.table?.rows || [];

  const matrix = rows.map(r => {
    return (r.c || []).map(cell => (cell ? (cell.f !== undefined ? cell.f : cell.v) : ''));
  });

  return parsePlexSheetMatrix(matrix);
}

exports.handler = async (event, _context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const spreadsheetId = (event.queryStringParameters && event.queryStringParameters.sheetId) || DEFAULT_SPREADSHEET_ID;

  // 1. Primary Strategy: CSV Export (Fast, follows redirects, preserves all rows & columns without GViz schema type interference)
  const cacheBuster = Date.now();
  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&_cb=${cacheBuster}`;
  try {
    const rawCsv = await fetchUrl(csvUrl);
    if (rawCsv && rawCsv.length > 20 && !rawCsv.includes('<!DOCTYPE html>') && !rawCsv.includes('<html')) {
      const matrix = parseCsv(rawCsv);
      const parsed = parsePlexSheetMatrix(matrix);
      if (parsed.clients.length > 0 || parsed.expenses.length > 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            source: 'csv_export',
            spreadsheetId,
            clients: parsed.clients,
            expenses: parsed.expenses,
            pastClients: parsed.pastClients,
            lastSynced: new Date().toISOString()
          })
        };
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Secondary Strategy: GViz JSON endpoint
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json`;
  try {
    const rawGviz = await fetchUrl(gvizUrl);
    if (rawGviz && rawGviz.includes('setResponse')) {
      const parsed = parseGvizResponse(rawGviz);
      if (parsed.clients.length > 0 || parsed.expenses.length > 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            source: 'gviz_json',
            spreadsheetId,
            clients: parsed.clients,
            expenses: parsed.expenses,
            pastClients: parsed.pastClients,
            lastSynced: new Date().toISOString()
          })
        };
      }
    }
  } catch {
    // Continue to permission error
  }

  // 3. Informative response if the sheet is private / restricted
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: false,
      needsSharePermission: true,
      spreadsheetId,
      message: 'Google Sheet is currently set to Restricted. In Google Sheets, click "Share" (top right) and change General access to "Anyone with the link can view".',
      shareUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    })
  };
};
