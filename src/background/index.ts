// ============================================================
// Background Service Worker
// ============================================================
import type { Message } from '../shared/messaging';
import type { NetworkRequest, HookEvent, Patch, HookSummary } from '../shared/types';
import { getAIConfig, getPatches, addPatch, removePatch, setPatches, updatePatch } from '../shared/storage';

// --- State per tab ---
interface TabState {
  networkRequests: NetworkRequest[];
  hookEvents: HookEvent[];
  enabled: boolean;
}

const tabStates = new Map<number, TabState>();

function getTabState(tabId: number): TabState {
  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, { networkRequests: [], hookEvents: [], enabled: false });
  }
  return tabStates.get(tabId)!;
}

// --- Open side panel on action click ---
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// --- Clean up on tab close ---
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// --- Network request capture via chrome.debugger ---
const debuggerAttached = new Set<number>();

async function attachDebugger(tabId: number) {
  if (debuggerAttached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    debuggerAttached.add(tabId);
  } catch (e) {
    console.warn('Failed to attach debugger:', e);
  }
}

async function detachDebugger(tabId: number) {
  if (!debuggerAttached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
    debuggerAttached.delete(tabId);
  } catch (e) {
    console.warn('Failed to detach debugger:', e);
  }
}

chrome.debugger.onEvent.addListener((source, method, params: any) => {
  const tabId = source.tabId;
  if (!tabId) return;
  const state = getTabState(tabId);

  if (method === 'Network.responseReceived') {
    const resp = params.response;
    const req: NetworkRequest = {
      id: params.requestId,
      method: params.response?.requestHeaders ? 'GET' : 'GET',
      url: resp.url,
      type: mapResourceType(params.type),
      status: resp.status,
      statusText: resp.statusText,
      startTime: params.timestamp * 1000,
      duration: resp.timing ? resp.timing.receiveHeadersEnd : 0,
      requestHeaders: resp.requestHeaders ?? {},
      responseHeaders: resp.headers ?? {},
      failed: resp.status >= 400,
    };
    state.networkRequests.push(req);
    // Keep last 500
    if (state.networkRequests.length > 500) {
      state.networkRequests = state.networkRequests.slice(-500);
    }
  }

  if (method === 'Network.requestWillBeSent') {
    // Update method for existing requests
    const existing = state.networkRequests.find(r => r.id === params.requestId);
    if (existing) {
      existing.method = params.request.method;
    } else {
      const req: NetworkRequest = {
        id: params.requestId,
        method: params.request.method,
        url: params.request.url,
        type: 'other',
        status: 0,
        statusText: '',
        startTime: params.timestamp * 1000,
        duration: 0,
        requestHeaders: params.request.headers ?? {},
        responseHeaders: {},
        failed: false,
        initiator: params.initiator?.type,
      };
      state.networkRequests.push(req);
    }
  }

  if (method === 'Network.loadingFailed') {
    const existing = state.networkRequests.find(r => r.id === params.requestId);
    if (existing) {
      existing.failed = true;
      existing.statusText = params.errorText || 'Failed';
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) {
    debuggerAttached.delete(source.tabId);
  }
});

function mapResourceType(type: string): NetworkRequest['type'] {
  const map: Record<string, NetworkRequest['type']> = {
    XHR: 'xhr',
    Fetch: 'fetch',
    Script: 'script',
    Document: 'document',
    Stylesheet: 'stylesheet',
    Image: 'image',
    Font: 'font',
  };
  return map[type] ?? 'other';
}

// --- Message handler ---
let debugMode = false;
chrome.storage.local.get('kp_debug_mode').then(r => { debugMode = r.kp_debug_mode ?? false; });
chrome.storage.onChanged.addListener((changes) => {
  if ('kp_debug_mode' in changes) debugMode = changes.kp_debug_mode.newValue ?? false;
});

function debugLog(...args: unknown[]) {
  if (debugMode) console.log('[KP]', ...args);
}

console.log('[KP] Background v0.2.1 loaded');

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  debugLog('MSG ←', message.type, message.payload, 'from', sender.tab?.id ?? 'sidepanel');
  handleMessage(message, sender).then((result) => {
    debugLog('MSG →', message.type, result);
    sendResponse(result);
  }).catch((err) => {
    console.error('[KP] Message error:', message.type, err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async
});

// --- Robust content script passthrough with auto-injection fallback ---
const CONTENT_PASS_TYPES = new Set([
  'MODIFY_DOM', 'MODIFY_STYLE', 'INJECT_JS', 'INJECT_CSS',
  'INSPECT_ELEMENT', 'ELEMENT_INFO', 'READ_SECTIONS',
  'CHECK_EXISTS', 'CHECK_TEXT', 'AUTOMATE', 'RUN_FLOW_STEP',
  'INJECT_HOOKS', 'REMOVE_HOOKS', 'START_INSPECT', 'STOP_INSPECT',
]);

async function sendToTab(tabId: number, msg: unknown): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (err: any) {
    // Content script not loaded — inject it and retry once
    if (err?.message?.includes('Receiving end does not exist') || err?.message?.includes('Could not establish connection')) {
      debugLog('Content script not loaded, injecting...', tabId);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        // Small delay for script to initialize
        await new Promise(r => setTimeout(r, 100));
        return await chrome.tabs.sendMessage(tabId, msg);
      } catch (retryErr: any) {
        return { error: `Content script injection failed: ${retryErr.message}` };
      }
    }
    return { error: err.message };
  }
}

