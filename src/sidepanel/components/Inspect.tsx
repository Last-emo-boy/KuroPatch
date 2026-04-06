import { useState, useEffect, useCallback } from 'react';
import type { ElementInfo, BoxModel } from '../../shared/types';

export default function Inspect({ onBack }: { onBack?: () => void }) {
  const [element, setElement] = useState<ElementInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [editingStyle, setEditingStyle] = useState<{ prop: string; value: string } | null>(null);
  const [styleInput, setStyleInput] = useState('');

  useEffect(() => {
    const listener = (msg: any) => {
      if (msg.type === 'ELEMENT_SELECTED' && msg.payload) {
        setElement(msg.payload);
        setPicking(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const togglePick = () => {
    if (picking) {
      chrome.runtime.sendMessage({ type: 'STOP_INSPECT' });
      setPicking(false);
    } else {
      chrome.runtime.sendMessage({ type: 'START_INSPECT' });
      setPicking(true);
    }
  };

  const refreshElement = useCallback(async () => {
    if (!element) return;
    const result = await chrome.runtime.sendMessage({ type: 'ELEMENT_INFO', payload: { selector: element.selector } });
    if (result && !(result as any).error) setElement(result as ElementInfo);
  }, [element]);

  const applyStyle = async (prop: string, value: string) => {
    if (!element) return;
    await chrome.runtime.sendMessage({
      type: 'MODIFY_STYLE',
      payload: { selector: element.selector, property: prop, value },
    });
    setEditingStyle(null);
    setTimeout(refreshElement, 100);
  };

  const toggleVisibility = async () => {
    if (!element) return;
    const isHidden = element.computedStyles?.display === 'none' || element.computedStyles?.visibility === 'hidden';
    await chrome.runtime.sendMessage({
      type: 'MODIFY_DOM',
      payload: { selector: element.selector, action: isHidden ? 'show' : 'hide' },
    });
    setTimeout(refreshElement, 100);
  };

  return (
    <div className="inspect-panel">
      {/* Toolbar */}
      <div className="inspect-toolbar">
        {onBack && <button className="btn secondary" onClick={onBack} style={{ padding: '6px 10px', fontSize: 11 }}>← Chat</button>}
        <button className={`btn${picking ? '' : ' secondary'}`} onClick={togglePick} style={{ flex: 1 }}>
          {picking ? '⏳ Click an element...' : '🎯 Pick Element'}
        </button>
        {element && (
          <button className="btn secondary" onClick={refreshElement} title="Refresh" style={{ padding: '6px 10px' }}>
            ↻
          </button>
        )}
      </div>

      {!element ? (
        <div className="empty-state">
          <div className="icon">🔍</div>
          <p>No element selected</p>
          <p style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
            Click "Pick Element" then click any element on the page.
          </p>
        </div>
      ) : (
        <>
          {/* Breadcrumb */}
          <div className="inspect-breadcrumb">
            {element.domPath.map((seg, i) => (
              <span key={i}>
                {i > 0 && <span className="bread-sep">›</span>}
                <span className={i === element.domPath.length - 1 ? 'bread-active' : 'bread-item'}>{seg}</span>
              </span>
            ))}
          </div>

          {/* Element summary */}
          <div className="card inspect-summary">
            <div className="inspect-tag">
              {'<'}{element.tagName.toLowerCase()}
              {element.id && <span className="tag-id">#{element.id}</span>}
              {element.className && <span className="tag-class">.{element.className.split(' ')[0]}</span>}
              {'>'}
            </div>
            <div className="inspect-selector mono">{element.selector}</div>
            {element.textContent && (
              <div className="inspect-text">"{element.textContent.slice(0, 100)}"</div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <button className="btn secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={toggleVisibility}>
                {element.computedStyles?.display === 'none' ? '👀 Show' : '🙈 Hide'}
              </button>
            </div>
          </div>

          {/* Box Model */}
          {element.boxModel && <BoxModelView box={element.boxModel} />}

          {/* Key Styles */}
          <div className="card">
            <label>Computed Styles</label>
            {Object.entries(element.computedStyles).map(([prop, val]) => (
              <div key={prop} className="style-row" onClick={() => { setEditingStyle({ prop, value: val }); setStyleInput(val); }}>
                <span className="style-prop">{prop}</span>
                {editingStyle?.prop === prop ? (
                  <input
                    className="style-edit-input"
                    value={styleInput}
                    onChange={(e) => setStyleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyStyle(prop, styleInput);
                      if (e.key === 'Escape') setEditingStyle(null);
                    }}
                    onBlur={() => setEditingStyle(null)}
                    autoFocus
                  />
                ) : (
                  <span className="style-val">{val}</span>
                )}
              </div>
            ))}
          </div>

          {/* Attributes */}
          {Object.keys(element.attributes).length > 0 && (
            <div className="card">
              <label>Attributes</label>
              {Object.entries(element.attributes).map(([k, v]) => (
                <div key={k} className="prop-row">
                  <span className="prop-key">{k}</span>
                  <span className="prop-value">{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* Children */}
          {element.children.length > 0 && (
            <div className="card">
              <label>Children ({element.children.length})</label>
              {element.children.map((c, i) => (
                <div key={i} className="child-row">
                  <span className="child-tag">&lt;{c.tag}&gt;</span>
                  <span className="child-text">{c.text.slice(0, 40)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Siblings */}
          {element.siblings.length > 0 && (
            <div className="card">
              <label>Siblings ({element.siblings.length})</label>
              {element.siblings.map((c, i) => (
                <div key={i} className="child-row">
                  <span className="child-tag">&lt;{c.tag}&gt;</span>
                  <span className="child-text">{c.text.slice(0, 40)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BoxModelView({ box }: { box: BoxModel }) {
  return (
    <div className="box-model-card">
      <label>Box Model</label>
      <div className="box-model">
        <div className="box-margin">
          <span className="box-label">margin</span>
          <span className="box-top">{box.margin.top}</span>
          <span className="box-right">{box.margin.right}</span>
          <span className="box-bottom">{box.margin.bottom}</span>
          <span className="box-left">{box.margin.left}</span>
          <div className="box-border">
            <span className="box-label">border</span>
            <span className="box-top">{box.border.top}</span>
            <span className="box-right">{box.border.right}</span>
            <span className="box-bottom">{box.border.bottom}</span>
            <span className="box-left">{box.border.left}</span>
            <div className="box-padding">
              <span className="box-label">padding</span>
              <span className="box-top">{box.padding.top}</span>
              <span className="box-right">{box.padding.right}</span>
              <span className="box-bottom">{box.padding.bottom}</span>
              <span className="box-left">{box.padding.left}</span>
              <div className="box-content">
                {Math.round(box.width)} × {Math.round(box.height)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
