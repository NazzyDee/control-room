// Date and client helper utilities for Control Room & Plex Tracker

export const INITIAL_CLIENTS = [
  {
    name: 'James Roy',
    email: 'james.stephen@live.com',
    startDate: '2025-10-11',
    lastPaymentDate: '2026-08-11',
    nextPaymentDue: '2026-09-11',
    monthlyAmount: 10.00,
    totalPaid: 110.00,
    statusOverride: null,
    notes: ''
  },
  {
    name: 'Ben DiGregorio',
    email: 'ben.digregorio@hotmail.com',
    startDate: '2025-10-23',
    lastPaymentDate: '2026-08-24',
    nextPaymentDue: '2026-09-24',
    monthlyAmount: 10.00,
    totalPaid: 110.00,
    statusOverride: null,
    notes: ''
  },
  {
    name: 'Jason Cheng',
    email: 'jasoncheng@mac.com',
    startDate: '2025-12-15',
    lastPaymentDate: '2026-08-15',
    nextPaymentDue: '2026-09-15',
    monthlyAmount: 10.00,
    totalPaid: 90.00,
    statusOverride: null,
    notes: ''
  },
  {
    name: 'Tyson',
    email: 'tysonfaravoni@hotmail.com',
    startDate: '2026-01-30',
    lastPaymentDate: '2026-08-31',
    nextPaymentDue: '2026-09-30',
    monthlyAmount: 10.00,
    totalPaid: 80.00,
    statusOverride: null,
    notes: ''
  },
  {
    name: 'Ianeesha Plummer',
    email: 'woollizeng@hotmail.com',
    startDate: '2026-05-19',
    lastPaymentDate: '2026-08-19',
    nextPaymentDue: '2026-09-19',
    monthlyAmount: 10.00,
    totalPaid: 40.00,
    statusOverride: null,
    notes: ''
  },
  {
    name: 'Marie Rid',
    email: 'kittykat007rules@gmail.com',
    startDate: '2026-06-04',
    lastPaymentDate: '2026-09-11',
    nextPaymentDue: '2026-10-11',
    monthlyAmount: 10.00,
    totalPaid: 40.00,
    statusOverride: null,
    notes: ''
  }
];

export function parseDateStringToMidnight(dateStr) {
  if (!dateStr) return null;
  let y, m, d;
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    y = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10) - 1;
    d = parseInt(parts[2], 10);
  } else if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    d = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10) - 1;
    y = parseInt(parts[2], 10);
  } else {
    return new Date(dateStr);
  }
  return new Date(y, m, d, 0, 0, 0, 0);
}

export function formatDateDisplay(dateVal) {
  if (!dateVal) return '—';
  const d = typeof dateVal === 'string' ? parseDateStringToMidnight(dateVal) : dateVal;
  if (!d || isNaN(d.getTime())) return String(dateVal);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatIsoDate(dateVal) {
  if (!dateVal) return '';
  const d = typeof dateVal === 'string' ? parseDateStringToMidnight(dateVal) : dateVal;
  if (!d || isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
}

export function addOneMonth(dateStr) {
  const d = parseDateStringToMidnight(dateStr) || new Date();
  d.setMonth(d.getMonth() + 1);
  return formatIsoDate(d);
}
