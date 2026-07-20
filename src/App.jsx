import { useState, useMemo, useEffect } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';

const APPS = ['All Apps', 'Your Journey Your Tools', 'Your Journey Your Tools (Website)', 'PlexMePlease', 'Check It', 'Pred: Know Your Stats'];

function App() {
  const [activeTab, setActiveTab] = useState('All Apps');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [feedbackData, setFeedbackData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Analytics state
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // Push Notification state
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushStatus, setPushStatus] = useState('idle'); // idle, sending, success, error
  const [broadcasts, setBroadcasts] = useState([]);

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
    });
    return () => unsubscribe();
  }, []);

  // Fetch Firestore Broadcasts
  useEffect(() => {
    const q = query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data = [];
      querySnapshot.forEach((document) => {
        data.push({ id: document.id, ...document.data() });
      });
      setBroadcasts(data);
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
    
    return data;
  }, [activeFilter, activeTab, feedbackData]);

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

  const sendPushNotification = async (e) => {
    e.preventDefault();
    if (!pushTitle || !pushBody) return;
    
    setPushStatus('sending');
    try {
      const res = await fetch('/.netlify/functions/sendNotification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pushTitle,
          body: pushBody
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
          <div style={{ padding: '0.5rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Apps</div>
          {APPS.map(app => (
            <button 
              key={app}
              onClick={() => setActiveTab(app)}
              className={`nav-item ${activeTab === app ? 'active' : ''}`}
              style={{ width: '100%', textAlign: 'left', border: 'none', background: activeTab === app ? '' : 'transparent', cursor: 'pointer' }}
            >
              <span className="icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {app === 'All Apps' ? '📊' : 
                 app === 'PlexMePlease' ? <img src="/favicons/plexmeplease.png" alt="PlexMePlease" style={{ width: '24px', height: '24px', borderRadius: '6px' }} /> : 
                 app === 'Check It' ? <img src="/favicons/checkit.png" alt="Check It" style={{ width: '24px', height: '24px', borderRadius: '6px' }} /> :
                 app === 'Pred: Know Your Stats' ? <img src="/favicons/pred.png" alt="Pred" style={{ width: '24px', height: '24px', borderRadius: '6px' }} /> :
                 app === 'Your Journey Your Tools' ? <img src="/favicons/yjyt-app.png" alt="YJYT App" style={{ width: '24px', height: '24px', borderRadius: '6px' }} /> :
                 app === 'Your Journey Your Tools (Website)' ? <img src="/favicons/yjyt-website.png" alt="YJYT Website" style={{ width: '24px', height: '24px', borderRadius: '6px' }} /> : '✨'}
              </span> 
              {app}
            </button>
          ))}

        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-header">
          <div className="header-search">
            <input type="text" placeholder="Search across all apps..." className="search-input" />
          </div>
          <div className="header-actions">
            {/* Removed Bell and Admin Avatar as requested */}
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content">
          <div className="dashboard-header animate-fade-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1>{activeTab === 'All Apps' ? 'Overview' : activeTab}</h1>
              <p className="subtitle">Real-time metrics and analytics from your applications.</p>
            </div>
            {activeTab === 'Your Journey Your Tools (Website)' && (
              <a href="https://yourjourneyyourtools.com/" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                Visit Website <span style={{ fontSize: '1.2em' }}>↗</span>
              </a>
            )}
          </div>

          {/* App Tabs have been moved to the sidebar */}

          {/* Stats Grid */}
          <div className="stats-grid animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <div 
              className={`stat-card glass-panel clickable ${activeFilter === 'unresolved_bugs' ? 'active' : ''}`}
              onClick={() => setActiveFilter('unresolved_bugs')}
            >
              <div className="stat-icon warning">🐛</div>
              <div className="stat-info">
                <h3>Unresolved Bugs</h3>
                <p className="stat-value">{stats.unresolvedBugs}</p>
              </div>
            </div>
            <div 
              className={`stat-card glass-panel clickable ${activeFilter === 'new_today' ? 'active' : ''}`}
              onClick={() => setActiveFilter('new_today')}
            >
              <div className="stat-icon info">💬</div>
              <div className="stat-info">
                <h3>New Feedback Today</h3>
                <p className="stat-value">{stats.newFeedbackToday}</p>
              </div>
            </div>

            
            {/* Inject Google Analytics "New Users" Card when YJYT tab is selected */}
            {(activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') && (
              <div className="stat-card glass-panel">
                <div className="stat-icon primary">📈</div>
                <div className="stat-info">
                  <h3>New Users (7d)</h3>
                  {analyticsLoading ? (
                    <p className="stat-value" style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Loading...</p>
                  ) : analyticsError ? (
                    <p className="stat-value" style={{ fontSize: '1rem', color: 'var(--error-color)' }}>Error</p>
                  ) : (
                    <p className="stat-value">{analyticsData?.newUsersLast7Days || 0}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Google Analytics Top Pages (Only for YJYT) */}
          {(activeTab === 'Your Journey Your Tools' || activeTab === 'Your Journey Your Tools (Website)') && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.15s', marginTop: '24px' }}>
              <div className="section-header">
                <h2>Most Used Pages (Last 7 Days)</h2>
              </div>
              <div className="glass-panel" style={{ padding: '16px', borderRadius: '12px' }}>
                {analyticsLoading ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Fetching from Google Analytics...</div>
                ) : analyticsError ? (
                  <div style={{ textAlign: 'center', color: 'var(--error-color)' }}>{analyticsError}</div>
                ) : analyticsData?.topPages?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {analyticsData.topPages.map((page, index) => (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: index < analyticsData.topPages.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{page.title || 'Unknown Title'}</span>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{page.path}</span>
                        </div>
                        <div style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>
                          {page.views} views
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No page data available.</div>
                )}
              </div>
            </div>
          )}

          {/* Broadcast Push Notifications (Only for PlexMePlease) */}
          {activeTab === 'PlexMePlease' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.15s', marginTop: '24px' }}>
              <div className="section-header">
                <h2>📣 Send Broadcast Notification</h2>
              </div>
              <div className="glass-panel" style={{ padding: '16px', borderRadius: '12px' }}>
                <form onSubmit={sendPushNotification} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input 
                    type="text" 
                    placeholder="Notification Title (e.g. New Movie Added!)" 
                    value={pushTitle}
                    onChange={(e) => setPushTitle(e.target.value)}
                    required
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  />
                  <textarea 
                    placeholder="Notification Body (e.g. Inception is now available to stream on Plex.)" 
                    value={pushBody}
                    onChange={(e) => setPushBody(e.target.value)}
                    required
                    rows={3}
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
                    {pushStatus === 'success' && <span style={{ color: 'var(--success-color)' }}>Sent successfully!</span>}
                    {pushStatus === 'error' && <span style={{ color: 'var(--error-color)' }}>Failed to send</span>}
                    <button 
                      type="submit" 
                      disabled={pushStatus === 'sending'}
                      style={{
                        padding: '8px 24px',
                        borderRadius: '8px',
                        background: 'var(--accent-primary)',
                        color: 'white',
                        border: 'none',
                        cursor: pushStatus === 'sending' ? 'not-allowed' : 'pointer',
                        opacity: pushStatus === 'sending' ? 0.7 : 1,
                        fontWeight: 'bold'
                      }}
                    >
                      {pushStatus === 'sending' ? 'Sending...' : 'Send Push'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Past Broadcasts (Only for PlexMePlease) */}
          {activeTab === 'PlexMePlease' && (
            <div className="activity-section animate-fade-in" style={{ animationDelay: '0.2s', marginTop: '24px' }}>
              <div className="section-header">
                <h2>📬 Past Broadcasts</h2>
              </div>
              <div className="feed-list">
                {broadcasts.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No broadcasts sent yet.</div>
                ) : (
                  broadcasts.map(b => {
                    const dateObj = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || Date.now());
                    return (
                      <div key={b.id} className="feed-item glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="item-content" style={{ flex: 1 }}>
                          <div className="item-meta">
                            <span className="app-name">{b.title}</span>
                            <span className="time-ago">
                              {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                          </div>
                          <p className="item-message">{b.body}</p>
                        </div>
                        <button 
                          onClick={() => handleDeleteBroadcast(b.id)}
                          style={{
                            marginLeft: '16px',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            background: 'rgba(255, 59, 48, 0.1)',
                            color: '#ff3b30',
                            border: '1px solid rgba(255, 59, 48, 0.3)',
                            cursor: 'pointer',
                            fontWeight: '600'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Recent Activity Feed */}
          <div className="activity-section animate-fade-in" style={{ animationDelay: '0.2s', marginTop: '24px' }}>
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
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading live data...</div>
              ) : filteredData.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No feedback found for this selection.</div>
              ) : (
                filteredData.map(item => {
                  const dateObj = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || Date.now());
                  return (
                    <div 
                      key={item.id} 
                      className="feed-item glass-panel"
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
        </div>
      </main>

      {/* Detail Modal Overlay */}
      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Issue Details</h2>
              <button className="close-btn" onClick={() => setSelectedItem(null)}>✕</button>
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
