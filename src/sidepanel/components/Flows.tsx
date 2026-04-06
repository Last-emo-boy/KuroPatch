import { useState, useEffect, useCallback } from 'react';
import type { Flow, FlowStep, AutomationAction } from '../../shared/types';
import { getFlows, addFlow, updateFlow, removeFlow } from '../../shared/storage';

type FlowView = 'list' | 'editor' | 'running';

const ACTION_TEMPLATES: { label: string; action: AutomationAction }[] = [
  { label: 'Click', action: { type: 'click', selector: '' } },
  { label: 'Type text', action: { type: 'input', selector: '', value: '' } },
  { label: 'Select option', action: { type: 'select', selector: '', value: '' } },
  { label: 'Scroll to', action: { type: 'scrollToElement', selector: '' } },
  { label: 'Wait for', action: { type: 'waitForSelector', selector: '', timeout: 5000 } },
  { label: 'Read text', action: { type: 'readText', selector: '' } },
  { label: 'Key press', action: { type: 'keyboard', key: 'Enter' } },
  { label: 'Check exists', action: { type: 'checkExists', selector: '' } },
  { label: 'Check text', action: { type: 'checkTextContains', selector: '', text: '' } },
  { label: 'Delay', action: { type: 'wait', ms: 1000 } },
];

