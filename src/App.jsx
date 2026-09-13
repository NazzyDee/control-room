import { useState, useMemo, useEffect, useRef } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import PlexTracker from './components/PlexTracker';
import { INITIAL_CLIENTS, parseDateStringToMidnight, formatDateDisplay, formatIsoDate, addOneMonth } from './utils/dateUtils';
import { syncPlexSheetWithFirestore } from './services/plexSheetSync';

const APPS = [
  '⚡ Action Center', 
  '📢 Dispatch Center',
  'Plex Tracker',
  '📦 All Messages',
  'PlexMePlease', 
  'Your Journey Your Tools', 
  'Your Journey Your Tools (Website)', 
  'Check It', 
  'Pred: Know Your Stats', 
  'EpisodeFeed'
];

const TARGET_APPS_LIST = [
  'All Apps',
  'PlexMePlease',
  'Your Journey Your Tools',
  'Your Journey Your Tools (Website)',
  'Check It',
  'Pred: Know Your Stats',
  'EpisodeFeed'
];

const QUICK_TEMPLATES = [
  "🛠️ A fix has been deployed in the latest update. Thanks for reporting!",
  "🔍 We are actively investigating this issue right now.",
  "✨ Great idea! We've added this feature to our development roadmap.",
  "📋 Could you please provide a few more details or steps to reproduce?",
  "✅ This issue has been verified and resolved. Please test on your end."
];

function playNotificationChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.warn('Audio chime error:', e);
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('⚡ Action Center');
  const [activeFilter, setActiveFilter] = useState('all'); // all, unresolved, in_progress, resolved, unresolved_bugs, new_today
  const [selectedItem, setSelectedItem] = useState(null);
  const [feedbackData, setFeedbackData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [plexOverdueCount, setPlexOverdueCount] = useState(0);

  // Action Center specific states
  const [clients, setClients] = useState([]);
  const [actionCategoryFilter, setActionCategoryFilter] = useState('all'); // all, bugs, payments, inquiries, in_progress, polls
  const [actionToast, setActionToast] = useState('');
  const [isSyncingFeeds, setIsSyncingFeeds] = useState(false);

  // Audio Alerts
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('control_room_sound') !== 'false');
  const initialFeedbackLoadRef = useRef(true);
  const previousFeedbackCountRef = useRef(0);

  // Admin Entrance state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => localStorage.getItem('control_room_admin_auth') === 'true');
  const [adminActionStatus, setAdminActionStatus] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date().toLocaleTimeString());

  // Analytics state
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // Universal Dispatch State
  const [dispatchApp, setDispatchApp] = useState('All Apps');
  const [dispatchCategory, setDispatchCategory] = useState('broadcast'); // broadcast, alert, update, info
  const [dispatchPriority, setDispatchPriority] = useState('normal'); // normal, high, urgent
  const [dispatchTitle, setDispatchTitle] = useState('');
  const [dispatchBody, setDispatchBody] = useState('');
  const [dispatchActionUrl, setDispatchActionUrl] = useState('');
  const [dispatchExpiryPreset, setDispatchExpiryPreset] = useState('24h'); // 1h, 24h, 3d, 7d, perm, custom
  const [dispatchCustomExpiry, setDispatchCustomExpiry] = useState('');
  const [dispatchSendPush, setDispatchSendPush] = useState(true);
  const [dispatchStatus, setDispatchStatus] = useState('idle'); // idle, sending, success, error
  const [dispatchStatusMsg, setDispatchStatusMsg] = useState('');
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchPollOptions, setDispatchPollOptions] = useState(['', '']);
  const [broadcastFilterApp, setBroadcastFilterApp] = useState('all');
  const [broadcasts, setBroadcasts] = useState([]);

  // EpisodeFeed State
  const [episodeFeedUrl, setEpisodeFeedUrl] = useState(() => localStorage.getItem('episodeFeedUrl') || 'https://episodefeed.com/rss/2914/83aa73f4c985cb7bc96bc5d122bf4e494bbc671d');
  const [episodeFeedData, setEpisodeFeedData] = useState(null);
  const [episodeFeedLoading, setEpisodeFeedLoading] = useState(false);
  const [episodeFeedError, setEpisodeFeedError] = useState(null);

  // Detail Modal 2-Way Reply State
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [ticketActionStatus, setTicketActionStatus] = useState('');

  // Toggle Sound Alerts
  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('control_room_sound', String(next));
    if (next) playNotificationChime();
  };

  // Fetch Firestore Feedback
  useEffect(() => {
    const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = [];
      querySnapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Check for newly arrived feedback to play alert chime
      if (!initialFeedbackLoadRef.current && data.length > previousFeedbackCountRef.current) {
        if (soundEnabled) {
          playNotificationChime();
        }
      }

      initialFeedbackLoadRef.current = false;
      previousFeedbackCountRef.current = data.length;

      setFeedbackData(data);
      setLoading(false);
      setLastRefreshed(new Date().toLocaleTimeString());
    }, (err) => {
      console.error("Firestore feedback error: ", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [soundEnabled]);

  // Fetch Firestore Broadcasts
  useEffect(() => {
    const q = query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = [];
      querySnapshot.forEach((document) => {
        const b = document.data();
        if (b.expiresAt) {
          const expiresAt = b.expiresAt?.toDate ? b.expiresAt.toDate().getTime() : b.expiresAt;
          if (Date.now() > expiresAt) {
            // Expired! Delete it automatically from DB.
            deleteDoc(doc(db, 'broadcasts', document.id)).catch(console.error);
            return;
          }
        }
        data.push({ id: document.id, ...b });
      });
      setBroadcasts(data);
    }, (err) => {
      console.error("Firestore broadcasts error: ", err);
    });
    return () => unsubscribe();
  }, []);

  // Fetch GA4 Analytics when the YJYT tab is selected
  useEffect(() => {
    if (activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') {
      setAnalyticsLoading(true);
      fetch('/.netlify/functions/getAnalytics')
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch analytics');
          return res.json();
        })
        .then(data => {
          setAnalyticsData(data);
          setAnalyticsError(null);
        })
        .catch(err => {
          console.error(err);
          setAnalyticsError(err.message);
        })
        .finally(() => {
          setAnalyticsLoading(false);
        });
    } else {
      setAnalyticsData(null);
    }
  }, [activeTab]);

  // Fetch EpisodeFeed Data
  useEffect(() => {
    if (activeTab === 'EpisodeFeed' && episodeFeedUrl) {
      setEpisodeFeedLoading(true);
      fetch('/.netlify/functions/fetchRss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: episodeFeedUrl })
      })
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch RSS feed');
          return res.json();
        })
        .then(data => {
          setEpisodeFeedData(data);
          setEpisodeFeedError(null);
        })
        .catch(err => {
          console.error(err);
          setEpisodeFeedError(err.message);
        })
        .finally(() => {
          setEpisodeFeedLoading(false);
        });
    }
  }, [activeTab, episodeFeedUrl]);

  // Fetch Firestore Plex Clients (for Action Center & Overdue tracking)
  useEffect(() => {
    const clientsRef = collection(db, 'plex_tracker_clients');
    const unsubscribe = onSnapshot(clientsRef, (snap) => {
      if (snap.empty) {
        setClients(INITIAL_CLIENTS.map(c => ({ id: `client_${c.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}`, ...c })));
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
    }, (err) => {
      console.warn('Firestore plex clients subscription error:', err);
      setClients(INITIAL_CLIENTS.map((c, i) => ({ id: `local-${i}`, ...c })));
    });
    return () => unsubscribe();
  }, []);

  // Automatically synchronize with live Google Sheet on app startup in background
  useEffect(() => {
    syncPlexSheetWithFirestore(db)
      .then(res => {
        console.log('Control Room: Google Sheet synced on boot:', res.clientsCount, 'clients');
      })
      .catch(err => {
        console.debug('Control Room: Background sheet sync on boot:', err.message);
      });
  }, []);

  // Today reference at midnight
  const todayMidnight = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // Compute payment status for each client
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

  const overdueClients = useMemo(() => {
    return clientStatusList.filter(c => c.calculatedStatus === 'overdue');
  }, [clientStatusList]);

  const dueSoonClients = useMemo(() => {
    return clientStatusList.filter(c => c.calculatedStatus === 'due_soon');
  }, [clientStatusList]);

  // Keep plexOverdueCount in sync for sidebar badges
  useEffect(() => {
    setPlexOverdueCount(overdueClients.length);
  }, [overdueClients.length]);

  // Action Center Toast Notification
  const showActionToast = (msg) => {
    setActionToast(msg);
    setTimeout(() => setActionToast(''), 3500);
  };

  // 1-Click Action: Mark Plex Subscriber Paid directly from Action Center
  const handleMarkClientPaidFromHome = async (client) => {
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
      showActionToast(`✓ Marked ${client.name} as paid ($${Number(client.monthlyAmount || 10).toFixed(2)})! Next due: ${formatDateDisplay(nextDue)}`);
      if (soundEnabled) playNotificationChime();
    } catch (err) {
      console.error('Error recording payment from Action Center:', err);
      showActionToast('✕ Error recording payment in database.');
    }
  };

  // 1-Click Action: Mark Support Ticket Resolved directly from Action Center
  const handleQuickResolveTicket = async (ticket, e) => {
    if (e) e.stopPropagation();
    try {
      await updateDoc(doc(db, 'feedback', ticket.id), {
        status: 'resolved',
        resolvedAt: serverTimestamp()
      });
      showActionToast(`✓ Resolved ticket from ${ticket.user || ticket.sender || ticket.app || 'User'}!`);
      if (soundEnabled) playNotificationChime();
    } catch (err) {
      console.error('Error resolving ticket:', err);
      showActionToast('✕ Failed to mark ticket as resolved.');
    }
  };

  // 1-Click Action: Toggle In-Progress status for a Ticket
  const handleToggleTicketInProgress = async (ticket, e) => {
    if (e) e.stopPropagation();
    const nextStatus = ticket.status === 'in_progress' ? 'unresolved' : 'in_progress';
    try {
      await updateDoc(doc(db, 'feedback', ticket.id), {
        status: nextStatus,
        updatedAt: serverTimestamp()
      });
      showActionToast(`✓ Ticket marked as ${nextStatus.replace('_', ' ')}.`);
    } catch (err) {
      console.error('Error updating status:', err);
      showActionToast('✕ Failed to update ticket status.');
    }
  };

  // Action Center: All Unresolved & In-Progress Tickets across apps
  const actionableTickets = useMemo(() => {
    return feedbackData.filter(item => {
      const status = item.status || 'unresolved';
      return status !== 'resolved';
    });
  }, [feedbackData]);

  // Combined Master Action Queue (The Open Page Feed)
  const allActionItems = useMemo(() => {
    const items = [];

    // 1. Overdue Plex Subscriptions (Highest urgency)
    overdueClients.forEach(c => {
      items.push({
        actionType: 'plex_overdue',
        urgency: 'high',
        urgencyRank: 1,
        date: parseDateStringToMidnight(c.nextPaymentDue),
        id: `plex-overdue-${c.id}`,
        client: c,
        title: `Overdue Payment: ${c.name}`,
        subtitle: `$${Number(c.monthlyAmount || 10).toFixed(2)} due on ${formatDateDisplay(c.nextPaymentDue)} (${Math.abs(c.daysDiff)} ${Math.abs(c.daysDiff) === 1 ? 'day' : 'days'} overdue)`,
        app: 'Plex Tracker'
      });
    });

    // 2. Urgent Bug Reports & High Priority Inquiries
    actionableTickets.forEach(t => {
      const isBug = t.type === 'bug';
      const isUrgent = t.priority === 'urgent' || t.priority === 'high';
      const isInProgress = t.status === 'in_progress';
      const rank = isUrgent || isBug ? 2 : (isInProgress ? 5 : 4);

      items.push({
        actionType: 'ticket',
        urgency: isUrgent || isBug ? 'high' : 'normal',
        urgencyRank: rank,
        date: t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || Date.now()),
        id: `ticket-${t.id}`,
        ticket: t,
        title: t.app || 'In-App Inquiry',
        subtitle: t.message,
        app: t.app
      });
    });

    // 3. Due Soon Plex Subscriptions (Due within 3 days)
    dueSoonClients.forEach(c => {
      items.push({
        actionType: 'plex_due_soon',
        urgency: 'medium',
        urgencyRank: 3,
        date: parseDateStringToMidnight(c.nextPaymentDue),
        id: `plex-due-${c.id}`,
        client: c,
        title: `Payment Due Soon: ${c.name}`,
        subtitle: `$${Number(c.monthlyAmount || 10).toFixed(2)} due on ${formatDateDisplay(c.nextPaymentDue)} (in ${c.daysDiff} ${c.daysDiff === 1 ? 'day' : 'days'})`,
        app: 'Plex Tracker'
      });
    });

    // 4. Active Polls requiring review
    broadcasts.filter(b => b.category === 'poll').forEach(p => {
      const pollVotes = feedbackData.filter(item => item.type === 'poll_vote' && (item.pollId === p.id || (item.pollTitle && item.pollTitle === p.title)));
      items.push({
        actionType: 'active_poll',
        urgency: 'medium',
        urgencyRank: 4,
        date: p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt || Date.now()),
        id: `poll-${p.id}`,
        poll: p,
        voteCount: pollVotes.length,
        votes: pollVotes,
        title: `Active Poll: ${p.title}`,
        subtitle: `${pollVotes.length} ${pollVotes.length === 1 ? 'response' : 'responses'} received`,
        app: p.app || 'All Apps'
      });
    });

    // Sort items by priority rank ascending, then by date descending
    items.sort((a, b) => {
      if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
      const da = a.date ? a.date.getTime() : 0;
      const db = b.date ? b.date.getTime() : 0;
      return db - da;
    });

    return items;
  }, [actionableTickets, overdueClients, dueSoonClients, broadcasts, feedbackData]);

  // Filtered Action Items based on triage category & search query
  const filteredActionItems = useMemo(() => {
    let list = allActionItems;

    if (actionCategoryFilter === 'bugs') {
      list = list.filter(item => item.actionType === 'ticket' && (item.ticket.type === 'bug' || item.ticket.priority === 'urgent' || item.ticket.priority === 'high'));
    } else if (actionCategoryFilter === 'payments') {
      list = list.filter(item => item.actionType === 'plex_overdue' || item.actionType === 'plex_due_soon');
    } else if (actionCategoryFilter === 'inquiries') {
      list = list.filter(item => item.actionType === 'ticket' && item.ticket.type !== 'bug' && item.ticket.status !== 'in_progress');
    } else if (actionCategoryFilter === 'in_progress') {
      list = list.filter(item => item.actionType === 'ticket' && item.ticket.status === 'in_progress');
    } else if (actionCategoryFilter === 'polls') {
      list = list.filter(item => item.actionType === 'active_poll');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(item => {
        if (item.actionType === 'plex_overdue' || item.actionType === 'plex_due_soon') {
          return item.client.name.toLowerCase().includes(q) || (item.client.email && item.client.email.toLowerCase().includes(q));
        }
        if (item.actionType === 'active_poll') {
          return item.poll.title.toLowerCase().includes(q) || (item.poll.body && item.poll.body.toLowerCase().includes(q));
        }
        if (item.actionType === 'ticket') {
          return (item.ticket.app && item.ticket.app.toLowerCase().includes(q)) ||
                 (item.ticket.message && item.ticket.message.toLowerCase().includes(q)) ||
                 (item.ticket.user && item.ticket.user.toLowerCase().includes(q)) ||
                 (item.ticket.type && item.ticket.type.toLowerCase().includes(q));
        }
        return false;
      });
    }

    return list;
  }, [allActionItems, actionCategoryFilter, searchQuery]);

  // Action Center Summary Metrics for Executive Dials
  const actionCounts = useMemo(() => {
    const bugsCount = actionableTickets.filter(t => t.type === 'bug' || t.priority === 'urgent' || t.priority === 'high').length;
    const inquiriesCount = actionableTickets.filter(t => t.type !== 'bug' && t.status !== 'in_progress').length;
    const inProgressCount = actionableTickets.filter(t => t.status === 'in_progress').length;
    const paymentsCount = overdueClients.length + dueSoonClients.length;
    const overdueCashAmount = overdueClients.reduce((acc, c) => acc + (Number(c.monthlyAmount) || 10), 0);
    const activePollsCount = broadcasts.filter(b => b.category === 'poll').length;

    return {
      total: allActionItems.length,
      bugsCount,
      inquiriesCount,
      inProgressCount,
      paymentsCount,
      overdueCount: overdueClients.length,
      dueSoonCount: dueSoonClients.length,
      overdueCashAmount,
      activePollsCount
    };
  }, [actionableTickets, overdueClients, dueSoonClients, broadcasts, allActionItems.length]);

  // Counts of unread / unresolved items per app for sidebar badges
  const unresolvedCountsByApp = useMemo(() => {
    const counts = {};
    APPS.forEach(app => { counts[app] = 0; });
    feedbackData.forEach(item => {
      const isUnresolved = (item.status || 'unresolved').toLowerCase() !== 'resolved';
      if (isUnresolved) {
        if (item.app && counts[item.app] !== undefined) {
          counts[item.app]++;
        }
        counts['📦 All Messages'] = (counts['📦 All Messages'] || 0) + 1;
        counts['All Apps'] = (counts['All Apps'] || 0) + 1;
      }
    });
    return counts;
  }, [feedbackData]);

  // Filtered Feedback Feed
  const filteredData = useMemo(() => {
    let data = feedbackData;
    
    // 1. Filter by App Tab
    if (activeTab !== '📦 All Messages' && activeTab !== 'All Apps' && activeTab !== '📢 Dispatch Center' && activeTab !== 'EpisodeFeed' && activeTab !== 'Plex Tracker' && activeTab !== '⚡ Action Center') {
      data = data.filter(item => item.app === activeTab);
    }
 
    // 2. Filter by Status
    if (activeFilter !== 'all') {
      if (activeFilter === 'unresolved_bugs') {
        data = data.filter(item => item.type === 'bug' && item.status !== 'resolved');
      } else if (activeFilter === 'new_today') {
        data = data.filter(i => {
          if (!i.createdAt) return false;
          const date = i.createdAt?.toDate ? i.createdAt.toDate() : new Date(i.createdAt);
          const today = new Date();
          return date.getDate() === today.getDate() && 
                 date.getMonth() === today.getMonth() && 
                 date.getFullYear() === today.getFullYear();
        });
      } else {
        data = data.filter(item => (item.status || 'unresolved') === activeFilter);
      }
    }

    // 3. Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      data = data.filter(item => 
        (item.app && item.app.toLowerCase().includes(q)) ||
        (item.message && item.message.toLowerCase().includes(q)) ||
        (item.user && item.user.toLowerCase().includes(q)) ||
        (item.type && item.type.toLowerCase().includes(q)) ||
        (item.status && item.status.toLowerCase().includes(q)) ||
        (item.priority && item.priority.toLowerCase().includes(q))
      );
    }
    
    return data;
  }, [activeFilter, activeTab, feedbackData, searchQuery]);

  // Stats derived from live data
  const stats = useMemo(() => {
    const dataForStats = (activeTab === '📦 All Messages' || activeTab === 'All Apps' || activeTab === '📢 Dispatch Center' || activeTab === 'Plex Tracker' || activeTab === '⚡ Action Center')
      ? feedbackData 
      : feedbackData.filter(i => i.app === activeTab);

    const totalIssues = dataForStats.length;
    const unresolved = dataForStats.filter(i => (i.status || 'unresolved') !== 'resolved').length;
    const inProgress = dataForStats.filter(i => i.status === 'in_progress').length;
    const unresolvedBugs = dataForStats.filter(i => i.type === 'bug' && i.status !== 'resolved').length;
    const newToday = dataForStats.filter(i => {
      if (!i.createdAt) return false;
      const date = i.createdAt?.toDate ? i.createdAt.toDate() : new Date(i.createdAt);
      const today = new Date();
      return date.getDate() === today.getDate() && 
             date.getMonth() === today.getMonth() && 
             date.getFullYear() === today.getFullYear();
    }).length;

    const broadcastsCount = (activeTab === '📦 All Messages' || activeTab === 'All Apps' || activeTab === '📢 Dispatch Center' || activeTab === '⚡ Action Center')
      ? broadcasts.length
      : broadcasts.filter(b => b.app === activeTab || b.app === 'All Apps').length;

    return {
      totalIssues,
      unresolved,
      inProgress,
      unresolvedBugs,
      newFeedbackToday: newToday,
      broadcastsCount
    };
  }, [feedbackData, broadcasts, activeTab]);

  // Filtered Broadcasts Log
  const filteredBroadcasts = useMemo(() => {
    if (broadcastFilterApp === 'all') return broadcasts;
    return broadcasts.filter(b => b.app === broadcastFilterApp);
  }, [broadcasts, broadcastFilterApp]);

  // Poll Options Helpers
  const handleAddPollOption = () => {
    if (dispatchPollOptions.length < 8) {
      setDispatchPollOptions([...dispatchPollOptions, '']);
    }
  };

  const handleRemovePollOption = (index) => {
    if (dispatchPollOptions.length > 2) {
      setDispatchPollOptions(dispatchPollOptions.filter((_, i) => i !== index));
    }
  };

  const handlePollOptionChange = (index, value) => {
    const next = [...dispatchPollOptions];
    next[index] = value;
    setDispatchPollOptions(next);
  };

  // Dispatch / Send Broadcast Function
  const handleSendDispatch = async (e) => {
    if (e) e.preventDefault();
    if (!dispatchTitle.trim()) return;

    // Validate poll options if category is poll
    let sanitizedPollOptions = [];
    let effectiveBody = dispatchBody.trim();
    if (dispatchCategory === 'poll') {
      sanitizedPollOptions = dispatchPollOptions
        .map(opt => (typeof opt === 'string' ? opt.trim() : ''))
        .filter(opt => opt.length > 0);
      if (sanitizedPollOptions.length < 2) {
        setDispatchStatus('error');
        setDispatchStatusMsg('✕ Please provide at least 2 poll options.');
        setTimeout(() => setDispatchStatus('idle'), 4000);
        return;
      }
      if (!effectiveBody) {
        effectiveBody = 'Please cast your vote on the options below.';
      }
    } else {
      if (!effectiveBody) return;
    }

    let expiresAt = null;
    const now = Date.now();
    if (dispatchExpiryPreset === '1h') expiresAt = now + 60 * 60 * 1000;
    else if (dispatchExpiryPreset === '24h') expiresAt = now + 24 * 60 * 60 * 1000;
    else if (dispatchExpiryPreset === '3d') expiresAt = now + 3 * 24 * 60 * 60 * 1000;
    else if (dispatchExpiryPreset === '7d') expiresAt = now + 7 * 24 * 60 * 60 * 1000;
    else if (dispatchExpiryPreset === 'custom' && dispatchCustomExpiry) {
      expiresAt = new Date(`${dispatchCustomExpiry}:00+08:00`).getTime();
    }

    setDispatchStatus('sending');
    try {
      const res = await fetch('/.netlify/functions/sendNotification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: dispatchTitle.trim(),
          body: effectiveBody,
          app: dispatchApp,
          category: dispatchCategory,
          priority: dispatchPriority,
          click_action: dispatchActionUrl.trim() || undefined,
          expiresAt: expiresAt,
          sendPush: dispatchSendPush,
          pollOptions: dispatchCategory === 'poll' ? sanitizedPollOptions : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch');

      setDispatchStatus('success');
      let successMsg = dispatchCategory === 'poll' ? '✓ Interactive Poll successfully dispatched!' : '✓ Broadcast successfully dispatched!';
      if (data.pushResult?.sent > 0) {
        successMsg += ` (${data.pushResult.sent} push notifications delivered)`;
      }
      setDispatchStatusMsg(successMsg);
      setDispatchTitle('');
      setDispatchBody('');
      setDispatchActionUrl('');
      setDispatchPollOptions(['', '']);
      setTimeout(() => {
        setDispatchStatus('idle');
        setDispatchStatusMsg('');
        setShowDispatchModal(false);
      }, 2500);
    } catch (err) {
      console.error('Dispatch error:', err);
      setDispatchStatus('error');
      setDispatchStatusMsg(`✕ Error: ${err.message}`);
      setTimeout(() => {
        setDispatchStatus('idle');
      }, 4000);
    }
  };

  const handleCloneBroadcast = (b) => {
    setDispatchApp(b.app || 'All Apps');
    setDispatchTitle(b.title || '');
    setDispatchBody(b.body || '');
    setDispatchCategory(b.category || 'broadcast');
    setDispatchPriority(b.priority || 'normal');
    setDispatchActionUrl(b.actionUrl || '');
    if (b.category === 'poll' && Array.isArray(b.pollOptions)) {
      setDispatchPollOptions(b.pollOptions.length >= 2 ? b.pollOptions : ['', '']);
    } else {
      setDispatchPollOptions(['', '']);
    }
    setShowDispatchModal(true);
  };

  const handleDeleteBroadcast = async (id) => {
    if (!window.confirm("Are you sure you want to delete this broadcast? It will be removed from all user inboxes.")) return;
    try {
      await deleteDoc(doc(db, 'broadcasts', id));
    } catch (err) {
      console.error("Error deleting broadcast:", err);
      alert("Failed to delete broadcast.");
    }
  };

  // 2-Way Reply to User Message
  const handleSendReply = async (item, replyContent, newStatus) => {
    if (!replyContent || !replyContent.trim()) return;
    setReplySending(true);
    try {
      const itemRef = doc(db, 'feedback', item.id);
      const replyEntry = {
        author: 'Control Room Admin',
        content: replyContent.trim(),
        timestamp: new Date().toISOString()
      };
      const currentThread = Array.isArray(item.thread) ? item.thread : [];
      const updatedThread = [...currentThread, replyEntry];
      
      const updatePayload = {
        thread: updatedThread,
        updatedAt: new Date()
      };
      if (newStatus) {
        updatePayload.status = newStatus;
      } else if (item.status === 'unresolved' || !item.status) {
        updatePayload.status = 'in_progress';
      }
      
      await updateDoc(itemRef, updatePayload);
      
      const updatedItem = {
        ...item,
        ...updatePayload
      };
      setSelectedItem(updatedItem);
      setReplyText('');
      setTicketActionStatus('Reply dispatched & ticket updated! ✨');
      setTimeout(() => setTicketActionStatus(''), 3000);
    } catch (err) {
      console.error('Error sending reply:', err);
      setTicketActionStatus('Failed to send reply');
      setTimeout(() => setTicketActionStatus(''), 3000);
    } finally {
      setReplySending(false);
    }
  };

  // Status & Priority Mutations
  const handleUpdateStatus = async (item, newStatus) => {
    try {
      const itemRef = doc(db, 'feedback', item.id);
      const payload = {
        status: newStatus,
        updatedAt: new Date()
      };
      if (newStatus === 'resolved') {
        payload.resolvedAt = new Date();
      }
      await updateDoc(itemRef, payload);
      setSelectedItem({ ...item, ...payload });
      setTicketActionStatus(`Status updated to ${newStatus.replace('_', ' ')}`);
      setTimeout(() => setTicketActionStatus(''), 2500);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleUpdatePriority = async (item, newPriority) => {
    try {
      const itemRef = doc(db, 'feedback', item.id);
      await updateDoc(itemRef, { priority: newPriority, updatedAt: new Date() });
      setSelectedItem({ ...item, priority: newPriority });
      setTicketActionStatus(`Priority updated to ${newPriority}`);
      setTimeout(() => setTicketActionStatus(''), 2500);
    } catch (err) {
      console.error('Error updating priority:', err);
    }
  };

  const handleDeleteTicket = async (id) => {
    if (!window.confirm("Are you sure you want to permanently delete this message ticket?")) return;
    try {
      await deleteDoc(doc(db, 'feedback', id));
      setSelectedItem(null);
    } catch (err) {
      console.error('Error deleting feedback:', err);
      alert('Failed to delete ticket.');
    }
  };

  const handleSaveEpisodeFeedUrl = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const url = formData.get('rssUrl');
    if (url) {
      setEpisodeFeedUrl(url);
      localStorage.setItem('episodeFeedUrl', url);
    }
  };

  const handleAdminAuthSubmit = (e) => {
    e.preventDefault();
    if (adminPinInput === '2026' || adminPinInput === '1234' || adminPinInput.trim() === 'admin') {
      setIsAdminAuthenticated(true);
      localStorage.setItem('control_room_admin_auth', 'true');
      setAdminPinInput('');
      setAdminActionStatus('Super Admin Mode Enabled ✨');
      setTimeout(() => setAdminActionStatus(''), 2500);
    } else {
      setAdminActionStatus('Incorrect PIN');
      setTimeout(() => setAdminActionStatus(''), 2500);
    }
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    localStorage.removeItem('control_room_admin_auth');
    setAdminActionStatus('Logged out of Admin Mode');
    setTimeout(() => setAdminActionStatus(''), 2000);
  };

  const handleManualRefresh = async () => {
    setIsSyncingFeeds(true);
    setAdminActionStatus('Syncing live feeds & Google Sheet...');
    showActionToast('🔄 Syncing with Google Sheet & Firestore...');
    try {
      const res = await syncPlexSheetWithFirestore(db);
      const timeStr = new Date().toLocaleTimeString();
      setLastRefreshed(timeStr);
      setAdminActionStatus(`✓ Synced! (${res.clientsCount} clients updated)`);
      showActionToast(`✓ Synced with Google Sheet! (${res.clientsCount} clients updated)`);
      setTimeout(() => setAdminActionStatus(''), 3000);
    } catch (err) {
      console.error('Manual sync error:', err);
      const timeStr = new Date().toLocaleTimeString();
      setLastRefreshed(timeStr);
      setAdminActionStatus('⚠️ Sync completed with local cache');
      showActionToast('⚠️ Sync completed with local cache');
      setTimeout(() => setAdminActionStatus(''), 3000);
    } finally {
      setIsSyncingFeeds(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'resolved': return 'badge-success';
      case 'in_progress': return 'badge-warning';
      case 'unresolved': return 'badge-error';
      default: return 'badge-info';
    }
  };

  const getPriorityBadgeClass = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'urgent': return 'badge-urgent';
      case 'high': return 'badge-warning';
      case 'low': return 'badge-info';
      default: return 'badge-neutral';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'bug': return '🐛';
      case 'feature_request': return '✨';
      case 'support': return '🔧';
      case 'poll_vote':
      case 'poll': return '📊';
      default: return '💬';
    }
  };

  const getCategoryBadge = (cat) => {
    switch (cat) {
      case 'alert': return { label: '🚨 Urgent Alert', class: 'badge-error' };
      case 'update': return { label: '✨ Feature Update', class: 'badge-success' };
      case 'info': return { label: '💡 Information', class: 'badge-info' };
      case 'poll': return { label: '📊 Interactive Poll', class: 'badge-poll' };
      default: return { label: '📢 Announcement', class: 'badge-primary' };
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">📡</div>
          <div className="sidebar-brand-text">
            <h2>Control Room</h2>
            <span className="brand-sub">Comms & Operations</span>
          </div>
        </div>

        {/* Global Quick Action Button in Sidebar */}
        <div className="sidebar-action-wrap">
          <button 
            className="btn btn-primary sidebar-dispatch-btn"
            onClick={() => {
              setDispatchApp(activeTab === '📢 Dispatch Center' || activeTab === 'All Apps' || activeTab === '⚡ Action Center' || activeTab === '📦 All Messages' ? 'All Apps' : activeTab);
              setShowDispatchModal(true);
            }}
          >
            <span>⚡ Dispatch Message</span>
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-title">Navigation & Channels</div>
          {APPS.map(app => {
            const badgeCount = app === '⚡ Action Center'
              ? actionCounts.total
              : app === 'Plex Tracker' 
              ? plexOverdueCount 
              : (unresolvedCountsByApp[app] || 0);
            return (
              <button 
                key={app}
                onClick={() => setActiveTab(app)}
                className={`nav-item ${activeTab === app ? 'active' : ''}`}
              >
                <span className="icon">
                  {app === '⚡ Action Center' ? '⚡' :
                   app === '📢 Dispatch Center' ? '📢' :
                   app === 'Plex Tracker' ? '💳' :
                   app === '📦 All Messages' ? '📦' :
                   app === 'All Apps' ? '📊' : 
                   app === 'PlexMePlease' ? <img src="/favicons/plexmeplease.png" alt="PlexMePlease" /> : 
                   app === 'Check It' ? <img src="/favicons/checkit.png" alt="Check It" /> :
                   app === 'Pred: Know Your Stats' ? <img src="/favicons/pred.png" alt="Pred" /> :
                   app === 'Your Journey Your Tools' ? <img src="/favicons/yjyt-app.png" alt="YJYT App" /> :
                   app === 'Your Journey Your Tools (Website)' ? <img src="/favicons/yjyt-website.png" alt="YJYT Website" /> :
                   app === 'EpisodeFeed' ? '📺' : '✨'}
                </span> 
                <span className="nav-label">{app}</span>
                {badgeCount > 0 && app !== '📢 Dispatch Center' && (
                  <span className={`nav-badge ${app === '⚡ Action Center' || app === 'Plex Tracker' ? 'badge-alert' : ''}`}>{badgeCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer Live Status */}
        <div className="sidebar-footer">
          <div className="live-status-pill">
            <span className="live-pulsing-dot"></span>
            <span>Live Sync Active</span>
          </div>
          <span className="sidebar-clock">🕒 AWST: {new Date().toLocaleTimeString('en-US', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </aside>

      {/* Main Content View */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-header">
          <div className="header-brand-mobile">
            <div className="logo-icon">📡</div>
            <h2>Control Room</h2>
          </div>
          
          {/* Universal Search Bar */}
          <div className="header-search">
            <span className="search-icon">🔍</span>
            <input 
              type="text" 
              placeholder="Search incoming messages, senders, apps..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input" 
            />
            {searchQuery && (
              <button 
                className="search-clear-btn" 
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >✕</button>
            )}
          </div>

          <div className="header-actions">
            {/* Audio Alerts Toggle */}
            <button 
              className={`header-tool-btn sound-toggle-btn ${soundEnabled ? 'active' : ''}`}
              onClick={handleToggleSound}
              title={soundEnabled ? 'Sound Alerts Enabled (Click to mute)' : 'Sound Alerts Muted (Click to enable)'}
              aria-label="Toggle Sound Alerts"
            >
              <span>{soundEnabled ? '🔊' : '🔇'}</span>
              <span className="btn-label-desktop">{soundEnabled ? 'Alerts On' : 'Muted'}</span>
            </button>

            {/* Quick Dispatch Action Button */}
            <button 
              className="btn btn-primary header-dispatch-btn"
              onClick={() => {
                setDispatchApp(activeTab === '📢 Dispatch Center' || activeTab === 'All Apps' || activeTab === '⚡ Action Center' || activeTab === '📦 All Messages' ? 'All Apps' : activeTab);
                setShowDispatchModal(true);
              }}
            >
              <span style={{ marginRight: '4px' }}>⚡</span>
              <span>Dispatch</span>
            </button>

            {/* Admin Entrance */}
            <button 
              className={`admin-entrance-btn ${isAdminAuthenticated ? 'authenticated' : ''}`}
              onClick={() => setShowAdminModal(true)}
              aria-label="Open Admin Entrance"
            >
              <span className="admin-avatar">👑</span>
              <span className="admin-text">{isAdminAuthenticated ? 'Admin' : 'Entrance'}</span>
              <span className="admin-status-dot" title="Live Link Active"></span>
            </button>
          </div>
        </header>

        {/* Page Content View */}
        <div className="page-content">
          {/* ========================================================
              ⚡ ACTION CENTER (PRIMARY HOME DECK)
              Surface exclusively items that require immediate action
             ======================================================== */}
          {activeTab === '⚡ Action Center' && (
            <div className="action-center-section animate-fade-in">
              {/* Header Banner */}
              <div className="action-center-header">
                <div className="action-header-left">
                  <div className="action-title-row">
                    <h1>⚡ Action Center</h1>
                    {actionCounts.total > 0 ? (
                      <span className="action-status-pill alert">
                        <span className="live-pulsing-dot red"></span>
                        <span>{actionCounts.total} {actionCounts.total === 1 ? 'Action Required' : 'Actions Required'}</span>
                      </span>
                    ) : (
                      <span className="action-status-pill success">
                        <span className="live-pulsing-dot green"></span>
                        <span>All Caught Up</span>
                      </span>
                    )}
                  </div>
                  <p className="action-subtitle">
                    Live triage deck. Surface only the things that need your immediate action. Once resolved or recorded, items clear automatically from this view.
                  </p>
                </div>
                <div className="action-header-quick-tools">
                  <button 
                    className={`btn btn-secondary action-sync-btn ${isSyncingFeeds ? 'btn-loading' : ''}`}
                    onClick={handleManualRefresh}
                    disabled={isSyncingFeeds}
                    title="Force refresh all Firestore feeds and pull latest Google Sheet data"
                  >
                    <span style={{ display: 'inline-block', transform: isSyncingFeeds ? 'rotate(360deg)' : 'none', transition: 'transform 1s linear' }}>🔄</span> <span>{isSyncingFeeds ? 'Syncing...' : 'Sync Feeds'}</span>
                  </button>
                  <button 
                    className="btn btn-primary action-dispatch-btn" 
                    onClick={() => {
                      setDispatchApp('All Apps');
                      setShowDispatchModal(true);
                    }}
                  >
                    <span>⚡</span> <span>New Dispatch</span>
                  </button>
                </div>
              </div>

              {/* Action Dials Grid */}
              <div className="action-dials-grid">
                <div 
                  className={`action-dial-card glass-panel clickable ${actionCategoryFilter === 'bugs' ? 'active' : ''}`}
                  onClick={() => setActionCategoryFilter(actionCategoryFilter === 'bugs' ? 'all' : 'bugs')}
                >
                  <div className="dial-top">
                    <span className="dial-icon error">🚨</span>
                    <span className="dial-count">{actionCounts.bugsCount}</span>
                  </div>
                  <div className="dial-info">
                    <h4>Bugs & Urgent</h4>
                    <p>{actionCounts.bugsCount === 0 ? 'No urgent issues' : 'Needs attention / fix'}</p>
                  </div>
                </div>

                <div 
                  className={`action-dial-card glass-panel clickable ${actionCategoryFilter === 'payments' ? 'active' : ''}`}
                  onClick={() => setActionCategoryFilter(actionCategoryFilter === 'payments' ? 'all' : 'payments')}
                >
                  <div className="dial-top">
                    <span className="dial-icon warning">💳</span>
                    <span className="dial-count">{actionCounts.paymentsCount}</span>
                  </div>
                  <div className="dial-info">
                    <h4>Subscriptions Due</h4>
                    <p>{actionCounts.overdueCount > 0 ? `$${Number(actionCounts.overdueCashAmount).toFixed(2)} overdue (${actionCounts.overdueCount} clients)` : (actionCounts.dueSoonCount > 0 ? `${actionCounts.dueSoonCount} due soon` : 'All accounts current')}</p>
                  </div>
                </div>

                <div 
                  className={`action-dial-card glass-panel clickable ${actionCategoryFilter === 'inquiries' ? 'active' : ''}`}
                  onClick={() => setActionCategoryFilter(actionCategoryFilter === 'inquiries' ? 'all' : 'inquiries')}
                >
                  <div className="dial-top">
                    <span className="dial-icon primary">💬</span>
                    <span className="dial-count">{actionCounts.inquiriesCount}</span>
                  </div>
                  <div className="dial-info">
                    <h4>User Inquiries</h4>
                    <p>{actionCounts.inquiriesCount === 0 ? 'No open inquiries' : 'Awaiting admin response'}</p>
                  </div>
                </div>

                <div 
                  className={`action-dial-card glass-panel clickable ${actionCategoryFilter === 'in_progress' ? 'active' : ''}`}
                  onClick={() => setActionCategoryFilter(actionCategoryFilter === 'in_progress' ? 'all' : 'in_progress')}
                >
                  <div className="dial-top">
                    <span className="dial-icon info">⏳</span>
                    <span className="dial-count">{actionCounts.inProgressCount}</span>
                  </div>
                  <div className="dial-info">
                    <h4>In Progress</h4>
                    <p>{actionCounts.inProgressCount === 0 ? 'None in progress' : 'Active investigation'}</p>
                  </div>
                </div>
              </div>

              {/* Action Toolbar (Filter chips & Search) */}
              <div className="action-toolbar glass-panel">
                <div className="action-filter-chips">
                  <button 
                    className={`action-chip ${actionCategoryFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setActionCategoryFilter('all')}
                  >
                    All Items <span className="chip-badge">{actionCounts.total}</span>
                  </button>
                  <button 
                    className={`action-chip ${actionCategoryFilter === 'bugs' ? 'active' : ''}`}
                    onClick={() => setActionCategoryFilter('bugs')}
                  >
                    🚨 Bugs & Urgent <span className="chip-badge alert">{actionCounts.bugsCount}</span>
                  </button>
                  <button 
                    className={`action-chip ${actionCategoryFilter === 'payments' ? 'active' : ''}`}
                    onClick={() => setActionCategoryFilter('payments')}
                  >
                    💳 Subscriptions <span className="chip-badge warning">{actionCounts.paymentsCount}</span>
                  </button>
                  <button 
                    className={`action-chip ${actionCategoryFilter === 'inquiries' ? 'active' : ''}`}
                    onClick={() => setActionCategoryFilter('inquiries')}
                  >
                    💬 Inquiries <span className="chip-badge">{actionCounts.inquiriesCount}</span>
                  </button>
                  <button 
                    className={`action-chip ${actionCategoryFilter === 'in_progress' ? 'active' : ''}`}
                    onClick={() => setActionCategoryFilter('in_progress')}
                  >
                    ⏳ In Progress <span className="chip-badge">{actionCounts.inProgressCount}</span>
                  </button>
                  {actionCounts.activePollsCount > 0 && (
                    <button 
                      className={`action-chip ${actionCategoryFilter === 'polls' ? 'active' : ''}`}
                      onClick={() => setActionCategoryFilter('polls')}
                    >
                      📊 Active Polls <span className="chip-badge">{actionCounts.activePollsCount}</span>
                    </button>
                  )}
                </div>

                <div className="action-search-box">
                  <span className="search-icon">🔍</span>
                  <input 
                    type="text" 
                    placeholder="Filter actions by user, app, or keyword..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="action-search-input"
                  />
                  {searchQuery && (
                    <button className="search-clear-btn" onClick={() => setSearchQuery('')}>✕</button>
                  )}
                </div>
              </div>

              {/* Action Feed Cards */}
              <div className="action-feed-list">
                {loading ? (
                  <div className="glass-panel empty-state">Loading action center queue...</div>
                ) : filteredActionItems.length === 0 ? (
                  actionCounts.total === 0 ? (
                    /* Zero Inbox Celebratory State */
                    <div className="all-clear-container glass-panel animate-fade-in">
                      <div className="all-clear-icon">🎉</div>
                      <h2>Mission Control is All Clear!</h2>
                      <p>
                        You have completely cleared the action deck. No pending bug reports, open inquiries, or overdue subscriptions.
                      </p>
                      <div className="all-clear-checklist">
                        <div className="checklist-item">
                          <span className="check-icon">✓</span>
                          <span>All user inquiries & tickets resolved</span>
                        </div>
                        <div className="checklist-item">
                          <span className="check-icon">✓</span>
                          <span>All Plex subscriptions up to date</span>
                        </div>
                        <div className="checklist-item">
                          <span className="check-icon">✓</span>
                          <span>Live synchronization nominal across all apps</span>
                        </div>
                      </div>
                      <div className="all-clear-actions">
                        <button onClick={() => setShowDispatchModal(true)} className="btn btn-primary">
                          ⚡ Dispatch a Message
                        </button>
                        <button onClick={() => setActiveTab('📦 All Messages')} className="btn btn-secondary">
                          📦 Browse Message Archive
                        </button>
                        <button onClick={() => setActiveTab('Plex Tracker')} className="btn btn-secondary">
                          💳 Open Plex Tracker
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel empty-state">
                      <p>No action items match your current filter or search query.</p>
                      <button 
                        className="btn btn-secondary" 
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => {
                          setActionCategoryFilter('all');
                          setSearchQuery('');
                        }}
                      >
                        Reset Filter
                      </button>
                    </div>
                  )
                ) : (
                  filteredActionItems.map(item => {
                    if (item.actionType === 'plex_overdue' || item.actionType === 'plex_due_soon') {
                      const isOverdue = item.actionType === 'plex_overdue';
                      return (
                        <div key={item.id} className={`action-card glass-panel payment-card ${isOverdue ? 'card-overdue' : 'card-due-soon'}`}>
                          <div className="action-card-header">
                            <div className="action-card-tags">
                              <span className="badge badge-plex">💳 Plex Subscription</span>
                              {isOverdue ? (
                                <span className="badge badge-error animate-pulse">
                                  ⚠️ OVERDUE ({Math.abs(item.client.daysDiff)} {Math.abs(item.client.daysDiff) === 1 ? 'day' : 'days'})
                                </span>
                              ) : (
                                <span className="badge badge-warning">
                                  ⏳ DUE SOON (in {item.client.daysDiff} {item.client.daysDiff === 1 ? 'day' : 'days'})
                                </span>
                              )}
                            </div>
                            <span className="action-card-time">Due Date: {formatDateDisplay(item.client.nextPaymentDue)}</span>
                          </div>

                          <div className="action-card-body">
                            <div className="client-info-row">
                              <div className="client-avatar">👤</div>
                              <div className="client-text">
                                <h3 className="client-name">{item.client.name}</h3>
                                <p className="client-meta">
                                  <span>{item.client.email || 'No email on record'}</span>
                                  <span className="dot-sep">•</span>
                                  <span>Last paid: {formatDateDisplay(item.client.lastPaymentDate)}</span>
                                  <span className="dot-sep">•</span>
                                  <span>Total received: ${Number(item.client.totalPaid || 0).toFixed(2)}</span>
                                </p>
                              </div>
                              <div className="client-amount-pill">
                                ${Number(item.client.monthlyAmount || 10.00).toFixed(2)} / mo
                              </div>
                            </div>
                            {item.client.notes && (
                              <p className="client-notes-snippet">📝 {item.client.notes}</p>
                            )}
                          </div>

                          <div className="action-card-footer">
                            <div className="action-card-btns">
                              <button 
                                className="btn btn-action-primary mark-paid-btn"
                                onClick={() => handleMarkClientPaidFromHome(item.client)}
                                title="Record payment and advance due date by 1 month"
                              >
                                <span className="btn-icon">✓</span>
                                <span>Mark Paid (${Number(item.client.monthlyAmount || 10).toFixed(2)})</span>
                              </button>

                              {item.client.email && (
                                <a 
                                  href={`mailto:${item.client.email}?subject=Plex Subscription Payment Reminder&body=Hi ${item.client.name},\n\nThis is a friendly reminder that your Plex subscription of $${Number(item.client.monthlyAmount || 10).toFixed(2)} was due on ${formatDateDisplay(item.client.nextPaymentDue)}.\n\nThank you!`}
                                  className="btn btn-action-secondary"
                                  title="Send payment reminder email"
                                >
                                  <span>✉️</span>
                                  <span>Send Reminder</span>
                                </a>
                              )}

                              <button 
                                className="btn btn-action-ghost"
                                onClick={() => setActiveTab('Plex Tracker')}
                                title="Open full client record in Plex Tracker"
                              >
                                <span>Open in Tracker ↗</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (item.actionType === 'active_poll') {
                      return (
                        <div key={item.id} className="action-card glass-panel poll-action-card">
                          <div className="action-card-header">
                            <div className="action-card-tags">
                              <span className="badge badge-poll">📊 Live Poll</span>
                              <span className="badge badge-info">{item.poll.app || 'All Apps'}</span>
                              <span className="badge badge-success">🗳️ {item.voteCount} {item.voteCount === 1 ? 'Vote Recorded' : 'Votes Recorded'}</span>
                            </div>
                            <span className="action-card-time">{item.date ? item.date.toLocaleDateString() : 'Active'}</span>
                          </div>

                          <div className="action-card-body">
                            <h3 className="poll-question-title">{item.poll.title}</h3>
                            {item.poll.body && <p className="poll-desc-text">{item.poll.body}</p>}

                            {Array.isArray(item.poll.pollOptions) && item.poll.pollOptions.length > 0 && (
                              <div className="poll-quick-bars">
                                {item.poll.pollOptions.slice(0, 3).map((opt, oIdx) => {
                                  const matching = item.votes.filter(v => (v.selectedOption || '').trim().toLowerCase() === opt.trim().toLowerCase()).length;
                                  const pct = item.voteCount > 0 ? Math.round((matching / item.voteCount) * 100) : 0;
                                  return (
                                    <div key={oIdx} className="poll-quick-bar-row">
                                      <span className="poll-quick-opt-name">{opt}</span>
                                      <div className="poll-quick-track">
                                        <div className="poll-quick-fill" style={{ width: `${pct}%` }}></div>
                                      </div>
                                      <span className="poll-quick-pct">{pct}% ({matching})</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div className="action-card-footer">
                            <div className="action-card-btns">
                              <button 
                                className="btn btn-action-primary"
                                onClick={() => setActiveTab('📢 Dispatch Center')}
                              >
                                <span>📊 View Full Breakdown</span>
                              </button>
                              <button 
                                className="btn btn-action-secondary"
                                onClick={() => {
                                  setDispatchApp(item.poll.app || 'All Apps');
                                  setDispatchCategory('broadcast');
                                  setDispatchTitle(`Poll Results: ${item.poll.title}`);
                                  setDispatchBody(`Thank you to everyone who voted on "${item.poll.title}"! Results have been recorded.`);
                                  setShowDispatchModal(true);
                                }}
                              >
                                <span>📢 Announce Results</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Ticket Card
                    const isUrgent = item.ticket.priority === 'urgent' || item.ticket.priority === 'high';
                    const isBug = item.ticket.type === 'bug';
                    const threadCount = Array.isArray(item.ticket.thread) ? item.ticket.thread.length : 0;

                    return (
                      <div key={item.id} className={`action-card glass-panel ticket-card ${isUrgent || isBug ? 'card-urgent' : ''}`}>
                        <div className="action-card-header">
                          <div className="action-card-tags">
                            <span className="badge badge-app">{item.ticket.app || 'In-App Inquiry'}</span>
                            {isBug && <span className="badge badge-error">🐛 Bug Report</span>}
                            {item.ticket.type === 'poll_vote' && <span className="badge badge-poll">📊 Poll Vote</span>}
                            {item.ticket.priority === 'urgent' && <span className="badge badge-urgent animate-pulse">🚨 URGENT</span>}
                            {item.ticket.priority === 'high' && <span className="badge badge-warning">⚡ HIGH</span>}
                            {item.ticket.status === 'in_progress' && <span className="badge badge-in-progress">⏳ In Progress</span>}
                            {threadCount > 0 && (
                              <span className="badge badge-thread">💬 {threadCount} {threadCount === 1 ? 'reply' : 'replies'}</span>
                            )}
                          </div>
                          <span className="action-card-time">
                            {item.date ? item.date.toLocaleDateString() + ' ' + item.date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Recent'}
                          </span>
                        </div>

                        <div className="action-card-body" onClick={() => setSelectedItem(item.ticket)}>
                          <p className="ticket-message-text">{item.ticket.message}</p>
                          
                          {item.ticket.selectedOption && (
                            <div className="poll-choice-preview" style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>
                              🗳️ Choice: <strong>{item.ticket.selectedOption}</strong>
                            </div>
                          )}

                          <div className="ticket-sender-meta">
                            <span>👤 {item.ticket.user || item.ticket.sender || 'Anonymous User'}</span>
                            {item.ticket.user && item.ticket.user.includes('@') && (
                              <a 
                                href={`mailto:${item.ticket.user}?subject=Regarding your ${item.ticket.app || 'app'} inquiry&body=Hi,\n\nRegarding your message: "${item.ticket.message}"\n\n`}
                                onClick={e => e.stopPropagation()}
                                className="user-email-link"
                              >
                                ✉️ Email Direct
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="action-card-footer">
                          <div className="action-card-btns">
                            <button 
                              className="btn btn-action-primary resolve-btn"
                              onClick={(e) => handleQuickResolveTicket(item.ticket, e)}
                              title="1-Click: Mark resolved and remove from Action Center"
                            >
                              <span className="btn-icon">✓</span>
                              <span>Mark Resolved</span>
                            </button>

                            <button 
                              className="btn btn-action-secondary reply-btn"
                              onClick={() => setSelectedItem(item.ticket)}
                              title="Open full ticket details and send 2-way reply"
                            >
                              <span>💬</span>
                              <span>Reply & Details ↗</span>
                            </button>

                            <button 
                              className={`btn btn-action-ghost ${item.ticket.status === 'in_progress' ? 'active-status' : ''}`}
                              onClick={(e) => handleToggleTicketInProgress(item.ticket, e)}
                              title={item.ticket.status === 'in_progress' ? 'Mark as Unresolved' : 'Mark as In Progress'}
                            >
                              <span>{item.ticket.status === 'in_progress' ? '⏳ In Progress' : 'Mark In Progress'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Header Banner for Non-Action-Center Views */}
          {activeTab !== 'Plex Tracker' && activeTab !== '⚡ Action Center' && (
            <div className="dashboard-header animate-fade-in">
              <div className="dashboard-title-group">
                <div className="dashboard-title-row">
                  <h1>{activeTab === '📦 All Messages' || activeTab === 'All Apps' ? 'Mission Control & Comms' : activeTab}</h1>
                  <span className="header-live-badge">
                    <span className="live-pulsing-dot small"></span> LIVE FEED
                  </span>
                </div>
                <p className="subtitle">Historical message archive, filters, direct replies, and universal broadcasts.</p>
              </div>
              {activeTab === 'Your Journey Your Tools (Website)' && (
                <a href="https://yourjourneyyourtools.com/" target="_blank" rel="noopener noreferrer" className="btn btn-primary website-link-btn">
                  <span>Visit Website</span> <span style={{ fontSize: '1.2em' }}>↗</span>
                </a>
              )}
            </div>
          )}

          {/* Stats Grid for Non-Action-Center Views */}
          {activeTab !== 'EpisodeFeed' && activeTab !== 'Plex Tracker' && activeTab !== '⚡ Action Center' && (
            <div className="stats-grid animate-fade-in" style={{ animationDelay: '0.05s' }}>
              <div 
                className={`stat-card glass-panel clickable ${activeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setActiveFilter('all')}
              >
                <div className="stat-icon primary">📥</div>
                <div className="stat-info">
                  <h3>Total Messages</h3>
                  <p className="stat-value">{stats.totalIssues}</p>
                </div>
              </div>

              <div 
                className={`stat-card glass-panel clickable ${activeFilter === 'unresolved' ? 'active' : ''}`}
                onClick={() => setActiveFilter(activeFilter === 'unresolved' ? 'all' : 'unresolved')}
              >
                <div className="stat-icon error">⚠️</div>
                <div className="stat-info">
                  <h3>Unresolved</h3>
                  <p className="stat-value">{stats.unresolved}</p>
                </div>
              </div>

              <div 
                className={`stat-card glass-panel clickable ${activeFilter === 'in_progress' ? 'active' : ''}`}
                onClick={() => setActiveFilter(activeFilter === 'in_progress' ? 'all' : 'in_progress')}
              >
                <div className="stat-icon warning">⚡</div>
                <div className="stat-info">
                  <h3>In Progress</h3>
                  <p className="stat-value">{stats.inProgress}</p>
                </div>
              </div>

              <div 
                className={`stat-card glass-panel clickable ${activeTab === '📢 Dispatch Center' ? 'active' : ''}`}
                onClick={() => setActiveTab('📢 Dispatch Center')}
              >
                <div className="stat-icon success">📢</div>
                <div className="stat-info">
                  <h3>Dispatched Logs</h3>
                  <p className="stat-value">{stats.broadcastsCount}</p>
                </div>
              </div>

              {/* Google Analytics Card for YJYT */}
              {(activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') && (
                <div className="stat-card glass-panel">
                  <div className="stat-icon info">📈</div>
                  <div className="stat-info">
                    <h3>New Users (7d)</h3>
                    {analyticsLoading ? (
                      <p className="stat-value" style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Loading...</p>
                    ) : analyticsError ? (
                      <p className="stat-value" style={{ fontSize: '1.1rem', color: 'var(--status-error)' }}>Error</p>
                    ) : (
                      <p className="stat-value">{analyticsData?.newUsersLast7Days || 0}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================
              DEDICATED BROADCAST & DISPATCH CENTER VIEW
             ======================================================== */}
          {activeTab === '📢 Dispatch Center' && (
            <div className="dispatch-center-view animate-fade-in">
              <div className="activity-section">
                <div className="section-header">
                  <div>
                    <h2>📡 Universal Message Dispatcher</h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Send in-app broadcasts, critical alerts, release notes, and FCM push notifications to any app or all apps.
                    </p>
                  </div>
                </div>

                <div className="glass-panel broadcast-form-panel">
                  <form onSubmit={handleSendDispatch} className="broadcast-form">
                    <div className="dispatch-form-row">
                      <div className="form-group flex-1">
                        <label>Target Application</label>
                        <select 
                          value={dispatchApp} 
                          onChange={(e) => setDispatchApp(e.target.value)}
                          className="form-input form-select"
                        >
                          {TARGET_APPS_LIST.map(app => (
                            <option key={app} value={app}>{app}</option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group flex-1">
                        <label>Message Category</label>
                        <select 
                          value={dispatchCategory} 
                          onChange={(e) => setDispatchCategory(e.target.value)}
                          className="form-input form-select"
                        >
                          <option value="broadcast">📢 In-App Broadcast</option>
                          <option value="poll">📊 Interactive Poll</option>
                          <option value="alert">🚨 Urgent Alert / Maintenance</option>
                          <option value="update">✨ Feature Release Note</option>
                          <option value="info">💡 Information / Tip</option>
                        </select>
                      </div>

                      <div className="form-group flex-1">
                        <label>Priority Level</label>
                        <select 
                          value={dispatchPriority} 
                          onChange={(e) => setDispatchPriority(e.target.value)}
                          className="form-input form-select"
                        >
                          <option value="normal">Normal</option>
                          <option value="high">High Priority</option>
                          <option value="urgent">Urgent / Critical</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>{dispatchCategory === 'poll' ? 'Poll Question / Subject' : 'Message Title / Subject'}</label>
                      <input 
                        type="text" 
                        placeholder={dispatchCategory === 'poll' ? "e.g. Which movie should we add to Plex next?" : "e.g. Scheduled System Maintenance / New Feature Added!"} 
                        value={dispatchTitle}
                        onChange={(e) => setDispatchTitle(e.target.value)}
                        required
                        className="form-input"
                      />
                    </div>

                    {dispatchCategory === 'poll' && (
                      <div className="form-group poll-options-builder">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <label style={{ margin: 0, fontWeight: '600', color: 'var(--text-primary)' }}>Poll Options (Minimum 2)</label>
                          {dispatchPollOptions.length < 8 && (
                            <button 
                              type="button" 
                              onClick={handleAddPollOption}
                              className="btn-add-option"
                            >
                              + Add Option
                            </button>
                          )}
                        </div>
                        <div className="poll-options-inputs">
                          {dispatchPollOptions.map((opt, idx) => (
                            <div key={idx} className="poll-option-input-row">
                              <span className="poll-option-badge">#{idx + 1}</span>
                              <input
                                type="text"
                                placeholder={`Option ${idx + 1} (e.g. ${idx === 0 ? 'Dune: Part Two' : idx === 1 ? 'Oppenheimer' : 'Interstellar'})`}
                                value={opt}
                                onChange={(e) => handlePollOptionChange(idx, e.target.value)}
                                required
                                className="form-input flex-1"
                              />
                              {dispatchPollOptions.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemovePollOption(idx)}
                                  className="btn-remove-option"
                                  title="Remove Option"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="form-group">
                      <label>{dispatchCategory === 'poll' ? 'Poll Description / Details (Optional)' : 'Message Body / Announcement Details'}</label>
                      <textarea 
                        placeholder={dispatchCategory === 'poll' ? "Additional instructions or details for voters (optional)..." : "Type the message content that users will see in their inboxes or push notifications..."} 
                        value={dispatchBody}
                        onChange={(e) => setDispatchBody(e.target.value)}
                        required={dispatchCategory !== 'poll'}
                        rows={dispatchCategory === 'poll' ? 2 : 4}
                        className="form-textarea"
                      />
                    </div>

                    <div className="dispatch-form-row">
                      <div className="form-group flex-2">
                        <label>Action URL / Deep Link (Optional)</label>
                        <input 
                          type="url" 
                          placeholder="e.g. https://yourjourneyyourtools.com/updates" 
                          value={dispatchActionUrl}
                          onChange={(e) => setDispatchActionUrl(e.target.value)}
                          className="form-input"
                        />
                      </div>

                      <div className="form-group flex-1">
                        <label>Auto-Expiration / Retention</label>
                        <select 
                          value={dispatchExpiryPreset} 
                          onChange={(e) => setDispatchExpiryPreset(e.target.value)}
                          className="form-input form-select"
                        >
                          <option value="1h">1 Hour</option>
                          <option value="24h">24 Hours (Default)</option>
                          <option value="3d">3 Days</option>
                          <option value="7d">7 Days</option>
                          <option value="perm">Permanent (No Auto-Delete)</option>
                          <option value="custom">Custom Date/Time</option>
                        </select>
                      </div>
                    </div>

                    {dispatchExpiryPreset === 'custom' && (
                      <div className="form-group">
                        <label>Custom Expiration Time (AWST / Perth Time)</label>
                        <input
                          type="datetime-local"
                          value={dispatchCustomExpiry}
                          onChange={(e) => setDispatchCustomExpiry(e.target.value)}
                          required={dispatchExpiryPreset === 'custom'}
                          className="form-input"
                        />
                      </div>
                    )}

                    <div className="dispatch-options-row">
                      <label className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={dispatchSendPush} 
                          onChange={(e) => setDispatchSendPush(e.target.checked)} 
                        />
                        <span>Send FCM Push Notification to registered devices</span>
                      </label>
                    </div>

                    <div className="form-action-row">
                      {dispatchStatus === 'success' && <span className="status-msg success">{dispatchStatusMsg || '✓ Dispatched successfully!'}</span>}
                      {dispatchStatus === 'error' && <span className="status-msg error">{dispatchStatusMsg || '✕ Failed to dispatch'}</span>}
                      <button 
                        type="submit" 
                        disabled={dispatchStatus === 'sending'}
                        className="btn btn-primary send-push-btn"
                      >
                        {dispatchStatus === 'sending' ? 'Dispatching...' : '🚀 Dispatch Message'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Past Broadcasts Log */}
              <div className="activity-section" style={{ marginTop: '2.5rem' }}>
                <div className="section-header">
                  <h2>📬 Dispatched Messages Log ({broadcasts.length})</h2>
                  <div className="filters">
                    <button 
                      className={`filter-btn ${broadcastFilterApp === 'all' ? 'active' : ''}`}
                      onClick={() => setBroadcastFilterApp('all')}
                    >All Apps</button>
                    <button 
                      className={`filter-btn ${broadcastFilterApp === 'PlexMePlease' ? 'active' : ''}`}
                      onClick={() => setBroadcastFilterApp('PlexMePlease')}
                    >PlexMePlease</button>
                    <button 
                      className={`filter-btn ${broadcastFilterApp === 'Your Journey Your Tools' ? 'active' : ''}`}
                      onClick={() => setBroadcastFilterApp('Your Journey Your Tools')}
                    >YJYT</button>
                  </div>
                </div>

                <div className="feed-list">
                  {filteredBroadcasts.length === 0 ? (
                    <div className="glass-panel empty-state">No broadcasts matching the current filter.</div>
                  ) : (
                    filteredBroadcasts.map(b => {
                      const dateObj = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || Date.now());
                      const catBadge = getCategoryBadge(b.category);
                      const expiresAt = b.expiresAt ? (b.expiresAt?.toDate ? b.expiresAt.toDate() : new Date(b.expiresAt)) : null;

                      const pollVotes = feedbackData.filter(item => item.type === 'poll_vote' && (item.pollId === b.id || (item.pollTitle && item.pollTitle === b.title)));
                      const totalVotes = pollVotes.length;
                      const options = Array.isArray(b.pollOptions) && b.pollOptions.length > 0 ? b.pollOptions : [];

                      return (
                        <div key={b.id} className="feed-item glass-panel broadcast-item">
                          <div className="item-content">
                            <div className="item-meta">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span className="app-name">{b.title}</span>
                                <span className={`badge ${catBadge.class}`}>{catBadge.label}</span>
                                <span className="badge badge-info">{b.app || 'All Apps'}</span>
                                {b.priority && b.priority !== 'normal' && (
                                  <span className={`badge ${getPriorityBadgeClass(b.priority)}`}>{b.priority}</span>
                                )}
                              </div>
                              <span className="time-ago">
                                {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </div>
                            <p className="item-message">{b.body}</p>

                            {/* Live Poll Results & Breakdown (Private to Control Room) */}
                            {b.category === 'poll' && options.length > 0 && (
                              <div className="poll-results-card">
                                <div className="poll-results-header">
                                  <span className="poll-total-votes">🗳️ {totalVotes} {totalVotes === 1 ? 'Vote Recorded' : 'Votes Recorded'}</span>
                                  <span className="poll-private-badge">🔒 Private Admin Results</span>
                                </div>
                                <div className="poll-options-results">
                                  {options.map((opt, optIdx) => {
                                    const matchingVotes = pollVotes.filter(v => (v.selectedOption || '').trim().toLowerCase() === opt.trim().toLowerCase());
                                    const count = matchingVotes.length;
                                    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                                    return (
                                      <div key={optIdx} className="poll-option-result-row">
                                        <div className="poll-option-info">
                                          <span className="poll-option-text">{opt}</span>
                                          <span className="poll-option-count">{count} {count === 1 ? 'vote' : 'votes'} ({pct}%)</span>
                                        </div>
                                        <div className="poll-progress-track">
                                          <div className="poll-progress-fill" style={{ width: `${pct}%` }}></div>
                                        </div>
                                        {matchingVotes.length > 0 && (
                                          <div className="poll-voter-names">
                                            <span className="poll-voter-label">👥 Voters:</span>
                                            {matchingVotes.map((v, vIdx) => (
                                              <span key={vIdx} className="poll-voter-chip">
                                                {v.user || v.sender || 'Anonymous'}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {b.actionUrl && (
                              <div style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '6px' }}>
                                🔗 Link: <a href={b.actionUrl} target="_blank" rel="noopener noreferrer">{b.actionUrl}</a>
                              </div>
                            )}
                            {expiresAt && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                ⏳ Expires: {expiresAt.toLocaleDateString()} {expiresAt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                              </div>
                            )}
                          </div>
                          <div className="item-action-end" style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              onClick={() => handleCloneBroadcast(b)}
                              className="btn btn-secondary"
                              style={{ minHeight: '36px', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                              title="Duplicate & Re-send"
                            >
                              🔄 Clone
                            </button>
                            <button 
                              onClick={() => handleDeleteBroadcast(b.id)}
                              className="btn-danger-outline"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              TOP PAGES ANALYTICS (FOR YJYT)
             ======================================================== */}
          {(activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="section-header">
                <h2>📈 Most Visited Pages (Last 7 Days)</h2>
              </div>
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                {analyticsLoading ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Fetching from Google Analytics...</div>
                ) : analyticsError ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--status-error)' }}>{analyticsError}</div>
                ) : analyticsData?.topPages?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {analyticsData.topPages.map((page, index) => (
                      <div key={index} className="top-page-item">
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, paddingRight: '12px' }}>
                          <span style={{ fontWeight: '600', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{page.title || 'Unknown Page'}</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{page.path}</span>
                        </div>
                        <div style={{ fontWeight: '700', color: 'var(--accent-primary)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {page.views} views
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>No page data available.</div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================
              EPISODEFEED RSS SECTION
             ======================================================== */}
          {activeTab === 'EpisodeFeed' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="section-header">
                <h2>📺 Your Shows (EpisodeFeed)</h2>
              </div>
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px', marginBottom: '1.5rem' }}>
                <form onSubmit={handleSaveEpisodeFeedUrl} className="rss-form">
                  <label style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: '600' }}>Custom RSS Feed URL</label>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Enter your personal RSS feed URL from EpisodeFeed.com to sync your upcoming shows.
                  </p>
                  <div className="rss-input-group">
                    <input 
                      type="url" 
                      name="rssUrl"
                      placeholder="https://episodefeed.com/rss/..." 
                      defaultValue={episodeFeedUrl}
                      required
                      className="form-input"
                    />
                    <button 
                      type="submit" 
                      className="btn btn-primary rss-save-btn"
                    >
                      Save URL
                    </button>
                  </div>
                </form>
              </div>

              {episodeFeedUrl && (
                <div className="feed-list">
                  {episodeFeedLoading ? (
                    <div className="glass-panel empty-state">Loading your shows...</div>
                  ) : episodeFeedError ? (
                    <div className="glass-panel empty-state error">Error: {episodeFeedError}</div>
                  ) : episodeFeedData?.items?.length > 0 ? (
                    episodeFeedData.items.map((item, index) => {
                      const pubDate = new Date(item.pubDate);
                      return (
                        <div key={index} className="feed-item glass-panel show-feed-item">
                          <div className="item-meta">
                            <span className="app-name" style={{ fontSize: '1.1rem' }}>{item.title}</span>
                            {item.pubDate && (
                              <span className="time-ago">
                                {pubDate.toLocaleDateString()} {pubDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            )}
                          </div>
                          {item.contentSnippet && (
                            <p className="item-message">{item.contentSnippet}</p>
                          )}
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="show-link-btn">
                            View details ↗
                          </a>
                        </div>
                      );
                    })
                  ) : (
                    <div className="glass-panel empty-state">No shows found in the feed.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========================================================
              PLEX TRACKER (CLIENTS, DUE DATES, COSTS, REVENUE)
             ======================================================== */}
          {activeTab === 'Plex Tracker' && (
            <PlexTracker 
              soundEnabled={soundEnabled}
              playNotificationChime={playNotificationChime}
              onOverdueCountChange={setPlexOverdueCount}
              onTriggerDispatch={({ app, title, body }) => {
                setDispatchApp(app || 'PlexMePlease');
                setDispatchTitle(title || '');
                setDispatchBody(body || '');
                setShowDispatchModal(true);
              }}
            />
          )}

          {/* ========================================================
              INCOMING MESSAGES & FEEDBACK STREAM
             ======================================================== */}
          {activeTab !== 'EpisodeFeed' && activeTab !== '📢 Dispatch Center' && activeTab !== 'Plex Tracker' && activeTab !== '⚡ Action Center' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.15s' }}>
              <div className="section-header">
                <div>
                  <h2>Incoming Messages & Feed ({filteredData.length})</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Live user feedback, bug reports, and inquiries. Click any item to reply directly and update ticket state.
                  </p>
                </div>
                <div className="filters">
                  <button 
                    className={`filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveFilter('all')}
                  >All</button>
                  <button 
                    className={`filter-btn ${activeFilter === 'unresolved' ? 'active' : ''}`}
                    onClick={() => setActiveFilter('unresolved')}
                  >Unresolved</button>
                  <button 
                    className={`filter-btn ${activeFilter === 'in_progress' ? 'active' : ''}`}
                    onClick={() => setActiveFilter('in_progress')}
                  >In Progress</button>
                  <button 
                    className={`filter-btn ${activeFilter === 'resolved' ? 'active' : ''}`}
                    onClick={() => setActiveFilter('resolved')}
                  >Resolved</button>
                </div>
              </div>

              <div className="feed-list">
                {loading ? (
                  <div className="glass-panel empty-state">Loading live message stream...</div>
                ) : filteredData.length === 0 ? (
                  <div className="glass-panel empty-state">
                    {searchQuery ? `No messages matching "${searchQuery}"` : 'No messages found for this selection.'}
                  </div>
                ) : (
                  filteredData.map(item => {
                    const dateObj = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || Date.now());
                    const threadCount = Array.isArray(item.thread) ? item.thread.length : 0;
                    return (
                      <div 
                        key={item.id} 
                        className={`feed-item glass-panel activity-item ${item.status === 'resolved' ? 'resolved-card' : ''}`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="item-icon">
                          {getTypeIcon(item.type)}
                        </div>
                        <div className="item-content">
                          <div className="item-meta">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span className="app-name">{item.app || 'Unknown App'}</span>
                              {item.type === 'poll_vote' && (
                                <span className="badge badge-poll">📊 Poll Vote</span>
                              )}
                              {item.priority && (
                                <span className={`badge ${getPriorityBadgeClass(item.priority)}`}>
                                  {item.priority}
                                </span>
                              )}
                              {threadCount > 0 && (
                                <span className="badge badge-thread">💬 {threadCount} {threadCount === 1 ? 'reply' : 'replies'}</span>
                              )}
                            </div>
                            <span className="time-ago">
                              {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                          </div>

                          <p className="item-message">{item.message}</p>

                          {item.selectedOption && (
                            <div className="feed-item-poll-selection">
                              🗳️ Option: <strong>{item.selectedOption}</strong>
                            </div>
                          )}

                          <div className="item-footer">
                            <span className="user-email">👤 {item.user || item.sender || 'Anonymous'}</span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span className={`badge ${getStatusBadgeClass(item.status || 'unresolved')}`}>
                                {(item.status || 'unresolved').replace('_', ' ')}
                              </span>
                              <span className="quick-reply-hint">Reply ↗</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ========================================================
          GLOBAL QUICK DISPATCH MODAL
         ======================================================== */}
      {showDispatchModal && (
        <div className="modal-overlay" onClick={() => setShowDispatchModal(false)}>
          <div className="modal-content glass-panel dispatch-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.4rem' }}>⚡</span>
                <h2>Dispatch Message / Broadcast</h2>
              </div>
              <button className="close-btn" onClick={() => setShowDispatchModal(false)} aria-label="Close modal">✕</button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <form onSubmit={handleSendDispatch} className="broadcast-form">
                <div className="dispatch-form-row">
                  <div className="form-group flex-1">
                    <label>Target Application</label>
                    <select 
                      value={dispatchApp} 
                      onChange={(e) => setDispatchApp(e.target.value)}
                      className="form-input form-select"
                    >
                      {TARGET_APPS_LIST.map(app => (
                        <option key={app} value={app}>{app}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group flex-1">
                    <label>Category</label>
                    <select 
                      value={dispatchCategory} 
                      onChange={(e) => setDispatchCategory(e.target.value)}
                      className="form-input form-select"
                    >
                      <option value="broadcast">📢 In-App Broadcast</option>
                      <option value="poll">📊 Interactive Poll</option>
                      <option value="alert">🚨 Urgent Alert</option>
                      <option value="update">✨ Feature Release</option>
                      <option value="info">💡 Information</option>
                    </select>
                  </div>

                  <div className="form-group flex-1">
                    <label>Priority</label>
                    <select 
                      value={dispatchPriority} 
                      onChange={(e) => setDispatchPriority(e.target.value)}
                      className="form-input form-select"
                    >
                      <option value="normal">Normal</option>
                      <option value="high">High Priority</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>{dispatchCategory === 'poll' ? 'Poll Question / Subject' : 'Message Title'}</label>
                  <input 
                    type="text" 
                    placeholder={dispatchCategory === 'poll' ? "e.g. Which movie should we add next?" : "e.g. Service Notice or Feature Release"} 
                    value={dispatchTitle}
                    onChange={(e) => setDispatchTitle(e.target.value)}
                    required
                    className="form-input"
                  />
                </div>

                {dispatchCategory === 'poll' && (
                  <div className="form-group poll-options-builder">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label style={{ margin: 0, fontWeight: '600', color: 'var(--text-primary)' }}>Poll Options (Minimum 2)</label>
                      {dispatchPollOptions.length < 8 && (
                        <button 
                          type="button" 
                          onClick={handleAddPollOption}
                          className="btn-add-option"
                        >
                          + Add Option
                        </button>
                      )}
                    </div>
                    <div className="poll-options-inputs">
                      {dispatchPollOptions.map((opt, idx) => (
                        <div key={idx} className="poll-option-input-row">
                          <span className="poll-option-badge">#{idx + 1}</span>
                          <input
                            type="text"
                            placeholder={`Option ${idx + 1}`}
                            value={opt}
                            onChange={(e) => handlePollOptionChange(idx, e.target.value)}
                            required
                            className="form-input flex-1"
                          />
                          {dispatchPollOptions.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemovePollOption(idx)}
                              className="btn-remove-option"
                              title="Remove Option"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>{dispatchCategory === 'poll' ? 'Poll Details (Optional)' : 'Message Content'}</label>
                  <textarea 
                    placeholder={dispatchCategory === 'poll' ? "Additional voter notes (optional)..." : "Enter full broadcast message..."} 
                    value={dispatchBody}
                    onChange={(e) => setDispatchBody(e.target.value)}
                    required={dispatchCategory !== 'poll'}
                    rows={dispatchCategory === 'poll' ? 2 : 4}
                    className="form-textarea"
                  />
                </div>

                <div className="dispatch-form-row">
                  <div className="form-group flex-2">
                    <label>Action URL (Optional)</label>
                    <input 
                      type="url" 
                      placeholder="https://..." 
                      value={dispatchActionUrl}
                      onChange={(e) => setDispatchActionUrl(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group flex-1">
                    <label>Retention / Expiration</label>
                    <select 
                      value={dispatchExpiryPreset} 
                      onChange={(e) => setDispatchExpiryPreset(e.target.value)}
                      className="form-input form-select"
                    >
                      <option value="1h">1 Hour</option>
                      <option value="24h">24 Hours</option>
                      <option value="3d">3 Days</option>
                      <option value="7d">7 Days</option>
                      <option value="perm">Permanent</option>
                      <option value="custom">Custom Date</option>
                    </select>
                  </div>
                </div>

                {dispatchExpiryPreset === 'custom' && (
                  <div className="form-group">
                    <label>Custom Expiration (AWST / Perth Time)</label>
                    <input
                      type="datetime-local"
                      value={dispatchCustomExpiry}
                      onChange={(e) => setDispatchCustomExpiry(e.target.value)}
                      required
                      className="form-input"
                    />
                  </div>
                )}

                <div className="dispatch-options-row">
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={dispatchSendPush} 
                      onChange={(e) => setDispatchSendPush(e.target.checked)} 
                    />
                    <span>Send FCM Push Notification to registered devices</span>
                  </label>
                </div>

                <div className="form-action-row">
                  {dispatchStatus === 'success' && <span className="status-msg success">{dispatchStatusMsg || '✓ Dispatched successfully!'}</span>}
                  {dispatchStatus === 'error' && <span className="status-msg error">{dispatchStatusMsg || '✕ Failed to dispatch'}</span>}
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={() => setShowDispatchModal(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={dispatchStatus === 'sending'}
                    className="btn btn-primary send-push-btn"
                  >
                    {dispatchStatus === 'sending' ? 'Dispatching...' : '🚀 Dispatch Now'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          2-WAY MESSAGE DETAIL & REPLY MODAL
         ======================================================== */}
      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content glass-panel message-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.4rem' }}>{getTypeIcon(selectedItem.type)}</span>
                <div>
                  <h2>Message Ticket</h2>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {selectedItem.id}</span>
                </div>
              </div>
              <button className="close-btn" onClick={() => setSelectedItem(null)} aria-label="Close details">✕</button>
            </div>

            <div className="modal-body modal-scrollable">
              {/* Meta Grid */}
              <div className="detail-group">
                <label>Target Application</label>
                <p style={{ fontWeight: '700', color: 'var(--accent-primary)' }}>{selectedItem.app || 'Unknown App'}</p>
              </div>

              <div className="detail-group">
                <label>Reported By / User</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <p>{selectedItem.user || selectedItem.sender || 'Anonymous'}</p>
                  {selectedItem.user && selectedItem.user.includes('@') && (
                    <a 
                      href={`mailto:${selectedItem.user}?subject=Regarding your ${selectedItem.app || 'Control Room'} feedback&body=Hi,\n\nRegarding your message: "${selectedItem.message}"\n\n`} 
                      className="email-direct-btn"
                      title="Send Direct Email"
                    >
                      ✉️ Email User
                    </a>
                  )}
                </div>
              </div>

              {/* Priority Control */}
              <div className="detail-group">
                <label>Priority</label>
                <div className="priority-select-group">
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <button 
                      key={p}
                      onClick={() => handleUpdatePriority(selectedItem, p)}
                      className={`priority-chip ${selectedItem.priority === p ? 'active ' + p : ''}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Control */}
              <div className="detail-group">
                <label>Ticket Status</label>
                <div className="status-progress-group">
                  {['unresolved', 'in_progress', 'resolved'].map(s => (
                    <button 
                      key={s}
                      onClick={() => handleUpdateStatus(selectedItem, s)}
                      className={`status-chip ${selectedItem.status === s || (!selectedItem.status && s === 'unresolved') ? 'active ' + s : ''}`}
                    >
                      {s.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Poll Vote Highlight if applicable */}
              {selectedItem.type === 'poll_vote' && selectedItem.selectedOption && (
                <div className="detail-group full-width poll-ticket-banner">
                  <label>Poll Vote Choice</label>
                  <div className="poll-choice-chip">
                    <span className="poll-choice-icon">🗳️</span>
                    <span className="poll-choice-val">{selectedItem.selectedOption}</span>
                    {selectedItem.pollTitle && (
                      <span className="poll-choice-sub">on &ldquo;{selectedItem.pollTitle}&rdquo;</span>
                    )}
                  </div>
                </div>
              )}

              {/* Original Message Container */}
              <div className="detail-group full-width">
                <label>Original User Message</label>
                <div className="message-box highlighted">
                  {selectedItem.message}
                </div>
              </div>

              {/* Conversation / Reply Thread History */}
              {Array.isArray(selectedItem.thread) && selectedItem.thread.length > 0 && (
                <div className="detail-group full-width">
                  <label>Conversation Thread ({selectedItem.thread.length})</label>
                  <div className="thread-list">
                    {selectedItem.thread.map((t, idx) => {
                      const tDate = t.timestamp ? new Date(t.timestamp) : null;
                      return (
                        <div key={idx} className="thread-item">
                          <div className="thread-item-header">
                            <span className="thread-author">👑 {t.author || 'Admin'}</span>
                            {tDate && (
                              <span className="thread-time">
                                {tDate.toLocaleDateString()} {tDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            )}
                          </div>
                          <p className="thread-content">{t.content}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2-Way Reply Composer */}
              <div className="detail-group full-width reply-composer-box">
                <label>Send Reply / Internal Note</label>
                
                {/* Quick Response Templates */}
                <div className="quick-templates-row">
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick templates:</span>
                  {QUICK_TEMPLATES.map((tmpl, idx) => (
                    <button 
                      key={idx}
                      type="button"
                      className="template-pill"
                      onClick={() => setReplyText(tmpl)}
                    >
                      {tmpl.slice(0, 32)}...
                    </button>
                  ))}
                </div>

                <textarea 
                  placeholder="Draft your reply to the user or record resolution steps..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  className="form-textarea"
                />

                <div className="reply-action-row">
                  {ticketActionStatus && (
                    <span className="status-msg success" style={{ marginRight: 'auto' }}>
                      {ticketActionStatus}
                    </span>
                  )}
                  <button 
                    type="button" 
                    disabled={!replyText.trim() || replySending}
                    onClick={() => handleSendReply(selectedItem, replyText, 'in_progress')}
                    className="btn btn-primary"
                    style={{ minHeight: '38px' }}
                  >
                    {replySending ? 'Sending...' : '💬 Send Reply & Update'}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button 
                className="btn-danger-outline" 
                onClick={() => handleDeleteTicket(selectedItem.id)}
              >
                Delete Ticket
              </button>
              <button className="btn btn-secondary" onClick={() => setSelectedItem(null)}>Close</button>
              {selectedItem.status !== 'resolved' ? (
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleUpdateStatus(selectedItem, 'resolved')}
                >
                  ✓ Mark as Resolved
                </button>
              ) : (
                <button 
                  className="btn btn-secondary" 
                  onClick={() => handleUpdateStatus(selectedItem, 'unresolved')}
                >
                  Re-open Ticket
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          ADMIN ENTRANCE MODAL
         ======================================================== */}
      {showAdminModal && (
        <div className="modal-overlay" onClick={() => setShowAdminModal(false)}>
          <div className="modal-content glass-panel admin-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem' }}>👑</span>
                <h2>Admin Entrance & Control</h2>
              </div>
              <button className="close-btn" onClick={() => setShowAdminModal(false)} aria-label="Close Admin Modal">✕</button>
            </div>
            
            <div className="modal-body admin-modal-body">
              {/* Status Banner */}
              <div className="admin-status-card glass-panel">
                <div className="admin-status-header">
                  <div className="status-pill-live">
                    <span className="live-pulsing-dot"></span>
                    <span>System Live</span>
                  </div>
                  <span className="admin-time-badge">🕒 Perth: {new Date().toLocaleTimeString('en-US', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                
                <div className="admin-metrics-grid">
                  <div className="admin-metric-item">
                    <span className="admin-metric-label">Total Messages</span>
                    <span className="admin-metric-val">{feedbackData.length}</span>
                  </div>
                  <div className="admin-metric-item">
                    <span className="admin-metric-label">Broadcasts</span>
                    <span className="admin-metric-val">{broadcasts.length}</span>
                  </div>
                  <div className="admin-metric-item">
                    <span className="admin-metric-label">Active Apps</span>
                    <span className="admin-metric-val">{APPS.length - 2}</span>
                  </div>
                  <div className="admin-metric-item">
                    <span className="admin-metric-label">Last Synced</span>
                    <span className="admin-metric-val" style={{ fontSize: '0.9rem' }}>{lastRefreshed}</span>
                  </div>
                </div>
              </div>

              {/* Authentication section if not unlocked */}
              {!isAdminAuthenticated ? (
                <div className="admin-auth-box">
                  <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Unlock Super Admin Controls</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Enter admin PIN to enable elevated system controls.
                  </p>
                  <form onSubmit={handleAdminAuthSubmit} className="admin-pin-form">
                    <input 
                      type="password" 
                      placeholder="Enter Admin PIN (e.g. 2026)" 
                      value={adminPinInput}
                      onChange={e => setAdminPinInput(e.target.value)}
                      className="form-input"
                      autoFocus
                    />
                    <button type="submit" className="btn btn-primary">
                      Unlock
                    </button>
                  </form>
                </div>
              ) : (
                <div className="admin-unlocked-section">
                  <div className="admin-badge-row">
                    <span className="badge badge-success">✓ Super Admin Authenticated</span>
                    <button onClick={handleAdminLogout} className="btn-link-danger">Log Out</button>
                  </div>

                  <div className="admin-quick-actions">
                    <label style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700' }}>Quick Actions</label>
                    <div className="admin-actions-grid">
                      <button onClick={handleManualRefresh} disabled={isSyncingFeeds} className="btn btn-secondary action-btn">
                        {isSyncingFeeds ? '🔄 Syncing Feeds...' : '🔄 Force Sync Feeds'}
                      </button>
                      <button 
                        onClick={() => {
                          setSearchQuery('');
                          setActiveFilter('all');
                          setAdminActionStatus('Filters Reset');
                          setTimeout(() => setAdminActionStatus(''), 2000);
                        }} 
                        className="btn btn-secondary action-btn"
                      >
                        🧹 Reset Filters & Search
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {adminActionStatus && (
                <div className="admin-status-toast">
                  {adminActionStatus}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAdminModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Action Center Instant Feedback Toast */}
      {actionToast && (
        <div className="action-toast-banner">
          <span>{actionToast}</span>
        </div>
      )}
    </div>
  );
}

export default App;

