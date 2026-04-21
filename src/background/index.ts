// ============================================================
// Background Service Worker
// ============================================================
import type { Message } from '../shared/messaging';
import type { NetworkRequest, HookEvent, Patch, HookSummary, UserScript } from '../shared/types';
import { getAIConfig, getPatches, addPatch, removePatch, setPatches, updatePatch, getScripts, updateScript, getStealthMode, setStealthMode } from '../shared/storage';

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

// --- Stealth mode state ---
let stealthMode = false;
chrome.storage.local.get('kp_stealth_mode').then(r => { stealthMode = r.kp_stealth_mode ?? false; });
chrome.storage.onChanged.addListener((changes) => {
  if ('kp_stealth_mode' in changes) stealthMode = changes.kp_stealth_mode.newValue ?? false;
});

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

    // Capture response body for xhr/fetch (text-based, capped at 10KB)
    if ((req.type === 'xhr' || req.type === 'fetch' || req.type === 'document') && tabId) {
      chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: params.requestId })
        .then((result: any) => {
          if (result?.body) {
            req.responsePreview = result.body.slice(0, 10000);
          }
        })
        .catch(() => { /* not all responses have bodies */ });
    }

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
      // Capture request body (POST data)
      if (params.request.postData) {
        (existing as any).requestBody = params.request.postData.slice(0, 10000);
      }
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
      // Capture request body (POST data)
      if (params.request.postData) {
        (req as any).requestBody = params.request.postData.slice(0, 10000);
      }
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

  // Handle Fetch.requestPaused for request interception
  if (method === 'Fetch.requestPaused' && tabId) {
    const intercepts = (state as any).intercepts as Array<{
      urlPattern: string; action: string;
      responseBody?: string; responseStatus?: number; responseHeaders?: Record<string, string>;
      headers?: Record<string, string>;
    }> | undefined;
    if (!intercepts?.length) {
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      return;
    }
    const requestUrl = params.request?.url || '';
    const match = intercepts.find(i => {
      try { return new RegExp(i.urlPattern.replace(/\*/g, '.*')).test(requestUrl); } catch { return requestUrl.includes(i.urlPattern); }
    });
    if (!match) {
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      return;
    }
    if (match.action === 'mock') {
      const body = btoa(match.responseBody || '{}');
      const headers = Object.entries(match.responseHeaders || { 'Content-Type': 'application/json' })
        .map(([name, value]) => ({ name, value }));
      chrome.debugger.sendCommand({ tabId }, 'Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: match.responseStatus || 200,
        responseHeaders: headers,
        body,
      }).catch(() => {});
    } else if (match.action === 'modify-headers') {
      const headers = Object.entries(match.headers || {}).map(([name, value]) => ({ name, value }));
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId,
        headers,
      }).catch(() => {});
    } else if (match.action === 'block') {
      chrome.debugger.sendCommand({ tabId }, 'Fetch.failRequest', {
        requestId: params.requestId,
        reason: 'BlockedByClient',
      }).catch(() => {});
    } else {
      chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
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

// ============================================================
// Stealth Anti-Detection System
// Injects code EARLY (before page scripts) to neutralize
// anti-debugging, anti-automation, and DevTools detection.
// ============================================================

/** The stealth code to inject into the page MAIN world */
function getStealthPayload(): () => void {
  return function () {
    if ((window as any).__kp_stealth_active) return;
    (window as any).__kp_stealth_active = true;

    // ===== 1. Neutralize `debugger` statement traps =====
    // Override Function constructor to strip debugger from dynamically created functions
    const OrigFunction = Function;
    const fnHandler: ProxyHandler<typeof Function> = {
      construct(target, args) {
        if (args.length > 0) {
          const last = args.length - 1;
          if (typeof args[last] === 'string' && /\bdebugger\b/.test(args[last])) {
            args[last] = args[last].replace(/\bdebugger\b/g, '/* noop */');
          }
        }
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        if (args.length > 0) {
          const last = args.length - 1;
          if (typeof args[last] === 'string' && /\bdebugger\b/.test(args[last])) {
            args[last] = args[last].replace(/\bdebugger\b/g, '/* noop */');
          }
        }
        return Reflect.apply(target, thisArg, args);
      },
    };
    (window as any).Function = new Proxy(OrigFunction, fnHandler);

    // Override eval to strip debugger
    const origEval = window.eval;
    (window as any).eval = function (code: any) {
      if (typeof code === 'string') {
        code = code.replace(/\bdebugger\b/g, '/* noop */');
      }
      return origEval.call(this, code);
    };

    // setInterval/setTimeout: strip debugger from string-based calls
    const origSetInterval = window.setInterval;
    const origSetTimeout = window.setTimeout;
    (window as any).setInterval = function (fn: any, ...rest: any[]) {
      if (typeof fn === 'string' && /\bdebugger\b/.test(fn)) {
        fn = fn.replace(/\bdebugger\b/g, '/* noop */');
      }
      return origSetInterval.call(window, fn, ...rest);
    };
    (window as any).setTimeout = function (fn: any, ...rest: any[]) {
      if (typeof fn === 'string' && /\bdebugger\b/.test(fn)) {
        fn = fn.replace(/\bdebugger\b/g, '/* noop */');
      }
      return origSetTimeout.call(window, fn, ...rest);
    };

    // ===== 2. Spoof DevTools size-based detection =====
    // Many anti-debug scripts check: outerWidth - innerWidth > threshold
    try {
      Object.defineProperty(window, 'outerWidth', {
        get: () => window.innerWidth,
        configurable: true,
      });
      Object.defineProperty(window, 'outerHeight', {
        get: () => window.innerHeight + 80, // account for browser chrome
        configurable: true,
      });
    } catch (_) {}

    // ===== 3. Remove automation/webdriver flags =====
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });
    } catch (_) {}
    // Remove CDP artifacts
    const cdcKeys = Object.keys(window).filter(
      (k) => k.startsWith('cdc_') || k.startsWith('__webdriver')
    );
    for (const k of cdcKeys) {
      try { delete (window as any)[k]; } catch (_) {}
    }

    // ===== 4. Protect Function.prototype.toString =====
    // Anti-debug scripts call fn.toString() to check if native functions were overridden
    const nativeStrings = new Map<Function, string>();
    const origToString = Function.prototype.toString;
    nativeStrings.set(origToString, 'function toString() { [native code] }');
    nativeStrings.set((window as any).eval, 'function eval() { [native code] }');
    nativeStrings.set((window as any).Function, 'function Function() { [native code] }');
    nativeStrings.set((window as any).setInterval, 'function setInterval() { [native code] }');
    nativeStrings.set((window as any).setTimeout, 'function setTimeout() { [native code] }');

    Function.prototype.toString = function () {
      if (nativeStrings.has(this)) return nativeStrings.get(this)!;
      return origToString.call(this);
    };
    nativeStrings.set(Function.prototype.toString, 'function toString() { [native code] }');

    // ===== 5. Console-based DevTools detection =====
    // Some scripts use console.log with getter-objects to detect DevTools
    // We can't fully prevent, but we can block the image-loading trick
    // Override console.table/log to strip detection objects
    const origConsoleTable = console.table;
    console.table = function (...args: any[]) {
      // Block devtools-detect patterns that use console.table with a special element
      try {
        if (args.length === 1 && args[0] instanceof HTMLElement) return;
      } catch (_) {}
      return origConsoleTable.apply(console, args);
    };
    nativeStrings.set(console.table, 'function table() { [native code] }');

    // ===== 6. Hide KuroPatch DOM artifacts =====
    // Wrap querySelectorAll/querySelector to filter out __kp_ elements
    // when querying generic selectors that anti-debug scripts might use
    const origQSA = Document.prototype.querySelectorAll;
    const origQS = Document.prototype.querySelector;
    const kpIdPattern = /^__kp_/;

    Document.prototype.querySelectorAll = function (sel: string) {
      const result = origQSA.call(this, sel);
      // Only filter for generic queries that might expose our elements
      if (sel === 'script' || sel === 'style' || sel === '[id]' || sel === 'div') {
        const filtered = Array.from(result).filter(
          (el) => !kpIdPattern.test((el as Element).id || '')
        );
        // Return an array-like that behaves as NodeList
        return filtered as unknown as NodeListOf<Element>;
      }
      return result;
    };
    nativeStrings.set(Document.prototype.querySelectorAll, 'function querySelectorAll() { [native code] }');

    Document.prototype.querySelector = function (sel: string) {
      const result = origQS.call(this, sel);
      if (result && kpIdPattern.test(result.id || '')) return null;
      return result;
    };
    nativeStrings.set(Document.prototype.querySelector, 'function querySelector() { [native code] }');

    // ===== 7. Date.now / performance.now timing protection =====
    // Anti-debug: let t=Date.now(); debugger; if(Date.now()-t > 100) detected
    // Since we strip debugger above, this is mostly neutralized already.
    // But we add a small safety net: prevent timing gaps > 50ms from being detected
    // by capping the delta that debugger-adjacent code sees.
    // (We don't override globally since that would break page logic —
    //  the function-constructor patching above is the primary defense.)
  };
}

