const https = require('https');

// Default fallback spreadsheet ID from user's URL
const DEFAULT_SPREADSHEET_ID = '1_Sq0dbOPbTsjiUCUOfklyHjXfLSxkKTjpHFlh7sM734';

// Helper to fetch text over HTTPS with redirects
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects if any (e.g. 301, 302, 307)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
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

// Convert DD/MM/YYYY or MM/DD/YYYY to YYYY-MM-DD
function normalizeDate(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);
      const p3 = parseInt(parts[2], 10);
      // Determine if p1 is day and p2 is month (Australian DD/MM/YYYY format used in sheet)
      let day = p1;
      let month = p2;
      let year = p3;
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

// Parse GViz JSON response (google.visualization.Query.setResponse(...))
function parseGvizResponse(rawText) {
  // Extract JSON object inside setResponse(...)
  const match = rawText.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?$/);
  let jsonString = match ? match[1] : rawText;
  const parsed = JSON.parse(jsonString);
  const rows = parsed.table?.rows || [];

  const matrix = rows.map(r => {
    return (r.c || []).map(cell => (cell ? (cell.f !== undefined ? cell.f : cell.v) : ''));
  });

  return parseSheetMatrix(matrix);
}

// Parse CSV text into a 2D matrix
function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/);
  const matrix = lines.map(line => {
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
  return parseSheetMatrix(matrix);
}

// Given a 2D matrix of cell values, extract the 3 key tables:
// 1. Client Tracker (Cols A to H)
// 2. Spent (Cols A to C)
// 3. PastClients (Cols E to G)
function parseSheetMatrix(matrix) {
  const clients = [];
  const expenses = [];
  const pastClients = [];

  let inClientTracker = false;
  let inSpent = false;

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const colA = String(row[0] || '').trim();
    const colE = String(row[4] || '').trim();

    // Check for Client Tracker header
    if (colA.toLowerCase().includes('person name') || colA.toLowerCase().includes('client tracker')) {
      inClientTracker = true;
      continue;
    }

    // Check for Spent section
    if (colA.toLowerCase().includes('spent') || colA.toLowerCase() === 'item name') {
      inClientTracker = false;
      inSpent = true;
      continue;
    }

    // Check for PastClients section in col E
    if (colE.toLowerCase().includes('pastclient') || colE.toLowerCase().includes('past clients') || colE.toLowerCase() === 'client name') {
      inPastClients = true;
      // Note: PastClients can be on the same row as other items
    }

    // Parse Client Tracker rows
    if (inClientTracker && colA) {
      // If we encounter a section break
      if (colA.toLowerCase().includes('spent') || colA.toLowerCase().includes('item name')) {
        inClientTracker = false;
        inSpent = true;
      } else {
        const name = colA;
        const email = String(row[1] || '').trim();
        const startDate = normalizeDate(row[2]);
        const lastPaymentDate = normalizeDate(row[3]);
        const nextPaymentDue = normalizeDate(row[4]);
        // Payment status is in col 5, monthly in col 6, total paid in col 7
        const monthlyAmount = parseMoney(row[6]) || 10.00;
        const totalPaid = parseMoney(row[7]) || 0;

        if (name && !name.toLowerCase().includes('person name')) {
          clients.push({
            name,
            email,
            startDate,
            lastPaymentDate,
            nextPaymentDue,
            monthlyAmount,
            totalPaid,
            notes: ''
          });
        }
      }
    }

    // Parse Spent rows (Cols A, B, C)
    if (inSpent && colA) {
      if (!colA.toLowerCase().includes('item name') && !colA.toLowerCase().includes('spent')) {
        const itemName = colA;
        const cost = parseMoney(row[1]);
        const purchaseDate = normalizeDate(row[2]);
        if (itemName && cost > 0) {
          expenses.push({
            itemName,
            cost,
            purchaseDate
          });
        }
      }
    }

    // Parse PastClients rows (Cols E, F, G)
    if (colE && !colE.toLowerCase().includes('pastclient') && !colE.toLowerCase().includes('client name') && !colE.toLowerCase().includes('income')) {
      const pastName = colE;
      const pastEmail = String(row[5] || '').trim();
      const totalRecv = parseMoney(row[6]);
      // Verify it's not a profit table row
      if (pastEmail.includes('@') || totalRecv > 0) {
        pastClients.push({
          name: pastName,
          email: pastEmail,
          totalRecv
        });
      }
    }
  }

  return { clients, expenses, pastClients };
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

  // 1. Attempt GViz JSON fetch
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
            clients: parsed.clients,
            expenses: parsed.expenses,
            pastClients: parsed.pastClients,
            lastSynced: new Date().toISOString()
          })
        };
      }
    }
  } catch {
    // Expected if private/restricted
  }

  // 2. Attempt CSV Export fetch
  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
  try {
    const rawCsv = await fetchUrl(csvUrl);
    if (rawCsv && rawCsv.length > 20 && !rawCsv.includes('<!DOCTYPE html>')) {
      const parsed = parseCsv(rawCsv);
      if (parsed.clients.length > 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            source: 'csv_export',
            clients: parsed.clients,
            expenses: parsed.expenses,
            pastClients: parsed.pastClients,
            lastSynced: new Date().toISOString()
          })
        };
      }
    }
  } catch {
    // Expected if private/restricted
  }

  // 3. Return informative response indicating sheet permissions need to be enabled
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
