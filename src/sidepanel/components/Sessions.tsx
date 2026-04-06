import { useState, useEffect, useCallback } from 'react';
import type { Session } from '../../shared/types';
import { getSessions, addSession, updateSession, removeSession, getCurrentSessionId, setCurrentSessionId } from '../../shared/storage';

export default function Sessions({ onBack }: { onBack?: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');

  const refresh = useCallback(async () => {
    setSessions(await getSessions());
    setCurrentId(await getCurrentSessionId());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createSession = async () => {
    // Get current page info
    let url = '';
    let title = '';
    try {
      const ctx = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
      if (ctx) {
        url = (ctx as any).url || '';
        title = (ctx as any).title || '';
      }
    } catch {}

    const session: Session = {
      id: `sess_${Date.now()}`,
      name: title || 'Untitled Session',
      url,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      patches: [],
      actions: [],
      aiSummary: '',
      notes: '',
      errorSnapshot: [],
      networkSnapshot: { failed: 0, slow: 0, total: 0 },
    };
    await addSession(session);
    await setCurrentSessionId(session.id);
    await refresh();
  };

  const switchSession = async (id: string) => {
    await setCurrentSessionId(id);
    setCurrentId(id);
  };

  const deleteSession = async (id: string) => {
    await removeSession(id);
    if (currentId === id) {
      await setCurrentSessionId(null as any);
      setCurrentId(null);
    }
    await refresh();
  };

  const saveNotes = async (id: string) => {
    await updateSession(id, { notes: editNotes, updatedAt: Date.now() });
    setEditingId(null);
    await refresh();
  };

  const exportSession = (session: Session) => {
    const lines = [
      `# Session: ${session.name}`,
      `URL: ${session.url}`,
      `Created: ${new Date(session.createdAt).toLocaleString()}`,
      `Updated: ${new Date(session.updatedAt).toLocaleString()}`,
      '',
    ];

    if (session.aiSummary) {
      lines.push('## AI Summary', session.aiSummary, '');
    }

    if (session.notes) {
      lines.push('## Notes', session.notes, '');
    }

    if (session.patches.length > 0) {
      lines.push('## Patches');
      session.patches.forEach((p) => {
        lines.push(`- [${p.type}] ${p.description} (${p.target})`);
      });
      lines.push('');
    }

    if (session.actions.length > 0) {
      lines.push('## Actions');
      session.actions.forEach((a) => {
        lines.push(`- [${a.type}] ${a.description}${a.result ? ` → ${a.result}` : ''}`);
      });
      lines.push('');
    }

    if (session.errorSnapshot.length > 0) {
      lines.push('## Errors');
      session.errorSnapshot.forEach((e) => lines.push(`- ${e}`));
      lines.push('');
    }

    lines.push(`## Network: ${session.networkSnapshot.total} total, ${session.networkSnapshot.failed} failed, ${session.networkSnapshot.slow} slow`);

    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${session.name.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = (session: Session) => {
    const text = JSON.stringify(session, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${session.name.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && <button className="btn secondary" onClick={onBack} style={{ padding: '4px 10px', fontSize: 11 }}>← Chat</button>}
          <h3>Sessions ({sessions.length})</h3>
        </div>
        <button className="btn" onClick={createSession} style={{ padding: '4px 10px', fontSize: 11 }}>+ New Session</button>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="icon">💾</div>
          <p>No sessions saved</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Create a session to save debugging context, patches, and notes.
          </p>
        </div>
      ) : (
        sessions.sort((a, b) => b.updatedAt - a.updatedAt).map((session) => {
          const isCurrent = session.id === currentId;
          const isEditing = editingId === session.id;

          return (
            <div key={session.id} className="card" style={{ padding: 10, marginBottom: 6, borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: isCurrent ? 'var(--accent)' : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{session.name}</span>
                    {isCurrent && <span className="badge info">active</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {session.url ? new URL(session.url).hostname : 'no url'}
                    {' · '}
                    {new Date(session.updatedAt).toLocaleString()}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 10, color: 'var(--text-dim)' }}>
                    <span>{session.patches.length} patches</span>
                    <span>{session.actions.length} actions</span>
                    {session.errorSnapshot.length > 0 && <span style={{ color: 'var(--error)' }}>{session.errorSnapshot.length} errors</span>}
                  </div>
                </div>
              </div>

              {/* Notes editing */}
              {isEditing ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder="Session notes..."
                    style={{ fontSize: 11, width: '100%' }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button className="btn" onClick={() => saveNotes(session.id)} style={{ padding: '3px 8px', fontSize: 10 }}>Save</button>
                    <button className="btn secondary" onClick={() => setEditingId(null)} style={{ padding: '3px 8px', fontSize: 10 }}>Cancel</button>
                  </div>
                </div>
              ) : session.notes ? (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '6px 8px', borderRadius: 'var(--radius)', cursor: 'pointer' }} onClick={() => { setEditingId(session.id); setEditNotes(session.notes); }}>
                  {session.notes}
                </div>
              ) : null}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                {!isCurrent && (
                  <button className="btn secondary" onClick={() => switchSession(session.id)} style={{ padding: '3px 8px', fontSize: 10 }}>🔄 Activate</button>
                )}
                <button className="btn secondary" onClick={() => { setEditingId(session.id); setEditNotes(session.notes); }} style={{ padding: '3px 8px', fontSize: 10 }}>📝 Notes</button>
                <button className="btn secondary" onClick={() => exportSession(session)} style={{ padding: '3px 8px', fontSize: 10 }}>📋 Export MD</button>
                <button className="btn secondary" onClick={() => exportJSON(session)} style={{ padding: '3px 8px', fontSize: 10 }}>📦 JSON</button>
                <button className="btn secondary" onClick={() => deleteSession(session.id)} style={{ padding: '3px 8px', fontSize: 10, color: 'var(--error)' }}>🗑️ Delete</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
