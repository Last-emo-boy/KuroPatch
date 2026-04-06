import { useState, useEffect, useCallback } from 'react';
import type { HookEvent, HookConfig, HookSummary } from '../../shared/types';

const DEFAULT_CONFIG: HookConfig = {
  fetch: true,
  xhr: true,
  console: true,
  errors: true,
  domMutation: true,
  scriptInject: true,
  events: false,
  navigation: true,
  timers: false,
};

const HOOK_LABELS: Record<keyof HookConfig, { icon: string; label: string }> = {
  fetch: { icon: '🌐', label: 'Fetch' },
  xhr: { icon: '📡', label: 'XHR' },
  console: { icon: '📋', label: 'Console' },
  errors: { icon: '❌', label: 'Errors' },
  domMutation: { icon: '🔄', label: 'DOM Mutations' },
  scriptInject: { icon: '📜', label: 'Script Inject' },
  events: { icon: '🖱️', label: 'Events' },
  navigation: { icon: '🧭', label: 'Navigation' },
  timers: { icon: '⏱️', label: 'Timers' },
};

type ViewMode = 'feed' | 'summary' | 'config';

export default function Hooks({ onBack }: { onBack?: () => void }) {
  const [events, setEvents] = useState<HookEvent[]>([]);
  const [config, setConfig] = useState<HookConfig>(DEFAULT_CONFIG);
  const [injected, setInjected] = useState(false);
  const [summary, setSummary] = useState<HookSummary | null>(null);
  const [view, setView] = useState<ViewMode>('feed');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchEvents = useCallback(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_HOOK_EVENTS' });
      if (Array.isArray(resp)) setEvents(resp);
    } catch {}
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_HOOK_SUMMARY' });
      if (resp && !(resp as any).error) setSummary(resp as HookSummary);
    } catch {}
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(() => {
      fetchEvents();
      if (view === 'summary') fetchSummary();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchEvents, fetchSummary, view]);

  const inject = async () => {
    await chrome.runtime.sendMessage({ type: 'INJECT_HOOKS', payload: config });
    setInjected(true);
    setTimeout(fetchEvents, 500);
  };

  const clearEvents = async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HOOKS' });
    setEvents([]);
    setSummary(null);
  };

  const toggleConfigKey = (key: keyof HookConfig) => {
    setConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filtered = typeFilter === 'all' ? events : events.filter((e) => e.type === typeFilter);
  const eventTypes = [...new Set(events.map((e) => e.type))];

  return (
    <div style={{ padding: 10, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && <button className="btn secondary" onClick={onBack} style={{ padding: '4px 10px', fontSize: 11 }}>← Chat</button>}
          <h3>Hooks ({events.length})</h3>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {!injected ? (
            <button className="btn" onClick={inject} style={{ padding: '4px 10px', fontSize: 11 }}>
              🪝 Start Hooks
            </button>
          ) : (
            <>
              <button className="btn secondary" onClick={fetchEvents} style={{ padding: '4px 8px', fontSize: 11 }}>↻</button>
              <button className="btn secondary" onClick={clearEvents} style={{ padding: '4px 8px', fontSize: 11 }}>🗑️</button>
            </>
          )}
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="hooks-view-tabs">
        {(['feed', 'summary', 'config'] as ViewMode[]).map((v) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => { setView(v); if (v === 'summary') fetchSummary(); }}>
            {v === 'feed' ? '📋 Feed' : v === 'summary' ? '📊 Summary' : '⚙ Config'}
          </button>
        ))}
      </div>

      {/* Config View */}
      {view === 'config' && (
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
          {(Object.keys(HOOK_LABELS) as (keyof HookConfig)[]).map((key) => (
            <div className="toggle" key={key}>
              <span style={{ fontSize: 12 }}>
                {HOOK_LABELS[key].icon} {HOOK_LABELS[key].label}
              </span>
              <div
                className={`toggle-switch${config[key] ? ' on' : ''}`}
                onClick={() => toggleConfigKey(key)}
              />
            </div>
          ))}
          {injected && (
            <button className="btn" onClick={inject} style={{ width: '100%', marginTop: 12 }}>
              🔄 Re-inject with new config
            </button>
          )}
        </div>
      )}

      {/* Summary View */}
      {view === 'summary' && (
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
          {!summary ? (
            <div className="empty-state">
              <div className="icon">📊</div>
              <p>No summary yet</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Start hooks and wait for events.</p>
            </div>
          ) : (
            <>
              <div className="hook-summary-grid">
                <SummaryCard label="Total" value={summary.totalEvents} color="var(--accent)" />
                <SummaryCard label="Fetch" value={summary.fetchCount} color="var(--success)" />
                <SummaryCard label="XHR" value={summary.xhrCount} color="var(--success)" />
                <SummaryCard label="DOM" value={summary.domMutationCount} color="var(--warning)" />
                <SummaryCard label="Scripts" value={summary.scriptInjectCount} color="var(--warning)" />
                <SummaryCard label="Errors" value={summary.errorCount} color="var(--error)" />
                <SummaryCard label="Nav" value={summary.navigationCount} color="var(--accent)" />
                <SummaryCard label="Timers" value={summary.timerCount} color="var(--text-muted)" />
              </div>

              {summary.topMutatedSelectors.length > 0 && (
                <div className="card" style={{ marginTop: 8 }}>
                  <label>Top Mutated Selectors</label>
                  {summary.topMutatedSelectors.map((s, i) => (
                    <div className="prop-row" key={i}>
                      <span className="prop-key mono" style={{ minWidth: 30 }}>{s.count}×</span>
                      <span className="prop-value mono">{s.selector}</span>
                    </div>
                  ))}
                </div>
              )}

              {summary.recentErrors.length > 0 && (
                <div className="card" style={{ marginTop: 8 }}>
                  <label>Recent Errors</label>
                  {summary.recentErrors.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--error)', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                      {e}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Feed View */}
      {view === 'feed' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Type filter */}
          {eventTypes.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6, paddingTop: 4 }}>
              <button
                className={`badge ${typeFilter === 'all' ? 'info' : ''}`}
                onClick={() => setTypeFilter('all')}
                style={{ cursor: 'pointer', border: 'none' }}
              >
                all
              </button>
              {eventTypes.map((t) => (
                <button
                  key={t}
                  className={`badge ${typeFilter === t ? 'info' : ''}`}
                  onClick={() => setTypeFilter(t)}
                  style={{ cursor: 'pointer', border: 'none' }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🪝</div>
                <p>{injected ? 'No events yet' : 'Hooks not started'}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {injected ? 'Events will appear as the page runs.' : 'Click "Start Hooks" to begin capturing.'}
                </p>
              </div>
            ) : (
              filtered.slice(-200).reverse().map((evt) => (
                <HookEventItem key={evt.id} event={evt} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="summary-card" style={{ borderColor: value > 0 ? color : 'var(--border)' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: value > 0 ? color : 'var(--text-dim)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

const TYPE_ICONS: Record<string, string> = {
  fetch: '🌐',
  xhr: '📡',
  console: '📋',
  error: '❌',
  'dom-mutation': '🔄',
  'script-inject': '📜',
  event: '🖱️',
  navigation: '🧭',
  timer: '⏱️',
};

function HookEventItem({ event }: { event: HookEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="hook-event-item" onClick={() => setExpanded(!expanded)}>
      <div className="hook-event-header">
        <span className="hook-type-icon">{TYPE_ICONS[event.type] || '🔧'}</span>
        <span className={`badge ${event.type === 'error' ? 'error' : 'info'}`}>{event.type}</span>
        <span className="hook-event-summary">{event.summary}</span>
        <span className="hook-event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
      </div>
      {expanded && event.detail && (
        <pre className="hook-event-detail">{JSON.stringify(event.detail, null, 2)}</pre>
      )}
    </div>
  );
}
