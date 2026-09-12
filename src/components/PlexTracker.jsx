import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  setDoc,
  deleteDoc, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';

// Initial dataset directly matching user's spreadsheet
const INITIAL_CLIENTS = [
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

const INITIAL_EXPENSES = [
  {
    itemName: '8TB HDD',
    cost: 360.00,
    purchaseDate: '2025-10-01'
  },
  {
    itemName: 'Life time Plex Pass',
    cost: 390.00,
    purchaseDate: '2026-04-29'
  }
];

const INITIAL_PAST_CLIENTS = [
  {
    name: 'Johnny',
    email: 'johnnyjarko@gmail.com',
    totalRecv: 10.00
  },
  {
    name: 'Michael Loyd',
    email: 'michaelloyd4081@gmail.com',
    totalRecv: 40.00
  }
];

const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1_Sq0dbOPbTSjiUCUOfkIyHjXfLSskKTjpHFIh7sM734/edit?usp=sharing';

// Date utility functions
function parseDateStringToMidnight(dateStr) {
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

function formatDateDisplay(dateVal) {
  if (!dateVal) return '—';
  const d = typeof dateVal === 'string' ? parseDateStringToMidnight(dateVal) : dateVal;
  if (!d || isNaN(d.getTime())) return String(dateVal);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatIsoDate(dateVal) {
  if (!dateVal) return '';
  const d = typeof dateVal === 'string' ? parseDateStringToMidnight(dateVal) : dateVal;
  if (!d || isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
}

// Advances date by 1 calendar month
function addOneMonth(dateStr) {
  const d = parseDateStringToMidnight(dateStr) || new Date();
  d.setMonth(d.getMonth() + 1);
  return formatIsoDate(d);
}

export default function PlexTracker({
  soundEnabled,
  playNotificationChime,
  onOverdueCountChange,
  onTriggerDispatch
}) {
  const [clients, setClients] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [pastClients, setPastClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState('clients'); // 'clients', 'expenses', 'past'
  const [notificationPermission, setNotificationPermission] = useState(() => {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default';
  });

  // Google Sheet Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle', 'syncing', 'synced', 'needs_permission', 'error'
  const [lastSyncedTime, setLastSyncedTime] = useState(() => localStorage.getItem('plex_tracker_last_sync') || '');
  const [showPermissionHelp, setShowPermissionHelp] = useState(false);

  // Modal states
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientModalMode, setClientModalMode] = useState('add'); // 'add' or 'edit'
  const [editingClient, setEditingClient] = useState(null);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderTarget, setReminderTarget] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  const initialNotificationFiredRef = useRef(false);
  const hasAutoSyncedRef = useRef(false);

  // Keep latest state in refs so callbacks never need to trigger re-renders or depend on them
  const clientsStateRef = useRef(clients);
  clientsStateRef.current = clients;
  const expensesStateRef = useRef(expenses);
  expensesStateRef.current = expenses;
  const pastClientsStateRef = useRef(pastClients);
  pastClientsStateRef.current = pastClients;

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // Helper for deterministic document IDs in Firestore to prevent duplicates
  const toDocId = (prefix, name) => `${prefix}_${String(name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`;

  // Sync with Google Sheet Netlify function
  const handleSyncGoogleSheet = useCallback(async (isManual = false) => {
    setIsSyncing(true);
    try {
      const res = await fetch('/.netlify/functions/fetchPlexSheet');
      const data = await res.json();

      if (data.success) {
        setSyncStatus('synced');
        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSyncedTime(nowTime);
        localStorage.setItem('plex_tracker_last_sync', nowTime);
        setShowPermissionHelp(false);

        // 1. Sync Clients
        if (Array.isArray(data.clients) && data.clients.length > 0) {
          // Immediately update local state with deduplication
          setClients(prev => {
            const map = new Map();
            prev.forEach(item => {
              if (item.name) map.set(item.name.toLowerCase().trim(), item);
            });
            data.clients.forEach(c => {
              const key = c.name.toLowerCase().trim();
              const existing = map.get(key);
              map.set(key, { ...(existing || {}), ...c, id: existing?.id || toDocId('client', c.name) });
            });
            return Array.from(map.values());
          });

          // Persist to Firestore with deterministic doc IDs (merge: true prevents duplicate creation)
          for (const c of data.clients) {
            const key = c.name.toLowerCase().trim();
            const existing = clientsStateRef.current.find(item => item.name && item.name.toLowerCase().trim() === key);
            const targetDocId = (existing && existing.id && !existing.id.startsWith('local-')) 
              ? existing.id 
              : toDocId('client', c.name);

            await setDoc(doc(db, 'plex_tracker_clients', targetDocId), {
              name: c.name,
              email: c.email || existing?.email || '',
              startDate: c.startDate || existing?.startDate || '',
              lastPaymentDate: c.lastPaymentDate || existing?.lastPaymentDate || '',
              nextPaymentDue: c.nextPaymentDue || existing?.nextPaymentDue || '',
              monthlyAmount: c.monthlyAmount || existing?.monthlyAmount || 10.0,
              totalPaid: c.totalPaid || existing?.totalPaid || 0,
              notes: existing?.notes || '',
              updatedAt: serverTimestamp()
            }, { merge: true }).catch(console.warn);
          }
        }

        // 2. Sync Expenses
        if (Array.isArray(data.expenses) && data.expenses.length > 0) {
          setExpenses(prev => {
            const map = new Map();
            prev.forEach(item => {
              if (item.itemName) map.set(item.itemName.toLowerCase().trim(), item);
            });
            data.expenses.forEach(exp => {
              const key = exp.itemName.toLowerCase().trim();
              const existing = map.get(key);
              map.set(key, { ...(existing || {}), ...exp, id: existing?.id || toDocId('exp', exp.itemName) });
            });
            return Array.from(map.values());
          });

          for (const exp of data.expenses) {
            const key = exp.itemName.toLowerCase().trim();
            const existing = expensesStateRef.current.find(item => item.itemName && item.itemName.toLowerCase().trim() === key);
            const targetDocId = (existing && existing.id && !existing.id.startsWith('local-'))
              ? existing.id
              : toDocId('exp', exp.itemName);

            await setDoc(doc(db, 'plex_tracker_expenses', targetDocId), {
              itemName: exp.itemName,
              cost: exp.cost,
              purchaseDate: exp.purchaseDate || '',
              updatedAt: serverTimestamp()
            }, { merge: true }).catch(console.warn);
          }
        }

        // 3. Sync Past Clients
        if (Array.isArray(data.pastClients) && data.pastClients.length > 0) {
          setPastClients(prev => {
            const map = new Map();
            prev.forEach(item => {
              if (item.name) map.set(item.name.toLowerCase().trim(), item);
            });
            data.pastClients.forEach(p => {
              const key = p.name.toLowerCase().trim();
              const existing = map.get(key);
              map.set(key, { ...(existing || {}), ...p, id: existing?.id || toDocId('past', p.name) });
            });
            return Array.from(map.values());
          });

          for (const p of data.pastClients) {
            const key = p.name.toLowerCase().trim();
            const existing = pastClientsStateRef.current.find(item => item.name && item.name.toLowerCase().trim() === key);
            const targetDocId = (existing && existing.id && !existing.id.startsWith('local-'))
              ? existing.id
              : toDocId('past', p.name);

            await setDoc(doc(db, 'plex_tracker_past_clients', targetDocId), {
              name: p.name,
              email: p.email || existing?.email || '',
              totalRecv: p.totalRecv,
              updatedAt: serverTimestamp()
            }, { merge: true }).catch(console.warn);
          }
        }

        showToast('✓ Fresh data pulled from Google Sheet!');
      } else if (data.needsSharePermission) {
        setSyncStatus('needs_permission');
        if (isManual) {
          setShowPermissionHelp(true);
        }
      } else {
        setSyncStatus('error');
      }
    } catch (err) {
      console.warn('Google Sheet fetch error:', err);
      setSyncStatus('error');
    } finally {
      setIsSyncing(false);
    }
  }, []); // Safe empty dependency array - references are accessed via ref

  // 1. Subscribe to Firestore collections or seed initial data
  useEffect(() => {
    const clientsRef = collection(db, 'plex_tracker_clients');
    const expensesRef = collection(db, 'plex_tracker_expenses');
    const pastRef = collection(db, 'plex_tracker_past_clients');

    let clientsLoaded = false;
    let expensesLoaded = false;
    let pastLoaded = false;

    const checkLoadingComplete = () => {
      if (clientsLoaded && expensesLoaded && pastLoaded) {
        setLoading(false);
      }
    };

    const unsubClients = onSnapshot(clientsRef, (snap) => {
      if (snap.empty) {
        INITIAL_CLIENTS.forEach(client => {
          const docId = `client_${client.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`;
          setDoc(doc(db, 'plex_tracker_clients', docId), { ...client, createdAt: serverTimestamp() }, { merge: true }).catch(console.error);
        });
      } else {
        const list = [];
        const seen = new Set();
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const key = String(data.name || '').toLowerCase().trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            list.push({ id: docSnap.id, ...data });
          }
        });
        list.sort((a, b) => {
          const da = parseDateStringToMidnight(a.nextPaymentDue)?.getTime() || 0;
          const db = parseDateStringToMidnight(b.nextPaymentDue)?.getTime() || 0;
          return da - db;
        });
        setClients(list);
      }
      clientsLoaded = true;
      checkLoadingComplete();
    }, (err) => {
      console.error('Firestore Plex clients error:', err);
      setClients(INITIAL_CLIENTS.map((c, i) => ({ id: `local-${i}`, ...c })));
      clientsLoaded = true;
      checkLoadingComplete();
    });

    const unsubExpenses = onSnapshot(expensesRef, (snap) => {
      if (snap.empty) {
        INITIAL_EXPENSES.forEach(exp => {
          const docId = `exp_${exp.itemName.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`;
          setDoc(doc(db, 'plex_tracker_expenses', docId), { ...exp, createdAt: serverTimestamp() }, { merge: true }).catch(console.error);
        });
      } else {
        const list = [];
        const seen = new Set();
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const key = String(data.itemName || '').toLowerCase().trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            list.push({ id: docSnap.id, ...data });
          }
        });
        list.sort((a, b) => {
          const da = parseDateStringToMidnight(a.purchaseDate)?.getTime() || 0;
          const db = parseDateStringToMidnight(b.purchaseDate)?.getTime() || 0;
          return db - da;
        });
        setExpenses(list);
      }
      expensesLoaded = true;
      checkLoadingComplete();
    }, (err) => {
      console.error('Firestore Plex expenses error:', err);
      setExpenses(INITIAL_EXPENSES.map((e, i) => ({ id: `local-exp-${i}`, ...e })));
      expensesLoaded = true;
      checkLoadingComplete();
    });

    const unsubPast = onSnapshot(pastRef, (snap) => {
      if (snap.empty) {
        INITIAL_PAST_CLIENTS.forEach(past => {
          const docId = `past_${past.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`;
          setDoc(doc(db, 'plex_tracker_past_clients', docId), { ...past, createdAt: serverTimestamp() }, { merge: true }).catch(console.error);
        });
      } else {
        const list = [];
        const seen = new Set();
        snap.forEach(docSnap => {
          const data = docSnap.data();
          const key = String(data.name || '').toLowerCase().trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            list.push({ id: docSnap.id, ...data });
          }
        });
        setPastClients(list);
      }
      pastLoaded = true;
      checkLoadingComplete();
    }, (err) => {
      console.error('Firestore Plex past clients error:', err);
      setPastClients(INITIAL_PAST_CLIENTS.map((p, i) => ({ id: `local-past-${i}`, ...p })));
      pastLoaded = true;
      checkLoadingComplete();
    });

    return () => {
      unsubClients();
      unsubExpenses();
      unsubPast();
    };
  }, []);

  // Attempt initial sync with Google Sheet once on mount
  useEffect(() => {
    if (!hasAutoSyncedRef.current) {
      hasAutoSyncedRef.current = true;
      handleSyncGoogleSheet(false);
    }
  }, [handleSyncGoogleSheet]);

  // Today reference at midnight
  const todayMidnight = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // 2. Compute payment status for each client
  const clientStatusList = useMemo(() => {
    return clients.map(client => {
      if (client.statusOverride) {
        return {
          ...client,
          calculatedStatus: client.statusOverride,
          daysDiff: 0
        };
      }

      const dueDate = parseDateStringToMidnight(client.nextPaymentDue);
      if (!dueDate) {
        return { ...client, calculatedStatus: 'current', daysDiff: 999 };
      }

      const diffTime = dueDate.getTime() - todayMidnight.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      let calculatedStatus = 'current'; // 'overdue', 'due_soon', 'current'
      if (diffDays <= 0) {
        calculatedStatus = 'overdue';
      } else if (diffDays <= 3) {
        calculatedStatus = 'due_soon';
      } else {
        calculatedStatus = 'current';
      }

      return {
        ...client,
        calculatedStatus,
        daysDiff: diffDays
      };
    });
  }, [clients, todayMidnight]);

  // Overdue clients count & list
  const overdueClients = useMemo(() => {
    return clientStatusList.filter(c => c.calculatedStatus === 'overdue');
  }, [clientStatusList]);

  const dueSoonClients = useMemo(() => {
    return clientStatusList.filter(c => c.calculatedStatus === 'due_soon');
  }, [clientStatusList]);

  // Report overdue count to parent (for sidebar badge)
  useEffect(() => {
    if (onOverdueCountChange) {
      onOverdueCountChange(overdueClients.length);
    }
  }, [overdueClients.length, onOverdueCountChange]);

  // Trigger sound alert & desktop notification on load if overdue clients exist
  useEffect(() => {
    if (!loading && overdueClients.length > 0 && !initialNotificationFiredRef.current) {
      initialNotificationFiredRef.current = true;
      if (soundEnabled && playNotificationChime) {
        playNotificationChime();
      }

      // Native browser notification
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const names = overdueClients.map(c => c.name).join(', ');
          new Notification('💳 Plex Payment Due Alert', {
            body: `${overdueClients.length} client(s) due: ${names}`,
            icon: '/favicons/plexmeplease.png'
          });
        } catch (e) {
          console.warn('Native notification error:', e);
        }
      }
    }
  }, [loading, overdueClients, soundEnabled, playNotificationChime]);

  // Request browser notification permission
  const handleRequestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        showToast('✓ Browser notifications enabled!');
        new Notification('💳 Notifications Active', {
          body: 'You will receive alerts when Plex subscriptions are due.',
          icon: '/favicons/plexmeplease.png'
        });
      } else {
        showToast('Browser notifications were declined or blocked.');
      }
    }
  };

  // Financial Metrics Calculations
  const metrics = useMemo(() => {
    const activeTotal = clients.reduce((acc, c) => acc + (Number(c.totalPaid) || 0), 0);
    const pastTotal = pastClients.reduce((acc, p) => acc + (Number(p.totalRecv) || 0), 0);
    const totalIncome = activeTotal + pastTotal;
    const totalSpent = expenses.reduce((acc, e) => acc + (Number(e.cost) || 0), 0);
    const netProfit = totalIncome - totalSpent;
    const mrr = clients.reduce((acc, c) => acc + (Number(c.monthlyAmount) || 0), 0);
    const overdueCash = overdueClients.reduce((acc, c) => acc + (Number(c.monthlyAmount) || 0), 0);

    return {
      totalIncome,
      totalSpent,
      netProfit,
      mrr,
      overdueCash,
      activeClientCount: clients.length,
      pastClientCount: pastClients.length
    };
  }, [clients, expenses, pastClients, overdueClients]);

  // Mark Paid Action (1-Click)
  const handleMarkPaid = async (client) => {
    const todayStr = formatIsoDate(new Date());
    const nextDue = addOneMonth(client.nextPaymentDue || todayStr);
    const newTotal = (Number(client.totalPaid) || 0) + (Number(client.monthlyAmount) || 10.00);

    try {
      if (client.id && !client.id.startsWith('local-')) {
        await updateDoc(doc(db, 'plex_tracker_clients', client.id), {
          lastPaymentDate: todayStr,
          nextPaymentDue: nextDue,
          totalPaid: newTotal,
          statusOverride: null,
          updatedAt: serverTimestamp()
        });
      } else {
        setClients(prev => prev.map(c => c.id === client.id ? {
          ...c,
          lastPaymentDate: todayStr,
          nextPaymentDue: nextDue,
          totalPaid: newTotal
        } : c));
      }
      showToast(`✓ Marked ${client.name} as paid! Next due: ${formatDateDisplay(nextDue)}`);
    } catch (err) {
      console.error('Error marking paid:', err);
      showToast('✕ Error marking paid. Check console.');
    }
  };

  // Add / Edit Client Submission
  const handleSaveClient = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const clientData = {
      name: formData.get('name')?.trim(),
      email: formData.get('email')?.trim() || '',
      startDate: formData.get('startDate') || formatIsoDate(new Date()),
      lastPaymentDate: formData.get('lastPaymentDate') || '',
      nextPaymentDue: formData.get('nextPaymentDue') || '',
      monthlyAmount: parseFloat(formData.get('monthlyAmount')) || 10.00,
      totalPaid: parseFloat(formData.get('totalPaid')) || 0.00,
      notes: formData.get('notes')?.trim() || ''
    };

    if (!clientData.name) return;

    try {
      if (clientModalMode === 'edit' && editingClient) {
        if (editingClient.id && !editingClient.id.startsWith('local-')) {
          await updateDoc(doc(db, 'plex_tracker_clients', editingClient.id), {
            ...clientData,
            updatedAt: serverTimestamp()
          });
        } else {
          setClients(prev => prev.map(c => c.id === editingClient.id ? { ...c, ...clientData } : c));
        }
        showToast(`✓ Updated client ${clientData.name}`);
      } else {
        await addDoc(collection(db, 'plex_tracker_clients'), {
          ...clientData,
          createdAt: serverTimestamp()
        });
        showToast(`✓ Added client ${clientData.name}`);
      }
      setShowClientModal(false);
      setEditingClient(null);
    } catch (err) {
      console.error('Error saving client:', err);
      showToast('✕ Failed to save client.');
    }
  };

  // Delete Client
  const handleDeleteClient = async (client) => {
    if (!window.confirm(`Are you sure you want to permanently delete ${client.name}?`)) return;
    try {
      if (client.id && !client.id.startsWith('local-')) {
        await deleteDoc(doc(db, 'plex_tracker_clients', client.id));
      } else {
        setClients(prev => prev.filter(c => c.id !== client.id));
      }
      showToast(`Deleted ${client.name}`);
    } catch (err) {
      console.error('Error deleting client:', err);
      showToast('✕ Failed to delete client.');
    }
  };

  // Move Active Client to Past Clients
  const handleArchiveClient = async (client) => {
    if (!window.confirm(`Move ${client.name} to Past Clients? This archives them while preserving total payments collected ($${Number(client.totalPaid || 0).toFixed(2)}).`)) return;
    try {
      await addDoc(collection(db, 'plex_tracker_past_clients'), {
        name: client.name,
        email: client.email || '',
        totalRecv: Number(client.totalPaid) || 0,
        archivedAt: serverTimestamp()
      });

      if (client.id && !client.id.startsWith('local-')) {
        await deleteDoc(doc(db, 'plex_tracker_clients', client.id));
      } else {
        setClients(prev => prev.filter(c => c.id !== client.id));
      }
      showToast(`✓ Moved ${client.name} to Past Clients`);
    } catch (err) {
      console.error('Error archiving client:', err);
      showToast('✕ Failed to move client.');
    }
  };

  // Restore Past Client back to Active
  const handleRestorePastClient = async (pastClient) => {
    const todayStr = formatIsoDate(new Date());
    const nextDue = addOneMonth(todayStr);
    try {
      await addDoc(collection(db, 'plex_tracker_clients'), {
        name: pastClient.name,
        email: pastClient.email || '',
        startDate: todayStr,
        lastPaymentDate: todayStr,
        nextPaymentDue: nextDue,
        monthlyAmount: 10.00,
        totalPaid: Number(pastClient.totalRecv) || 0,
        createdAt: serverTimestamp()
      });

      if (pastClient.id && !pastClient.id.startsWith('local-')) {
        await deleteDoc(doc(db, 'plex_tracker_past_clients', pastClient.id));
      } else {
        setPastClients(prev => prev.filter(p => p.id !== pastClient.id));
      }
      showToast(`✓ Restored ${pastClient.name} to Active Clients`);
    } catch (err) {
      console.error('Error restoring past client:', err);
      showToast('✕ Failed to restore client.');
    }
  };

  // Save Expense
  const handleSaveExpense = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const expenseData = {
      itemName: formData.get('itemName')?.trim(),
      cost: parseFloat(formData.get('cost')) || 0,
      purchaseDate: formData.get('purchaseDate') || formatIsoDate(new Date())
    };

    if (!expenseData.itemName) return;

    try {
      await addDoc(collection(db, 'plex_tracker_expenses'), {
        ...expenseData,
        createdAt: serverTimestamp()
      });
      showToast(`✓ Added expense: ${expenseData.itemName}`);
      setShowExpenseModal(false);
    } catch (err) {
      console.error('Error adding expense:', err);
      showToast('✕ Failed to add expense.');
    }
  };

  const handleDeleteExpense = async (exp) => {
    if (!window.confirm(`Delete expense "${exp.itemName}" ($${exp.cost})?`)) return;
    try {
      if (exp.id && !exp.id.startsWith('local-')) {
        await deleteDoc(doc(db, 'plex_tracker_expenses', exp.id));
      } else {
        setExpenses(prev => prev.filter(e => e.id !== exp.id));
      }
      showToast(`Deleted expense: ${exp.itemName}`);
    } catch (err) {
      console.error('Error deleting expense:', err);
      showToast('✕ Failed to delete expense.');
    }
  };

  // Reminder Helper
  const getReminderText = (client) => {
    const formattedDue = formatDateDisplay(client.nextPaymentDue);
    return `Hi ${client.name}, just a friendly reminder that your monthly Plex subscription payment of $${Number(client.monthlyAmount || 10).toFixed(2)} was due on ${formattedDue}. Please send through when you get a moment. Thank you!`;
  };

  const handleCopyReminder = (client) => {
    const text = getReminderText(client);
    navigator.clipboard.writeText(text).then(() => {
      showToast(`✓ Copied reminder for ${client.name} to clipboard!`);
    }).catch(() => {
      showToast('✕ Could not copy to clipboard.');
    });
  };

  const handleEmailReminder = (client) => {
    if (!client.email) {
      showToast(`✕ No email listed for ${client.name}`);
      return;
    }
    const subject = encodeURIComponent(`Plex Subscription Payment Due - $${Number(client.monthlyAmount || 10).toFixed(2)}`);
    const body = encodeURIComponent(getReminderText(client));
    window.location.href = `mailto:${client.email}?subject=${subject}&body=${body}`;
  };

  const handleDispatchInApp = (client) => {
    if (onTriggerDispatch) {
      onTriggerDispatch({
        app: 'PlexMePlease',
        title: `Payment Reminder: ${client.name}`,
        body: getReminderText(client)
      });
    }
  };

  return (
    <div className="plex-tracker-container animate-fade-in">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="plex-toast animate-slide-up">
          {toastMessage}
        </div>
      )}

      {/* Tracker Top Header */}
      <div className="plex-tracker-topbar glass-panel">
        <div className="topbar-left">
          <div className="tracker-title-row">
            <span className="tracker-icon-badge">💳</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2>Plex Subscription & Cost Tracker</h2>
                {syncStatus === 'synced' && (
                  <span className="live-sync-pill" title={`Synced from Google Sheet at ${lastSyncedTime}`}>
                    <span className="live-dot-green"></span> Synced {lastSyncedTime}
                  </span>
                )}
                {isSyncing && (
                  <span className="live-sync-pill syncing">
                    <span className="spinner-mini"></span> Pulling sheet...
                  </span>
                )}
              </div>
              <p className="subtitle">
                Track active client subscriptions, renewal due dates, server hardware investments, and net revenue.
              </p>
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          {/* Live Google Sheet Pull / Sync Button */}
          <button 
            className={`btn btn-secondary plex-topbar-btn ${isSyncing ? 'btn-loading' : ''}`}
            onClick={() => handleSyncGoogleSheet(true)}
            title="Pull the latest data from your Google Sheet"
            disabled={isSyncing}
          >
            <span style={{ display: 'inline-block', transform: isSyncing ? 'rotate(360deg)' : 'none', transition: 'transform 1s linear' }}>
              🔄
            </span>
            <span>{isSyncing ? 'Pulling Data...' : 'Pull Sheet Data'}</span>
          </button>

          {notificationPermission !== 'granted' && (
            <button 
              className="btn btn-secondary plex-topbar-btn"
              onClick={handleRequestNotificationPermission}
              title="Enable desktop notifications when payments are due"
            >
              🔔 Due Alerts
            </button>
          )}

          <a 
            href={GOOGLE_SHEET_URL} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="btn btn-secondary plex-topbar-btn"
            title="Open original Google Sheet"
          >
            <span>Google Sheet</span> <span style={{ fontSize: '1.1em' }}>↗</span>
          </a>

          <button 
            className="btn btn-primary plex-topbar-btn"
            onClick={() => {
              setEditingClient(null);
              setClientModalMode('add');
              setShowClientModal(true);
            }}
          >
            <span>+ Add Client</span>
          </button>
        </div>
      </div>

      {/* GOOGLE SHEET SYNC HELP BANNER (If sheet is restricted) */}
      {(showPermissionHelp || syncStatus === 'needs_permission') && (
        <div className="plex-sync-help-banner glass-panel animate-fade-in">
          <div className="sync-help-content">
            <span className="sync-help-icon">💡</span>
            <div className="sync-help-text">
              <strong>Enable Automatic Pull from Google Sheet</strong>
              <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                Your Google Sheet is currently set to <em>Restricted</em>. To allow Control Room to pull your latest updates automatically:
              </p>
              <div className="sync-steps-box">
                <span>1. Open your <a href={GOOGLE_SHEET_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', color: 'var(--accent-primary)' }}>Plex Tracker Sheet ↗</a></span>
                <span>2. Click the blue <strong>Share</strong> button (top-right)</span>
                <span>3. Under <strong>General access</strong>, change <em>Restricted</em> to <strong>"Anyone with the link"</strong> (Viewer)</span>
              </div>
            </div>
          </div>
          <div className="sync-help-actions">
            <button 
              className="btn btn-primary alert-btn"
              onClick={() => handleSyncGoogleSheet(true)}
              disabled={isSyncing}
            >
              {isSyncing ? '⏳ Checking...' : '✓ Done, Pull Data Now!'}
            </button>
            <button 
              className="action-icon-btn" 
              onClick={() => setShowPermissionHelp(false)}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* OVERDUE PAYMENTS ALERT BANNER */}
      {overdueClients.length > 0 && (
        <div className="plex-alert-banner glass-panel overdue-glow animate-fade-in">
          <div className="alert-content">
            <div className="alert-icon-wrap">
              <span className="alert-icon-pulsing">⚠️</span>
            </div>
            <div className="alert-text-block">
              <div className="alert-heading">
                <strong>{overdueClients.length} Payment{overdueClients.length > 1 ? 's' : ''} Due Today</strong>
                <span className="badge badge-error" style={{ marginLeft: '8px' }}>Action Required</span>
              </div>
              <p className="alert-names-list">
                {overdueClients.map((c, i) => (
                  <span key={c.id || i} className="overdue-client-chip">
                    <strong>{c.name}</strong> (${Number(c.monthlyAmount || 10).toFixed(2)} due {formatDateDisplay(c.nextPaymentDue)})
                    {i < overdueClients.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
              {dueSoonClients.length > 0 && (
                <div style={{ marginTop: '6px', fontSize: '0.84rem', color: '#fbbf24' }}>
                  ⏳ Upcoming within 3 days: {dueSoonClients.map(c => `${c.name} (${formatDateDisplay(c.nextPaymentDue)})`).join(', ')}
                </div>
              )}
            </div>
          </div>
          <div className="alert-actions">
            <button 
              className="btn btn-secondary alert-btn"
              onClick={() => {
                if (overdueClients.length > 0) {
                  setReminderTarget(overdueClients[0]);
                  setShowReminderModal(true);
                }
              }}
            >
              🔔 Send Reminders
            </button>
          </div>
        </div>
      )}

      {/* FINANCIAL SUMMARY METRICS CARDS (Balanced 4-Column Row) */}
      <div className="plex-metrics-grid animate-fade-in">
        <div className="plex-metric-card glass-panel">
          <div className="stat-icon primary">💰</div>
          <div className="stat-info">
            <h3>Total Revenue (Income)</h3>
            <p className="stat-value">${metrics.totalIncome.toFixed(2)}</p>
            <span className="stat-subtext">Across active & past clients</span>
          </div>
        </div>

        <div className="plex-metric-card glass-panel">
          <div className="stat-icon warning">🖥️</div>
          <div className="stat-info">
            <h3>Server & Hardware Costs</h3>
            <p className="stat-value">${metrics.totalSpent.toFixed(2)}</p>
            <span className="stat-subtext">{expenses.length} recorded items</span>
          </div>
        </div>

        <div className={`plex-metric-card glass-panel ${metrics.netProfit < 0 ? 'profit-negative' : 'profit-positive'}`}>
          <div className="stat-icon" style={{ background: metrics.netProfit < 0 ? 'var(--status-error-bg)' : 'var(--status-success-bg)' }}>
            {metrics.netProfit < 0 ? '📉' : '📈'}
          </div>
          <div className="stat-info">
            <h3>Net Cash Balance</h3>
            <p className="stat-value" style={{ color: metrics.netProfit < 0 ? 'var(--status-error)' : 'var(--status-success)' }}>
              {metrics.netProfit < 0 ? `-$${Math.abs(metrics.netProfit).toFixed(2)}` : `+$${metrics.netProfit.toFixed(2)}`}
            </p>
            <span className="stat-subtext">{metrics.netProfit < 0 ? 'Hardware payback in progress' : 'Plex server is profitable!'}</span>
          </div>
        </div>

        <div className="plex-metric-card glass-panel">
          <div className="stat-icon info">🔄</div>
          <div className="stat-info">
            <h3>Monthly Run-Rate (MRR)</h3>
            <p className="stat-value">${metrics.mrr.toFixed(2)}<span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/mo</span></p>
            <span className="stat-subtext">{metrics.activeClientCount} active subscriptions</span>
          </div>
        </div>
      </div>

      {/* SUB-NAVIGATION TABS */}
      <div className="plex-subnav-row">
        <div className="plex-subnav-tabs">
          <button 
            className={`plex-tab-btn ${activeSubTab === 'clients' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('clients')}
          >
            <span>👥 Active Clients</span>
            <span className="tab-pill-count">{clients.length}</span>
            {overdueClients.length > 0 && (
              <span className="tab-pill-alert">{overdueClients.length}</span>
            )}
          </button>

          <button 
            className={`plex-tab-btn ${activeSubTab === 'expenses' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('expenses')}
          >
            <span>🛠️ Hardware Spent</span>
            <span className="tab-pill-count">{expenses.length}</span>
          </button>

          <button 
            className={`plex-tab-btn ${activeSubTab === 'past' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('past')}
          >
            <span>📦 Past Clients</span>
            <span className="tab-pill-count">{pastClients.length}</span>
          </button>
        </div>

        <div className="plex-subnav-right">
          {activeSubTab === 'expenses' && (
            <button 
              className="btn btn-secondary" 
              onClick={() => setShowExpenseModal(true)}
            >
              + Add Expense
            </button>
          )}
        </div>
      </div>

      {/* ========================================================
          1. ACTIVE CLIENTS TABLE VIEW
         ======================================================== */}
      {activeSubTab === 'clients' && (
        <div className="activity-section animate-fade-in" style={{ marginTop: '0.5rem' }}>
          <div className="glass-panel table-panel">
            <div className="table-responsive">
              <table className="plex-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '180px' }}>Person Name</th>
                    <th style={{ minWidth: '220px' }}>Email</th>
                    <th style={{ minWidth: '120px' }}>Start Date</th>
                    <th style={{ minWidth: '120px' }}>Last Payment</th>
                    <th style={{ minWidth: '140px' }}>Next Due</th>
                    <th style={{ minWidth: '120px' }}>Status</th>
                    <th style={{ minWidth: '100px' }}>Monthly</th>
                    <th style={{ minWidth: '110px' }}>Total Paid</th>
                    <th style={{ minWidth: '200px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '3rem' }}>
                        Loading client data...
                      </td>
                    </tr>
                  ) : clientStatusList.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '3rem' }}>
                        No clients found. Click "+ Add Client" or "Pull Sheet Data" to populate.
                      </td>
                    </tr>
                  ) : (
                    clientStatusList.map((client) => {
                      const isOverdue = client.calculatedStatus === 'overdue';
                      const isDueSoon = client.calculatedStatus === 'due_soon';

                      return (
                        <tr key={client.id} className={isOverdue ? 'row-overdue' : isDueSoon ? 'row-due-soon' : ''}>
                          <td>
                            <div className="client-name-cell">
                              <span className="client-name-text">{client.name}</span>
                            </div>
                          </td>
                          <td className="text-secondary text-mono">
                            {client.email || '—'}
                          </td>
                          <td className="text-secondary">
                            {formatDateDisplay(client.startDate)}
                          </td>
                          <td className="text-secondary">
                            {formatDateDisplay(client.lastPaymentDate)}
                          </td>
                          <td>
                            <div className="due-date-cell">
                              <span className={isOverdue ? 'due-text-overdue' : isDueSoon ? 'due-text-soon' : ''}>
                                {formatDateDisplay(client.nextPaymentDue)}
                              </span>
                              {isOverdue && (
                                <span className="days-label overdue">
                                  {client.daysDiff === 0 ? 'Due Today' : `${Math.abs(client.daysDiff)}d ago`}
                                </span>
                              )}
                              {isDueSoon && (
                                <span className="days-label soon">
                                  In {client.daysDiff}d
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            {isOverdue ? (
                              <span className="plex-status-pill overdue">
                                🔴 Due
                              </span>
                            ) : isDueSoon ? (
                              <span className="plex-status-pill due-soon">
                                🟡 Due Soon
                              </span>
                            ) : (
                              <span className="plex-status-pill paid">
                                🟢 Paid
                              </span>
                            )}
                          </td>
                          <td className="text-mono font-bold">
                            ${Number(client.monthlyAmount || 10).toFixed(2)}
                          </td>
                          <td className="text-mono font-bold" style={{ color: 'var(--accent-primary)' }}>
                            ${Number(client.totalPaid || 0).toFixed(2)}
                          </td>
                          <td>
                            <div className="plex-row-actions">
                              {/* Quick 1-Click Mark Paid */}
                              <button 
                                className="action-pill-btn paid-action-btn"
                                onClick={() => handleMarkPaid(client)}
                                title="Mark Paid: advances Next Due by 1 month and increments Total Paid"
                              >
                                ✓ Paid
                              </button>

                              {/* Remind Modal Trigger */}
                              <button 
                                className="action-pill-btn remind-action-btn"
                                onClick={() => {
                                  setReminderTarget(client);
                                  setShowReminderModal(true);
                                }}
                                title="Send or Copy Payment Reminder"
                              >
                                🔔 Remind
                              </button>

                              {/* Edit Modal */}
                              <button 
                                className="action-icon-btn"
                                onClick={() => {
                                  setEditingClient(client);
                                  setClientModalMode('edit');
                                  setShowClientModal(true);
                                }}
                                title="Edit Client"
                              >
                                ✏️
                              </button>

                              {/* Archive to Past Clients */}
                              <button 
                                className="action-icon-btn"
                                onClick={() => handleArchiveClient(client)}
                                title="Move to Past Clients"
                              >
                                📦
                              </button>

                              {/* Delete */}
                              <button 
                                className="action-icon-btn danger"
                                onClick={() => handleDeleteClient(client)}
                                title="Delete Client"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          2. HARDWARE & SERVER SPENT VIEW
         ======================================================== */}
      {activeSubTab === 'expenses' && (
        <div className="activity-section animate-fade-in" style={{ marginTop: '0.5rem' }}>
          <div className="glass-panel table-panel">
            <div className="table-responsive">
              <table className="plex-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '220px' }}>Item / Hardware Description</th>
                    <th style={{ minWidth: '140px' }}>Cost</th>
                    <th style={{ minWidth: '160px' }}>Purchase Date</th>
                    <th style={{ minWidth: '100px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: '3rem' }}>
                        No hardware expenses logged yet.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((exp) => (
                      <tr key={exp.id}>
                        <td>
                          <div className="client-name-cell">
                            <span className="client-avatar">🖥️</span>
                            <span className="client-name-text">{exp.itemName}</span>
                          </div>
                        </td>
                        <td className="text-mono font-bold" style={{ color: 'var(--status-warning)' }}>
                          ${Number(exp.cost || 0).toFixed(2)}
                        </td>
                        <td className="text-secondary">
                          {formatDateDisplay(exp.purchaseDate)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            className="action-icon-btn danger"
                            onClick={() => handleDeleteExpense(exp)}
                            title="Delete Expense"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 'bold' }}>
                    <td>Total Hardware & Licensing Invested</td>
                    <td className="text-mono font-bold" style={{ color: 'var(--status-warning)', fontSize: '1.05rem' }}>
                      ${metrics.totalSpent.toFixed(2)}
                    </td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          3. PAST CLIENTS VIEW
         ======================================================== */}
      {activeSubTab === 'past' && (
        <div className="activity-section animate-fade-in" style={{ marginTop: '0.5rem' }}>
          <div className="glass-panel table-panel">
            <div className="table-responsive">
              <table className="plex-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '180px' }}>Client Name</th>
                    <th style={{ minWidth: '220px' }}>Email</th>
                    <th style={{ minWidth: '140px' }}>Total Received</th>
                    <th style={{ minWidth: '160px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pastClients.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: '3rem' }}>
                        No past clients recorded.
                      </td>
                    </tr>
                  ) : (
                    pastClients.map((past) => (
                      <tr key={past.id}>
                        <td>
                          <div className="client-name-cell">
                            <span className="client-avatar past">👤</span>
                            <span className="client-name-text">{past.name}</span>
                          </div>
                        </td>
                        <td className="text-secondary text-mono">
                          {past.email || '—'}
                        </td>
                        <td className="text-mono font-bold" style={{ color: 'var(--accent-primary)' }}>
                          ${Number(past.totalRecv || 0).toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            className="action-pill-btn"
                            onClick={() => handleRestorePastClient(past)}
                            title="Restore back to Active Clients"
                            style={{ marginRight: '8px' }}
                          >
                            🔄 Reactivate
                          </button>
                          <button 
                            className="action-icon-btn danger"
                            onClick={async () => {
                              if (!window.confirm(`Delete past record for ${past.name}?`)) return;
                              if (past.id && !past.id.startsWith('local-')) {
                                await deleteDoc(doc(db, 'plex_tracker_past_clients', past.id));
                              } else {
                                setPastClients(prev => prev.filter(p => p.id !== past.id));
                              }
                              showToast(`Deleted ${past.name}`);
                            }}
                            title="Delete Past Record"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: ADD / EDIT CLIENT
         ======================================================== */}
      {showClientModal && (
        <div className="modal-overlay" onClick={() => setShowClientModal(false)}>
          <div className="modal-content glass-panel plex-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>{clientModalMode === 'edit' ? '✏️' : '👤'}</span>
                <h2>{clientModalMode === 'edit' ? `Edit Client: ${editingClient?.name}` : 'Add New Client'}</h2>
              </div>
              <button className="close-btn" onClick={() => setShowClientModal(false)}>✕</button>
            </div>

            <form onSubmit={handleSaveClient} className="plex-form">
              <div className="form-group">
                <label>Person / Client Name *</label>
                <input 
                  type="text" 
                  name="name" 
                  defaultValue={editingClient?.name || ''} 
                  required 
                  placeholder="e.g. James Roy" 
                  className="form-input" 
                />
              </div>

              <div className="form-group">
                <label>Email Address</label>
                <input 
                  type="email" 
                  name="email" 
                  defaultValue={editingClient?.email || ''} 
                  placeholder="e.g. james.stephen@live.com" 
                  className="form-input" 
                />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Monthly Amount ($) *</label>
                  <input 
                    type="number" 
                    step="0.5" 
                    name="monthlyAmount" 
                    defaultValue={editingClient?.monthlyAmount ?? 10.00} 
                    required 
                    className="form-input" 
                  />
                </div>

                <div className="form-group">
                  <label>Total Paid to Date ($)</label>
                  <input 
                    type="number" 
                    step="1" 
                    name="totalPaid" 
                    defaultValue={editingClient?.totalPaid ?? 0.00} 
                    className="form-input" 
                  />
                </div>
              </div>

              <div className="form-row-3">
                <div className="form-group">
                  <label>Start Date</label>
                  <input 
                    type="date" 
                    name="startDate" 
                    defaultValue={formatIsoDate(editingClient?.startDate) || formatIsoDate(new Date())} 
                    className="form-input" 
                  />
                </div>

                <div className="form-group">
                  <label>Last Payment Date</label>
                  <input 
                    type="date" 
                    name="lastPaymentDate" 
                    defaultValue={formatIsoDate(editingClient?.lastPaymentDate) || formatIsoDate(new Date())} 
                    className="form-input" 
                  />
                </div>

                <div className="form-group">
                  <label>Next Payment Due *</label>
                  <input 
                    type="date" 
                    name="nextPaymentDue" 
                    defaultValue={formatIsoDate(editingClient?.nextPaymentDue) || addOneMonth(new Date())} 
                    required 
                    className="form-input" 
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes (Optional)</label>
                <input 
                  type="text" 
                  name="notes" 
                  defaultValue={editingClient?.notes || ''} 
                  placeholder="e.g. Pays via PayID on the 11th" 
                  className="form-input" 
                />
              </div>

              <div className="modal-footer" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowClientModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {clientModalMode === 'edit' ? 'Save Changes' : 'Add Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: ADD EXPENSE
         ======================================================== */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="modal-content glass-panel plex-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>🛠️</span>
                <h2>Add Server / Hardware Cost</h2>
              </div>
              <button className="close-btn" onClick={() => setShowExpenseModal(false)}>✕</button>
            </div>

            <form onSubmit={handleSaveExpense} className="plex-form">
              <div className="form-group">
                <label>Item Description *</label>
                <input 
                  type="text" 
                  name="itemName" 
                  required 
                  placeholder="e.g. 16TB IronWolf Pro HDD or Server RAM Upgrade" 
                  className="form-input" 
                />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Cost ($) *</label>
                  <input 
                    type="number" 
                    step="0.5" 
                    name="cost" 
                    required 
                    placeholder="360.00" 
                    className="form-input" 
                  />
                </div>

                <div className="form-group">
                  <label>Purchase Date *</label>
                  <input 
                    type="date" 
                    name="purchaseDate" 
                    defaultValue={formatIsoDate(new Date())} 
                    required 
                    className="form-input" 
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowExpenseModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL: REMIND CLIENT OPTIONS
         ======================================================== */}
      {showReminderModal && reminderTarget && (
        <div className="modal-overlay" onClick={() => setShowReminderModal(false)}>
          <div className="modal-content glass-panel plex-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>🔔</span>
                <h2>Payment Reminder: {reminderTarget.name}</h2>
              </div>
              <button className="close-btn" onClick={() => setShowReminderModal(false)}>✕</button>
            </div>

            <div className="reminder-modal-content">
              <div className="reminder-preview-card glass-panel">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Preview Message
                </label>
                <p className="reminder-text-body">
                  "{getReminderText(reminderTarget)}"
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Target: {reminderTarget.email || 'No email provided'}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 'bold' }}>
                    ${Number(reminderTarget.monthlyAmount || 10).toFixed(2)} Due {formatDateDisplay(reminderTarget.nextPaymentDue)}
                  </span>
                </div>
              </div>

              <div className="reminder-action-list">
                <button 
                  className="btn btn-primary reminder-btn"
                  onClick={() => {
                    handleCopyReminder(reminderTarget);
                    setShowReminderModal(false);
                  }}
                >
                  <span>📋 Copy Reminder Text</span>
                  <small>Copy message to clipboard to paste in WhatsApp, SMS, or Discord</small>
                </button>

                {reminderTarget.email && (
                  <button 
                    className="btn btn-secondary reminder-btn"
                    onClick={() => {
                      handleEmailReminder(reminderTarget);
                      setShowReminderModal(false);
                    }}
                  >
                    <span>📧 Send Pre-filled Email</span>
                    <small>Opens default mail app to {reminderTarget.email}</small>
                  </button>
                )}

                <button 
                  className="btn btn-secondary reminder-btn"
                  onClick={() => {
                    handleDispatchInApp(reminderTarget);
                    setShowReminderModal(false);
                  }}
                >
                  <span>⚡ Dispatch to PlexMePlease</span>
                  <small>Pre-fills Control Room Dispatcher with in-app notice</small>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
