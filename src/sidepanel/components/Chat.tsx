import { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import type { ToolCall, ToolResult } from '../../shared/tools';
import type { ChatSession, ChatSessionItem, ChatSessionAIMsg } from '../../shared/types';
import { callAIWithTools, type AIMessage, type AIStreamEvent } from '../services/ai';
import { executeTool, getToolIcon, getToolDisplayName } from '../services/tools';
import { getPageContext } from '../services/page';
import { getChatSessions, saveChatSession, deleteChatSession, getActiveChatSessionId, setActiveChatSessionId } from '../../shared/storage';

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

// ---- ChatItem for display (extends stored item with typed refs) ----
interface ChatItem extends ChatSessionItem {}

function newSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function Chat({ onOpenSettings, onOpenScripts, onOpenPanel }: { onOpenSettings?: () => void; onOpenScripts?: () => void; onOpenPanel?: (panel: string) => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickedElement, setPickedElement] = useState<any>(null);
  const [showSessions, setShowSessions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [lastFailedInput, setLastFailedInput] = useState<string | null>(null);

  // ---- Persistence helpers ----
  const persistSession = useCallback(async (id: string, newItems: ChatItem[], newAiMsgs: AIMessage[]) => {
    const existing = sessions.find(s => s.id === id);
    const name = existing?.name || newItems.find(i => i.type === 'user')?.content.slice(0, 40) || 'New Chat';
    const session: ChatSession = {
      id,
      name,
      items: newItems,
      aiMessages: newAiMsgs as ChatSessionAIMsg[],
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await saveChatSession(session);
    const updated = await getChatSessions();
    setSessions(updated);
  }, [sessions]);

  // ---- Load sessions on mount ----
  useEffect(() => {
    (async () => {
      const all = await getChatSessions();
      setSessions(all);
      const savedId = await getActiveChatSessionId();
      if (savedId && all.find(s => s.id === savedId)) {
        const session = all.find(s => s.id === savedId)!;
        setActiveId(savedId);
        setItems(session.items as ChatItem[]);
        setAiMessages(session.aiMessages as AIMessage[]);
      } else if (all.length > 0) {
        // Load latest
        const latest = all[0];
        setActiveId(latest.id);
        setItems(latest.items as ChatItem[]);
        setAiMessages(latest.aiMessages as AIMessage[]);
        await setActiveChatSessionId(latest.id);
      }
    })();
  }, []);

  // ---- Switch session ----
  const switchToSession = useCallback(async (id: string) => {
    const all = await getChatSessions();
    const session = all.find(s => s.id === id);
    if (session) {
      setActiveId(id);
      setItems(session.items as ChatItem[]);
      setAiMessages(session.aiMessages as AIMessage[]);
      await setActiveChatSessionId(id);
      setShowSessions(false);
    }
  }, []);

  // ---- New session ----
  const createNewSession = useCallback(async () => {
    // Save current session first
    if (activeId && items.length > 0) {
      await persistSession(activeId, items, aiMessages);
    }
    const id = newSessionId();
    setActiveId(id);
    setItems([]);
    setAiMessages([]);
    await setActiveChatSessionId(id);
    setShowSessions(false);
  }, [activeId, items, aiMessages, persistSession]);

  // ---- Delete session ----
  const deleteSession = useCallback(async (id: string) => {
    await deleteChatSession(id);
    const updated = await getChatSessions();
    setSessions(updated);
    if (id === activeId) {
      if (updated.length > 0) {
        await switchToSession(updated[0].id);
      } else {
        const newId = newSessionId();
        setActiveId(newId);
        setItems([]);
        setAiMessages([]);
        await setActiveChatSessionId(newId);
      }
    }
  }, [activeId, switchToSession]);

  // Listen for ELEMENT_SELECTED from content script
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg.type === 'ELEMENT_SELECTED' && msg.payload) {
        setPicking(false);
        setPickedElement(msg.payload);
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

  const dismissPicked = () => setPickedElement(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [items, scrollToBottom]);
  useEffect(() => { inputRef.current?.focus(); }, [loading]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    // Ensure we have an active session ID
    let sessionId = activeId;
    if (!sessionId) {
      sessionId = newSessionId();
      setActiveId(sessionId);
      await setActiveChatSessionId(sessionId);
    }

    // Add user message
    const userItem: ChatItem = {
      id: `u_${Date.now()}`,
      type: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const newItems = [...items, userItem];
    setItems(newItems);
    setInput('');
    setLoading(true);
    setStatus('Analyzing page...');
    setLastFailedInput(null);

    // Create AbortController
    const controller = new AbortController();
    abortRef.current = controller;

    let currentItems: ChatItem[] = newItems;

    try {
      const context = await getPageContext();
      const systemPrompt = buildSystemPrompt(context, pickedElement);

      let userContent = text;
      if (pickedElement) {
        userContent += `\n\n[Selected element]\nTag: ${pickedElement.tagName}\nSelector: ${pickedElement.selector}\nText: ${(pickedElement.textContent || '').slice(0, 200)}\nAttributes: ${JSON.stringify(pickedElement.attributes || {})}`;
        setPickedElement(null);
      }

      const messages: AIMessage[] = [
        ...aiMessages,
        { role: 'user', content: userContent },
      ];

      const onEvent = (event: AIStreamEvent) => {
        switch (event.type) {
          case 'tool_call':
            setStatus(`Running: ${getToolDisplayName(event.toolCall!.name)}...`);
            currentItems = [...currentItems, {
              id: `tc_${Date.now()}_${Math.random()}`,
              type: 'tool_call',
              content: '',
              toolCall: event.toolCall,
              timestamp: Date.now(),
            }];
            setItems([...currentItems]);
            break;
          case 'tool_result':
            currentItems = [...currentItems, {
              id: `tr_${Date.now()}_${Math.random()}`,
              type: 'tool_result',
              content: '',
              toolResult: event.toolResult,
              timestamp: Date.now(),
            }];
            setItems([...currentItems]);
            break;
          case 'text':
            setStatus('');
            const last = currentItems[currentItems.length - 1];
            if (last?.type === 'text') {
              currentItems = [...currentItems.slice(0, -1), { ...last, content: last.content + '\n' + event.text }];
            } else {
              currentItems = [...currentItems, {
                id: `t_${Date.now()}`,
                type: 'text',
                content: event.text || '',
                timestamp: Date.now(),
              }];
            }
            setItems([...currentItems]);
            break;
        }
      };

      const fullResponse = await callAIWithTools(
        systemPrompt,
        messages,
        executeTool,
        onEvent,
        10,
        controller.signal,
      );

      const newAiMessages: AIMessage[] = [
        ...messages,
        { role: 'assistant', content: fullResponse },
      ];
      setAiMessages(newAiMessages);

      // Persist after AI responds
      await persistSession(sessionId, currentItems, newAiMessages);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        const cancelItem: ChatItem = {
          id: `e_${Date.now()}`,
          type: 'error',
          content: 'Cancelled by user.',
          timestamp: Date.now(),
        };
        const cancelItems = [...currentItems, cancelItem];
        setItems(cancelItems);
        await persistSession(sessionId, cancelItems, aiMessages);
      } else {
        setLastFailedInput(text);
        const errItem: ChatItem = {
          id: `e_${Date.now()}`,
          type: 'error',
          content: err.message || 'Failed to get AI response',
          timestamp: Date.now(),
        };
        const errItems = [...currentItems, errItem];
        setItems(errItems);
        await persistSession(sessionId, errItems, aiMessages);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setStatus('');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleRetry = () => {
    if (lastFailedInput) {
      handleSend(lastFailedInput);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = async () => {
    setItems([]);
    setAiMessages([]);
    if (activeId) {
      await persistSession(activeId, [], []);
    }
  };

  const activeName = sessions.find(s => s.id === activeId)?.name || 'New Chat';

  return (
    <div className="chat-container">
      {/* Session header */}
      <div className="chat-header">
        <button className="chat-session-btn" onClick={() => setShowSessions(!showSessions)}>
          <span className="session-name">{items.length > 0 ? activeName : 'New Chat'}</span>
          <span className="session-chevron">{showSessions ? '▲' : '▼'}</span>
        </button>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="chat-header-btn" onClick={createNewSession} title="New chat">+</button>
          {onOpenSettings && (
            <button className="chat-header-btn" onClick={onOpenSettings} title="Settings">⚙</button>
          )}
        </div>
      </div>

      {/* Panel quick-access bar */}
      {onOpenPanel && (
        <div className="panel-bar">
          <button className="panel-bar-btn" onClick={onOpenScripts} title="Scripts">📜 Scripts</button>
          <button className="panel-bar-btn" onClick={() => onOpenPanel('inspect')} title="Inspect">🔍 Inspect</button>
          <button className="panel-bar-btn" onClick={() => onOpenPanel('network')} title="Network">🌐 Network</button>
          <button className="panel-bar-btn" onClick={() => onOpenPanel('hooks')} title="Hooks">🪝 Hooks</button>
          <button className="panel-bar-btn" onClick={() => onOpenPanel('patches')} title="Patches">🩹 Patches</button>
          <button className="panel-bar-btn" onClick={() => onOpenPanel('flows')} title="Flows">▶ Flows</button>
          <button className="panel-bar-btn" onClick={() => onOpenPanel('sessions')} title="Sessions">💾 Sessions</button>
        </div>
      )}

      {/* Session drawer */}
      {showSessions && (
        <div className="session-drawer">
          <div className="session-drawer-header">
            <span style={{ fontWeight: 600, fontSize: 12 }}>Conversations</span>
            <button className="btn" onClick={createNewSession} style={{ padding: '3px 8px', fontSize: 10 }}>+ New</button>
          </div>
          <div className="session-list">
            {sessions.length === 0 ? (
              <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11, textAlign: 'center' }}>No saved conversations</div>
            ) : sessions.map((s) => (
              <div key={s.id} className={`session-item${s.id === activeId ? ' active' : ''}`} onClick={() => switchToSession(s.id)}>
                <div className="session-item-name">{s.name}</div>
                <div className="session-item-meta">
                  {s.items.length} messages · {new Date(s.updatedAt).toLocaleDateString()}
                </div>
                <button className="session-delete" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} title="Delete">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="chat-messages" ref={scrollRef}>
        {items.length === 0 && <WelcomeCard onSend={handleSend} />}
        {items.map((item, idx) => (
          <ChatItemView
            key={item.id}
            item={item}
            onRetry={item.type === 'error' && lastFailedInput ? handleRetry : undefined}
          />
        ))}
        {loading && status && (
          <div className="chat-status">
            <div className="status-dot" />
            <span>{status}</span>
          </div>
        )}
      </div>

      {/* Picked element banner */}
      {pickedElement && (
        <div className="picked-banner">
          <span className="picked-tag">&lt;{pickedElement.tagName.toLowerCase()}&gt;</span>
          <span className="picked-selector">{pickedElement.selector}</span>
          <button className="picked-dismiss" onClick={dismissPicked}>✕</button>
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area">
        <button
          className={`chat-pick-btn${picking ? ' active' : ''}`}
          onClick={togglePick}
          title={picking ? 'Cancel pick' : 'Pick an element'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            <path d="M13 13l6 6" />
          </svg>
        </button>
        {items.length > 0 && (
          <button className="chat-clear-btn" onClick={clearChat} title="Clear chat">
            ⟳
          </button>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={loading ? 'AI is working...' : 'Describe what you want to do...'}
          rows={1}
          disabled={loading}
        />
        {loading ? (
          <button className="chat-cancel-btn" onClick={handleCancel} title="Cancel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        ) : (
          <button className="chat-send-btn" onClick={() => handleSend()} disabled={!input.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Sub-components ----

function WelcomeCard({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="welcome-card">
      <div className="welcome-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
      <h2>KuroPatch</h2>
      <p className="welcome-sub">AI page debugger that acts, not just talks.</p>
      <div className="welcome-hints">
        <HintChip text="Fix this button's click handler" onClick={onSend} />
        <HintChip text="Why is the API failing?" onClick={onSend} />
        <HintChip text="Make the header red and bold" onClick={onSend} />
        <HintChip text="Hide all ads on this page" onClick={onSend} />
        <HintChip text="Run an accessibility audit" onClick={onSend} />
        <HintChip text="Take a screenshot of this page" onClick={onSend} />
        <HintChip text="Show page performance metrics" onClick={onSend} />
      </div>
    </div>
  );
}

function HintChip({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return <div className="hint-chip" onClick={() => onClick(text)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onClick(text); }}>{text}</div>;
}

function ChatItemView({ item, onRetry }: { item: ChatItem; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  switch (item.type) {
    case 'user':
      return (
        <div className="chat-bubble user-bubble">
          <div className="bubble-content">{item.content}</div>
        </div>
      );

    case 'text':
      return (
        <div className="chat-bubble ai-bubble">
          <div
            className="bubble-content markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content) }}
          />
          <button
            className="bubble-copy-btn"
            onClick={() => handleCopy(item.content)}
            title="Copy"
          >
            {copied ? '✓' : '⧉'}
          </button>
        </div>
      );

    case 'tool_call':
      return (
        <div className="action-card">
          <div className="action-header">
            <span className="action-icon">{getToolIcon(item.toolCall!.name)}</span>
            <span className="action-name">{getToolDisplayName(item.toolCall!.name)}</span>
          </div>
          <div className="action-args">
            {Object.entries(item.toolCall!.args).map(([k, v]) => (
              <div key={k} className="arg-line">
                <span className="arg-key">{k}:</span>
                <span className="arg-value">{String(v).slice(0, 120)}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'tool_result': {
      const tr = item.toolResult!;
      const imgUrl = extractToolResultImage(tr.result);
      return (
        <div className={`action-result ${tr.success ? 'success' : 'fail'}`}>
          <span className="result-icon">{tr.success ? '✓' : '✗'}</span>
          <span className="result-text">{tr.displayText}</span>
          {imgUrl && (
            <div className="result-image">
              <img
                src={imgUrl}
                alt="Screenshot"
                onClick={() => window.open(imgUrl, '_blank')}
                title="Click to open full size"
              />
            </div>
          )}
        </div>
      );
    }

    case 'error':
      return (
        <div className="chat-bubble error-bubble">
          <span className="error-icon">⚠</span>
          <span>{item.content}</span>
          {onRetry && (
            <button className="retry-btn" onClick={onRetry}>↻ Retry</button>
          )}
        </div>
      );

    default:
      return null;
  }
}

function renderMarkdown(text: string): string {
  try {
    const html = marked.parse(text, { async: false }) as string;
    return html;
  } catch {
    // Fallback: escape HTML
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

/** Extract image data URL from tool result for display in chat */
function extractToolResultImage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as any;
  if (r.__imageDataUrl) return r.__imageDataUrl;
  if (r.dataUrl && typeof r.dataUrl === 'string' && r.dataUrl.startsWith('data:image/')) return r.dataUrl;
  if (r.result?.__imageDataUrl) return r.result.__imageDataUrl;
  if (r.result?.dataUrl && typeof r.result.dataUrl === 'string' && r.result.dataUrl.startsWith('data:image/')) return r.result.dataUrl;
  return undefined;
}

function buildSystemPrompt(context: any, pickedElement?: any): string {
  // ---- Dynamic context blocks ----
  let pickedBlock = '';
  if (pickedElement) {
    pickedBlock = `
## 🎯 USER-SELECTED ELEMENT (via picker)
When the user says "this", "it", "this element", they mean:
  Tag: <${pickedElement.tagName.toLowerCase()}>
  Selector: ${pickedElement.selector}
  Text: "${(pickedElement.textContent || '').slice(0, 200)}"
  Attributes: ${JSON.stringify(pickedElement.attributes || {})}
  DOM Path: ${(pickedElement.domPath || []).join(' > ')}
Use this selector directly in your tool calls. Do NOT ask the user to re-identify it.`;
  }

  const sectionsBlock = context?.sections?.length
    ? `\n## Page Structure\n${context.sections.slice(0, 15).map((s: any) => `  <${s.tag}> role=${s.role} selector="${s.selector}" — ${s.summary}`).join('\n')}`
    : '';

  const consoleBlock = context?.consoleLogs?.length
    ? `\n## Recent Console (${context.consoleLogs.length} entries)\n${context.consoleLogs.slice(-8).map((l: any) => `  [${l.level.toUpperCase()}] ${l.args.join(' ')}`).join('\n')}`
    : '';

  const errorsBlock = context?.errors?.length
    ? `\n## ⚠ Page Errors (${context.errors.length})\n${context.errors.slice(-5).map((e: any) => `  ${e.message}${e.source ? ` (${e.source}:${e.lineno})` : ''}`).join('\n')}`
    : '';

  return `# KuroPatch v0.2 — AI Browser Debugger

You are KuroPatch, an AI-powered browser debugging agent embedded as a Chrome extension side panel.
You have DIRECT ACCESS to the user's current web page through a set of powerful tools.

## What You Are
- A hands-on debugging assistant that ACTS on the page, not a chatbot that gives advice.
- You operate inside a Chrome extension with full access to DOM, styles, network, console, and JavaScript execution.
- Every tool you call is executed IMMEDIATELY on the live page the user is viewing.
- All your modifications (style, DOM, JS) take effect in real time — the user sees changes instantly.

## Core Principles

### 1. ACT FIRST, TALK LATER
- When the user asks to change something → use tools to change it, THEN confirm.
- When the user asks "why is X broken?" → use tools to investigate (inspect, read console, check network), THEN explain.
- NEVER respond with "you could try..." or "here's how you might..." — just DO IT.
- NEVER ask for permission to use a tool. The user asked you to act, so act.

### 2. INVESTIGATE THOROUGHLY
- When diagnosing issues, gather evidence from multiple sources:
  • \`inspect_element\` — see the element's actual state (styles, attributes, DOM tree)
  • \`get_page_info\` — understand the page structure
  • \`get_page_sections\` — identify semantic landmarks and regions
  • \`get_console_logs\` — find runtime errors and warnings
  • \`get_network_requests\` — find failed API calls, slow requests, 4xx/5xx errors
  • \`read_text\` — verify text content
  • \`check_exists\` / \`check_text_contains\` — assert conditions
- Don't guess when you can verify. Use tools to confirm hypotheses.

### 3. USE MULTIPLE TOOLS PER TURN
- You can (and should) call multiple tools in a single response when the task requires it.
- Example: to fix a hidden button, you might: inspect_element → modify_style → check_exists in one turn.
- Example: to fill a form, you might: type_text (username) → type_text (password) → click (submit).

### 4. BE RESOURCEFUL WITH INJECT_JS
- \`inject_js\` is your most powerful tool. Use it for anything the specialized tools can't do:
  • Read complex state: \`document.querySelector(...).__vue__\`, \`React fiber\`, global variables
  • Batch operations: loop through elements, transform multiple items
  • Event manipulation: add/remove listeners, dispatch custom events
  • Debugging: override functions, add breakpoints, log interceptors
  • Advanced queries: \`document.querySelectorAll\`, XPath, tree walking
  • Timer/animation control: \`document.querySelector('video').playbackRate = 2\`
- ALWAYS return a value from inject_js so you can see the result.

## Tool Categories

### 🔍 Inspection & Reading
- \`inspect_element\` — Full element details: styles, attributes, box model, DOM path, children, siblings
- \`get_page_info\` — Page URL, title, viewport, DOM summary, sections overview
- \`get_page_sections\` — Structural map of page regions (header, nav, main, footer, forms, etc.)
- \`read_text\` — Read text content of any element
- \`check_exists\` — Check if a selector matches any element
- \`check_text_contains\` — Verify text content contains a substring
- \`get_console_logs\` — Console output and errors from page runtime
- \`get_network_requests\` — HTTP requests with status, timing, headers (filter by URL)

### 🎨 Visual Modification
- \`modify_style\` — Change any CSS property on an element
- \`inject_css\` — Inject CSS rules for batch/global changes (use real CSS selectors)
- \`hide_element\` / \`show_element\` — Toggle visibility
- \`remove_element\` — Remove from DOM entirely
- \`clone_element\` — Duplicate an element

### ✏️ Content Modification
- \`modify_text\` — Change text content
- \`modify_attribute\` — Set/change HTML attributes (src, href, class, data-*, etc.)
- \`modify_html\` — Replace inner HTML (use carefully)

### ⚡ Interaction & Automation
- \`click\` — Click any element
- \`type_text\` — Type into inputs (works with React/Vue controlled components)
- \`select_option\` — Select dropdown options
- \`keypress\` — Simulate key presses (Enter, Tab, Escape, etc.)
- \`scroll_to\` — Scroll to an element or coordinates
- \`wait_for\` — Wait for an element to appear in DOM

### 🖱️ Human-Like Automation (Anti-Detection)
Use these when you need realistic user behavior simulation — e.g. for bot-detection bypass, realistic interaction testing, or when hover/focus states matter.
- \`human_click\` — Full realistic mouse event chain: mouseover → mouseenter → mousemove (jitter) → mousedown → mouseup → click, with random offset from center and natural timing. Supports right-click and double-click.
- \`human_type\` — Character-by-character typing with variable inter-key delays (50-200ms), occasional hesitation pauses, and full keydown→keypress→input→keyup per character. Speed options: slow/normal/fast.
- \`human_move\` — Mouse movement along a Bézier curve with ease-in-out timing. Dispatches mousemove events at each step. Good for triggering hover menus, tooltips, popups.
- \`human_scroll\` — Inertia-based wheel scrolling with easing, mimicking trackpad/wheel behavior.
- \`human_drag\` — Full drag-and-drop: mousedown on source → Bézier path mousemove events → mouseup on target. Also dispatches HTML5 DragEvents. Works with sortable lists, sliders, kanban boards, etc.

**When to use human_* vs regular tools:**
- Use regular \`click\`/\`type_text\` for quick, reliable actions on cooperative pages
- Use \`human_*\` when: the page has bot detection, hover-dependent UI, drag-drop, or when the user explicitly asks for realistic/human-like behavior

### 🔧 Advanced
- \`inject_js\` — Execute arbitrary JavaScript in page context
- \`start_hooks\` — Begin monitoring: fetch, XHR, console, errors, DOM mutations, navigation

### � Capture & Visual Feedback
- \`screenshot\` — Capture a screenshot of the visible page area (returns base64 data URL)
- \`highlight_element\` — Flash-highlight an element with a colored outline (great for showing users what you found)

### 🗄️ Storage & Cookies
- \`get_storage\` — Read localStorage, sessionStorage, or cookies (all entries or by key)
- \`set_storage\` — Write a value to localStorage or sessionStorage
- \`clear_storage\` — Clear all entries in localStorage, sessionStorage, or cookies

### ♿ Audit & Performance
- \`accessibility_audit\` — Run an accessibility check (missing alt text, unlabeled inputs, empty links, heading order, contrast, lang attribute). Optionally scope to a selector.
- \`get_performance\` — Get page performance metrics: load time, TTFB, LCP, CLS, memory usage, DOM size, resource counts
### 🎯 Multimodal & Coordinate Tools (POWERFUL)
These tools enable vision-based page interaction. When using a multimodal model (Claude, GPT-4V), screenshots are sent as actual images to the AI for visual analysis.

**Screenshot & Vision:**
- \`screenshot_element\` — Screenshot a specific element (cropped to its bounding box). Returns base64 image that multimodal models can see. Use for: reading captchas/images, verifying visual rendering, identifying non-DOM content.
- \`screenshot_area\` — Screenshot a rectangular region by viewport coordinates (x, y, width, height).
- \`visual_query\` — Take a screenshot and analyze it visually. The screenshot is included as an image in the AI conversation. Use when you need to SEE the page: read captcha text, identify visual elements, check layout, find elements that are hard to locate via DOM.

**Coordinate-Based Interaction:**
- \`get_element_bounds\` — Get precise bounding rect (x, y, width, height), visibility status, and computed styles of an element.
- \`find_at_point\` — Identify what element is at specific (x, y) viewport coordinates. Returns tag, text, selector, bounds, attributes. Essential for resolving coordinates returned by multimodal analysis.
- \`click_at_coords\` — Click at exact (x, y) viewport coordinates with realistic mouse events. Perfect after multimodal model identifies a click target.
- \`type_at_coords\` — Focus and type text at (x, y) coordinates.
- \`get_interactive_map\` — Get ALL interactive elements (buttons, links, inputs) with their bounding rectangles and center coordinates. Provides the AI a complete spatial map of the page.

**Multimodal Workflow (for captchas, visual elements, etc.):**
1. \`screenshot_element\` (or \`visual_query\`) — capture the target
2. The AI model sees the image and identifies coordinates/text
3. \`click_at_coords\` / \`type_at_coords\` — act on the coordinates
4. Verify with another screenshot or DOM check
### �💾 Script Persistence (IMPORTANT)
- \`save_script\` — Save a reusable JS/CSS script for the user to run again later
- \`update_script\` — Update an existing saved script (iterate on code, fix bugs)
- \`run_script\` — Execute a saved script by ID on the current page
- \`list_scripts\` — List all saved scripts

**WHEN TO SAVE SCRIPTS:**
- When a user asks you to do something they'll likely want to repeat (download video, auto-fill, hide ads, inject custom styles, etc.)
- After you successfully create and test a working solution via inject_js/inject_css, PROACTIVELY offer to save it as a persistent script
- When the user explicitly says "save this", "keep this", "I want to reuse this"

**Script triggers:**
- \`manual\` — user clicks "Run" in the Scripts panel
- \`auto\` — runs automatically on every page load (good for ad blockers, custom CSS)
- \`url-match\` — runs only on matching URLs (e.g. "*://youtube.com/*")

**Script modes:**
- \`action\` — one-shot: user clicks "Run" and it executes once
- \`toggle\` — persistent on/off: survives page navigation (auto-reapplied when page reloads while active)

**Workflow:** First test with inject_js → if it works → save_script to persist → user can re-run from Scripts tab anytime. If the user wants changes → update_script to iterate.
When saving CSS that should persist across pages, use mode="toggle" + trigger="auto" or trigger="url-match".

## Response Format
1. **Use tools** to accomplish the task (one or more tool calls).
2. **Brief summary** (1-3 sentences) of what you did and the result.
3. If relevant, mention how the user can verify the change.

Keep text responses SHORT. The user sees every tool call and its result in the UI — they don't need you to narrate every step. Focus on conclusions and insights, not process descriptions.

When reporting inspection results, highlight the INTERESTING findings — anomalies, errors, unexpected values — not obvious facts.

## Language
Respond in the SAME LANGUAGE the user uses. If they write in Chinese, respond in Chinese. If in English, use English.
${pickedBlock}

## Current Page State
- **URL**: ${context?.url || 'unknown'}
- **Title**: ${context?.title || 'unknown'}
- **Viewport**: ${context?.viewport ? `${context.viewport.width}×${context.viewport.height}` : 'unknown'}

### DOM Summary
${context?.domSummary || 'Not available'}
${sectionsBlock}${consoleBlock}${errorsBlock}`;
}
