import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import type { ChatSession, ChatSessionItem, ChatSessionAIMsg, UserScript } from '../../shared/types';
import { callAIWithTools, type AIMessage, type AIStreamEvent } from '../services/ai';
import { executeTool, getToolIcon, getToolDisplayName } from '../services/tools';
import { getPageContext } from '../services/page';
import {
  addScript,
  getActiveChatSessionId,
  getChatSessions,
  getCustomPrompt,
  getPatches,
  getScripts,
  saveChatSession,
  deleteChatSession,
  setActiveChatSessionId,
} from '../../shared/storage';

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true });

// ---- ChatItem for display (extends stored item with typed refs) ----
interface ChatItem extends ChatSessionItem {}

function newSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Format a timestamp as relative time ("2m ago", "3h ago", "yesterday", etc.) */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Export chat items as a markdown string */
function exportChatAsMarkdown(items: ChatItem[], sessionName: string): string {
  const lines: string[] = [`# ${sessionName}`, `_Exported ${new Date().toLocaleString()}_`, ''];
  for (const item of items) {
    switch (item.type) {
      case 'user':
        lines.push(`**You:** ${item.content}`, '');
        break;
      case 'text':
        lines.push(`**AI:** ${item.content}`, '');
        break;
      case 'tool_call':
        lines.push(`> 🔧 **${getToolDisplayName(item.toolCall!.name)}** — ${Object.entries(item.toolCall!.args).map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join(', ')}`, '');
        break;
      case 'tool_result':
        lines.push(`> ${item.toolResult!.success ? '✓' : '✗'} ${item.toolResult!.displayText}`, '');
        break;
      case 'error':
        lines.push(`> ⚠ Error: ${item.content}`, '');
        break;
    }
  }
  return lines.join('\n');
}

type ToolCallInfo = NonNullable<ChatItem['toolCall']>;
type ToolResultInfo = NonNullable<ChatItem['toolResult']>;

type TurnStatus = 'running' | 'completed' | 'partial' | 'failed';

type ToolCategory = 'inspect' | 'change' | 'script' | 'capture' | 'monitor' | 'navigation' | 'other';

interface ToolExecution {
  call: ToolCallInfo;
  result?: ToolResultInfo;
}

interface ScriptSuggestion {
  name: string;
  description: string;
  type: 'js' | 'css';
  code: string;
  mode: 'action' | 'toggle';
  trigger: 'manual' | 'auto' | 'url-match';
  urlPattern: string;
  tags: string;
}

interface TurnSummary {
  status: TurnStatus;
  statusLabel: string;
  statusDetail: string;
  toolsUsed: number;
  successfulTools: number;
  failedTools: number;
  changeCount: number;
  inspectCount: number;
  captureCount: number;
  scriptCount: number;
  categories: ToolCategory[];
  recommendation: 'changes' | 'library' | 'page' | 'assistant';
  recommendationLabel: string;
  suggestion?: ScriptSuggestion;
}

interface TurnGroup {
  id: string;
  prompt?: ChatItem;
  items: ChatItem[];
  startedAt: number;
  endedAt: number;
  assistantReply?: string;
  executions: ToolExecution[];
  summary?: TurnSummary;
}

interface AssistantWorkspaceState {
  pageTitle: string | null;
  pageUrl: string | null;
  patchCount: number;
  scriptCount: number;
  consoleCount: number;
  errorCount: number;
}

interface SaveDraft extends ScriptSuggestion {
  turnId: string;
  notice: string;
}

const CHANGE_TOOLS = new Set([
  'modify_style',
  'modify_text',
  'modify_attribute',
  'modify_html',
  'inject_css',
  'inject_js',
  'hide_element',
  'show_element',
  'remove_element',
  'toggle_class',
  'insert_element',
  'clone_element',
]);

const INSPECT_TOOLS = new Set([
  'inspect_element',
  'get_page_info',
  'get_page_sections',
  'read_text',
  'check_exists',
  'check_text_contains',
  'extract_table',
  'extract_links',
  'query_selector_all',
  'get_element_bounds',
  'find_at_point',
  'get_interactive_map',
  'get_computed_style',
  'extract_meta',
  'list_iframes',
  'pierce_shadow',
  'search_text',
]);

const CAPTURE_TOOLS = new Set(['screenshot', 'screenshot_element', 'screenshot_area', 'visual_query', 'highlight_element']);
const SCRIPT_TOOLS = new Set(['save_script', 'update_script', 'run_script', 'list_scripts']);
const MONITOR_TOOLS = new Set(['get_console_logs', 'get_network_requests', 'start_hooks', 'observe_dom', 'monitor_events', 'accessibility_audit', 'get_performance']);
const NAVIGATION_TOOLS = new Set(['navigate', 'scroll_to', 'human_scroll', 'click', 'human_click', 'double_click', 'right_click', 'hover', 'fill_form', 'type_text', 'human_type', 'click_at_coords', 'type_at_coords']);

function getToolCategory(name: string): ToolCategory {
  if (CHANGE_TOOLS.has(name)) return 'change';
  if (INSPECT_TOOLS.has(name)) return 'inspect';
  if (CAPTURE_TOOLS.has(name)) return 'capture';
  if (SCRIPT_TOOLS.has(name)) return 'script';
  if (MONITOR_TOOLS.has(name)) return 'monitor';
  if (NAVIGATION_TOOLS.has(name)) return 'navigation';
  return 'other';
}

function getStatusMessageForTool(name: string): string {
  switch (getToolCategory(name)) {
    case 'inspect':
      return `Inspecting the page with ${getToolDisplayName(name)}...`;
    case 'change':
      return `Applying a live change with ${getToolDisplayName(name)}...`;
    case 'script':
      return `Saving reusable output with ${getToolDisplayName(name)}...`;
    case 'capture':
      return `Capturing evidence with ${getToolDisplayName(name)}...`;
    case 'monitor':
      return `Reviewing runtime signals with ${getToolDisplayName(name)}...`;
    case 'navigation':
      return `Driving the page with ${getToolDisplayName(name)}...`;
    default:
      return `Running ${getToolDisplayName(name)}...`;
  }
}

function getTurnLabel(status: TurnStatus): string {
  switch (status) {
    case 'running':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'partial':
      return 'Partially complete';
    case 'failed':
      return 'Needs attention';
  }
}

