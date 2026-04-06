import { useState, useEffect } from 'react';
import type { NetworkRequest } from '../../shared/types';

export default function Network({ onBack }: { onBack?: () => void }) {
  const [requests, setRequests] = useState<NetworkRequest[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showSlow, setShowSlow] = useState(false);
  const [selected, setSelected] = useState<NetworkRequest | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_NETWORK_REQUESTS' });
      if (Array.isArray(resp)) setRequests(resp);
    } catch (e) {
      console.warn('Failed to fetch requests:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    const interval = setInterval(fetchRequests, 3000);
    return () => clearInterval(interval);
  }, []);

  const filtered = requests.filter((r) => {
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (filter && !r.url.toLowerCase().includes(filter.toLowerCase())) return false;
    if (showSlow && r.duration < 500) return false;
    return true;
  });

  const failedCount = requests.filter((r) => r.failed).length;
  const slowCount = requests.filter((r) => r.duration >= 500).length;

  // Group by type
  const typeCounts: Record<string, number> = {};
  requests.forEach((r) => { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });

  return (
    <div style={{ padding: 10, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && <button className="btn secondary" onClick={onBack} style={{ padding: '4px 10px', fontSize: 11 }}>← Chat</button>}
          <h3>Network ({requests.length})</h3>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {failedCount > 0 && <span className="badge error">{failedCount} failed</span>}
          {slowCount > 0 && <span className="badge warning">{slowCount} slow</span>}
          <button className="btn secondary" onClick={fetchRequests} style={{ padding: '4px 8px', fontSize: 11 }}>↻</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input type="text" placeholder="Filter URL..." value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 90 }}>
          <option value="all">All</option>
          <option value="xhr">XHR</option>
          <option value="fetch">Fetch</option>
          <option value="script">Script</option>
          <option value="document">Doc</option>
          <option value="stylesheet">CSS</option>
          <option value="image">Image</option>
        </select>
      </div>

      {/* Type summary chips */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 6, flexWrap: 'wrap' }}>
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <span key={type} className="badge info" style={{ cursor: 'pointer', fontSize: 9 }} onClick={() => setTypeFilter(type)}>
            {type} ({count})
          </span>
        ))}
        {slowCount > 0 && (
          <span className={`badge ${showSlow ? 'warning' : ''}`} style={{ cursor: 'pointer', fontSize: 9 }} onClick={() => setShowSlow(!showSlow)}>
            🐌 slow ({slowCount})
          </span>
        )}
      </div>

      {selected ? (
        <RequestDetail request={selected} onBack={() => setSelected(null)} />
      ) : (
        <div className="request-list" style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🌐</div>
              <p>{loading ? 'Loading...' : 'No requests captured yet'}</p>
              <p style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
                Network capture uses Chrome Debugger API. Requests will appear as the page makes them.
              </p>
            </div>
          ) : (
            filtered.map((req) => (
              <div key={req.id} className="request-item" onClick={() => setSelected(req)}>
                <span className="method">{req.method}</span>
                <span className={`status ${req.failed ? 'fail' : req.status >= 200 && req.status < 400 ? 'ok' : req.status === 0 ? 'pending' : 'fail'}`}>
                  {req.status || '...'}
                </span>
                <span className="url" title={req.url}>{shortenUrl(req.url)}</span>
                {req.duration > 0 && (
                  <span className={`net-timing ${req.duration >= 500 ? 'slow' : ''}`}>{Math.round(req.duration)}ms</span>
                )}
                <span className="badge info" style={{ fontSize: 9 }}>{req.type}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RequestDetail({ request, onBack }: { request: NetworkRequest; onBack: () => void }) {
  return (
    <div>
      <button className="btn secondary" onClick={onBack} style={{ marginBottom: 8, padding: '4px 8px', fontSize: 11 }}>
        ← Back
      </button>
      <div className="card">
        <label>General</label>
        <div className="prop-row"><span className="prop-key">URL</span><span className="prop-value" style={{ wordBreak: 'break-all' }}>{request.url}</span></div>
        <div className="prop-row"><span className="prop-key">Method</span><span className="prop-value">{request.method}</span></div>
        <div className="prop-row"><span className="prop-key">Status</span><span className={`prop-value ${request.failed ? 'fail' : ''}`}>{request.status} {request.statusText}</span></div>
        <div className="prop-row"><span className="prop-key">Type</span><span className="prop-value">{request.type}</span></div>
        {request.duration > 0 && (
          <div className="prop-row"><span className="prop-key">Duration</span><span className="prop-value">{Math.round(request.duration)}ms</span></div>
        )}
      </div>

      {Object.keys(request.responseHeaders).length > 0 && (
        <div className="card">
          <label>Response Headers</label>
          {Object.entries(request.responseHeaders).slice(0, 20).map(([k, v]) => (
            <div className="prop-row" key={k}>
              <span className="prop-key">{k}</span>
              <span className="prop-value">{v}</span>
            </div>
          ))}
        </div>
      )}

      {request.responsePreview && (
        <div className="card">
          <label>Response Preview</label>
          <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{request.responsePreview}</pre>
        </div>
      )}
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url.slice(0, 80);
  }
}