/** Inject stealth code into a tab's MAIN world early */
async function injectStealthCode(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: getStealthPayload(),
      injectImmediately: true,
    });
    debugLog('Stealth injected into tab', tabId);
  } catch (e: any) {
    debugLog('Stealth injection failed:', tabId, e.message);
  }
}

// Early stealth injection: inject on page commit (before scripts run)
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) return;
  if (!stealthMode) return;
  debugLog('Stealth early-inject on commit:', details.tabId, details.url);
  await injectStealthCode(details.tabId);
});

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

/** Wait for tab to reach 'complete' status (with timeout) */
async function waitForTabReady(tabId: number, timeoutMs = 10000): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return true;
  } catch { return false; }
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }, timeoutMs);
    const listener = (updatedId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && changeInfo.status === 'complete') {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Track last injection attempt per tab to debounce rapid retries */
const lastInjectionAttempt = new Map<number, number>();

async function sendToTab(tabId: number, msg: unknown): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (err: any) {
    const errMsg = err?.message || '';
    // Detect content script not loaded or destroyed mid-navigation
    const isDisconnect = errMsg.includes('Receiving end does not exist')
      || errMsg.includes('Could not establish connection')
      || errMsg.includes('message channel closed')
      || errMsg.includes('message port closed');

    if (!isDisconnect) return { error: errMsg };

    // Debounce: skip if we attempted injection within the last 1s for this tab
    const now = Date.now();
    const lastAttempt = lastInjectionAttempt.get(tabId) || 0;
    if (now - lastAttempt < 1000) {
      return { error: 'Page is navigating — please wait a moment and retry.' };
    }
    lastInjectionAttempt.set(tabId, now);

    // Verify tab URL is injectable (not chrome://, about:, etc.)
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url || '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url === '') {
        return { error: `Cannot inject into this page: ${url}` };
      }
    } catch { return { error: 'Tab no longer exists' }; }

    debugLog('Content script disconnected, waiting for tab ready...', tabId);
    // Wait for the tab to finish loading before re-injecting (5s timeout)
    const ready = await waitForTabReady(tabId, 5000);
    if (!ready) {
      // Page might be stuck or unresponsive — try injection anyway as a last resort
      debugLog('Tab not complete after 5s, attempting injection anyway...', tabId);
    }

    try {
      debugLog('Re-injecting content script...', tabId);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Wait for script to initialize
      await new Promise(r => setTimeout(r, 300));
      const result = await chrome.tabs.sendMessage(tabId, msg);
      // Injection succeeded — clear debounce so subsequent calls go through immediately
      lastInjectionAttempt.delete(tabId);
      return result;
    } catch (retryErr: any) {
      return { error: `Content script injection failed: ${retryErr.message}` };
    }
  }
}

