// ============================================================
// Background Service Worker
// ============================================================
import type { Message } from '../shared/messaging';
import type { NetworkRequest, HookEvent, Patch, HookSummary, UserScript } from '../shared/types';
import { getAIConfig, getPatches, addPatch, removePatch, setPatches, updatePatch, getScripts, updateScript } from '../shared/storage';

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

console.log('[KP] Background v0.2.3 loaded');

// --- Re-apply active scripts on page navigation ---
// Debounce per tab to prevent double-injection from multiple triggers
const lastReapply = new Map<number, number>();

async function reapplyActiveScripts(tabId: number, url: string) {
  // Skip chrome:// and extension pages
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

  // Debounce: skip if we reapplied this tab within 800ms
  const now = Date.now();
  if (now - (lastReapply.get(tabId) || 0) < 800) return;
  lastReapply.set(tabId, now);

  debugLog('reapplyActiveScripts →', tabId, url);

  try {
    const scripts = await getScripts();
    for (const s of scripts) {
      if (!s.enabled) continue;

      // Re-apply active toggle scripts
      const shouldReapply = s.mode === 'toggle' && s.active;
      // Auto-apply scripts that trigger on every page
      const shouldAutoApply = s.trigger === 'auto' && (s.mode === 'action' || !s.active);
      // URL-match scripts
      const shouldUrlMatch = s.trigger === 'url-match' && s.urlPattern && !s.active && matchUrl(url, s.urlPattern);

      if (!shouldReapply && !shouldAutoApply && !shouldUrlMatch) continue;

      debugLog('Script auto-apply:', s.name, '→', url);

      try {
        if (s.type === 'css') {
          // Use chrome.scripting.insertCSS — no content script needed, more reliable
          await chrome.scripting.insertCSS({
            target: { tabId },
            css: s.code,
          });
          await updateScript(s.id, { active: true, lastRunAt: Date.now(), lastRunResult: '● ON (auto)' });
        } else {
          // JS: use chrome.scripting.executeScript directly
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (c: string) => { try { new Function(c)(); } catch (e: any) { console.error('[KP]', e); } },
            args: [s.code],
          });
          await updateScript(s.id, { active: true, lastRunAt: Date.now(), lastRunResult: '● ON (auto)' });
        }
      } catch (e: any) {
        debugLog('Script auto-apply failed:', s.name, e.message);
      }
    }
  } catch (e) {
    debugLog('Script reapply error:', e);
  }
}

// Trigger 1: Content script signals readiness (most reliable — no race condition)
// This is handled in the message handler below via CONTENT_READY case

// Trigger 2: SPA navigations (pushState/replaceState) — content script doesn't reinit
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  debugLog('SPA navigation detected:', details.tabId, details.url);
  await reapplyActiveScripts(details.tabId, details.url);
});

// Trigger 3: Reference-fragment navigations (hash changes within SPA)
chrome.webNavigation.onReferenceFragmentUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await reapplyActiveScripts(details.tabId, details.url);
});

function matchUrl(url: string, pattern: string): boolean {
  try {
    // Try as regex first
    return new RegExp(pattern).test(url);
  } catch {
    // Fallback: treat as glob-like pattern (convert * to .*)
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(url);
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  debugLog('MSG ←', message.type, message.payload, 'from', sender.tab?.id ?? 'sidepanel');
  handleMessage(message, sender).then((result) => {
    debugLog('MSG →', message.type, result);
    try { sendResponse(result); } catch (_) { /* channel already closed */ }
  }).catch((err) => {
    console.error('[KP] Message error:', message.type, err);
    try { sendResponse({ error: err.message }); } catch (_) { /* channel already closed */ }
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
          func: async (c: string) => {
            try {
              const fn = new Function(c);
              const result = fn();
              // Support async/promise-returning scripts
              if (result && typeof result === 'object' && typeof result.then === 'function') {
                return await result;
              }
              return result;
            } catch (e: any) { return { error: e.message }; }
          },
          args: [code],
        });
        const val = results?.[0]?.result;
        if (val && typeof val === 'object' && 'error' in (val as any)) {
          return val;
        }
        return { ok: true, result: val ?? null };
      } catch (e: any) {
        return { error: e.message };
      }
    }

    // REMOVE_CSS: use chrome.scripting.removeCSS to cleanly undo insertCSS
    case 'REMOVE_CSS': {
      const { css } = (msg.payload || {}) as { css: string };
      try {
        await chrome.scripting.removeCSS({ target: { tabId }, css });
        return { ok: true };
      } catch (e: any) {
        // Fallback: remove via chrome.scripting.executeScript (no content script dependency)
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (cssText: string) => {
              document.querySelectorAll('style').forEach(s => {
                if (s.textContent === cssText) s.remove();
              });
            },
            args: [css],
          });
          return { ok: true };
        } catch (e2: any) {
          return { error: e2.message };
        }
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

    case 'SCREENSHOT': {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(undefined as any, { format: 'png' });
        return { ok: true, dataUrl };
      } catch (e: any) {
        return { error: `Screenshot failed: ${e.message}` };
      }
    }

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

    // Content script signals it's fully initialized — re-inject active scripts
    case 'CONTENT_READY': {
      const url = sender.tab?.url || (msg.payload as any)?.url || '';
      debugLog('Content script ready on tab', tabId, url);
      // Don't await — let it run in background to avoid blocking the response
      reapplyActiveScripts(tabId, url);
      return { ok: true };
    }

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