function getHostnameLabel(url?: string | null): string {
  if (!url) return 'No page context';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function pairExecutions(items: ChatItem[]): ToolExecution[] {
  const executions: ToolExecution[] = [];
  for (const item of items) {
    if (item.type === 'tool_call' && item.toolCall) {
      executions.push({ call: item.toolCall });
      continue;
    }
    if (item.type === 'tool_result' && item.toolResult) {
      const target = [...executions].reverse().find((entry) => !entry.result && entry.call.name === item.toolResult!.tool)
        ?? [...executions].reverse().find((entry) => !entry.result);
      if (target) {
        target.result = item.toolResult;
      }
    }
  }
  return executions;
}

function toSentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildSelectorAction(selector: unknown, body: string): string | null {
  if (typeof selector !== 'string' || !selector.trim()) return null;
  return `{
  const el = document.querySelector(${JSON.stringify(selector)});
  if (el) {
    ${body}
  }
}`;
}

function buildScriptSuggestion(executions: ToolExecution[], promptText: string, pageUrl?: string | null): ScriptSuggestion | undefined {
  const successful = executions.filter((entry) => entry.result?.success !== false);
  if (!successful.length) return undefined;

  const cssChunks: string[] = [];
  const jsChunks: string[] = [];
  const tags = new Set<string>(['assistant']);

  for (const entry of successful) {
    const args = entry.call.args;
    switch (entry.call.name) {
      case 'inject_css': {
        if (typeof args.css === 'string' && args.css.trim()) {
          cssChunks.push(args.css);
          tags.add('style');
        }
        break;
      }
      case 'inject_js': {
        if (typeof args.code === 'string' && args.code.trim()) {
          jsChunks.push(`// From Assistant\n${args.code}`);
          tags.add('automation');
        }
        break;
      }
      case 'modify_style': {
        if (typeof args.styles === 'string' && args.styles.trim()) {
          const op = buildSelectorAction(args.selector, `const styles = JSON.parse(${JSON.stringify(args.styles)});
    Object.entries(styles).forEach(([prop, value]) => el.style.setProperty(prop, String(value)));`);
          if (op) {
            jsChunks.push(op);
            tags.add('style');
          }
        } else if (typeof args.property === 'string' && typeof args.value === 'string') {
          const op = buildSelectorAction(args.selector, `el.style.setProperty(${JSON.stringify(args.property)}, ${JSON.stringify(args.value)});`);
          if (op) {
            jsChunks.push(op);
            tags.add('style');
          }
        }
        break;
      }
      case 'modify_text': {
        const op = buildSelectorAction(args.selector, `el.textContent = ${JSON.stringify(String(args.text ?? ''))};`);
        if (op) {
          jsChunks.push(op);
          tags.add('content');
        }
        break;
      }
      case 'modify_attribute': {
        const op = buildSelectorAction(args.selector, `el.setAttribute(${JSON.stringify(String(args.attribute ?? ''))}, ${JSON.stringify(String(args.value ?? ''))});`);
        if (op) {
          jsChunks.push(op);
          tags.add('content');
        }
        break;
      }
      case 'modify_html': {
        const op = buildSelectorAction(args.selector, `el.innerHTML = ${JSON.stringify(String(args.html ?? ''))};`);
        if (op) {
          jsChunks.push(op);
          tags.add('content');
        }
        break;
      }
      case 'hide_element': {
        const op = buildSelectorAction(args.selector, `el.style.setProperty('display', 'none');`);
        if (op) {
          jsChunks.push(op);
          tags.add('style');
        }
        break;
      }
      case 'show_element': {
        const op = buildSelectorAction(args.selector, `el.style.removeProperty('display');`);
        if (op) {
          jsChunks.push(op);
          tags.add('style');
        }
        break;
      }
      case 'remove_element': {
        const op = buildSelectorAction(args.selector, `el.remove();`);
        if (op) {
          jsChunks.push(op);
          tags.add('cleanup');
        }
        break;
      }
      case 'toggle_class': {
        const add = typeof args.add === 'string' ? args.add : '';
        const remove = typeof args.remove === 'string' ? args.remove : '';
        const toggle = typeof args.toggle === 'string' ? args.toggle : '';
        const lines = [
          add ? `${JSON.stringify(add)}.split(' ').filter(Boolean).forEach((cls) => el.classList.add(cls));` : '',
          remove ? `${JSON.stringify(remove)}.split(' ').filter(Boolean).forEach((cls) => el.classList.remove(cls));` : '',
          toggle ? `${JSON.stringify(toggle)}.split(' ').filter(Boolean).forEach((cls) => el.classList.toggle(cls));` : '',
        ].filter(Boolean).join('\n    ');
        const op = buildSelectorAction(args.selector, lines || '// No class operations captured');
        if (op) {
          jsChunks.push(op);
          tags.add('style');
        }
        break;
      }
      case 'insert_element': {
        const op = buildSelectorAction(args.selector, `el.insertAdjacentHTML(${JSON.stringify(String(args.position ?? 'beforeend'))}, ${JSON.stringify(String(args.html ?? ''))});`);
        if (op) {
          jsChunks.push(op);
          tags.add('content');
        }
        break;
      }
      case 'clone_element': {
        const op = buildSelectorAction(args.selector, `el.parentElement?.insertBefore(el.cloneNode(true), el.nextSibling);`);
        if (op) {
          jsChunks.push(op);
          tags.add('content');
        }
        break;
      }
    }
  }

  let urlPattern = '*://*/*';
  if (pageUrl) {
    try {
      const parsed = new URL(pageUrl);
      urlPattern = `${parsed.protocol}//${parsed.hostname}/*`;
    } catch {
      urlPattern = '*://*/*';
    }
  }

  const promptLabel = promptText.trim().slice(0, 48) || 'Assistant fix';
  if (cssChunks.length > 0 && jsChunks.length === 0) {
    return {
      name: `Assistant style · ${promptLabel}`,
      description: `Generated from Assistant request: ${promptText.trim().slice(0, 120)}`,
      type: 'css',
      code: cssChunks.join('\n\n'),
      mode: 'toggle',
      trigger: 'manual',
      urlPattern,
      tags: Array.from(tags).join(', '),
    };
  }

  if (jsChunks.length > 0) {
    return {
      name: `Assistant action · ${promptLabel}`,
      description: `Reusable Assistant output for: ${promptText.trim().slice(0, 120)}`,
      type: 'js',
      code: `(function () {\n${jsChunks.join('\n\n')}\n})();`,
      mode: 'action',
      trigger: 'manual',
      urlPattern,
      tags: Array.from(tags).join(', '),
    };
  }

  return undefined;
}

function buildTurnSummary(group: { prompt?: ChatItem; items: ChatItem[]; executions: ToolExecution[]; isRunning: boolean; pageUrl?: string | null }): TurnSummary | undefined {
  if (!group.prompt) return undefined;

  const toolsUsed = group.executions.length;
  const successfulTools = group.executions.filter((entry) => entry.result?.success !== false).length;
  const failedTools = group.executions.filter((entry) => entry.result?.success === false).length;
  const categories = Array.from(new Set(group.executions.map((entry) => getToolCategory(entry.call.name))));
  const changeCount = group.executions.filter((entry) => getToolCategory(entry.call.name) === 'change' && entry.result?.success !== false).length;
  const inspectCount = group.executions.filter((entry) => getToolCategory(entry.call.name) === 'inspect' && entry.result?.success !== false).length;
  const captureCount = group.executions.filter((entry) => ['capture', 'monitor'].includes(getToolCategory(entry.call.name)) && entry.result?.success !== false).length;
  const scriptCount = group.executions.filter((entry) => getToolCategory(entry.call.name) === 'script' && entry.result?.success !== false).length;
  const latestError = [...group.items].reverse().find((item) => item.type === 'error');

  let status: TurnStatus = 'completed';
  if (group.isRunning) status = 'running';
  else if (latestError || (toolsUsed > 0 && failedTools === toolsUsed)) status = 'failed';
  else if (failedTools > 0) status = 'partial';

  let statusDetail = 'The Assistant wrapped up this request.';
  if (status === 'running') {
    statusDetail = 'The Assistant is still gathering signals and shaping the response.';
  } else if (status === 'failed') {
    statusDetail = latestError?.content || 'The last attempt hit an issue before finishing.';
  } else if (changeCount > 0) {
    statusDetail = `Applied ${changeCount} live change${changeCount === 1 ? '' : 's'} on the page.`;
  } else if (scriptCount > 0) {
    statusDetail = `Saved or updated ${scriptCount} reusable script${scriptCount === 1 ? '' : 's'}.`;
  } else if (inspectCount > 0 || captureCount > 0) {
    statusDetail = `Gathered ${inspectCount + captureCount} signal${inspectCount + captureCount === 1 ? '' : 's'} to explain the page state.`;
  }

  let recommendation: TurnSummary['recommendation'] = 'assistant';
  let recommendationLabel = 'Continue chat';
  if (scriptCount > 0) {
    recommendation = 'library';
    recommendationLabel = 'Open Library';
  } else if (changeCount > 0) {
    recommendation = 'changes';
    recommendationLabel = 'Review changes';
  } else if (inspectCount > 0 || captureCount > 0) {
    recommendation = 'page';
    recommendationLabel = 'Open context';
  }

  return {
    status,
    statusLabel: getTurnLabel(status),
    statusDetail,
    toolsUsed,
    successfulTools,
    failedTools,
    changeCount,
    inspectCount,
    captureCount,
    scriptCount,
    categories,
    recommendation,
    recommendationLabel,
    suggestion: scriptCount === 0 ? buildScriptSuggestion(group.executions, group.prompt.content, group.pageUrl) : undefined,
  };
}

function groupTurns(items: ChatItem[], loading: boolean, pageUrl?: string | null): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: ChatItem[] = [];

  const pushCurrent = (isRunning: boolean) => {
    if (!current.length) return;
    const prompt = current.find((item) => item.type === 'user');
    const executions = pairExecutions(current);
    const assistantReply = [...current].reverse().find((item) => item.type === 'text')?.content;
    groups.push({
      id: prompt?.id || current[0].id,
      prompt,
      items: [...current],
      startedAt: current[0].timestamp,
      endedAt: current[current.length - 1].timestamp,
      assistantReply,
      executions,
      summary: buildTurnSummary({ prompt, items: current, executions, isRunning, pageUrl }),
    });
    current = [];
  };

  items.forEach((item, index) => {
    if (item.type === 'user' && current.length) {
      pushCurrent(false);
    }
    current.push(item);
    if (index === items.length - 1) {
      pushCurrent(loading && current.some((entry) => entry.type === 'user'));
    }
  });

  return groups;
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
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toolsMenuButtonRef = useRef<HTMLButtonElement>(null);
  const toolsMenuPanelRef = useRef<HTMLDivElement>(null);
  const [lastFailedInput, setLastFailedInput] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [workspace, setWorkspace] = useState<AssistantWorkspaceState>({
    pageTitle: null,
    pageUrl: null,
    patchCount: 0,
    scriptCount: 0,
    consoleCount: 0,
    errorCount: 0,
  });
  const [toolsMenuPosition, setToolsMenuPosition] = useState({ top: 0, left: 12, maxHeight: 320 });
  const [saveDraft, setSaveDraft] = useState<SaveDraft | null>(null);

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

  // ---- Rename session ----
  const renameSession = useCallback(async (id: string, newName: string) => {
    const all = await getChatSessions();
    const session = all.find(s => s.id === id);
    if (session && newName.trim()) {
      session.name = newName.trim();
      await saveChatSession(session);
      const updated = await getChatSessions();
      setSessions(updated);
    }
    setRenamingId(null);
  }, []);

  // ---- Export current chat as markdown ----
  const exportChat = useCallback(() => {
    const name = sessions.find(s => s.id === activeId)?.name || 'chat';
    const md = exportChatAsMarkdown(items, name);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeId, items, sessions]);

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

  const updateToolsMenuPosition = useCallback(() => {
    const rect = toolsMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = Math.min(240, Math.max(180, viewportWidth - 24));
    const left = Math.max(12, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 12));
    const top = Math.max(12, rect.bottom + 8);
    const maxHeight = Math.max(160, viewportHeight - top - 12);

    setToolsMenuPosition({
      top: Math.round(top),
      left: Math.round(left),
      maxHeight: Math.round(maxHeight),
    });
  }, []);

  const closeToolsMenu = useCallback(() => {
    setShowToolsMenu(false);
  }, []);

  const toggleToolsMenu = useCallback(() => {
    setShowSessions(false);
    if (showToolsMenu) {
      setShowToolsMenu(false);
      return;
    }
    updateToolsMenuPosition();
    setShowToolsMenu(true);
  }, [showToolsMenu, updateToolsMenuPosition]);

  const refreshWorkspace = useCallback(async () => {
    const [patches, scripts] = await Promise.all([getPatches(), getScripts()]);
    let context: Awaited<ReturnType<typeof getPageContext>> | null = null;
    try {
      context = await getPageContext();
    } catch {
      context = null;
    }

    setWorkspace({
      pageTitle: context?.title || null,
      pageUrl: context?.url || null,
      patchCount: patches.filter((patch) => patch.enabled !== false).length,
      scriptCount: scripts.length,
      consoleCount: context?.consoleLogs?.length || 0,
      errorCount: context?.errors?.length || 0,
    });
  }, []);

  useEffect(() => {
    void refreshWorkspace();

    const onStorageChange = (_changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local') {
        void refreshWorkspace();
      }
    };

    const onFocus = () => {
      void refreshWorkspace();
    };

    chrome.storage.onChanged.addListener(onStorageChange);
    window.addEventListener('focus', onFocus);

    return () => {
      chrome.storage.onChanged.removeListener(onStorageChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    void refreshWorkspace();
  }, [pickedElement, refreshWorkspace]);

  useEffect(() => {
    if (!showToolsMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        toolsMenuButtonRef.current?.contains(target)
        || toolsMenuPanelRef.current?.contains(target)
      ) {
        return;
      }
      setShowToolsMenu(false);
    };

    const handleViewportChange = () => {
      updateToolsMenuPosition();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [showToolsMenu, updateToolsMenuPosition]);

  const dismissSaveDraft = () => setSaveDraft(null);

  const openSaveDraft = useCallback((turn: TurnGroup) => {
    if (!turn.summary?.suggestion) return;
    setSaveDraft({
      turnId: turn.id,
      notice: 'Review the generated script before saving it to your Library.',
      ...turn.summary.suggestion,
    });
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!saveDraft) return;
    const script: UserScript = {
      id: `script_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: saveDraft.name.trim() || 'Assistant script',
      description: saveDraft.description.trim() || 'Generated from an Assistant summary.',
      type: saveDraft.type,
      code: saveDraft.code,
      mode: saveDraft.mode,
      trigger: saveDraft.trigger,
      urlPattern: saveDraft.trigger === 'url-match' ? saveDraft.urlPattern.trim() || '*://*/*' : undefined,
      enabled: true,
      active: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: saveDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    await addScript(script);
    await refreshWorkspace();
    setSaveDraft((current) => current ? { ...current, notice: `Saved “${script.name}” to Library.` } : current);
  }, [refreshWorkspace, saveDraft]);

  const turnGroups = useMemo(() => groupTurns(items, loading, workspace.pageUrl), [items, loading, workspace.pageUrl]);
  const currentTurn = turnGroups[turnGroups.length - 1];

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

    // ---- Slash commands ----
    if (text.startsWith('/')) {
      const cmd = text.toLowerCase();
      if (cmd === '/clear') {
        setInput('');
        await clearChat();
        return;
      }
      if (cmd === '/export') {
        setInput('');
        exportChat();
        return;
      }
      if (cmd === '/new') {
        setInput('');
        await createNewSession();
        return;
      }
      if (cmd === '/sessions') {
        setInput('');
        setShowSessions(true);
        return;
      }
      if (cmd === '/help') {
        setInput('');
        const helpItem: ChatItem = {
          id: `t_${Date.now()}`,
          type: 'text',
          content: `**Available Slash Commands:**\n- \`/clear\` — Clear current chat\n- \`/export\` — Export chat as Markdown file\n- \`/new\` — Start a new session\n- \`/sessions\` — Open session drawer\n- \`/help\` — Show this help\n\n**Keyboard Shortcuts:**\n- \`Ctrl+K\` — Focus chat input\n- \`Ctrl+N\` — New session\n- \`Ctrl+E\` — Export chat\n- \`Enter\` — Send message\n- \`Shift+Enter\` — New line`,
          timestamp: Date.now(),
        };
        setItems([...items, helpItem]);
        return;
      }
    }

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
    setStatus('Understanding your request and checking the page...');
    setLastFailedInput(null);
    setSaveDraft(null);

    // Create AbortController
    const controller = new AbortController();
    abortRef.current = controller;

    let currentItems: ChatItem[] = newItems;

    try {
      const context = await getPageContext();
      const customPrompt = await getCustomPrompt();
      const systemPrompt = buildSystemPrompt(context, pickedElement, customPrompt);

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
            setStatus(getStatusMessageForTool(event.toolCall!.name));
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
            setStatus(event.toolResult?.success === false ? `Tool needs attention: ${getToolDisplayName(event.toolResult.tool)}` : 'Reviewing tool output and deciding what to do next...');
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
            setStatus('Summarizing the result for you...');
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

      setStatus('Saving this conversation to your workspace...');
      const fullResponse = await callAIWithTools(
        systemPrompt,
        messages,
        executeTool,
        onEvent,
        25,
        controller.signal,
      );

      const newAiMessages: AIMessage[] = [
        ...messages,
        { role: 'assistant', content: fullResponse },
      ];
      setAiMessages(newAiMessages);

      // Persist after AI responds
      await persistSession(sessionId, currentItems, newAiMessages);
      await refreshWorkspace();
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
        await refreshWorkspace();
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
        await refreshWorkspace();
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

  // ---- Global keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'k') { e.preventDefault(); inputRef.current?.focus(); }
        else if (e.key === 'n') { e.preventDefault(); createNewSession(); }
        else if (e.key === 'e') { e.preventDefault(); exportChat(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [createNewSession, exportChat]);

  const clearChat = async () => {
    setItems([]);
    setAiMessages([]);
    if (activeId) {
      await persistSession(activeId, [], []);
    }
  };

  const activeName = sessions.find(s => s.id === activeId)?.name || 'New Chat';
  const selectedLabel = pickedElement?.selector || pickedElement?.tagName || null;

  const openPanelShortcut = useCallback((panel: string) => {
    closeToolsMenu();
    onOpenPanel?.(panel);
  }, [closeToolsMenu, onOpenPanel]);

  const openScriptsShortcut = useCallback(() => {
    closeToolsMenu();
    onOpenScripts?.();
  }, [closeToolsMenu, onOpenScripts]);

  const openSettingsShortcut = useCallback(() => {
    closeToolsMenu();
    onOpenSettings?.();
  }, [closeToolsMenu, onOpenSettings]);

  const handleToolMenuPick = useCallback(() => {
    closeToolsMenu();
    togglePick();
  }, [closeToolsMenu, picking]);

  const handleToolMenuRefresh = useCallback(() => {
    closeToolsMenu();
    void refreshWorkspace();
  }, [closeToolsMenu, refreshWorkspace]);

  const toolsMenu = showToolsMenu ? createPortal(
    <div
      ref={toolsMenuPanelRef}
      className="chat-tools-menu chat-tools-menu-portal"
      style={{
        top: `${toolsMenuPosition.top}px`,
        left: `${toolsMenuPosition.left}px`,
        maxHeight: `${toolsMenuPosition.maxHeight}px`,
      }}
    >
      <div className="chat-tools-section-label">Conversation</div>
      <button className="chat-tools-item" type="button" onClick={() => { closeToolsMenu(); void createNewSession(); }}>
        <span>New chat</span>
        <small>Start a fresh conversation</small>
      </button>
      <button className="chat-tools-item" type="button" onClick={() => { closeToolsMenu(); setShowSessions(true); }}>
        <span>Conversations</span>
        <small>{sessions.length} saved chats</small>
      </button>
      {items.length > 0 ? (
        <button className="chat-tools-item" type="button" onClick={() => { closeToolsMenu(); exportChat(); }}>
          <span>Export chat</span>
          <small>Save this conversation as Markdown</small>
        </button>
      ) : null}
      {items.length > 0 ? (
        <button className="chat-tools-item" type="button" onClick={() => { closeToolsMenu(); void clearChat(); }}>
          <span>Clear conversation</span>
          <small>Remove messages from the current chat</small>
        </button>
      ) : null}

      <div className="chat-tools-divider" />
      <div className="chat-tools-section-label">Workspace</div>
      <button className="chat-tools-item" type="button" onClick={() => openPanelShortcut('page')}>
        <span>Context</span>
        <small>{workspace.pageUrl ? getHostnameLabel(workspace.pageUrl) : 'Open page view'}</small>
      </button>
      <button className="chat-tools-item" type="button" onClick={openScriptsShortcut}>
        <span>Library</span>
        <small>{workspace.scriptCount} saved scripts</small>
      </button>
      <button className="chat-tools-item" type="button" onClick={() => openPanelShortcut('patches')}>
        <span>Changes</span>
        <small>{workspace.patchCount} live changes</small>
      </button>

      <div className="chat-tools-divider" />
      <div className="chat-tools-section-label">Tools</div>
      <button className="chat-tools-item" type="button" onClick={handleToolMenuPick}>
        <span>{picking ? 'Stop picker' : 'Pick element'}</span>
        <small>{selectedLabel ? selectedLabel : 'Attach page element context'}</small>
      </button>
      <button className="chat-tools-item" type="button" onClick={() => openPanelShortcut('inspect')}>
        <span>Inspect</span>
        <small>Open detailed DOM inspector</small>
      </button>
      <button className="chat-tools-item" type="button" onClick={() => openPanelShortcut('network')}>
        <span>Network</span>
        <small>{workspace.errorCount} errors · {workspace.consoleCount} logs</small>
      </button>
      <button className="chat-tools-item" type="button" onClick={handleToolMenuRefresh}>
        <span>Refresh context</span>
        <small>Reload page signals and counts</small>
      </button>

      {onOpenSettings ? (
        <>
          <div className="chat-tools-divider" />
          <div className="chat-tools-section-label">Preferences</div>
          <button className="chat-tools-item" type="button" onClick={openSettingsShortcut}>
            <span>Settings</span>
            <small>Provider and runtime options</small>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="chat-container assistant-workspace assistant-workspace-minimal">
      <div className="chat-header chat-header-minimal chat-header-ultra-minimal chat-header-focused">
        <button className="chat-session-btn chat-session-btn-minimal" onClick={() => { setShowToolsMenu(false); setShowSessions(!showSessions); }}>
          <span className="session-name">{items.length > 0 ? activeName : 'New chat'}</span>
          <span className="session-chevron">{showSessions ? '▲' : '▼'}</span>
        </button>

        <div className="chat-header-actions">
          <div className="chat-tools-menu-wrap">
            <button
              ref={toolsMenuButtonRef}
              className={`chat-header-btn${showToolsMenu ? ' active' : ''}`}
              onClick={toggleToolsMenu}
              title="Open chat menu"
              type="button"
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {toolsMenu}

      {showSessions && (
        <div className="session-drawer session-drawer-minimal">
          <div className="session-drawer-header">
            <span style={{ fontWeight: 600, fontSize: 12 }}>Conversations</span>
            <button className="btn" onClick={createNewSession} style={{ padding: '3px 8px', fontSize: 10 }}>+ New</button>
          </div>
          <div style={{ padding: '6px 10px' }}>
            <input
              className="session-search-input"
              type="text"
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="Search conversations..."
            />
          </div>
          <div className="session-list">
            {sessions.length === 0 ? (
              <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 11, textAlign: 'center' }}>No saved conversations</div>
            ) : sessions
              .filter(s => !sessionSearch || s.name.toLowerCase().includes(sessionSearch.toLowerCase()))
              .map((s) => (
              <div key={s.id} className={`session-item${s.id === activeId ? ' active' : ''}`} onClick={() => switchToSession(s.id)}>
                {renamingId === s.id ? (
                  <input
                    className="session-rename-input"
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => renameSession(s.id, renameValue)}
                    onKeyDown={e => { if (e.key === 'Enter') renameSession(s.id, renameValue); if (e.key === 'Escape') setRenamingId(null); }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <div className="session-item-name" onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.id); setRenameValue(s.name); }} title="Double-click to rename">{s.name}</div>
                )}
                <div className="session-item-meta">
                  {s.items.length} messages · {relativeTime(s.updatedAt)}
                </div>
                <button className="session-delete" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} title="Delete">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="chat-messages chat-messages-minimal" ref={scrollRef}>
        {items.length === 0 && <WelcomeCard onSend={handleSend} onPick={togglePick} />}
        {turnGroups.map((turn, turnIndex) => (
          <div key={turn.id} className="assistant-turn assistant-turn-minimal">
            {turn.prompt ? (
              <div className="assistant-turn-header assistant-turn-header-minimal">
                <span className="assistant-turn-index">Request {turnIndex + 1}</span>
                <span className="assistant-turn-time">{relativeTime(turn.endedAt)}</span>
              </div>
            ) : null}
            <div className="assistant-turn-body">
              {turn.items.map((item) => (
                <ChatItemView
                  key={item.id}
                  item={item}
                  onRetry={item.type === 'error' && lastFailedInput ? handleRetry : undefined}
                />
              ))}
              {turn.summary && (
                <TaskSummaryCard
                  summary={turn.summary}
                  isLatest={turn.id === currentTurn?.id}
                  isLoading={loading && turn.id === currentTurn?.id}
                  status={status}
                  onOpenRecommendation={() => {
                    const panelMap = {
                      assistant: 'assistant',
                      page: 'page',
                      changes: 'patches',
                      library: 'scripts',
                    } as const;
                    const target = panelMap[turn.summary!.recommendation];
                    if (target === 'scripts') {
                      onOpenScripts?.();
                    } else if (target === 'assistant') {
                      inputRef.current?.focus();
                    } else {
                      onOpenPanel?.(target);
                    }
                  }}
                  onSaveScript={turn.summary.suggestion ? () => openSaveDraft(turn) : undefined}
                />
              )}
              {saveDraft?.turnId === turn.id && (
                <SaveScriptCard
                  draft={saveDraft}
                  onChange={setSaveDraft}
                  onSave={() => void handleSaveDraft()}
                  onDismiss={dismissSaveDraft}
                  onOpenLibrary={onOpenScripts}
                />
              )}
            </div>
          </div>
        ))}
        {loading && status && (
          <div className="chat-status assistant-chat-status">
            <div className="status-dot" />
            <span>{status}</span>
          </div>
        )}
      </div>

      {pickedElement && (
        <div className="picked-banner picked-banner-minimal">
          <span className="picked-tag">&lt;{pickedElement.tagName.toLowerCase()}&gt;</span>
          <span className="picked-selector">{pickedElement.selector}</span>
          <button className="picked-dismiss" onClick={dismissPicked}>✕</button>
        </div>
      )}

      <div className="chat-input-area chat-input-area-minimal">
        <button
          className={`chat-pick-btn chat-pick-btn-compact${picking ? ' active' : ''}`}
          onClick={togglePick}
          title={picking ? 'Cancel pick' : 'Pick an element'}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            <path d="M13 13l6 6" />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={loading ? 'Assistant is working through the live page…' : 'Ask anything about this page…'}
          rows={1}
          disabled={loading}
        />
        {loading ? (
          <button className="chat-cancel-btn chat-cancel-btn-compact" onClick={handleCancel} title="Cancel" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        ) : (
          <button className="chat-send-btn" onClick={() => handleSend()} disabled={!input.trim()} type="button">
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

function TaskSummaryCard({
  summary,
  isLatest,
  isLoading,
  status,
  onOpenRecommendation,
  onSaveScript,
}: {
  summary: TurnSummary;
  isLatest: boolean;
  isLoading: boolean;
  status: string;
  onOpenRecommendation: () => void;
  onSaveScript?: () => void;
}) {
  const toneClass = summary.status === 'failed' ? 'failed' : summary.status === 'partial' ? 'partial' : summary.status === 'running' ? 'running' : 'success';
  return (
    <div className={`assistant-summary-card assistant-summary-card-compact assistant-summary-card-inline ${toneClass}`}>
      <div className="assistant-summary-inline-shell">
        <div className="assistant-summary-copy">
          <div className="assistant-summary-inline-meta">
            <span className="assistant-summary-title-compact">{isLoading && isLatest ? 'Working' : summary.statusLabel}</span>
            {isLoading && isLatest ? <span className="assistant-summary-live-pill">Live</span> : null}
          </div>
          <p className="assistant-summary-note assistant-summary-note-compact">{isLoading && isLatest && status ? status : summary.statusDetail}</p>
        </div>
        <div className="assistant-summary-actions compact inline subtle">
          <button className="btn secondary assistant-summary-btn" type="button" onClick={onOpenRecommendation}>{summary.recommendationLabel}</button>
          {onSaveScript && (
            <button className="btn secondary assistant-summary-btn" type="button" onClick={onSaveScript}>Save</button>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveScriptCard({
  draft,
  onChange,
  onSave,
  onDismiss,
  onOpenLibrary,
}: {
  draft: SaveDraft;
  onChange: (draft: SaveDraft | null) => void;
  onSave: () => void;
  onDismiss: () => void;
  onOpenLibrary?: () => void;
}) {
  const updateField = <K extends keyof SaveDraft>(key: K, value: SaveDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="assistant-save-card">
      <div className="assistant-save-header">
        <div>
          <div className="assistant-summary-kicker">Assistant → Library</div>
          <div className="assistant-summary-title">Save this result as a reusable script</div>
        </div>
        <button className="chat-header-btn" type="button" onClick={onDismiss} title="Close">✕</button>
      </div>
      <p className="assistant-save-notice">{draft.notice}</p>
      <div className="assistant-save-grid">
        <label>
          <span>Name</span>
          <input value={draft.name} onChange={(e) => updateField('name', e.target.value)} />
        </label>
        <label>
          <span>Type</span>
          <select value={draft.type} onChange={(e) => updateField('type', e.target.value as SaveDraft['type'])}>
            <option value="js">JavaScript</option>
            <option value="css">CSS</option>
          </select>
        </label>
        <label className="full">
          <span>Description</span>
          <input value={draft.description} onChange={(e) => updateField('description', e.target.value)} />
        </label>
        <label>
          <span>Mode</span>
          <select value={draft.mode} onChange={(e) => updateField('mode', e.target.value as SaveDraft['mode'])}>
            <option value="action">Action</option>
            <option value="toggle">Toggle</option>
          </select>
        </label>
        <label>
          <span>Trigger</span>
          <select value={draft.trigger} onChange={(e) => updateField('trigger', e.target.value as SaveDraft['trigger'])}>
            <option value="manual">Manual</option>
            <option value="auto">Auto</option>
            <option value="url-match">URL match</option>
          </select>
        </label>
        {draft.trigger === 'url-match' && (
          <label className="full">
            <span>URL pattern</span>
            <input value={draft.urlPattern} onChange={(e) => updateField('urlPattern', e.target.value)} />
          </label>
        )}
        <label className="full">
          <span>Tags</span>
          <input value={draft.tags} onChange={(e) => updateField('tags', e.target.value)} />
        </label>
        <label className="full">
          <span>Code</span>
          <textarea value={draft.code} onChange={(e) => updateField('code', e.target.value)} rows={12} spellCheck={false} />
        </label>
      </div>
      <div className="assistant-save-actions">
        <button className="btn secondary" type="button" onClick={onDismiss}>Dismiss</button>
        {onOpenLibrary && <button className="btn secondary" type="button" onClick={onOpenLibrary}>Open Library</button>}
        <button className="btn" type="button" onClick={onSave}>Save script</button>
      </div>
    </div>
  );
}

function WelcomeCard({ onSend, onPick }: { onSend: (text: string) => void; onPick: () => void }) {
  return (
    <div className="welcome-card welcome-card-minimal welcome-card-ultra-minimal">
      <p className="welcome-sub welcome-sub-minimal">Ask about the page, or pick one element to give the assistant a target.</p>
      <div className="welcome-inline-actions welcome-inline-actions-minimal">
        <button className="welcome-pick-btn" type="button" onClick={onPick}>Select element</button>
      </div>
      <div className="welcome-hints welcome-hints-minimal welcome-hints-ultra-minimal">
        <HintChip text="Why is this page failing?" onClick={onSend} />
        <HintChip text="Inspect the selected element" onClick={onSend} />
      </div>
    </div>
  );
}

function HintChip({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return <div className="hint-chip" onClick={() => onClick(text)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onClick(text); }}>{text}</div>;
}

function formatCompactValue(value: unknown, limit = 36): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function summarizeToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (!entries.length) return 'No parameters';
  const preview = entries.slice(0, 2).map(([key, value]) => `${key}: ${formatCompactValue(value, 24)}`);
  if (entries.length > 2) {
    preview.push(`+${entries.length - 2} more`);
  }
  return preview.join(' · ');
}

function summarizeToolResult(text: string, limit = 88): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function ChatItemView({ item, onRetry }: { item: ChatItem; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  switch (item.type) {
    case 'user':
      return (
        <div className="chat-bubble user-bubble user-bubble-minimal">
          <div className="bubble-content">{item.content}</div>
        </div>
      );

    case 'text':
      return (
        <div className="chat-bubble ai-bubble ai-bubble-minimal">
          <div
            className="bubble-content markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content) }}
          />
          <button
            className={`bubble-copy-btn${copied ? ' copied' : ''}`}
            onClick={() => handleCopy(item.content)}
            title="Copy"
          >
            {copied ? '✓' : '⧉'}
          </button>
        </div>
      );

    case 'tool_call': {
      const argEntries = Object.entries(item.toolCall!.args);
      const canExpand = argEntries.length > 0;
      return (
        <div className="action-card action-card-minimal">
          <div className="action-header action-header-compact" onClick={() => canExpand && setCollapsed(!collapsed)} style={canExpand ? { cursor: 'pointer' } : undefined}>
            <span className="action-icon">{getToolIcon(item.toolCall!.name)}</span>
            <div className="action-copy">
              <span className="action-name action-name-compact">{getToolDisplayName(item.toolCall!.name)}</span>
              <span className="action-meta">{summarizeToolArgs(item.toolCall!.args)}</span>
            </div>
            {canExpand && <span className="collapse-indicator">{collapsed ? '▸' : '▾'}</span>}
          </div>
          {!collapsed && argEntries.length > 0 ? (
            <div className="action-args action-args-expanded">
              {argEntries.map(([k, v]) => (
                <div key={k} className="arg-line">
                  <span className="arg-key">{k}:</span>
                  <span className="arg-value">{String(v).slice(0, 500)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    case 'tool_result': {
      const tr = item.toolResult!;
      const imgUrl = extractToolResultImage(tr.result);
      const canExpand = tr.displayText.length > 100 || !!imgUrl;
      return (
        <div className={`action-result action-result-minimal ${tr.success ? 'success' : 'fail'}`}>
          <div className="result-main result-main-compact" onClick={() => canExpand && setCollapsed(!collapsed)} style={canExpand ? { cursor: 'pointer' } : undefined}>
            <span className="result-icon">{tr.success ? '✓' : '✗'}</span>
            <div className="result-copy">
              <span className="result-state">{tr.success ? 'Completed' : 'Needs attention'}</span>
              <span className="result-text">{collapsed ? summarizeToolResult(tr.displayText) : tr.displayText}</span>
            </div>
            {canExpand && <span className="collapse-indicator">{collapsed ? '▸' : '▾'}</span>}
          </div>
          {!collapsed && imgUrl && (
            <div className="result-image">
              <img
                src={imgUrl}
                alt="Screenshot"
                onClick={() => {
                  // Convert data URL to blob URL to avoid Chrome blocking data: navigation
                  if (imgUrl.startsWith('data:')) {
                    const [header, b64] = imgUrl.split(',');
                    const mime = header.match(/data:(.*?);/)?.[1] || 'image/png';
                    const bin = atob(b64);
                    const arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    const blob = new Blob([arr], { type: mime });
                    window.open(URL.createObjectURL(blob), '_blank');
                  } else {
                    window.open(imgUrl, '_blank');
                  }
                }}
                title="Click to open full size"
              />
            </div>
          )}
        </div>
      );
    }

    case 'error':
      return (
        <div className="chat-bubble error-bubble" role="alert">
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

function buildSystemPrompt(context: any, pickedElement?: any, customPrompt?: string): string {
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
  • Shadow DOM access: \`el.shadowRoot.querySelector(...);\`
- ALWAYS return a value from inject_js so you can see the result.
- inject_js has a timeout (default 10s) — if your code hangs, it'll report an error with execution time.
- If inject_js returns an \`errorType\` and \`stack\`, use those to diagnose the issue.

## 🎯 Smart Tool Selection

### click vs. human_click
- Use \`click\` for quick, reliable actions on cooperative pages (dashboards, internal tools)
- Use \`human_click\` when: bot detection active, hover-dependent UI, drag needed, or user asks for "human-like"

### wait_for Advanced Usage
- Basic: \`wait_for(selector=".loaded")\` — wait for element
- Visible: \`wait_for(selector=".modal", visible=true)\` — wait for visible
- Condition: \`wait_for(condition="document.querySelector('.data-table')?.rows?.length > 5")\` — wait for state

### check_exists as Pre-check
- Returns \`count\` of matches — useful for "are there 3 items in the list?"
- Use \`retries\` for async content: \`check_exists(selector=".result", retries=3, retryDelay=1000)\`

### get_network_requests Filtering
- Find failed APIs: \`get_network_requests(status="failed")\`
- Find specific API: \`get_network_requests(filter="/api/user", method="POST")\`
- Server errors only: \`get_network_requests(status="5xx")\`
- Responses now include \`responsePreview\` and \`requestBody\` for API debugging

### get_console_logs Filtering
- Errors only: \`get_console_logs(level="error")\`
- Search: \`get_console_logs(search="TypeError")\`
- Warnings + errors: \`get_console_logs(level="error,warn")\`

### start_hooks Selective Monitoring
- Monitor only network: \`start_hooks(types="fetch,xhr")\`
- Filter by URL: \`start_hooks(types="fetch,xhr", urlFilter="/api/")\`
- Console + errors: \`start_hooks(types="console,errors")\`

### fill_form vs type_text
- **fill_form** when: filling 3+ fields, handling a form holistically, need submit in same call
- **type_text** when: single field, need to trigger specific input events, field needs special handling
- fill_form handles input/textarea/select/checkbox/radio — it auto-detects field type

### navigate vs inject_js(window.location)
- **navigate** for: URL navigation with automatic page load waiting, back/forward/reload, optional waitFor selector
- **inject_js** for: SPA route changes, hash navigation, or when you need to stay on same page context

### extract_table vs read_text(mode=structured)
- **extract_table** for: dedicated \<table\> elements — returns clean {headers, rows} JSON
- **read_text(mode=structured)** for: auto-detecting any structured content (table, list, form, or fallback text)

### query_selector_all vs get_interactive_map
- **query_selector_all** for: any CSS selector, returns tag/text/bounds/visible/attributes for up to 100 matches
- **get_interactive_map** for: specifically interactive elements (buttons, links, inputs) with coordinates for clicking

### get_cookies vs get_storage(type=cookies)
- **get_cookies** for: reading httpOnly cookies (invisible to JS!), filtering by domain, seeing full cookie metadata
- **get_storage(type=cookies)** for: quick access to document.cookie-visible cookies only

### emulate_device for Responsive Testing
- Quick preset: \`emulate_device(preset="iphone14")\` — sets viewport, DPR, and mobile UA
- Custom: \`emulate_device(width=768, height=1024, deviceScaleFactor=2)\`
- Reset: \`emulate_device(action="reset")\` — returns to desktop viewport
- Always screenshot after emulation to verify layout changes

### intercept_request for API Testing
- Mock API response: \`intercept_request(urlPattern="*/api/user*", action="mock", responseBody='{"name":"test"}')\`
- Block request: \`intercept_request(urlPattern="*.analytics.*", action="block")\`
- Clear all intercepts: \`intercept_request(action="clear")\`

### block_urls for Performance Testing
- Block ads/trackers: \`block_urls(patterns='["*doubleclick*","*analytics*","*tracking*"]')\`
- Clear blocks: \`block_urls(action="clear")\`

### network_throttle for Loading State Testing
- Slow connection: \`network_throttle(preset="slow-3g")\` → triggers loading spinners, skeleton UIs
- Offline mode: \`network_throttle(preset="offline")\` → test offline fallbacks
- Custom: \`network_throttle(downloadKbps=100, latencyMs=500)\`
- Reset: \`network_throttle(action="reset")\`

### force_css_state for CSS Debugging
- Inspect hover styles: \`force_css_state(selector=".dropdown", states="hover")\` → menu stays open for inspection
- Multiple states: \`force_css_state(selector="input", states="focus,hover")\`
- Clear: \`force_css_state(selector=".dropdown", action="clear")\`

### get_event_listeners for Click Debugging
- "Click does nothing" → \`get_event_listeners(selector="button.submit")\` to see if handler exists
- Compare expected vs actual event types attached

### emulate_media for Theming
- Dark mode test: \`emulate_media(colorScheme="dark")\` → screenshot → verify dark theme
- Print preview: \`emulate_media(mediaType="print")\` → check print-specific styles
- Reset: \`emulate_media(action="reset")\`

### wait_for Absent Mode (NEW)
- Wait for spinner to disappear: \`wait_for(selector=".loading-spinner", absent=true)\`
- Wait for modal to close: \`wait_for(selector=".modal-overlay", absent=true, visible=true)\`

### modify_style Batch Mode (NEW)
- Multiple properties at once: \`modify_style(selector=".card", styles='{"background":"#fff","border-radius":"8px","padding":"16px"}')\`

### screenshot Full Page (NEW)
- Capture entire scrollable page: \`screenshot(fullPage=true)\` — stitches viewport screenshots

### Responsive Testing Workflow
1. \`emulate_device(preset="iphone14")\` → set mobile viewport
2. \`screenshot()\` → capture mobile layout
3. \`emulate_media(colorScheme="dark")\` → switch to dark mode
4. \`screenshot()\` → capture dark mobile
5. \`emulate_device(action="reset")\` + \`emulate_media(action="reset")\`

## 📋 Task Decomposition

For complex multi-step tasks, PLAN before executing:
1. **Assess** — Use get_page_info/get_page_sections/screenshot to understand current state
2. **Plan** — Identify the minimal set of tool calls needed
3. **Execute** — Perform actions in logical order, batch when possible (fill_form > multiple type_text)
4. **Verify** — Use screenshot/check_exists/read_text to confirm success

**Form Automation Pattern:**
1. \`get_interactive_map\` → map all form fields
2. \`fill_form(fields=[...], submit="button[type=submit]")\` → fill all + submit in ONE call
3. \`wait_for(selector=".success-message")\` → confirm submission

**API Debugging Pattern:**
1. \`get_network_requests(status="failed")\` → find failing requests
2. \`get_network_requests(filter="/api/endpoint", method="POST")\` → inspect specific request with responsePreview
3. \`get_console_logs(level="error")\` → find related runtime errors

## 📝 Context Management
- When tool results return large JSON, extract KEY FINDINGS for the user — don't repeat raw data
- Summarize network requests, DOM trees, and element lists instead of dumping them
- Focus on anomalies, errors, and actionable insights

## 🔄 Error Recovery Patterns

**"Element not found":**
1. \`get_page_sections\` to understand current page structure
2. \`inspect_element\` on a nearby visible element to find the right selector
3. Try \`get_interactive_map\` if looking for a button/link/input
4. If element might be in Shadow DOM: \`inject_js\` with \`el.shadowRoot.querySelector()\`
5. If in iframe: \`inject_js\` with \`document.querySelector('iframe').contentDocument.querySelector()\`

**"Click had no effect":**
1. \`inspect_element\` — check disabled/pointer-events/z-index state
2. \`get_console_logs(level="error")\` — look for JS errors
3. Try \`human_click\` (event sequence might be required)
4. \`get_network_requests(status="failed")\` — check if click triggered a failing API
5. \`keypress("Enter")\` if element is focused but click didn't work

**"Type_text didn't register":**
1. Check if it's a React/Vue controlled input (check\_exists for the input, inspect attributes)
2. Try \`human_type\` (dispatches full keydown→keypress→input→keyup per char)
3. Use \`inject_js\` to set value directly + trigger React onChange: \`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'text'); el.dispatchEvent(new Event('input', {bubbles:true}))\`

**"Page changed unexpectedly":**
1. Don't reuse old selectors — \`get_page_sections\` to re-map
2. \`wait_for\` for the new state to stabilize before acting
3. \`screenshot\` to visually confirm what's shown

**"inject_js timed out":**
1. Check the \`executionTime\` in the error — was it genuinely slow or an infinite loop?
2. Break complex code into smaller inject_js calls
3. Increase \`timeout\` parameter if operation is legitimately slow

## ⚠️ Known Limitations

- **Shadow DOM**: Most selector-based tools can't cross shadow boundaries. Use \`pierce_shadow\` to query/click/modify inside shadow roots. \`inject_js\` can also reach shadow DOM manually. \`inspect_element\` will report shadow children if present.
- **Iframes**: Cross-origin iframes are inaccessible. Same-origin iframes can be accessed via \`inject_js(allFrames=true)\`. Use \`list_iframes\` to discover all frames on page. \`inspect_element\` reports iframe accessibility status.
- **Stealth trade-off**: Enabling stealth disables chrome.debugger (removes "debugging" banner). Network capture falls back to hook-based monitoring (less headers, but captures response bodies).
- **inject_js can't access Chrome APIs**: Only page-context globals are available.

## Tool Categories

### 🔍 Inspection & Reading
- \`inspect_element\` — Full element details: styles, attributes, box model, DOM path, children, siblings
- \`get_page_info\` — Page URL, title, viewport, DOM summary, sections overview
- \`get_page_sections\` — Structural map of page regions (header, nav, main, footer, forms, etc.)
- \`read_text\` — Read text content (mode="structured" for tables→JSON, lists→array, forms→field objects)
- \`extract_table\` — Extract \<table\> data as structured JSON with headers and rows
- \`extract_links\` — Get all links from page/element: href, text, target, isExternal
- \`query_selector_all\` — Get info about ALL matching elements (tag, text, bounds, visible) — up to 100
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
- \`click\` — Click any element (auto-validates visibility & scrolls into view). Supports right-click (button="right"), middle-click, and double-click (clickCount=2)
- \`type_text\` — Type into inputs (auto-validates visibility/disabled/readOnly, works with React/Vue)
- \`fill_form\` — Batch fill multiple form fields in ONE call (replaces 5-10 type_text calls!)
- \`select_option\` — Select dropdown options
- \`keypress\` — Key presses: single keys, combos ("Ctrl+A"), or sequences (["Tab","Tab","Enter"])
- \`scroll_to\` — Scroll to an element or coordinates. Use behavior="instant" for immediate or "smooth" for animated.
- \`wait_for\` — Wait for an element to appear in DOM, disappear (absent=true), or network idle (networkIdle=true)
- \`navigate\` — Go to URL, back/forward in history, or reload page. Set waitUntil="networkidle" to wait until all AJAX completes.
- \`hover\` — Hover over element (triggers CSS :hover + JS events). Essential for dropdown menus, tooltips, hover cards
- \`double_click\` — Double-click element with full event sequence (dblclick event)
- \`right_click\` — Right-click element (triggers contextmenu event)
- \`upload_file\` — Set file on <input type="file"> via CDP. Supports text and binary (base64) content.
- \`focus\` / \`blur\` — Focus or unfocus an element. Triggers focus/blur related events and CSS states.

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
- \`get_cookies\` — Read cookies via Chrome API (includes httpOnly cookies invisible to JS!)
- \`set_cookie\` — Set cookie with full options (domain, path, secure, httpOnly, sameSite, expires)

### 🌐 Network & Device Control
- \`emulate_device\` — Emulate device viewport/UA (presets: iphone14, ipad, pixel7, galaxy-s21, desktop-hd, desktop-4k, or custom)
- \`intercept_request\` — Mock/modify/block network requests via CDP (great for API testing)
- \`block_urls\` — Block URL patterns (ads, trackers, specific API endpoints)
- \`network_throttle\` — Simulate slow network (slow-3g, fast-3g, 4g, offline, custom speeds)
- \`get_event_listeners\` — Reveal ALL event listeners on an element (invisible to normal JS!)
- \`force_css_state\` — Force :hover/:focus/:active/:visited states for CSS debugging
- \`set_geolocation\` — Override browser geolocation for testing location features
- \`set_timezone\` — Override browser timezone
- \`emulate_media\` — Toggle dark/light mode, print styles, reduced motion via CSS media overrides

### ♿ Audit & Performance
- \`accessibility_audit\` — Run an accessibility check (missing alt text, unlabeled inputs, empty links, heading order, contrast, lang attribute). Optionally scope to a selector.
- \`get_performance\` — Get page performance metrics: load time, TTFB, LCP, CLS, memory usage, DOM size, resource counts

### 🔬 Deep Analysis & Debugging
- \`get_computed_style\` — Get ALL computed CSS values after cascade/inheritance (shows what browser ACTUALLY renders). Supports pseudo-elements.
- \`observe_dom\` — Watch for DOM mutations (additions, removals, attribute changes) for N seconds. Essential for debugging dynamic/reactive content.
- \`monitor_events\` — Record ALL events fired on an element for N seconds. Debug "why doesn't my click handler work" issues.
- \`js_coverage\` — Measure JS code coverage: start coverage → perform actions → stop to see which code ran (% used). Essential for performance optimization.
- \`animation_speed\` — Control CSS animation playback speed (0=paused, 0.25=slow-mo, 1=normal, 10=fast-forward). Debug animations frame by frame.
- \`extract_meta\` — Extract page metadata: title, description, Open Graph, Twitter Card, JSON-LD, canonical URL, favicons

### 🪟 Iframes & Shadow DOM
- \`list_iframes\` — List all iframes on page with URLs, dimensions, sandbox/allow attributes
- \`pierce_shadow\` — Query inside Shadow DOM: find, read text, click, or modify styles of elements in shadow roots
- \`inject_js(allFrames=true)\` — Execute JavaScript in ALL frames including iframes

### 🧹 Data Management
- \`clear_site_data\` — Clear cache, cookies, storage, service workers via CDP. Fresh-state testing.
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
### 🥷 Stealth & Anti-Detection
- \`enable_stealth\` — Activate comprehensive anti-detection stealth mode. Use when CAPTCHAs or anti-bot systems detect the extension. Protections: neutralizes debugger traps, spoofs DevTools detection, removes automation flags (navigator.webdriver), hides extension DOM artifacts, protects Function.prototype.toString. Also detaches chrome.debugger to remove the yellow "debugging" banner.
- \`disable_stealth\` — Deactivate stealth mode. A page reload is recommended after disabling.

**When to use stealth:**
- CAPTCHAs fail to render or behave differently
- Sites show "debugging detected" or block functionality
- Anti-bot systems interfere with automation
- Before interacting with security-sensitive pages

**Note:** When stealth mode is on, \`get_network_requests\` uses hook-based monitoring instead of chrome.debugger (which is highly detectable). Stealth injection runs early on every page navigation to beat anti-debug scripts.
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
${sectionsBlock}${consoleBlock}${errorsBlock}${customPrompt ? `\n\n## Custom Instructions\n${customPrompt}` : ''}`;
}
