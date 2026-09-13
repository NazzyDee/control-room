import { doc, setDoc, deleteDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';

export const DEFAULT_SPREADSHEET_ID = '1_Sq0dbOPbTSjiUCUOfkIyHjXfLSskKTjpHFIh7sM734';

// Convert DD/MM/YYYY or YYYY-MM-DD to YYYY-MM-DD
export function normalizeDate(val) {
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

// Parse currency string like "$10.00", "$360.00", "-$220.00"
export function parseMoney(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// Parse CSV text into 2D matrix
export function parseCsv(csvText) {
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

// Parse 2D matrix matching Plex Tracker spreadsheet format
export function parsePlexSheetMatrix(matrix) {
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

    // Section transitions
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

// Browser JSONP fallback for GViz endpoint (works everywhere without CORS)
function fetchSheetViaJsonp(spreadsheetId) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return reject(new Error('Window not defined'));
    }
    const callbackName = '__gviz_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Google Sheet JSONP timed out'));
    }, 12000);

    function cleanup() {
      clearTimeout(timeoutId);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    }

    window[callbackName] = (data) => {
      cleanup();
      const rows = data?.table?.rows || [];
      const matrix = rows.map(r => (r.c || []).map(cell => cell ? (cell.f !== undefined ? cell.f : cell.v) : ''));
      resolve(parsePlexSheetMatrix(matrix));
    };

    script.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=responseHandler:${callbackName}&_cb=${Date.now()}`;
    script.onerror = (err) => {
      cleanup();
      reject(err);
    };
    document.body.appendChild(script);
  });
}

// Fetch spreadsheet data with automatic fallback strategies
export async function fetchLiveSpreadsheetData(spreadsheetId = DEFAULT_SPREADSHEET_ID) {
  const cacheBuster = Date.now();

  // Strategy 1: Call Netlify Function (if hosted on Netlify in browser)
  if (typeof window !== 'undefined' && window.location) {
    try {
      const res = await fetch(`/.netlify/functions/fetchPlexSheet?_cb=${cacheBuster}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.clients) && data.clients.length > 0) {
          return data;
        }
      }
    } catch (e) {
      console.debug('Netlify function fetch not available, falling back to direct fetch:', e);
    }
  }

  // Strategy 2: Direct CSV fetch (Google sheets export sends access-control-allow-origin: *)
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&_cb=${cacheBuster}`;
    const res = await fetch(csvUrl, { redirect: 'follow', cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      if (text && !text.includes('<!DOCTYPE html>') && text.includes('Person Name')) {
        const matrix = parseCsv(text);
        const parsed = parsePlexSheetMatrix(matrix);
        if (parsed.clients.length > 0) {
          return {
            success: true,
            source: 'direct_csv',
            ...parsed
          };
        }
      }
    }
  } catch (e) {
    console.debug('Direct CSV fetch failed, trying JSONP fallback:', e);
  }

  // Strategy 3: JSONP GViz API (works from any origin, file://, Capacitor, localhost)
  try {
    const parsed = await fetchSheetViaJsonp(spreadsheetId);
    if (parsed && parsed.clients.length > 0) {
      return {
        success: true,
        source: 'direct_jsonp_gviz',
        ...parsed
      };
    }
  } catch (e) {
    console.warn('JSONP fetch failed:', e);
  }

  throw new Error('Could not fetch spreadsheet from any source.');
}

// Helper to sanitize document IDs in Firestore
export const toDocId = (prefix, name) => `${prefix}_${String(name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`;

// Master Sync Function: Fetches live Google Sheet and persists directly to Firestore
export async function syncPlexSheetWithFirestore(db, options = {}) {
  const spreadsheetId = options.spreadsheetId || DEFAULT_SPREADSHEET_ID;
  const sheetData = await fetchLiveSpreadsheetData(spreadsheetId);

  if (!sheetData || !sheetData.success) {
    throw new Error('Spreadsheet returned unsuccessful response.');
  }

  const { clients = [], expenses = [], pastClients = [] } = sheetData;

  // 1. Persist Clients to Firestore
  for (const c of clients) {
    if (!c.name) continue;
    const docId = toDocId('client', c.name);
    await setDoc(doc(db, 'plex_tracker_clients', docId), {
      name: c.name,
      email: c.email || '',
      startDate: c.startDate || '',
      lastPaymentDate: c.lastPaymentDate || '',
      nextPaymentDue: c.nextPaymentDue || '',
      monthlyAmount: c.monthlyAmount || 10.0,
      totalPaid: c.totalPaid || 0,
      statusOverride: null,
      notes: c.notes || '',
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  // Purge any legacy duplicate / non-canonical documents from Firestore
  try {
    const clientsSnap = await getDocs(collection(db, 'plex_tracker_clients'));
    const validClientIds = new Set(clients.map(c => toDocId('client', c.name)));
    for (const docSnap of clientsSnap.docs) {
      if (!validClientIds.has(docSnap.id)) {
        const docName = String(docSnap.data()?.name || '').toLowerCase().trim();
        const matchesClient = clients.some(c => c.name.toLowerCase().trim() === docName);
        if (matchesClient || !docSnap.id.startsWith('client_')) {
          await deleteDoc(docSnap.ref).catch(() => {});
        }
      }
    }

    const expensesSnap = await getDocs(collection(db, 'plex_tracker_expenses'));
    const validExpIds = new Set(expenses.map(e => toDocId('exp', e.itemName)));
    for (const docSnap of expensesSnap.docs) {
      if (!validExpIds.has(docSnap.id) && !docSnap.id.startsWith('exp_')) {
        await deleteDoc(docSnap.ref).catch(() => {});
      }
    }

    const pastSnap = await getDocs(collection(db, 'plex_tracker_past_clients'));
    const validPastIds = new Set(pastClients.map(p => toDocId('past', p.name)));
    for (const docSnap of pastSnap.docs) {
      if (!validPastIds.has(docSnap.id) && !docSnap.id.startsWith('past_')) {
        await deleteDoc(docSnap.ref).catch(() => {});
      }
    }
  } catch (err) {
    console.debug('Purge legacy docs error:', err);
  }

  // 2. Persist Expenses to Firestore
  for (const exp of expenses) {
    if (!exp.itemName) continue;
    const docId = toDocId('exp', exp.itemName);
    await setDoc(doc(db, 'plex_tracker_expenses', docId), {
      itemName: exp.itemName,
      cost: exp.cost || 0,
      purchaseDate: exp.purchaseDate || '',
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  // 3. Persist Past Clients to Firestore
  for (const p of pastClients) {
    if (!p.name) continue;
    const docId = toDocId('past', p.name);
    await setDoc(doc(db, 'plex_tracker_past_clients', docId), {
      name: p.name,
      email: p.email || '',
      totalRecv: p.totalRecv || 0,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('plex_tracker_last_sync', nowTime);
  }

  return {
    success: true,
    clientsCount: clients.length,
    expensesCount: expenses.length,
    pastClientsCount: pastClients.length,
    clients,
    expenses,
    pastClients,
    lastSynced: nowTime
  };
}
