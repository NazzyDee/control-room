import { useState, useMemo, useEffect } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';

const APPS = ['All Apps', 'Your Journey Your Tools', 'Your Journey Your Tools (Website)', 'PlexMePlease', 'Check It', 'Pred: Know Your Stats', 'EpisodeFeed'];

function App() {
  const [activeTab, setActiveTab] = useState('All Apps');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [feedbackData, setFeedbackData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

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

  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushDuration, setPushDuration] = useState('');
  const [pushStatus, setPushStatus] = useState('idle'); // idle, sending, success, error
  const [broadcasts, setBroadcasts] = useState([]);

  // EpisodeFeed State
  const [episodeFeedUrl, setEpisodeFeedUrl] = useState(() => localStorage.getItem('episodeFeedUrl') || 'https://episodefeed.com/rss/2914/83aa73f4c985cb7bc96bc5d122bf4e494bbc671d');
  const [episodeFeedData, setEpisodeFeedData] = useState(null);
  const [episodeFeedLoading, setEpisodeFeedLoading] = useState(false);
  const [episodeFeedError, setEpisodeFeedError] = useState(null);

  // Fetch Firestore Feedback
  useEffect(() => {
    const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      setFeedbackData(data);
      setLoading(false);
      setLastRefreshed(new Date().toLocaleTimeString());
    }, (err) => {
      console.error("Firestore feedback error: ", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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

  const filteredData = useMemo(() => {
    let data = feedbackData;
    
    // 1. Filter by App Tab
    if (activeTab !== 'All Apps') {
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
        data = data.filter(item => item.status === activeFilter);
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
        (item.status && item.status.toLowerCase().includes(q))
      );
    }
    
    return data;
  }, [activeFilter, activeTab, feedbackData, searchQuery]);

  // Stats derived from live data for the currently selected app tab
  const stats = useMemo(() => {
    // Determine the base dataset for stats based on the active tab
    const dataForStats = activeTab === 'All Apps' 
      ? feedbackData 
      : feedbackData.filter(i => i.app === activeTab);

    const totalIssues = dataForStats.length;
    const unresolvedBugs = dataForStats.filter(i => i.type === 'bug' && i.status !== 'resolved').length;
    const newToday = dataForStats.filter(i => {
      if (!i.createdAt) return false;
      const date = i.createdAt?.toDate ? i.createdAt.toDate() : new Date(i.createdAt);
      const today = new Date();
      return date.getDate() === today.getDate() && 
             date.getMonth() === today.getMonth() && 
             date.getFullYear() === today.getFullYear();
    }).length;

    return {
      totalIssues,
      unresolvedBugs,
      newFeedbackToday: newToday,
    };
  }, [feedbackData, activeTab]);

  const markAsResolved = async (item) => {
    try {
      const itemRef = doc(db, 'feedback', item.id);
      await updateDoc(itemRef, {
        status: 'resolved'
      });
      setSelectedItem({ ...item, status: 'resolved' });
    } catch (error) {
      console.error("Error updating document: ", error);
    }
  };

  const handleDeleteBroadcast = async (id) => {
    if (!window.confirm("Are you sure you want to delete this broadcast? It will be removed from user inboxes.")) return;
    try {
      await deleteDoc(doc(db, 'broadcasts', id));
    } catch (err) {
      console.error("Error deleting broadcast:", err);
      alert("Failed to delete broadcast.");
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

  const sendPushNotification = async (e) => {
    e.preventDefault();
    if (!pushTitle || !pushBody) return;
    
    let expiresAt = null;
    if (pushDuration) {
       // datetime-local gives YYYY-MM-DDTHH:mm. Append seconds and +08:00 for Perth time
       expiresAt = new Date(`${pushDuration}:00+08:00`).getTime();
    }
    
    setPushStatus('sending');
    try {
      const res = await fetch('/.netlify/functions/sendNotification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pushTitle,
          body: pushBody,
          expiresAt: expiresAt
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      
      setPushStatus('success');
      setPushTitle('');
      setPushBody('');
      setTimeout(() => setPushStatus('idle'), 3000);
    } catch (err) {
      console.error(err);
      setPushStatus('error');
      setTimeout(() => setPushStatus('idle'), 3000);
    }
  };

  const handleAdminAuthSubmit = (e) => {
    e.preventDefault();
    // Simple PIN check for admin access (default PIN: 2026 or 1234)
    if (adminPinInput === '2026' || adminPinInput === '1234' || adminPinInput.trim() === 'admin') {
      setIsAdminAuthenticated(true);
      localStorage.setItem('control_room_admin_auth', 'true');
      setAdminPinInput('');
      setAdminActionStatus('Admin Mode Enabled ✨');
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

  const handleManualRefresh = () => {
    setLastRefreshed(new Date().toLocaleTimeString());
    setAdminActionStatus('Feeds synchronized!');
    setTimeout(() => setAdminActionStatus(''), 2000);
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'resolved': return 'badge-success';
      case 'unresolved': return 'badge-error';
      case 'in_progress': return 'badge-warning';
      default: return 'badge-info';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'bug': return '🐛';
      case 'feature_request': return '✨';
      case 'support': return '🔧';
      default: return '💬';
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">📡</div>
          <h2>Control Room</h2>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-title">Apps</div>
          {APPS.map(app => (
            <button 
              key={app}
              onClick={() => setActiveTab(app)}
              className={`nav-item ${activeTab === app ? 'active' : ''}`}
            >
               <span className="icon">
                {app === 'All Apps' ? '📊' : 
                 app === 'PlexMePlease' ? <img src="/favicons/plexmeplease.png" alt="PlexMePlease" /> : 
                 app === 'Check It' ? <img src="/favicons/checkit.png" alt="Check It" /> :
                 app === 'Pred: Know Your Stats' ? <img src="/favicons/pred.png" alt="Pred" /> :
                 app === 'Your Journey Your Tools' ? <img src="/favicons/yjyt-app.png" alt="YJYT App" /> :
                 app === 'Your Journey Your Tools (Website)' ? <img src="/favicons/yjyt-website.png" alt="YJYT Website" /> :
                 app === 'EpisodeFeed' ? '📺' : '✨'}
              </span> 
              <span className="nav-label">{app}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-header">
          <div className="header-brand-mobile">
            <div className="logo-icon">📡</div>
            <h2>Control Room</h2>
          </div>
          
          <div className="header-search">
            <span className="search-icon">🔍</span>
            <input 
              type="text" 
              placeholder="Search feedback, apps, issues..." 
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
            <button 
              className={`admin-entrance-btn ${isAdminAuthenticated ? 'authenticated' : ''}`}
              onClick={() => setShowAdminModal(true)}
              aria-label="Open Admin Entrance"
            >
              <span className="admin-avatar">👑</span>
              <span className="admin-text">{isAdminAuthenticated ? 'Admin' : 'Entrance'}</span>
              <span className="admin-status-dot" title="Live Connection Active"></span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content">
          <div className="dashboard-header animate-fade-in">
            <div className="dashboard-title-group">
              <h1>{activeTab === 'All Apps' ? 'Overview' : activeTab}</h1>
              <p className="subtitle">Real-time metrics and analytics across your applications.</p>
            </div>
            {activeTab === 'Your Journey Your Tools (Website)' && (
              <a href="https://yourjourneyyourtools.com/" target="_blank" rel="noopener noreferrer" className="btn btn-primary website-link-btn">
                <span>Visit Website</span> <span style={{ fontSize: '1.2em' }}>↗</span>
              </a>
            )}
          </div>

          {/* Stats Grid */}
          {activeTab !== 'EpisodeFeed' && (
            <div className="stats-grid animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <div 
                className={`stat-card glass-panel clickable ${activeFilter === 'unresolved_bugs' ? 'active' : ''}`}
                onClick={() => setActiveFilter(activeFilter === 'unresolved_bugs' ? 'all' : 'unresolved_bugs')}
              >
                <div className="stat-icon warning">🐛</div>
                <div className="stat-info">
                  <h3>Unresolved Bugs</h3>
                  <p className="stat-value">{stats.unresolvedBugs}</p>
                </div>
              </div>

              <div 
                className={`stat-card glass-panel clickable ${activeFilter === 'new_today' ? 'active' : ''}`}
                onClick={() => setActiveFilter(activeFilter === 'new_today' ? 'all' : 'new_today')}
              >
                <div className="stat-icon info">💬</div>
                <div className="stat-info">
                  <h3>New Feedback Today</h3>
                  <p className="stat-value">{stats.newFeedbackToday}</p>
                </div>
              </div>

              {/* Google Analytics "New Users" Card when YJYT tab is selected */}
              {(activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') && (
                <div className="stat-card glass-panel">
                  <div className="stat-icon primary">📈</div>
                  <div className="stat-info">
                    <h3>New Users (7d)</h3>
                    {analyticsLoading ? (
                      <p className="stat-value" style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>Loading...</p>
                    ) : analyticsError ? (
                      <p className="stat-value" style={{ fontSize: '1.1rem', color: 'var(--error-color)' }}>Error</p>
                    ) : (
                      <p className="stat-value">{analyticsData?.newUsersLast7Days || 0}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Google Analytics Top Pages (Only for YJYT) */}
          {(activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.15s' }}>
              <div className="section-header">
                <h2>Most Used Pages (Last 7 Days)</h2>
              </div>
              <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '12px' }}>
                {analyticsLoading ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Fetching from Google Analytics...</div>
                ) : analyticsError ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--error-color)' }}>{analyticsError}</div>
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

          {/* Broadcast Push Notifications (Only for PlexMePlease) */}
          {activeTab === 'PlexMePlease' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.15s' }}>
              <div className="section-header">
                <h2>📣 Send Broadcast Notification</h2>
              </div>
              <div className="glass-panel broadcast-form-panel">
                <form onSubmit={sendPushNotification} className="broadcast-form">
                  <div className="form-group">
                    <label>Notification Title</label>
                    <input 
                      type="text" 
                      placeholder="e.g. New Movie Added!" 
                      value={pushTitle}
                      onChange={(e) => setPushTitle(e.target.value)}
                      required
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Notification Body</label>
                    <textarea 
                      placeholder="e.g. Inception is now available to stream on Plex." 
                      value={pushBody}
                      onChange={(e) => setPushBody(e.target.value)}
                      required
                      rows={3}
                      className="form-textarea"
                    />
                  </div>

                  <div className="form-group">
                    <label>Auto-Delete Time (Perth Time / AWST)</label>
                    <input
                      type="datetime-local"
                      value={pushDuration}
                      onChange={(e) => setPushDuration(e.target.value)}
                      className="form-input"
                    />
                    <small style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Optional: Leave blank for permanent message</small>
                  </div>

                  <div className="form-action-row">
                    {pushStatus === 'success' && <span className="status-msg success">✓ Sent successfully!</span>}
                    {pushStatus === 'error' && <span className="status-msg error">✕ Failed to send</span>}
                    <button 
                      type="submit" 
                      disabled={pushStatus === 'sending'}
                      className="btn btn-primary send-push-btn"
                    >
                      {pushStatus === 'sending' ? 'Sending...' : 'Send Push Notification'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Past Broadcasts (Only for PlexMePlease) */}
          {activeTab === 'PlexMePlease' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="section-header">
                <h2>📬 Past Broadcasts</h2>
              </div>
              <div className="feed-list">
                {broadcasts.length === 0 ? (
                  <div className="glass-panel empty-state">No broadcasts sent yet.</div>
                ) : (
                  broadcasts.map(b => {
                    const dateObj = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || Date.now());
                    return (
                      <div key={b.id} className="feed-item glass-panel broadcast-item">
                        <div className="item-content">
                          <div className="item-meta">
                            <span className="app-name">{b.title}</span>
                            <span className="time-ago">
                              {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                          </div>
                          <p className="item-message">{b.body}</p>
                        </div>
                        <div className="item-action-end">
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
          )}

          {/* EpisodeFeed Section */}
          {activeTab === 'EpisodeFeed' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.15s' }}>
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

          {/* Recent Activity Feed (Hide when on EpisodeFeed) */}
          {activeTab !== 'EpisodeFeed' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="section-header">
                <h2>Recent Activity</h2>
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
                    className={`filter-btn ${activeFilter === 'resolved' ? 'active' : ''}`}
                    onClick={() => setActiveFilter('resolved')}
                  >Resolved</button>
                </div>
              </div>

              <div className="feed-list">
                {loading ? (
                  <div className="glass-panel empty-state">Loading live data...</div>
                ) : filteredData.length === 0 ? (
                  <div className="glass-panel empty-state">
                    {searchQuery ? `No feedback matching "${searchQuery}"` : 'No feedback found for this selection.'}
                  </div>
                ) : (
                  filteredData.map(item => {
                    const dateObj = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || Date.now());
                    return (
                      <div 
                        key={item.id} 
                        className="feed-item glass-panel activity-item"
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="item-icon">
                          {getTypeIcon(item.type)}
                        </div>
                        <div className="item-content">
                          <div className="item-meta">
                            <span className="app-name">{item.app || 'Unknown App'}</span>
                            <span className="time-ago">
                              {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                          </div>
                          <p className="item-message">{item.message}</p>
                          <div className="item-footer">
                            <span className="user-email">{item.user || 'Anonymous'}</span>
                            <span className={`badge ${getStatusBadgeClass(item.status || 'info')}`}>
                              {(item.status || 'info').replace('_', ' ')}
                            </span>
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

      {/* Admin Entrance Modal */}
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
                    <span className="admin-metric-label">Total Feedback</span>
                    <span className="admin-metric-val">{feedbackData.length}</span>
                  </div>
                  <div className="admin-metric-item">
                    <span className="admin-metric-label">Broadcasts</span>
                    <span className="admin-metric-val">{broadcasts.length}</span>
                  </div>
                  <div className="admin-metric-item">
                    <span className="admin-metric-label">Active Apps</span>
                    <span className="admin-metric-val">{APPS.length - 1}</span>
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
                  <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Unlock Admin Controls</h3>
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
                      <button onClick={handleManualRefresh} className="btn btn-secondary action-btn">
                        🔄 Force Sync Feeds
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

      {/* Detail Modal Overlay */}
      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Issue Details</h2>
              <button className="close-btn" onClick={() => setSelectedItem(null)} aria-label="Close details">✕</button>
            </div>
            <div className="modal-body">
              <div className="detail-group">
                <label>App</label>
                <p>{selectedItem.app || 'Unknown App'}</p>
              </div>
              <div className="detail-group">
                <label>Reported By</label>
                <p>{selectedItem.user || 'Anonymous'}</p>
              </div>
              <div className="detail-group">
                <label>Type & Priority</label>
                <p>{selectedItem.type} - <strong>{selectedItem.priority || 'Normal'}</strong></p>
              </div>
              <div className="detail-group">
                <label>Status</label>
                <div>
                  <span className={`badge ${getStatusBadgeClass(selectedItem.status || 'info')}`}>
                    {(selectedItem.status || 'info').replace('_', ' ')}
                  </span>
                </div>
              </div>
              <div className="detail-group full-width">
                <label>Message</label>
                <div className="message-box">
                  {selectedItem.message}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedItem(null)}>Close</button>
              {selectedItem.status !== 'resolved' && (
                <button className="btn btn-primary" onClick={() => markAsResolved(selectedItem)}>
                  Mark as Resolved
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
