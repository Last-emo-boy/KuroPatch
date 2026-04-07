import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserScript } from '../../shared/types';
import { getScripts, updateScript, removeScript, addScript } from '../../shared/storage';

export default function Scripts({ onBack }: { onBack: () => void }) {
  const [scripts, setScripts] = useState<UserScript[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [runResult, setRunResult] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'all' | 'action' | 'toggle'>('all');
  const [importMsg, setImportMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setScripts(await getScripts());
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (id: string, msg: string) => {
    setRunResult(prev => ({ ...prev, [id]: msg }));
    setTimeout(() => setRunResult(prev => { const n = { ...prev }; delete n[id]; return n; }), 3000);
  };

  // --- Run (one-shot action) ---
  const handleRun = async (s: UserScript) => {
    try {
      const result: any = s.type === 'js'
        ? await chrome.runtime.sendMessage({ type: 'INJECT_JS', payload: { code: s.code } })
        : await chrome.runtime.sendMessage({ type: 'INJECT_CSS', payload: { css: s.code } });
      const msg = result?.error ? `✗ ${result.error}` : '✓ Done';
      flash(s.id, msg);
      await updateScript(s.id, { lastRunAt: Date.now(), lastRunResult: msg });
      await load();
    } catch (err: any) {
      flash(s.id, `✗ ${err.message}`);
    }
  };

  // --- Toggle on/off ---
  const handleToggleActive = async (s: UserScript) => {
    if (s.active) {
      // Turn OFF
      try {
        if (s.type === 'css') {
          // Remove CSS via chrome.scripting.removeCSS (background handles this)
          await chrome.runtime.sendMessage({
            type: 'REMOVE_CSS',
            payload: { css: s.code },
          });
        } else if (s.undoCode) {
          await chrome.runtime.sendMessage({ type: 'INJECT_JS', payload: { code: s.undoCode } });
        }
        flash(s.id, '○ OFF');
        await updateScript(s.id, { active: false, activeStyleId: undefined, lastRunAt: Date.now(), lastRunResult: '○ OFF' });
      } catch (err: any) { flash(s.id, `✗ ${err.message}`); }
    } else {
      // Turn ON — use chrome.scripting.insertCSS via background for CSS
      try {
        let result: any;
        if (s.type === 'css') {
          // Background will use chrome.scripting.insertCSS
          result = await chrome.runtime.sendMessage({ type: 'INJECT_CSS', payload: { css: s.code } });
        } else {
          result = await chrome.runtime.sendMessage({ type: 'INJECT_JS', payload: { code: s.code } });
        }
        const msg = result?.error ? `✗ ${result.error}` : '● ON';
        flash(s.id, msg);
        await updateScript(s.id, {
          active: !result?.error,
          lastRunAt: Date.now(),
          lastRunResult: msg,
        });
      } catch (err: any) { flash(s.id, `✗ ${err.message}`); }
    }
    await load();
  };

  const handleEnableToggle = async (id: string, enabled: boolean) => {
    await updateScript(id, { enabled: !enabled });
    await load();
  };

  const handleDelete = async (id: string) => {
    await removeScript(id);
    if (editing === id) setEditing(null);
    await load();
  };

  const handleEdit = (s: UserScript) => {
    setEditing(s.id);
    setEditCode(s.code);
    setEditName(s.name);
    setEditDesc(s.description);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    await updateScript(editing, { name: editName, description: editDesc, code: editCode });
    setEditing(null);
    await load();
  };

  // --- Export all scripts as JSON ---
  const handleExport = () => {
    if (scripts.length === 0) return;
    const data = JSON.stringify(scripts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kuropatch-scripts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Import scripts from JSON ---
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        let count = 0;
        for (const s of arr) {
          if (!s.name || !s.code || !s.type) continue;
          await addScript({
            ...s,
            id: crypto.randomUUID(),
            active: false,
            activeStyleId: undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastRunAt: undefined,
            lastRunResult: undefined,
          });
          count++;
        }
        setImportMsg(`✓ Imported ${count} script${count !== 1 ? 's' : ''}`);
        setTimeout(() => setImportMsg(''), 3000);
        await load();
      } catch {
        setImportMsg('✗ Invalid JSON file');
        setTimeout(() => setImportMsg(''), 3000);
      }
      // Reset input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  // Filtering by tab + text search
  let filtered = scripts;
  if (tab === 'action') filtered = filtered.filter(s => (s.mode || 'action') === 'action');
  if (tab === 'toggle') filtered = filtered.filter(s => s.mode === 'toggle');
  if (filter) {
    const q = filter.toLowerCase();
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)) ||
      s.type === q
    );
  }

  const actionCount = scripts.filter(s => (s.mode || 'action') === 'action').length;
  const toggleCount = scripts.filter(s => s.mode === 'toggle').length;
  const activeCount = scripts.filter(s => s.mode === 'toggle' && s.active).length;

  // ---- Editor view ----
  if (editing) {
    return (
      <div className="scripts-panel">
        <div className="scripts-header">
          <button className="btn secondary" onClick={() => setEditing(null)} style={{ padding: '4px 10px', fontSize: 11 }}>← Back</button>
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Edit Script</span>
          <button className="btn primary" onClick={handleSaveEdit} style={{ padding: '4px 12px', fontSize: 11 }}>Save</button>
        </div>
        <div className="script-editor">
          <input className="script-edit-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Script name" />
          <input className="script-edit-input" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" />
          <textarea className="script-code-editor" value={editCode} onChange={e => setEditCode(e.target.value)} spellCheck={false} />
        </div>
      </div>
    );
  }

  // ---- Main list view ----
  return (
    <div className="scripts-panel">
      <div className="scripts-header">
        <button className="btn secondary" onClick={onBack} style={{ padding: '4px 10px', fontSize: 11 }}>← Chat</button>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Scripts</span>
        <button className="script-action-btn" onClick={() => fileInputRef.current?.click()} title="Import scripts">⬆</button>
        <button className="script-action-btn" onClick={handleExport} title="Export scripts" disabled={scripts.length === 0}>⬇</button>
        <span className="scripts-count">{scripts.length}</span>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
      {importMsg && <div className={`script-import-msg${importMsg.startsWith('✓') ? ' ok' : ' err'}`}>{importMsg}</div>}

      {/* Mode tabs */}
      <div className="script-tabs">
        <button className={`script-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
          All <span className="script-tab-count">{scripts.length}</span>
        </button>
        <button className={`script-tab${tab === 'action' ? ' active' : ''}`} onClick={() => setTab('action')}>
          ⚡ Action <span className="script-tab-count">{actionCount}</span>
        </button>
        <button className={`script-tab${tab === 'toggle' ? ' active' : ''}`} onClick={() => setTab('toggle')}>
          ◐ Toggle <span className="script-tab-count">{toggleCount}</span>
          {activeCount > 0 && <span className="script-tab-active">{activeCount} on</span>}
        </button>
      </div>

      {/* Search filter */}
      {scripts.length > 3 && (
        <div className="scripts-filter">
          <input type="text" placeholder="Search scripts..." value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
      )}

      {/* Script list */}
      <div className="scripts-list">
        {filtered.length === 0 ? (
          <div className="scripts-empty">
            <div className="scripts-empty-icon">📜</div>
            <div className="scripts-empty-title">No scripts yet</div>
            <div className="scripts-empty-hint">
              Ask the AI to create one, e.g.<br/>
              "Hide all ads on this page and save as a script"
            </div>
          </div>
        ) : filtered.map(s => {
          const isToggle = s.mode === 'toggle';
          return (
            <div key={s.id} className={`script-card${!s.enabled ? ' disabled' : ''}${s.active ? ' active-card' : ''}`}>
              <div className="script-card-header">
                <div className="script-card-info">
                  <span className={`script-type-badge ${s.type}`}>{s.type.toUpperCase()}</span>
                  <span className={`script-mode-badge ${isToggle ? 'toggle' : 'action'}`}>
                    {isToggle ? '◐' : '⚡'}
                  </span>
                  <span className="script-card-name">{s.name}</span>
                </div>

                {/* Primary action: toggle switch vs run button */}
                {isToggle ? (
                  <button
                    className={`script-toggle-switch${s.active ? ' on' : ''}`}
                    onClick={() => handleToggleActive(s)}
                    title={s.active ? 'Turn OFF' : 'Turn ON'}
                  >
                    <span className="toggle-track"><span className="toggle-knob" /></span>
                  </button>
                ) : (
                  <button className="script-run-btn" onClick={() => handleRun(s)} title="Run">▶</button>
                )}
              </div>

              <div className="script-card-desc">{s.description}</div>

              <div className="script-card-meta">
                <span className="script-trigger-badge">{s.trigger}</span>
                {s.urlPattern && (
                  <span className="script-url-pattern" title={s.urlPattern}>
                    🔗 {s.urlPattern.length > 25 ? s.urlPattern.slice(0, 25) + '…' : s.urlPattern}
                  </span>
                )}
                {s.tags.map(t => <span key={t} className="script-tag">{t}</span>)}
              </div>

              {/* Result flash */}
              {runResult[s.id] && (
                <div className={`script-flash${
                  runResult[s.id].startsWith('✓') || runResult[s.id].startsWith('●') ? ' ok'
                  : runResult[s.id].startsWith('○') ? ' off'
                  : ' err'
                }`}>{runResult[s.id]}</div>
              )}

              {/* Footer: time + secondary actions */}
              <div className="script-card-footer">
                <span className="script-card-time">
                  {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'Never run'}
                </span>
                <div className="script-card-actions">
                  {isToggle && (
                    <button className="script-action-btn run" onClick={() => handleRun(s)} title="Force run">▶</button>
                  )}
                  <button className="script-action-btn" onClick={() => handleEdit(s)} title="Edit">✎</button>
                  <button
                    className={`script-action-btn${s.enabled ? ' enabled' : ''}`}
                    onClick={() => handleEnableToggle(s.id, s.enabled)}
                    title={s.enabled ? 'Disable' : 'Enable'}
                  >{s.enabled ? '●' : '○'}</button>
                  <button className="script-action-btn delete" onClick={() => handleDelete(s.id)} title="Delete">×</button>
                </div>
              </div>

              {/* Code preview (collapsible) */}
              <details className="script-code-preview">
                <summary>View Code</summary>
                <pre><code>{s.code}</code></pre>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