async function handleMessage(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id ?? (await getActiveTabId());
  if (!tabId) return { error: 'No active tab' };

  switch (msg.type) {
    // INJECT_JS: use chrome.scripting.executeScript to bypass page CSP
    case 'INJECT_JS': {
      const { code, timeout = 10000, allFrames = false } = (msg.payload || {}) as { code: string; timeout?: number; allFrames?: boolean };
      const maxTimeout = Math.min(timeout, 30000);
      try {
        const execPromise = chrome.scripting.executeScript({
          target: { tabId, allFrames },
          world: 'MAIN',
          func: async (c: string, tmo: number) => {
            const startTime = performance.now();
            try {
              const fn = new Function(c);
              const raw = fn();
              // Support async/promise-returning scripts with inner timeout
              if (raw && typeof raw === 'object' && typeof raw.then === 'function') {
                const result = await Promise.race([
                  raw,
                  new Promise((_, rej) => setTimeout(() => rej(new Error('Async operation timed out')), tmo)),
                ]);
                return { ok: true, result: result ?? null, executionTime: Math.round(performance.now() - startTime), async: true };
              }
              return { ok: true, result: raw ?? null, executionTime: Math.round(performance.now() - startTime) };
            } catch (e: any) {
              return {
                error: e.message,
                stack: (e.stack || '').split('\n').slice(0, 5).join('\n'),
                errorType: e.constructor?.name || 'Error',
                executionTime: Math.round(performance.now() - startTime),
              };
            }
          },
          args: [code, maxTimeout],
        });
        const results = await Promise.race([
          execPromise,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Script execution timed out after ${maxTimeout}ms`)), maxTimeout + 1000)),
        ]);
        const val = results?.[0]?.result;
        return val || { error: 'No result returned' };
      } catch (e: any) {
        return {
          error: e.message,
          hint: e.message.includes('timed out') ? 'Script exceeded timeout. Simplify code or increase timeout parameter.' : undefined,
        };
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
        const { format, quality } = (msg.payload || {}) as { format?: string; quality?: number };
        const fmt = format === 'webp' ? 'jpeg' : 'png'; // chrome API uses 'jpeg' for webp-like compression
        const opts: chrome.tabs.CaptureVisibleTabOptions = { format: fmt as any };
        if (format === 'webp' && quality !== undefined) opts.quality = Math.min(100, Math.max(0, quality));
        else if (format === 'webp') opts.quality = 80;
        const dataUrl = await chrome.tabs.captureVisibleTab(undefined as any, opts);
        return { ok: true, dataUrl };
      } catch (e: any) {
        return { error: `Screenshot failed: ${e.message}` };
      }
    }

    case 'GET_NETWORK_REQUESTS': {
      // In stealth mode, skip chrome.debugger to avoid the yellow "debugging" banner
      if (!stealthMode) {
        await attachDebugger(tabId);
      }
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

    case 'ENABLE_STEALTH': {
      stealthMode = true;
      await setStealthMode(true);
      // Detach debugger from all tabs to remove yellow banner
      try {
        const targets = await chrome.debugger.getTargets();
        for (const t of targets) {
          if (t.tabId && t.attached) {
            try { await chrome.debugger.detach({ tabId: t.tabId }); } catch (_) {}
          }
        }
      } catch (_) {}
      // Inject stealth into current tab
      if (tabId) {
        try { await injectStealthCode(tabId); } catch (_) {}
      }
      return { success: true, message: 'Stealth mode enabled. Debugger detached, anti-detection active.' };
    }

    case 'DISABLE_STEALTH': {
      stealthMode = false;
      await setStealthMode(false);
      return { success: true, message: 'Stealth mode disabled. Page reload recommended to clear injections.' };
    }

    // ========== Navigate ==========
    case 'NAVIGATE': {
      const { url, action, waitFor, waitUntil } = (msg.payload || {}) as { url?: string; action?: string; waitFor?: string; waitUntil?: string };
      try {
        if (url) {
          // Validate URL
          try { new URL(url); } catch { return { error: `Invalid URL: ${url}` }; }
          await chrome.tabs.update(tabId, { url });
        } else if (action === 'back') {
          await chrome.tabs.goBack(tabId);
        } else if (action === 'forward') {
          await chrome.tabs.goForward(tabId);
        } else if (action === 'reload') {
          await chrome.tabs.reload(tabId);
        } else {
          return { error: 'Provide url or action (back/forward/reload)' };
        }
        // Wait for load based on waitUntil option
        const waitEvent = waitUntil === 'domcontentloaded' ? 'loading' : 'complete';
        await new Promise<void>((resolve) => {
          const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (updatedTabId === tabId) {
              if (waitUntil === 'domcontentloaded' && changeInfo.status === 'loading') {
                // DOMContentLoaded fires during 'loading' → resolve early
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              } else if (changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
        });
        // networkidle: wait until no new requests for 500ms
        if (waitUntil === 'networkidle') {
          const state = getTabState(tabId);
          let settled = false;
          for (let i = 0; i < 20 && !settled; i++) {
            const countBefore = state.networkRequests.length;
            await new Promise(r => setTimeout(r, 500));
            if (state.networkRequests.length === countBefore) settled = true;
          }
        }
        // Ensure content script is ready after navigation
        await new Promise(r => setTimeout(r, 300));
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'READ_DOM' });
        } catch {
          // Content script not ready — inject and wait
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            await new Promise(r => setTimeout(r, 300));
          } catch (_) { /* may fail on special pages */ }
        }
        // Optional: wait for a selector
        if (waitFor) {
          await sendToTab(tabId, { type: 'AUTOMATE', payload: { type: 'waitForSelector', selector: waitFor, timeout: 10000 } });
        }
        const tab = await chrome.tabs.get(tabId);
        return { ok: true, url: tab.url, title: tab.title };
      } catch (e: any) {
        return { error: `Navigation failed: ${e.message}` };
      }
    }

    // ========== Cookies ==========
    case 'GET_COOKIES': {
      const { name, domain } = (msg.payload || {}) as { name?: string; domain?: string };
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = domain ? `https://${domain}` : tab.url;
        const query: chrome.cookies.GetAllDetails = { url: url || '' };
        if (name) query.name = name;
        const cookies = await chrome.cookies.getAll(query);
        return {
          cookies: cookies.map(c => ({
            name: c.name,
            value: c.value.slice(0, 500),
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
            session: c.session,
          })),
          total: cookies.length,
        };
      } catch (e: any) {
        return { error: `Cookie read failed: ${e.message}` };
      }
    }

    case 'SET_COOKIE': {
      const { name: cName, value: cValue, domain: cDomain, path: cPath, secure, httpOnly, sameSite, expiresInSeconds } = (msg.payload || {}) as any;
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = tab.url || '';
        const details: chrome.cookies.SetDetails = {
          url,
          name: cName,
          value: cValue,
          path: cPath || '/',
        };
        if (cDomain) details.domain = cDomain;
        if (secure !== undefined) details.secure = secure;
        if (httpOnly !== undefined) details.httpOnly = httpOnly;
        if (sameSite) details.sameSite = sameSite;
        if (expiresInSeconds && expiresInSeconds > 0) {
          details.expirationDate = Math.floor(Date.now() / 1000) + expiresInSeconds;
        }
        const cookie = await chrome.cookies.set(details);
        return { ok: true, cookie: { name: cookie?.name, domain: cookie?.domain, path: cookie?.path } };
      } catch (e: any) {
        return { error: `Cookie set failed: ${e.message}` };
      }
    }

    // ========== Device Emulation ==========
    case 'EMULATE_DEVICE': {
      const payload = (msg.payload || {}) as any;
      const presets: Record<string, { width: number; height: number; dpr: number; ua: string }> = {
        'iphone14': { width: 390, height: 844, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
        'iphone-se': { width: 375, height: 667, dpr: 2, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
        'ipad': { width: 810, height: 1080, dpr: 2, ua: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
        'pixel7': { width: 412, height: 915, dpr: 2.625, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
        'galaxy-s21': { width: 360, height: 800, dpr: 3, ua: 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
        'desktop-hd': { width: 1920, height: 1080, dpr: 1, ua: '' },
        'desktop-4k': { width: 3840, height: 2160, dpr: 2, ua: '' },
      };
      try {
        if (stealthMode) return { error: 'Cannot emulate device in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'reset') {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride');
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setUserAgentOverride', { userAgent: '' });
          return { ok: true, message: 'Device emulation reset' };
        }
        const preset = payload.preset ? presets[payload.preset] : null;
        const width = payload.width || preset?.width || 1280;
        const height = payload.height || preset?.height || 720;
        const dpr = payload.deviceScaleFactor || preset?.dpr || 1;
        const ua = payload.userAgent || preset?.ua || '';
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: dpr, mobile: width < 768,
        });
        if (ua) {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setUserAgentOverride', { userAgent: ua });
        }
        return { ok: true, width, height, deviceScaleFactor: dpr, userAgent: ua || '(default)', mobile: width < 768 };
      } catch (e: any) {
        return { error: `Device emulation failed: ${e.message}` };
      }
    }

    // ========== Request Interception ==========
    case 'INTERCEPT_REQUEST': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot intercept requests in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'clear') {
          await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable');
          return { ok: true, message: 'All request intercepts cleared' };
        }
        // Enable Fetch domain for interception
        const patterns = payload.urlPattern ? [{ urlPattern: payload.urlPattern, requestStage: 'Response' as const }] : [];
        await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns });

        // Store intercept config in tab state for the event handler
        const state = getTabState(tabId);
        if (!(state as any).intercepts) (state as any).intercepts = [];
        (state as any).intercepts.push({
          urlPattern: payload.urlPattern,
          action: payload.action,
          responseBody: payload.responseBody,
          responseStatus: payload.responseStatus || 200,
          responseHeaders: payload.responseHeaders ? JSON.parse(payload.responseHeaders) : { 'Content-Type': 'application/json' },
          headers: payload.headers ? JSON.parse(payload.headers) : {},
        });

        return { ok: true, message: `Intercept configured: ${payload.action} on ${payload.urlPattern}` };
      } catch (e: any) {
        return { error: `Request interception failed: ${e.message}` };
      }
    }

    // ========== Block URLs ==========
    case 'BLOCK_URLS': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot block URLs in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'clear') {
          await chrome.debugger.sendCommand({ tabId }, 'Network.setBlockedURLs', { urls: [] });
          return { ok: true, message: 'All URL blocks cleared' };
        }
        let patterns: string[];
        try { patterns = JSON.parse(payload.patterns); } catch { return { error: 'Invalid JSON in patterns parameter' }; }
        await chrome.debugger.sendCommand({ tabId }, 'Network.setBlockedURLs', { urls: patterns });
        return { ok: true, blocked: patterns, count: patterns.length };
      } catch (e: any) {
        return { error: `URL blocking failed: ${e.message}` };
      }
    }

    // ========== Network Throttle ==========
    case 'NETWORK_THROTTLE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot throttle network in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'reset') {
          await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
            offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
          });
          return { ok: true, message: 'Network throttle reset to normal' };
        }
        const presets: Record<string, { offline: boolean; latency: number; down: number; up: number }> = {
          'slow-3g':  { offline: false, latency: 400, down: 400 * 1024 / 8, up: 400 * 1024 / 8 },
          'fast-3g':  { offline: false, latency: 150, down: 1600 * 1024 / 8, up: 750 * 1024 / 8 },
          '4g':       { offline: false, latency: 20,  down: 9000 * 1024 / 8, up: 9000 * 1024 / 8 },
          'offline':  { offline: true,  latency: 0,   down: 0, up: 0 },
        };
        const p = payload.preset ? presets[payload.preset] : null;
        const offline = p?.offline || false;
        const latency = payload.latencyMs ?? p?.latency ?? 0;
        const down = payload.downloadKbps ? (payload.downloadKbps * 1024 / 8) : (p?.down ?? -1);
        const up = payload.uploadKbps ? (payload.uploadKbps * 1024 / 8) : (p?.up ?? -1);
        await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
          offline, latency, downloadThroughput: down, uploadThroughput: up,
        });
        return { ok: true, preset: payload.preset || 'custom', offline, latencyMs: latency, downloadKbps: Math.round(down * 8 / 1024), uploadKbps: Math.round(up * 8 / 1024) };
      } catch (e: any) {
        return { error: `Network throttle failed: ${e.message}` };
      }
    }

    // ========== Get Event Listeners ==========
    case 'GET_EVENT_LISTENERS': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot inspect event listeners in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        // Resolve selector to remote object
        const evalResult = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `document.querySelector('${(payload.selector || '').replace(/'/g, "\\'")}')`,
          objectGroup: 'kuropatch',
        }) as any;
        if (!evalResult?.result?.objectId) return { error: `Element not found: ${payload.selector}` };
        // Get event listeners via CDP
        const listenersResult = await chrome.debugger.sendCommand({ tabId }, 'DOMDebugger.getEventListeners', {
          objectId: evalResult.result.objectId,
        }) as any;
        const listeners = (listenersResult?.listeners || []).map((l: any) => ({
          type: l.type,
          useCapture: l.useCapture,
          passive: l.passive,
          once: l.once,
          handler: l.handler?.description?.slice(0, 200) || '(native)',
          lineNumber: l.lineNumber,
          columnNumber: l.columnNumber,
          scriptId: l.scriptId,
        }));
        // Release object
        chrome.debugger.sendCommand({ tabId }, 'Runtime.releaseObjectGroup', { objectGroup: 'kuropatch' }).catch(() => {});
        return { listeners, total: listeners.length, selector: payload.selector };
      } catch (e: any) {
        return { error: `Get event listeners failed: ${e.message}` };
      }
    }

    // ========== Force CSS State ==========
    case 'FORCE_CSS_STATE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot force CSS state in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
        // Find the DOM node
        const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument') as any;
        const nodeResult = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: payload.selector,
        }) as any;
        if (!nodeResult?.nodeId) return { error: `Element not found: ${payload.selector}` };
        const stateNames = payload.action === 'clear' ? [] :
          (payload.states || 'hover').split(',').map((s: string) => s.trim()).filter(Boolean);
        await chrome.debugger.sendCommand({ tabId }, 'CSS.enable');
        await chrome.debugger.sendCommand({ tabId }, 'CSS.forcePseudoState', {
          nodeId: nodeResult.nodeId,
          forcedPseudoClasses: stateNames,
        });
        return { ok: true, selector: payload.selector, forcedStates: stateNames };
      } catch (e: any) {
        return { error: `Force CSS state failed: ${e.message}` };
      }
    }

    // ========== Set Geolocation ==========
    case 'SET_GEOLOCATION': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot set geolocation in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'reset') {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearGeolocationOverride');
          return { ok: true, message: 'Geolocation reset to real location' };
        }
        if (payload.latitude == null || payload.longitude == null) return { error: 'latitude and longitude are required' };
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setGeolocationOverride', {
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy || 100,
        });
        return { ok: true, latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy || 100 };
      } catch (e: any) {
        return { error: `Set geolocation failed: ${e.message}` };
      }
    }

    // ========== Set Timezone ==========
    case 'SET_TIMEZONE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot set timezone in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'reset') {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setTimezoneOverride', { timezoneId: '' });
          return { ok: true, message: 'Timezone reset' };
        }
        if (!payload.timezoneId) return { error: 'timezoneId is required (e.g. "America/New_York")' };
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setTimezoneOverride', {
          timezoneId: payload.timezoneId,
        });
        return { ok: true, timezoneId: payload.timezoneId };
      } catch (e: any) {
        return { error: `Set timezone failed: ${e.message}` };
      }
    }

    // ========== Emulate Media ==========
    case 'EMULATE_MEDIA': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot emulate media in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'reset') {
          await chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedMedia', { media: '', features: [] });
          return { ok: true, message: 'Media emulation reset' };
        }
        const features: Array<{name: string; value: string}> = [];
        if (payload.colorScheme) features.push({ name: 'prefers-color-scheme', value: payload.colorScheme });
        if (payload.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: payload.reducedMotion });
        if (payload.forcedColors) features.push({ name: 'forced-colors', value: payload.forcedColors });
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setEmulatedMedia', {
          media: payload.mediaType || '',
          features,
        });
        return { ok: true, mediaType: payload.mediaType || '(default)', features: features.map(f => `${f.name}: ${f.value}`) };
      } catch (e: any) {
        return { error: `Emulate media failed: ${e.message}` };
      }
    }

    // ========== PDF Page ==========
    case 'PDF_PAGE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot generate PDF in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        const pdfResult = await chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', {
          landscape: payload.landscape || false,
          printBackground: payload.printBackground !== false,
          scale: payload.scale || 1,
          paperWidth: payload.paperWidth || 8.5,
          paperHeight: payload.paperHeight || 11,
          marginTop: 0.4,
          marginBottom: 0.4,
          marginLeft: 0.4,
          marginRight: 0.4,
        }) as any;
        if (!pdfResult?.data) return { error: 'PDF generation returned no data' };
        const dataUrl = `data:application/pdf;base64,${pdfResult.data}`;
        // Estimate size
        const sizeKB = Math.round(pdfResult.data.length * 3 / 4 / 1024);
        return { ok: true, dataUrl, sizeKB, message: `PDF generated (${sizeKB}KB)` };
      } catch (e: any) {
        return { error: `PDF generation failed: ${e.message}` };
      }
    }

    // ========== Full Page Screenshot ==========
    case 'SCREENSHOT_FULL_PAGE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot capture full page screenshot in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        // Get full page dimensions
        const layoutMetrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics') as any;
        const contentWidth = Math.ceil(layoutMetrics.cssContentSize?.width || layoutMetrics.contentSize?.width || 1280);
        const contentHeight = Math.ceil(layoutMetrics.cssContentSize?.height || layoutMetrics.contentSize?.height || 800);
        // Cap at reasonable size (max 16384px)
        const capH = Math.min(contentHeight, 16384);
        // Set viewport to full page size
        const dpr = layoutMetrics.cssVisualViewport?.pageScaleFactor || 1;
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setDeviceMetricsOverride', {
          mobile: false, width: contentWidth, height: capH, deviceScaleFactor: dpr,
        });
        // Capture
        const fmt = (payload.format === 'webp' || payload.format === 'jpeg') ? 'jpeg' : 'png';
        const captureResult = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
          format: fmt,
          quality: fmt === 'jpeg' ? (payload.quality || 80) : undefined,
          clip: { x: 0, y: 0, width: contentWidth, height: capH, scale: 1 },
          captureBeyondViewport: true,
        }) as any;
        // Reset viewport
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.clearDeviceMetricsOverride');
        if (!captureResult?.data) return { error: 'Full page screenshot failed — no data returned' };
        const dataUrl = `data:image/${fmt};base64,${captureResult.data}`;
        return { ok: true, dataUrl, width: contentWidth, height: capH, sizeKB: Math.round(captureResult.data.length * 3 / 4 / 1024) };
      } catch (e: any) {
        return { error: `Full page screenshot failed: ${e.message}` };
      }
    }

    // ========== Phase 24: Upload File ==========
    case 'UPLOAD_FILE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot upload file in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
        // Find the file input element
        const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument') as any;
        const nodeResult = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: payload.selector,
        }) as any;
        if (!nodeResult?.nodeId) return { error: `File input not found: ${payload.selector}` };
        // Create a temporary file with content
        const fileName = payload.fileName || 'file.txt';
        const content = payload.content || '';
        const isBase64 = payload.base64;
        // Detect MIME type from extension if not provided
        let mimeType = payload.mimeType;
        if (!mimeType) {
          const ext = fileName.split('.').pop()?.toLowerCase();
          const mimeMap: Record<string, string> = {
            txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript',
            json: 'application/json', xml: 'application/xml', csv: 'text/csv',
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
            svg: 'image/svg+xml', webp: 'image/webp', pdf: 'application/pdf',
            zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4',
          };
          mimeType = mimeMap[ext || ''] || 'application/octet-stream';
        }
        // Write content to a temp file-like blob via page JS, then set via DOM.setFileInputFiles
        // For simplicity, we use Runtime.evaluate to create a File and set it on the input
        const fileContent = isBase64 ? content : btoa(unescape(encodeURIComponent(content)));
        const evalResult = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `(function(){
            const input = document.querySelector('${payload.selector.replace(/'/g, "\\'")}');
            if (!input || input.type !== 'file') return { error: 'Not a file input' };
            const b64 = '${fileContent}';
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const file = new File([bytes], '${fileName.replace(/'/g, "\\'")}', { type: '${mimeType}' });
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: true, fileName: file.name, size: file.size, type: file.type };
          })()`,
          returnByValue: true,
        }) as any;
        return evalResult?.result?.value || { error: 'File upload execution failed' };
      } catch (e: any) {
        return { error: `File upload failed: ${e.message}` };
      }
    }

    // ========== Phase 24: JS Coverage ==========
    case 'JS_COVERAGE': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot collect JS coverage in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        if (payload.action === 'start') {
          await chrome.debugger.sendCommand({ tabId }, 'Profiler.enable');
          await chrome.debugger.sendCommand({ tabId }, 'Profiler.startPreciseCoverage', {
            callCount: payload.detailed || false,
            detailed: payload.detailed || false,
          });
          return { ok: true, message: 'JS coverage collection started. Perform actions, then call js_coverage(action="stop") to get results.' };
        }
        if (payload.action === 'stop') {
          const coverageResult = await chrome.debugger.sendCommand({ tabId }, 'Profiler.takePreciseCoverage') as any;
          await chrome.debugger.sendCommand({ tabId }, 'Profiler.stopPreciseCoverage');
          await chrome.debugger.sendCommand({ tabId }, 'Profiler.disable');
          if (!coverageResult?.result) return { error: 'No coverage data returned' };
          // Summarize coverage per script
          const scripts = coverageResult.result.map((entry: any) => {
            const url = entry.url || '(inline)';
            const functions = entry.functions || [];
            let totalBytes = 0;
            let usedBytes = 0;
            for (const fn of functions) {
              for (const range of fn.ranges || []) {
                const size = range.endOffset - range.startOffset;
                totalBytes += size;
                if (range.count > 0) usedBytes += size;
              }
            }
            const usagePercent = totalBytes > 0 ? Math.round(usedBytes / totalBytes * 100) : 0;
            return {
              url: url.slice(0, 200),
              totalBytes,
              usedBytes,
              unusedBytes: totalBytes - usedBytes,
              usagePercent,
              functionCount: functions.length,
            };
          }).filter((s: any) => s.totalBytes > 0);
          // Sort by unused bytes descending
          scripts.sort((a: any, b: any) => b.unusedBytes - a.unusedBytes);
          const totalAll = scripts.reduce((s: number, e: any) => s + e.totalBytes, 0);
          const usedAll = scripts.reduce((s: number, e: any) => s + e.usedBytes, 0);
          return {
            scripts: scripts.slice(0, 50),
            summary: {
              totalScripts: scripts.length,
              totalBytes: totalAll,
              usedBytes: usedAll,
              unusedBytes: totalAll - usedAll,
              overallUsage: totalAll > 0 ? Math.round(usedAll / totalAll * 100) + '%' : 'N/A',
            },
          };
        }
        return { error: 'Invalid action. Use "start" or "stop".' };
      } catch (e: any) {
        return { error: `JS coverage failed: ${e.message}` };
      }
    }

    // ========== Phase 24: Animation Speed ==========
    case 'ANIMATION_SPEED': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot control animation speed in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        const rate = payload.rate ?? 1;
        await chrome.debugger.sendCommand({ tabId }, 'Animation.enable');
        await chrome.debugger.sendCommand({ tabId }, 'Animation.setPlaybackRate', {
          playbackRate: rate,
        });
        const label = rate === 0 ? 'paused' : rate === 1 ? 'normal' : `${rate}x`;
        return { ok: true, playbackRate: rate, label, message: `Animation speed set to ${label}` };
      } catch (e: any) {
        return { error: `Animation speed control failed: ${e.message}` };
      }
    }

    // ========== Phase 24: Clear Site Data ==========
    case 'CLEAR_SITE_DATA': {
      const payload = (msg.payload || {}) as any;
      try {
        if (stealthMode) return { error: 'Cannot clear site data in stealth mode (requires debugger). Disable stealth first.' };
        await attachDebugger(tabId);
        const tab = await chrome.tabs.get(tabId);
        const url = tab.url || '';
        let origin: string;
        try { origin = new URL(url).origin; } catch { return { error: `Cannot determine origin from URL: ${url}` }; }
        const typesStr = (payload.types as string) || 'cache,cookies,storage,serviceworkers';
        const types = typesStr.split(',').map((t: string) => t.trim());
        const storageTypes: string[] = [];
        if (types.includes('cache')) storageTypes.push('cache_storage');
        if (types.includes('cookies')) storageTypes.push('cookies');
        if (types.includes('storage')) storageTypes.push('local_storage', 'session_storage', 'indexeddb', 'websql');
        if (types.includes('serviceworkers')) storageTypes.push('service_workers');
        await chrome.debugger.sendCommand({ tabId }, 'Storage.clearDataForOrigin', {
          origin,
          storageTypes: storageTypes.join(','),
        });
        return { ok: true, origin, cleared: types, message: `Cleared ${types.join(', ')} for ${origin}` };
      } catch (e: any) {
        return { error: `Clear site data failed: ${e.message}` };
      }
    }

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