export default function Flows({ onBack }: { onBack?: () => void }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [view, setView] = useState<FlowView>('list');
  const [editFlow, setEditFlow] = useState<Flow | null>(null);
  const [runningFlow, setRunningFlow] = useState<Flow | null>(null);

  const refresh = useCallback(async () => {
    setFlows(await getFlows());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createNew = () => {
    const flow: Flow = {
      id: `flow_${Date.now()}`,
      name: 'New Flow',
      description: '',
      steps: [],
      createdAt: Date.now(),
    };
    setEditFlow(flow);
    setView('editor');
  };

  const saveFlow = async (flow: Flow) => {
    const existing = flows.find((f) => f.id === flow.id);
    if (existing) {
      await updateFlow(flow.id, flow);
    } else {
      await addFlow(flow);
    }
    await refresh();
    setView('list');
    setEditFlow(null);
  };

  const deleteFlow = async (id: string) => {
    await removeFlow(id);
    await refresh();
  };

  const startRun = (flow: Flow) => {
    const running: Flow = {
      ...flow,
      steps: flow.steps.map((s) => ({ ...s, status: 'pending' as const, result: undefined, error: undefined, duration: undefined })),
    };
    setRunningFlow(running);
    setView('running');
    executeFlow(running);
  };

  const executeFlow = async (flow: Flow) => {
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      step.status = 'running';
      setRunningFlow({ ...flow, steps: [...flow.steps] });

      const start = Date.now();
      try {
        const result = await chrome.runtime.sendMessage({ type: 'AUTOMATE', payload: step.action });
        step.duration = Date.now() - start;
        if ((result as any)?.error) {
          step.status = 'failed';
          step.error = (result as any).error;
          if (!step.continueOnError) break;
        } else {
          step.status = 'success';
          step.result = typeof result === 'string' ? result : JSON.stringify(result);
        }
      } catch (err: any) {
        step.duration = Date.now() - start;
        step.status = 'failed';
        step.error = err.message;
        if (!step.continueOnError) break;
      }
      setRunningFlow({ ...flow, steps: [...flow.steps] });
    }

    // Mark remaining as skipped
    for (const step of flow.steps) {
      if (step.status === 'pending') step.status = 'skipped';
    }

    const allSuccess = flow.steps.every((s) => s.status === 'success');
    const someFailed = flow.steps.some((s) => s.status === 'failed');
    const status = allSuccess ? 'success' : someFailed ? (flow.steps.some((s) => s.status === 'success') ? 'partial' : 'failed') : 'success';

    await updateFlow(flow.id, { lastRunAt: Date.now(), lastRunStatus: status });
    setRunningFlow({ ...flow, steps: [...flow.steps] });
    await refresh();
  };

  if (view === 'editor' && editFlow) {
    return <FlowEditor flow={editFlow} onSave={saveFlow} onCancel={() => { setView('list'); setEditFlow(null); }} />;
  }

  if (view === 'running' && runningFlow) {
    return <FlowRunner flow={runningFlow} onBack={() => { setView('list'); setRunningFlow(null); }} />;
  }

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && <button className="btn secondary" onClick={onBack} style={{ padding: '4px 10px', fontSize: 11 }}>← Chat</button>}
          <h3>Flows ({flows.length})</h3>
        </div>
        <button className="btn" onClick={createNew} style={{ padding: '4px 10px', fontSize: 11 }}>+ New Flow</button>
      </div>

      {flows.length === 0 ? (
        <div className="empty-state">
          <div className="icon">▶</div>
          <p>No flows yet</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Create multi-step automation chains to replay actions.
          </p>
        </div>
      ) : (
        flows.map((flow) => (
          <div key={flow.id} className="card" style={{ padding: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{flow.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {flow.steps.length} steps
                  {flow.lastRunStatus && <span className={`badge ${flow.lastRunStatus === 'success' ? 'success' : flow.lastRunStatus === 'partial' ? 'warning' : 'error'}`} style={{ marginLeft: 6 }}>{flow.lastRunStatus}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn" onClick={() => startRun(flow)} style={{ padding: '3px 8px', fontSize: 10 }}>▶ Run</button>
                <button className="btn secondary" onClick={() => { setEditFlow({ ...flow }); setView('editor'); }} style={{ padding: '3px 8px', fontSize: 10 }}>✏️</button>
                <button className="btn secondary" onClick={() => deleteFlow(flow.id)} style={{ padding: '3px 8px', fontSize: 10 }}>🗑️</button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function FlowEditor({ flow, onSave, onCancel }: { flow: Flow; onSave: (f: Flow) => void; onCancel: () => void }) {
  const [name, setName] = useState(flow.name);
  const [desc, setDesc] = useState(flow.description);
  const [steps, setSteps] = useState<FlowStep[]>(flow.steps);

  const addStep = (template: typeof ACTION_TEMPLATES[0]) => {
    const step: FlowStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action: JSON.parse(JSON.stringify(template.action)),
      label: template.label,
      timeout: 5000,
      retries: 0,
      continueOnError: false,
    };
    setSteps((prev) => [...prev, step]);
  };

  const updateStep = (idx: number, updates: Partial<FlowStep>) => {
    setSteps((prev) => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  const updateStepAction = (idx: number, key: string, value: string | number) => {
    setSteps((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      return { ...s, action: { ...s.action, [key]: value } as AutomationAction };
    }));
  };

  const removeStep = (idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    const arr = [...steps];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setSteps(arr);
  };

  const handleSave = () => {
    onSave({ ...flow, name, description: desc, steps });
  };

  return (
    <div style={{ padding: 10, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button className="btn secondary" onClick={onCancel} style={{ padding: '4px 8px', fontSize: 11 }}>← Back</button>
        <button className="btn" onClick={handleSave} style={{ padding: '4px 10px', fontSize: 11 }}>💾 Save</button>
      </div>

      <div className="form-group">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="form-group">
        <label>Description</label>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional description" />
      </div>

      {/* Steps */}
      <label>Steps ({steps.length})</label>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
        {steps.map((step, idx) => (
          <div key={step.id} className="card" style={{ padding: 8, marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>#{idx + 1} {step.label}</span>
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="btn secondary" onClick={() => moveStep(idx, -1)} style={{ padding: '1px 4px', fontSize: 9 }}>↑</button>
                <button className="btn secondary" onClick={() => moveStep(idx, 1)} style={{ padding: '1px 4px', fontSize: 9 }}>↓</button>
                <button className="btn secondary" onClick={() => removeStep(idx)} style={{ padding: '1px 4px', fontSize: 9 }}>✕</button>
              </div>
            </div>
            {/* Action-specific fields */}
            {('selector' in step.action) && (
              <div className="form-group" style={{ marginBottom: 4 }}>
                <input type="text" value={(step.action as any).selector} onChange={(e) => updateStepAction(idx, 'selector', e.target.value)} placeholder="CSS selector" style={{ fontSize: 11 }} />
              </div>
            )}
            {('value' in step.action) && step.action.type !== 'select' && (
              <div className="form-group" style={{ marginBottom: 4 }}>
                <input type="text" value={(step.action as any).value} onChange={(e) => updateStepAction(idx, 'value', e.target.value)} placeholder="Value" style={{ fontSize: 11 }} />
              </div>
            )}
            {step.action.type === 'select' && (
              <div className="form-group" style={{ marginBottom: 4 }}>
                <input type="text" value={(step.action as any).value} onChange={(e) => updateStepAction(idx, 'value', e.target.value)} placeholder="Option value" style={{ fontSize: 11 }} />
              </div>
            )}
            {step.action.type === 'keyboard' && (
              <div className="form-group" style={{ marginBottom: 4 }}>
                <input type="text" value={(step.action as any).key} onChange={(e) => updateStepAction(idx, 'key', e.target.value)} placeholder="Key (Enter, Tab, etc.)" style={{ fontSize: 11 }} />
              </div>
            )}
            {step.action.type === 'wait' && (
              <div className="form-group" style={{ marginBottom: 4 }}>
                <input type="number" value={(step.action as any).ms} onChange={(e) => updateStepAction(idx, 'ms', parseInt(e.target.value) || 0)} placeholder="Delay (ms)" style={{ fontSize: 11 }} />
              </div>
            )}
            {step.action.type === 'checkTextContains' && (
              <div className="form-group" style={{ marginBottom: 4 }}>
                <input type="text" value={(step.action as any).text} onChange={(e) => updateStepAction(idx, 'text', e.target.value)} placeholder="Expected text" style={{ fontSize: 11 }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <label style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0, textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={step.continueOnError} onChange={(e) => updateStep(idx, { continueOnError: e.target.checked })} />
                Continue on error
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* Add step buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {ACTION_TEMPLATES.map((t) => (
          <button key={t.label} className="btn secondary" onClick={() => addStep(t)} style={{ padding: '3px 8px', fontSize: 10 }}>
            + {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FlowRunner({ flow, onBack }: { flow: Flow; onBack: () => void }) {
  return (
    <div style={{ padding: 10, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        <button className="btn secondary" onClick={onBack} style={{ padding: '4px 8px', fontSize: 11 }}>← Back</button>
        <h3 style={{ flex: 1 }}>{flow.name}</h3>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {flow.steps.map((step, idx) => {
          const statusIcon = step.status === 'success' ? '✅' : step.status === 'failed' ? '❌' : step.status === 'running' ? '⏳' : step.status === 'skipped' ? '⏭️' : '⬜';
          return (
            <div key={step.id} className="card" style={{ padding: 8, marginBottom: 4, borderLeftColor: step.status === 'success' ? 'var(--success)' : step.status === 'failed' ? 'var(--error)' : step.status === 'running' ? 'var(--accent)' : 'var(--border)', borderLeftWidth: 3, borderLeftStyle: 'solid' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{statusIcon}</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>#{idx + 1} {step.label}</span>
                {step.duration !== undefined && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{step.duration}ms</span>}
              </div>
              {step.result && <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>{step.result.slice(0, 200)}</div>}
              {step.error && <div style={{ fontSize: 10, color: 'var(--error)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>{step.error}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
