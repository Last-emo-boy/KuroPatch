import { useState, useEffect } from 'react';
import type { Patch, PatchCategory } from '../../shared/types';

const TYPE_COLORS: Record<string, string> = {
  style: 'var(--accent)',
  dom: 'var(--success)',
  js: 'var(--warning)',
  css: 'var(--accent)',
  event: '#e879f9',
};

const CAT_ICONS: Record<PatchCategory, string> = {
  visual: '🎨',
  behavior: '⚡',
  content: '✏️',
  debug: '🐛',
};

export default function Patches() {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [catFilter, setCatFilter] = useState<string>('all');

  const fetchPatches = async () => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_PATCHES' });
      if (Array.isArray(resp)) setPatches(resp);
    } catch {}
  };

  useEffect(() => { fetchPatches(); }, []);

  const togglePatch = async (id: string, enabled: boolean) => {
    await chrome.runtime.sendMessage({ type: 'TOGGLE_PATCH', payload: { id, enabled } });
    setPatches((prev) => prev.map((p) => p.id === id ? { ...p, enabled } : p));
  };

  const rollback = async (id: string) => {
    await chrome.runtime.sendMessage({ type: 'ROLLBACK_PATCH', payload: id });
    setPatches((prev) => prev.filter((p) => p.id !== id));
  };

  const rollbackAll = async () => {
    await chrome.runtime.sendMessage({ type: 'ROLLBACK_ALL' });
    setPatches([]);
  };

  const exportPatches = () => {
    const text = patches
      .map((p) => `[${p.type.toUpperCase()}] ${p.description}\nCategory: ${p.category || 'visual'}\nTarget: ${p.target}\nBefore: ${p.before}\nAfter: ${p.after}\nEnabled: ${p.enabled !== false}\n`)
      .join('\n---\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kuropatch-export-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = catFilter === 'all' ? patches : patches.filter((p) => (p.category || 'visual') === catFilter);
  const enabledCount = patches.filter((p) => p.enabled !== false).length;

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3>Patches ({patches.length}){enabledCount < patches.length && <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400 }}> · {enabledCount} active</span>}</h3>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {patches.length > 0 && (
            <>
              <button className="btn secondary" onClick={exportPatches} style={{ padding: '4px 8px', fontSize: 11 }}>📋</button>
              <button className="btn danger" onClick={rollbackAll} style={{ padding: '4px 8px', fontSize: 11 }}>↩ Reset</button>
            </>
          )}
        </div>
      </div>

      {/* Category filter */}
      {patches.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className={`badge ${catFilter === 'all' ? 'info' : ''}`} onClick={() => setCatFilter('all')} style={{ cursor: 'pointer', border: 'none' }}>all</button>
          {(['visual', 'behavior', 'content', 'debug'] as PatchCategory[]).map((cat) => (
            <button key={cat} className={`badge ${catFilter === cat ? 'info' : ''}`} onClick={() => setCatFilter(cat)} style={{ cursor: 'pointer', border: 'none' }}>
              {CAT_ICONS[cat]} {cat}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🩹</div>
          <p>{patches.length === 0 ? 'No patches applied yet' : 'No patches in this category'}</p>
          <p style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
            Modifications made through Inspect or Chat will appear here.
          </p>
        </div>
      ) : (
        filtered.map((patch) => {
          const enabled = patch.enabled !== false;
          return (
            <div key={patch.id} className="card" style={{ padding: 8, opacity: enabled ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {/* Enable/Disable toggle */}
                    <div
                      className={`toggle-switch${enabled ? ' on' : ''}`}
                      onClick={() => togglePatch(patch.id, !enabled)}
                      style={{ width: 28, height: 16, flexShrink: 0 }}
                    />
                    <span className="badge" style={{ background: `${TYPE_COLORS[patch.type] || 'var(--accent)'}22`, color: TYPE_COLORS[patch.type] || 'var(--accent)' }}>
                      {patch.type}
                    </span>
                    {patch.category && <span style={{ fontSize: 10 }}>{CAT_ICONS[patch.category]}</span>}
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{patch.description}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', paddingLeft: 34 }}>
                    {patch.target}
                  </div>
                </div>
                <button className="btn secondary" onClick={() => rollback(patch.id)} style={{ padding: '2px 8px', fontSize: 10, flexShrink: 0 }}>↩</button>
              </div>

              {/* Diff */}
              <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)', paddingLeft: 34 }}>
                <div style={{ color: 'var(--error)', background: 'rgba(244,67,54,0.08)', padding: '2px 6px', borderRadius: 3 }}>
                  - {patch.before.slice(0, 120)}
                </div>
                <div style={{ color: 'var(--success)', background: 'rgba(76,175,80,0.08)', padding: '2px 6px', borderRadius: 3, marginTop: 2 }}>
                  + {patch.after.slice(0, 120)}
                </div>
              </div>

              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)', paddingLeft: 34 }}>
                {new Date(patch.timestamp).toLocaleTimeString()}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