async function handleMessage(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id ?? (await getActiveTabId());
  if (!tabId) return { error: 'No active tab' };

  switch (msg.type) {
    // INJECT_JS: use chrome.scripting.executeScript to bypass page CSP
    case 'INJECT_JS': {
      const { code } = (msg.payload || {}) as { code: string };
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (c: string) => {
            try { return new Function(c)(); } catch (e: any) { return { error: e.message }; }
          },
          args: [code],
        });
        const val = results?.[0]?.result;
        if (val && typeof val === 'object' && 'error' in (val as any)) {
          return val;
        }
        return { ok: true, result: val };
      } catch (e: any) {
        return { error: e.message };
      }
    }

    // Content-script passthrough messages
    case 'MODIFY_DOM':
    case 'MODIFY_STYLE':
    case 'INJECT_CSS':
    case 'INSPECT_ELEMENT':
    case 'ELEMENT_INFO':
    case 'READ_SECTIONS':
    case 'CHECK_EXISTS':
    case 'CHECK_TEXT':
    case 'AUTOMATE':
    case 'RUN_FLOW_STEP':
    case 'INJECT_HOOKS':
    case 'REMOVE_HOOKS':
    case 'START_INSPECT':
    case 'STOP_INSPECT':
      return sendToTab(tabId, msg);

    case 'GET_PAGE_CONTEXT':
      return sendToTab(tabId, { type: 'READ_DOM' });

    case 'GET_NETWORK_REQUESTS': {
      await attachDebugger(tabId);
      const state = getTabState(tabId);
      return state.networkRequests;
    }

    case 'HOOK_EVENT': {
      const state = getTabState(tabId);
      const event = msg.payload as HookEvent;
      state.hookEvents.push(event);
      if (state.hookEvents.length > 1000) {
        state.hookEvents = state.hookEvents.slice(-1000);
      }
      return { ok: true };
    }

    case 'GET_HOOK_EVENTS': {
      const state = getTabState(tabId);
      return state.hookEvents;
    }

    case 'GET_HOOK_SUMMARY': {
      const state = getTabState(tabId);
      return computeHookSummary(state.hookEvents);
    }

    case 'ELEMENT_SELECTED':
      return { ok: true };

    case 'TOGGLE_PATCH': {
      const { id, enabled } = msg.payload as { id: string; enabled: boolean };
      await updatePatch(id, { enabled });
      if (enabled) {
        const patches = await getPatches();
        const patch = patches.find(p => p.id === id);
        if (patch) return sendToTab(tabId, { type: 'APPLY_PATCH', payload: patch });
      } else {
        return sendToTab(tabId, { type: 'ROLLBACK_PATCH', payload: id });
      }
      return { ok: true };
    }

    case 'APPLY_PATCH': {
      const patch = msg.payload as Patch;
      await addPatch(patch);
      return sendToTab(tabId, msg);
    }

    case 'ROLLBACK_PATCH': {
      const patchId = msg.payload as string;
      await removePatch(patchId);
      return sendToTab(tabId, { type: 'ROLLBACK_PATCH', payload: patchId });
    }

    case 'ROLLBACK_ALL': {
      await setPatches([]);
      return sendToTab(tabId, { type: 'ROLLBACK_ALL' });
    }

    case 'GET_PATCHES':
      return getPatches();

    default:
      debugLog('UNHANDLED message type:', msg.type);
      return { error: `Unknown message type: ${msg.type}` };
  }
}

function computeHookSummary(events: HookEvent[]): HookSummary {
  const summary: HookSummary = {
    totalEvents: events.length,
    domMutationCount: 0,
    scriptInjectCount: 0,
    fetchCount: 0,
    xhrCount: 0,
    errorCount: 0,
    navigationCount: 0,
    timerCount: 0,
    topMutatedSelectors: [],
    recentErrors: [],
  };

  const mutationCounts = new Map<string, number>();

  for (const ev of events) {
    switch (ev.type) {
      case 'dom-mutation':
        summary.domMutationCount++;
        const target = (ev.detail as any)?.target || 'unknown';
        mutationCounts.set(target, (mutationCounts.get(target) || 0) + 1);
        break;
      case 'script-inject': summary.scriptInjectCount++; break;
      case 'fetch': summary.fetchCount++; break;
      case 'xhr': summary.xhrCount++; break;
      case 'error':
        summary.errorCount++;
        summary.recentErrors.push(ev.summary);
        break;
      case 'navigation': summary.navigationCount++; break;
      case 'timer': summary.timerCount++; break;
    }
  }

  summary.recentErrors = summary.recentErrors.slice(-10);
  summary.topMutatedSelectors = Array.from(mutationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([selector, count]) => ({ selector, count }));

  return summary;
}

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}
