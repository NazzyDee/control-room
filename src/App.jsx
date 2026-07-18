import { useState, useMemo, useEffect } from 'react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';

function App() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [feedbackData, setFeedbackData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Stats derived from live data
  const stats = useMemo(() => {
    const totalIssues = feedbackData.length;
    const unresolvedBugs = feedbackData.filter(i => i.type === 'bug' && i.status !== 'resolved').length;
    const newToday = feedbackData.filter(i => {
      // Assuming createdAt is a timestamp or string
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
  }, [feedbackData]);

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

  const filteredData = useMemo(() => {
    if (activeFilter === 'all') return feedbackData;
    return feedbackData.filter(item => item.status === activeFilter);
  }, [activeFilter, feedbackData]);

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
            <span className="icon">📱</span> Apps Integration
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
            <p className="subtitle">Real-time metrics from all your connected applications.</p>
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
          </div>

          {/* Recent Activity Feed */}
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
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading live data...</div>
              ) : filteredData.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No feedback found.</div>
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
