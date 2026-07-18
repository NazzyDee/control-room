import { useState, useMemo, useEffect } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';

const APPS = ['All Apps', 'Your Journey Your Tools', 'PlexMePlease'];

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

  // Fetch GA4 Analytics when the YJYT tab is selected
  useEffect(() => {
    if (activeTab === 'Your Journey Your Tools') {
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
      data = data.filter(item => item.status === activeFilter);
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
          <a href="#" className="nav-item active">
            <span className="icon">📊</span> Dashboard
          </a>
          <a href="#" className="nav-item">
            <span className="icon">📥</span> Inbox <span className="nav-badge">{feedbackData.filter(i => i.status === 'unresolved').length}</span>
          </a>
          <a href="#" className="nav-item">
            <span className="icon">⚙️</span> Settings
          </a>
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
            <button className="icon-btn">🔔</button>
            <div className="avatar">Admin</div>
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content">
          <div className="dashboard-header animate-fade-in">
            <h1>Overview</h1>
            <p className="subtitle">Real-time metrics and analytics from your applications.</p>
          </div>

          {/* App Tabs */}
          <div className="app-tabs animate-fade-in" style={{ animationDelay: '0.05s', display: 'flex', gap: '10px', marginBottom: '24px' }}>
            {APPS.map(app => (
              <button 
                key={app}
                onClick={() => setActiveTab(app)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: activeTab === app ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                  color: activeTab === app ? 'white' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: activeTab === app ? '600' : '400',
                  transition: 'all 0.2s ease'
                }}
              >
                {app}
              </button>
            ))}
          </div>

          {/* Stats Grid */}
          <div className="stats-grid animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <div className="stat-card glass-panel">
              <div className="stat-icon warning">🐛</div>
              <div className="stat-info">
                <h3>Unresolved Bugs</h3>
                <p className="stat-value">{stats.unresolvedBugs}</p>
              </div>
            </div>
            <div className="stat-card glass-panel">
              <div className="stat-icon info">💬</div>
              <div className="stat-info">
                <h3>New Feedback Today</h3>
                <p className="stat-value">{stats.newFeedbackToday}</p>
              </div>
            </div>
            <div className="stat-card glass-panel">
              <div className="stat-icon success">📥</div>
              <div className="stat-info">
                <h3>Total Issues Logged</h3>
                <p className="stat-value">{stats.totalIssues}</p>
              </div>
            </div>
            
            {/* Inject Google Analytics "New Users" Card when YJYT tab is selected */}
            {activeTab === 'Your Journey Your Tools' && (
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
          {activeTab === 'Your Journey Your Tools' && (
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
