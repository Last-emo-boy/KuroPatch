import { useState, useEffect } from 'react';
import type { AIProviderConfig, AIProviderType } from '../../shared/types';
import { getAIConfig, setAIConfig, getDebugMode, setDebugMode, getCustomPrompt, setCustomPrompt, getStealthMode, setStealthMode } from '../../shared/storage';

const PROVIDER_PRESETS: Record<AIProviderType, { baseUrl: string; models: string[] }> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  'openai-compatible': {
    baseUrl: '',
    models: [],
  },
};

export default function Settings() {
  const [config, setConfig] = useState<AIProviderConfig>({
    type: 'anthropic',
    baseUrl: PROVIDER_PRESETS.anthropic.baseUrl,
    apiKey: '',
    model: PROVIDER_PRESETS.anthropic.models[0],
  });
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [debug, setDebug] = useState(false);
  const [stealth, setStealth] = useState(false);
  const [customPrompt, setCustomPromptState] = useState('');
  const [promptSaved, setPromptSaved] = useState(false);

  useEffect(() => {
    getAIConfig().then((c) => {
      if (c) setConfig(c);
    });
    getDebugMode().then(setDebug);
    getStealthMode().then(setStealth);
    getCustomPrompt().then(setCustomPromptState);
  }, []);

  const handleProviderChange = (type: AIProviderType) => {
    const preset = PROVIDER_PRESETS[type];
    setConfig((prev) => ({
      ...prev,
      type,
      baseUrl: preset.baseUrl || prev.baseUrl,
      model: preset.models[0] || prev.model,
    }));
  };

  const handleSave = async () => {
    await setAIConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const preset = PROVIDER_PRESETS[config.type];

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>AI Provider Configuration</h3>

      <div className="form-group">
        <label>Provider</label>
        <select
          value={config.type}
          onChange={(e) => handleProviderChange(e.target.value as AIProviderType)}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openai-compatible">OpenAI-Compatible</option>
        </select>
      </div>

      <div className="form-group">
        <label>Base URL</label>
        <input
          type="text"
          value={config.baseUrl}
          onChange={(e) => setConfig((p) => ({ ...p, baseUrl: e.target.value }))}
          placeholder="https://api.example.com/v1"
        />
      </div>

      <div className="form-group">
        <label>API Key</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => setConfig((p) => ({ ...p, apiKey: e.target.value }))}
            placeholder="sk-..."
          />
          <button
            className="btn secondary"
            onClick={() => setShowKey(!showKey)}
            style={{ flexShrink: 0 }}
          >
            {showKey ? '🙈' : '👁️'}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>Model</label>
        {preset.models.length > 0 ? (
          <select
            value={config.model}
            onChange={(e) => setConfig((p) => ({ ...p, model: e.target.value }))}
          >
            {preset.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={config.model}
            onChange={(e) => setConfig((p) => ({ ...p, model: e.target.value }))}
            placeholder="model-name"
          />
        )}
      </div>

      <div className="form-group">
        <label>Temperature (optional)</label>
        <input
          type="number"
          value={config.temperature ?? ''}
          onChange={(e) =>
            setConfig((p) => ({
              ...p,
              temperature: e.target.value ? parseFloat(e.target.value) : undefined,
            }))
          }
          placeholder="0.7"
          min="0"
          max="2"
          step="0.1"
        />
      </div>

      <div className="form-group">
        <label>Max Tokens (optional)</label>
        <input
          type="number"
          value={config.maxTokens ?? ''}
          onChange={(e) =>
            setConfig((p) => ({
              ...p,
              maxTokens: e.target.value ? parseInt(e.target.value) : undefined,
            }))
          }
          placeholder="4096"
          min="1"
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" onClick={handleSave}>
          Save Configuration
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ Saved</span>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <p>🔒 API keys are stored locally in browser storage.</p>
          <p style={{ marginTop: 4 }}>No data is sent to any server other than your configured AI provider.</p>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Debug</h3>
        <div className="toggle">
          <span style={{ fontSize: 13 }}>Debug Logging</span>
          <div
            className={`toggle-switch${debug ? ' on' : ''}`}
            onClick={() => {
              const next = !debug;
              setDebug(next);
              setDebugMode(next);
            }}
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          When enabled, all messages between sidepanel ↔ background ↔ content script are logged to the browser console (F12). Check the Service Worker console for background logs.
        </p>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>🥷 Stealth Mode</h3>
        <div className="toggle">
          <span style={{ fontSize: 13 }}>Anti-Detection</span>
          <div
            className={`toggle-switch${stealth ? ' on' : ''}`}
            onClick={() => {
              const next = !stealth;
              setStealth(next);
              setStealthMode(next);
              // Also send message to background to apply immediately
              chrome.runtime.sendMessage({ type: next ? 'ENABLE_STEALTH' : 'DISABLE_STEALTH' });
            }}
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Neutralizes anti-debugging detection: strips debugger traps, spoofs DevTools detection, hides automation flags, protects native function toString. Disables chrome.debugger to remove the yellow "debugging" banner. Recommended when interacting with CAPTCHAs or anti-bot protected sites.
        </p>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Custom Instructions</h3>
        <div className="form-group">
          <label>Additional System Prompt</label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPromptState(e.target.value)}
            placeholder="Add custom instructions for the AI... (e.g. &quot;Always respond in Chinese&quot;, &quot;Focus on accessibility&quot;, &quot;Be more verbose&quot;)"
            rows={4}
            style={{ resize: 'vertical', minHeight: 80 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={async () => { await setCustomPrompt(customPrompt); setPromptSaved(true); setTimeout(() => setPromptSaved(false), 2000); }}>
            Save Instructions
          </button>
          {promptSaved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ Saved</span>}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          These instructions are appended to the AI system prompt in every conversation. Use this to customize AI behavior.
        </p>
      </div>
    </div>
  );
}
