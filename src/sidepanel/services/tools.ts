// ============================================================
// Tool Executor - bridges AI tool calls to page operations
// ============================================================
import type { ToolCall, ToolResult } from '../../shared/tools';
import type { UserScript } from '../../shared/types';
import { getScripts, addScript, updateScript, getScriptById } from '../../shared/storage';

const TOOL_ICONS: Record<string, string> = {
  inspect_element: '🔍',
  modify_style: '🎨',
  modify_text: '✏️',
  modify_attribute: '🏷️',
  modify_html: '📝',
  inject_css: '💅',
  inject_js: '⚡',
  click: '👆',
  type_text: '⌨️',
  scroll_to: '📜',
  read_text: '👁️',
  get_page_info: '📄',
  get_page_sections: '🗂️',
  get_console_logs: '📋',
  get_network_requests: '🌐',
  start_hooks: '🪝',
  hide_element: '🙈',
  show_element: '👀',
  wait_for: '⏳',
  select_option: '📋',
  keypress: '⌨️',
  check_exists: '✅',
  check_text_contains: '🔎',
  remove_element: '🗑️',
  clone_element: '📋',
  save_script: '💾',
  update_script: '📝',
  run_script: '▶️',
  list_scripts: '📂',
  screenshot: '📷',
  highlight_element: '✨',
  get_storage: '🗄️',
  set_storage: '📦',
  clear_storage: '🧹',
  accessibility_audit: '♿',
  get_performance: '⚡',
  human_click: '🖱️',
  human_type: '⌨️',
  human_move: '↗️',
  human_scroll: '📜',
  human_drag: '✋',
  screenshot_element: '🖼️',
  screenshot_area: '📐',
  get_element_bounds: '📐',
  find_at_point: '📍',
  click_at_coords: '🎯',
  type_at_coords: '⌨️',
  get_interactive_map: '🗺️',
  visual_query: '👁️',
  enable_stealth: '🥷',
  disable_stealth: '🔓',
  fill_form: '📋',
  navigate: '🧭',
  extract_table: '📊',
  extract_links: '🔗',
  query_selector_all: '🔍',
  get_cookies: '🍪',
  set_cookie: '🍪',
  emulate_device: '📱',
  intercept_request: '🔀',
  block_urls: '🚫',
  network_throttle: '🐌',
  get_event_listeners: '👂',
  force_css_state: '🎭',
  set_geolocation: '📍',
  set_timezone: '🕐',
  emulate_media: '🌗',
  pdf_page: '📄',
  search_text: '🔎',
  toggle_class: '🏷️',
  insert_element: '➕',
  // Phase 24
  hover: '🖱️',
  double_click: '👆',
  right_click: '🖱️',
  upload_file: '📎',
  focus: '🎯',
  blur: '💨',
  observe_dom: '👁️',
  get_computed_style: '🎨',
  monitor_events: '📡',
  js_coverage: '📊',
  animation_speed: '🎬',
  list_iframes: '🪟',
  pierce_shadow: '👻',
  extract_meta: '🏷️',
  clear_site_data: '🧹',
};

export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || '🔧';
}

export function getToolDisplayName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { name, args } = call;

  try {
    let result: unknown;

    switch (name) {
      case 'inspect_element':
        result = await sendToContent('INSPECT_ELEMENT', { selector: args.selector });
        break;

      case 'modify_style':
        if (args.styles) {
          // Batch mode: multiple properties at once
          const stylesJson = (args.styles as string).replace(/'/g, "\\'");
          result = await sendToContent('INJECT_JS', {
            code: `(function(){
  const el = document.querySelector('${(args.selector as string).replace(/'/g, "\\'")}');
  if (!el) return { error: 'Element not found' };
  const styles = JSON.parse('${stylesJson}');
  const results = {};
  for (const [prop, val] of Object.entries(styles)) {
    el.style.setProperty(prop, val);
    results[prop] = { set: val, computed: window.getComputedStyle(el).getPropertyValue(prop) };
  }
  return { ok: true, selector: '${(args.selector as string).replace(/'/g, "\\'")}', properties: results };
})()`
          });
        } else {
          result = await sendToContent('MODIFY_STYLE', {
            selector: args.selector,
            property: args.property,
            value: args.value,
          });
        }
        break;

      case 'modify_text':
        result = await sendToContent('MODIFY_DOM', {
          selector: args.selector,
          action: 'setText',
          value: args.text,
        });
        break;

      case 'modify_attribute':
        result = await sendToContent('MODIFY_DOM', {
          selector: args.selector,
          action: 'setAttribute',
          attr: args.attribute,
          value: args.value,
        });
        break;

      case 'modify_html':
        result = await sendToContent('MODIFY_DOM', {
          selector: args.selector,
          action: 'setHTML',
          value: args.html,
        });
        break;

      case 'inject_css':
        result = await sendToContent('INJECT_CSS', { css: args.css });
        break;

      case 'inject_js': {
        let code = args.code as string;
        if (args.awaitPromise) {
          // Wrap in async IIFE if not already
          if (!code.trim().startsWith('(async') && !code.trim().startsWith('async')) {
            code = `(async () => { ${code} })()`;
          }
        }
        result = await sendToContent('INJECT_JS', { code, timeout: args.timeout, allFrames: args.allFrames });
        break;
      }

      case 'click':
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${(args.selector as string).replace(/'/g, "\\'")}');
  if (!el) return { error: 'Element not found: ${(args.selector as string).replace(/'/g, "\\'")}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none).' };
  if (cs.visibility === 'hidden') return { error: 'Element is hidden (visibility:hidden).' };
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const btn = ${args.button === 'right' ? 2 : args.button === 'middle' ? 1 : 0};
  const count = ${(args.clickCount as number) || 1};
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const common = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: btn, view: window };
  for (let i = 0; i < count; i++) {
    el.dispatchEvent(new MouseEvent('mousedown', common));
    el.dispatchEvent(new MouseEvent('mouseup', common));
    el.dispatchEvent(new MouseEvent('click', common));
  }
  if (count >= 2) el.dispatchEvent(new MouseEvent('dblclick', common));
  if (btn === 2) el.dispatchEvent(new MouseEvent('contextmenu', common));
  return { ok: true };
})()`
        });
        break;

      case 'type_text': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const text = (args.text as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none).' };
  if (el.disabled) return { error: 'Element is disabled.' };
  if (el.readOnly) return { error: 'Element is readOnly.' };
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(el, '${text}');
  else el.value = '${text}';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`
        });
        break;
      }

      case 'scroll_to':
        if (args.selector) {
          const scrollBehavior = (args.behavior as string) || 'smooth';
          result = await sendToContent('INJECT_JS', {
            code: `(function(){
  const el = document.querySelector('${(args.selector as string).replace(/'/g, "\\'")}');
  if (!el) return { error: 'Element not found' };
  el.scrollIntoView({ behavior: '${scrollBehavior}', block: 'center' });
  return { ok: true, scrollY: window.scrollY };
})()`
          });
        } else {
          result = await sendToContent('AUTOMATE', { type: 'scroll', x: args.x || 0, y: args.y || 0 });
        }
        break;

      case 'read_text': {
        if (args.mode === 'structured') {
          const sel = (args.selector as string).replace(/'/g, "\\'");
          result = await sendToContent('INJECT_JS', {
            code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found' };
  const tag = el.tagName.toLowerCase();

  // Table → structured JSON
  if (tag === 'table') {
    const hRow = el.querySelector('thead tr') || el.querySelector('tr');
    const headers = [];
    if (hRow) hRow.querySelectorAll('th, td').forEach(c => headers.push(c.textContent.trim()));
    const rows = [];
    const body = el.querySelectorAll('tbody tr');
    const all = body.length > 0 ? body : el.querySelectorAll('tr');
    const start = body.length > 0 ? 0 : 1;
    for (let i = start; i < Math.min(all.length, 50); i++) {
      const cells = all[i].querySelectorAll('td, th');
      const row = {};
      cells.forEach((c, j) => { row[headers[j] || 'col_'+j] = c.textContent.trim(); });
      rows.push(row);
    }
    return { type: 'table', headers, rows, rowCount: rows.length };
  }

  // List (ul/ol) → array
  if (tag === 'ul' || tag === 'ol') {
    const items = [];
    el.querySelectorAll(':scope > li').forEach(li => items.push(li.textContent.trim().slice(0, 200)));
    return { type: 'list', items, count: items.length };
  }

  // Form → fields
  if (tag === 'form') {
    const fields = [];
    el.querySelectorAll('input, select, textarea').forEach(inp => {
      const t = inp.tagName.toLowerCase();
      const label = (function(){
        const id = inp.id;
        if (id) { const l = document.querySelector('label[for="'+id+'"]'); if (l) return l.textContent.trim(); }
        const w = inp.closest('label'); if (w) return w.textContent.trim().slice(0, 60);
        return inp.getAttribute('aria-label') || inp.placeholder || null;
      })();
      fields.push({
        tag: t, type: inp.type || t, name: inp.name || null,
        value: (inp.value || '').slice(0, 100), label,
        required: inp.required, disabled: inp.disabled,
      });
    });
    return { type: 'form', fields, fieldCount: fields.length, action: el.action || null, method: el.method || 'get' };
  }

  // Fallback: plain text
  return { type: 'text', text: (el.innerText || el.textContent || '').trim().slice(0, 3000) };
})()`
          });
        } else {
          result = await sendToContent('AUTOMATE', { type: 'readText', selector: args.selector });
        }
        break;
      }

      case 'get_page_info': {
        if (args.section) {
          // Section deep-dive mode
          const sel = (args.section as string).replace(/'/g, "\\'");
          result = await sendToContent('INJECT_JS', {
            code: `(function(){
  const root = document.querySelector('${sel}');
  if (!root) return { error: 'Section not found: ${sel}' };

  // Detailed DOM tree
  const parts = [];
  function walk(el, depth) {
    if (depth > 6 || parts.length > 120) return;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
    const indent = '  '.repeat(depth);
    const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.textContent.trim().slice(0,60) : '';
    parts.push(indent + '<' + tag + id + cls + '>' + (text ? ' "' + text + '"' : ''));
    Array.from(el.children).slice(0, 10).forEach(c => walk(c, depth + 1));
  }
  walk(root, 0);

  // All interactive elements
  const interactives = [];
  root.querySelectorAll('a,button,input,select,textarea,[role="button"],[onclick],[tabindex]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const tag = el.tagName.toLowerCase();
    let text = tag === 'input' || tag === 'textarea' ? (el.placeholder || el.value || '') : (el.textContent || '').trim().slice(0,60);
    let sel2 = tag;
    if (el.id) sel2 = '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim()) sel2 = tag + '.' + el.className.trim().split(/\\s+/)[0];
    interactives.push({ tag, text: text.slice(0,60), selector: sel2, type: el.type || el.getAttribute('role') || tag });
  });

  // Full text content
  const fullText = (root.innerText || root.textContent || '').trim().slice(0, 5000);

  return {
    section: '${sel}',
    tag: root.tagName.toLowerCase(),
    childCount: root.children.length,
    domTree: parts.join('\\n'),
    interactiveElements: interactives,
    fullText,
    boundingRect: root.getBoundingClientRect(),
  };
})()`
          });
        } else {
          result = await sendToBackground('GET_PAGE_CONTEXT');
        }
        break;
      }

      case 'get_console_logs': {
        let logs = await sendToBackground('GET_HOOK_EVENTS') as any[];
        if (!Array.isArray(logs) || logs.length === 0) {
          // Auto-inject hooks if not started (fixes silent empty results)
          await sendToBackground('INJECT_HOOKS', { console: true, errors: true, fetch: false, xhr: false, domMutation: false, scriptInject: false, events: false });
          // Wait briefly for hooks to capture initial state
          await new Promise(r => setTimeout(r, 500));
          logs = await sendToBackground('GET_HOOK_EVENTS') as any[];
          if (!Array.isArray(logs)) logs = [];
        }
        // Filter to console-type events
        logs = logs.filter((e: any) => e.type === 'console' || e.type === 'error');
        // Apply level filter
        if (args.level) {
          const levels = (args.level as string).split(',').map(l => l.trim().toLowerCase());
          logs = logs.filter((e: any) => {
            const eventLevel = e.detail?.level || (e.type === 'error' ? 'error' : 'log');
            return levels.includes(eventLevel);
          });
        }
        // Apply search filter
        if (args.search) {
          const s = (args.search as string).toLowerCase();
          logs = logs.filter((e: any) => e.summary?.toLowerCase().includes(s));
        }
        // Limit
        const logLimit = Math.min((args.limit as number) || 50, 200);
        result = logs.slice(-logLimit);
        break;
      }

      case 'get_network_requests': {
        // If waitForNew, snapshot current count and poll for new ones
        if (args.waitForNew) {
          const baseline = ((await sendToBackground('GET_NETWORK_REQUESTS') as any[]) || []);
          const baselineCount = baseline.length;
          const filterFn = (list: any[]) => {
            let items = list.slice(baselineCount); // Only new items
            if (args.filter) { const f = (args.filter as string).toLowerCase(); items = items.filter((r: any) => r.url?.toLowerCase().includes(f)); }
            if (args.status) { const s = String(args.status).toLowerCase(); items = items.filter((r: any) => { const c = r.status; if (s==='failed') return r.failed||c>=400; if (s==='4xx') return c>=400&&c<500; if (s==='5xx') return c>=500; return c===parseInt(s); }); }
            if (args.method) { const m = (args.method as string).toUpperCase(); items = items.filter((r: any) => r.method === m); }
            if (args.type) { items = items.filter((r: any) => r.type === args.type); }
            return items;
          };
          // Poll for up to 10s
          let newReqs: any[] = [];
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            const all = ((await sendToBackground('GET_NETWORK_REQUESTS') as any[]) || []);
            newReqs = filterFn(all);
            if (newReqs.length > 0) break;
          }
          result = { requests: newReqs, total: newReqs.length, returned: newReqs.length, waitedForNew: true };
          break;
        }

        let netResult = await sendToBackground('GET_NETWORK_REQUESTS') as any[];
        if (!Array.isArray(netResult)) netResult = [];
        // Apply filters
        if (args.filter) {
          const f = (args.filter as string).toLowerCase();
          netResult = netResult.filter((r: any) => r.url?.toLowerCase().includes(f));
        }
        if (args.status) {
          const s = String(args.status).toLowerCase();
          netResult = netResult.filter((r: any) => {
            const code = r.status;
            if (s === 'failed') return r.failed || code >= 400;
            if (s === '4xx') return code >= 400 && code < 500;
            if (s === '5xx') return code >= 500;
            return code === parseInt(s);
          });
        }
        if (args.method) {
          const m = (args.method as string).toUpperCase();
          netResult = netResult.filter((r: any) => r.method === m);
        }
        if (args.type) {
          netResult = netResult.filter((r: any) => r.type === args.type);
        }
        // Sort by time descending, then limit
        netResult.sort((a: any, b: any) => (b.startTime ?? 0) - (a.startTime ?? 0));
        const limit = Math.min((args.limit as number) || 50, 200);
        const total = netResult.length;
        result = { requests: netResult.slice(0, limit), total, returned: Math.min(total, limit) };
        break;
      }

      case 'start_hooks': {
        const typesStr = args.types as string | undefined;
        let hookConfig: Record<string, boolean | string>;
        if (typesStr && typesStr !== 'all') {
          hookConfig = { fetch: false, xhr: false, console: false, errors: false, domMutation: false, scriptInject: false, events: false };
          for (const t of typesStr.split(',').map(s => s.trim())) {
            if (t in hookConfig) (hookConfig as any)[t] = true;
          }
        } else {
          hookConfig = { fetch: true, xhr: true, console: true, errors: true, domMutation: true, scriptInject: true, events: false };
        }
        if (args.urlFilter) (hookConfig as any).urlFilter = args.urlFilter;
        result = await sendToBackground('INJECT_HOOKS', hookConfig);
        break;
      }

      case 'hide_element':
        result = await sendToContent('MODIFY_DOM', {
          selector: args.selector,
          action: 'hide',
        });
        break;

      case 'show_element':
        result = await sendToContent('MODIFY_DOM', {
          selector: args.selector,
          action: 'show',
        });
        break;

      case 'wait_for':
        if (args.networkIdle) {
          // Network idle mode: wait until no network requests for 500ms
          const niTimeout = Math.min((args.timeout as number) || 10000, 30000);
          result = await sendToContent('INJECT_JS', {
            code: `(async function(){
  const start = Date.now();
  const timeout = ${niTimeout};
  const idleThreshold = 500;
  let lastActivity = Date.now();
  let pending = 0;
  const origFetch = window.fetch;
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  // Track fetch
  window.fetch = function(...a) {
    pending++; lastActivity = Date.now();
    return origFetch.apply(this, a).finally(() => { pending--; lastActivity = Date.now(); });
  };
  // Track XHR
  XMLHttpRequest.prototype.open = function(...a) { return origXhrOpen.apply(this, a); };
  XMLHttpRequest.prototype.send = function(...a) {
    pending++; lastActivity = Date.now();
    this.addEventListener('loadend', () => { pending--; lastActivity = Date.now(); }, { once: true });
    return origXhrSend.apply(this, a);
  };
  try {
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 100));
      if (pending === 0 && Date.now() - lastActivity >= idleThreshold) {
        return { ok: true, idle: true, waited: Date.now() - start, message: 'Network idle detected' };
      }
    }
    return { ok: false, idle: false, waited: timeout, pending, message: 'Network still active after timeout' };
  } finally {
    window.fetch = origFetch;
    XMLHttpRequest.prototype.open = origXhrOpen;
    XMLHttpRequest.prototype.send = origXhrSend;
  }
})()`
          });
        } else if (args.absent) {
          // Wait for element to DISAPPEAR
          const absentSel = (args.selector as string).replace(/'/g, "\\'");
          const absentTimeout = Math.min((args.timeout as number) || 5000, 30000);
          const absentPoll = Math.max(Math.min((args.pollInterval as number) || 200, 2000), 50);
          const checkVis = args.visible ? 'true' : 'false';
          result = await sendToContent('INJECT_JS', {
            code: `(async function(){
  const start = Date.now();
  const timeout = ${absentTimeout};
  const poll = ${absentPoll};
  const checkVisible = ${checkVis};
  while (Date.now() - start < timeout) {
    const el = document.querySelector('${absentSel}');
    if (!el) return { ok: true, absent: true, waited: Date.now() - start };
    if (checkVisible) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')
        return { ok: true, absent: true, hiddenButInDOM: true, waited: Date.now() - start };
    }
    await new Promise(r => setTimeout(r, poll));
  }
  return { ok: false, absent: false, waited: Date.now() - start, message: 'Element still present after timeout' };
})()`
          });
        } else {
          result = await sendToContent('AUTOMATE', {
            type: 'waitForSelector',
            selector: args.selector,
            timeout: args.timeout || 5000,
            visible: args.visible,
            condition: args.condition,
            pollInterval: args.pollInterval,
          });
        }
        break;

      case 'get_page_sections':
        result = await sendToContent('READ_SECTIONS');
        break;

      case 'select_option':
        result = await sendToContent('AUTOMATE', { type: 'select', selector: args.selector, value: args.value });
        break;

      case 'keypress': {
        // Support combo ("Ctrl+A") and sequence (["Tab","Tab","Enter"])
        const seqStr = args.sequence as string | undefined;
        if (seqStr) {
          let keys: string[];
          try { keys = JSON.parse(seqStr); } catch { result = { error: 'Invalid JSON in sequence parameter' }; break; }
          result = await sendToContent('INJECT_JS', {
            code: `(async function(){
  const keys = ${JSON.stringify(keys)};
  for (const k of keys) {
    const opts = { key: k, code: 'Key' + k, bubbles: true, cancelable: true };
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', opts));
    await new Promise(r => setTimeout(r, 50));
  }
  return { ok: true, keysPressed: keys.length };
})()`
          });
        } else {
          const keyStr = args.key as string;
          // Parse combo like "Ctrl+Shift+A"
          const parts = keyStr.split('+').map(s => s.trim());
          const key = parts.pop() || keyStr;
          const mods = (args.modifiers as string || '').split(',').map(s => s.trim().toLowerCase());
          for (const p of parts) mods.push(p.toLowerCase());
          result = await sendToContent('AUTOMATE', {
            type: 'keyboard',
            key,
            modifiers: mods.filter(Boolean),
          });
        }
        break;
      }

      case 'check_exists':
        result = await sendToContent('CHECK_EXISTS', {
          selector: args.selector,
          retries: args.retries,
          retryDelay: args.retryDelay,
        });
        break;

      case 'check_text_contains':
        result = await sendToContent('CHECK_TEXT', { selector: args.selector, text: args.text });
        break;

      case 'remove_element':
        result = await sendToContent('MODIFY_DOM', { selector: args.selector, action: 'remove' });
        break;

      case 'clone_element':
        result = await sendToContent('MODIFY_DOM', { selector: args.selector, action: 'clone' });
        break;

      // --- Script management ---
      case 'save_script': {
        const script: UserScript = {
          id: `script_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: args.name as string,
          description: args.description as string,
          type: (args.type as 'js' | 'css') || 'js',
          code: args.code as string,
          mode: (args.mode as 'action' | 'toggle') || (args.type === 'css' ? 'toggle' : 'action'),
          trigger: (args.trigger as 'manual' | 'auto' | 'url-match') || 'manual',
          urlPattern: args.urlPattern as string | undefined,
          enabled: true,
          active: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          tags: args.tags ? (args.tags as string).split(',').map(t => t.trim()).filter(Boolean) : [],
          undoCode: args.undoCode as string | undefined,
        };
        await addScript(script);
        result = { id: script.id, name: script.name, saved: true };
        break;
      }

      case 'update_script': {
        const existing = await getScriptById(args.id as string);
        if (!existing) {
          result = { error: `Script not found: ${args.id}` };
          break;
        }
        const updates: Partial<UserScript> = {};
        if (args.name) updates.name = args.name as string;
        if (args.description) updates.description = args.description as string;
        if (args.code) updates.code = args.code as string;
        if (args.trigger) updates.trigger = args.trigger as 'manual' | 'auto' | 'url-match';
        if (args.urlPattern !== undefined) updates.urlPattern = args.urlPattern as string;
        if (args.tags) updates.tags = (args.tags as string).split(',').map(t => t.trim()).filter(Boolean);
        await updateScript(args.id as string, updates);
        result = { id: args.id, updated: true };
        break;
      }

      case 'run_script': {
        const script = await getScriptById(args.id as string);
        if (!script) {
          result = { error: `Script not found: ${args.id}` };
          break;
        }
        if (script.type === 'js') {
          result = await sendToContent('INJECT_JS', { code: script.code });
        } else {
          result = await sendToContent('INJECT_CSS', { css: script.code });
        }
        // Update lastRun info
        await updateScript(script.id, {
          lastRunAt: Date.now(),
          lastRunResult: (result as any)?.error ? `Error: ${(result as any).error}` : 'Success',
        });
        break;
      }

      case 'list_scripts': {
        const allScripts = await getScripts();
        result = allScripts.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          type: s.type,
          trigger: s.trigger,
          enabled: s.enabled,
          tags: s.tags,
          lastRunAt: s.lastRunAt,
        }));
        break;
      }

      // --- Screenshot & Visual tools ---
      case 'screenshot':
        if (args.fullPage) {
          result = await sendToBackground('SCREENSHOT_FULL_PAGE', {
            format: args.format || 'png',
            quality: args.quality,
          });
        } else {
          result = await sendToBackground('SCREENSHOT', {
            format: args.format || 'png',
            quality: args.quality,
          });
        }
        break;

      case 'highlight_element': {
        const hlColor = (args.color as string) || '#7c6aff';
        const hlDuration = (args.duration as number) || 1500;
        const hlLabel = args.label ? (args.label as string).replace(/'/g, "\\'").replace(/\\/g, '\\\\') : '';
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
            const el = document.querySelector('${(args.selector as string).replace(/'/g, "\\'")}');
            if (!el) return { error: 'Element not found' };
            const orig = el.style.cssText;
            el.style.outline = '3px solid ${hlColor}';
            el.style.outlineOffset = '2px';
            el.style.boxShadow = '0 0 12px ${hlColor}80';
            el.style.transition = 'outline 0.3s, box-shadow 0.3s';
            ${hlLabel ? `
            const badge = document.createElement('div');
            badge.textContent = '${hlLabel}';
            badge.style.cssText = 'position:absolute;z-index:999999;background:${hlColor};color:#fff;padding:2px 8px;border-radius:4px;font:12px/1.4 system-ui;white-space:nowrap;pointer-events:none;';
            const rect = el.getBoundingClientRect();
            badge.style.left = (rect.left + window.scrollX) + 'px';
            badge.style.top = (rect.top + window.scrollY - 22) + 'px';
            document.body.appendChild(badge);
            setTimeout(() => badge.remove(), ${hlDuration});
            ` : ''}
            setTimeout(() => { el.style.cssText = orig; }, ${hlDuration});
            return { ok: true };
          })()`
        });
        break;
      }

      // --- Storage & Cookie tools ---
      case 'get_storage': {
        const storageType = args.type as string;
        const storageKey = args.key as string | undefined;
        if (storageType === 'cookies') {
          result = await sendToContent('INJECT_JS', {
            code: `(function(){ return document.cookie.split('; ').reduce((o,c) => { const [k,...v] = c.split('='); o[k] = v.join('='); return o; }, {}); })()`
          });
        } else {
          const store = storageType === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
          if (storageKey) {
            result = await sendToContent('INJECT_JS', {
              code: `(function(){ return { key: '${storageKey.replace(/'/g, "\\'")}', value: ${store}.getItem('${storageKey.replace(/'/g, "\\'")}') }; })()`
            });
          } else {
            result = await sendToContent('INJECT_JS', {
              code: `(function(){ const s = ${store}; const o = {}; for(let i=0;i<s.length;i++){const k=s.key(i);o[k]=s.getItem(k);} return { count: s.length, entries: o }; })()`
            });
          }
        }
        break;
      }

      case 'set_storage': {
        const setType = args.type as string;
        const store = setType === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
        const setKey = (args.key as string).replace(/'/g, "\\'");
        const setValue = (args.value as string).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
        result = await sendToContent('INJECT_JS', {
          code: `(function(){ ${store}.setItem('${setKey}', '${setValue}'); return { ok: true }; })()`
        });
        break;
      }

      case 'clear_storage': {
        const clearType = args.type as string;
        if (clearType === 'cookies') {
          result = await sendToContent('INJECT_JS', {
            code: `(function(){ document.cookie.split('; ').forEach(c => { const k = c.split('=')[0]; document.cookie = k + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; }); return { ok: true, cleared: 'cookies' }; })()`
          });
        } else {
          const cs = clearType === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
          result = await sendToContent('INJECT_JS', {
            code: `(function(){ const count = ${cs}.length; ${cs}.clear(); return { ok: true, cleared: '${cs}', itemsRemoved: count }; })()`
          });
        }
        break;
      }

      // --- Accessibility audit ---
      case 'accessibility_audit': {
        const scope = args.selector ? `document.querySelector('${(args.selector as string).replace(/'/g, "\\'")}')` : 'document';
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
            const root = ${scope} || document;
            const issues = [];
            // Images without alt
            root.querySelectorAll('img:not([alt])').forEach(el => {
              issues.push({ type: 'error', rule: 'img-alt', message: 'Image missing alt text', selector: el.src?.slice(0,80) || 'img', fix: 'Add descriptive alt attribute to this image', tool: 'modify_attribute' });
            });
            root.querySelectorAll('img[alt=""]').forEach(el => {
              issues.push({ type: 'warning', rule: 'img-alt-empty', message: 'Image has empty alt text (decorative?)', selector: el.src?.slice(0,80) || 'img', fix: 'If decorative, add role="presentation". Otherwise add meaningful alt text.', tool: 'modify_attribute' });
            });
            // Form inputs without labels
            root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])').forEach(el => {
              const id = el.id;
              const hasLabel = id && root.querySelector('label[for="'+id+'"]');
              const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
              const wrapped = el.closest('label');
              if (!hasLabel && !hasAria && !wrapped) {
                issues.push({ type: 'error', rule: 'input-label', message: 'Input missing label', selector: el.name || el.type || 'input', fix: 'Add aria-label attribute describing the input purpose', tool: 'modify_attribute' });
              }
            });
            // Empty links/buttons
            root.querySelectorAll('a, button').forEach(el => {
              const text = (el.textContent || '').trim();
              const aria = el.getAttribute('aria-label');
              const title = el.getAttribute('title');
              if (!text && !aria && !title && !el.querySelector('img,svg')) {
                issues.push({ type: 'error', rule: 'empty-interactive', message: 'Empty ' + el.tagName.toLowerCase() + ' (no text, aria-label, or title)', selector: el.className?.slice(0,40) || el.tagName, fix: 'Add aria-label or visible text content', tool: 'modify_attribute' });
              }
            });
            // Missing document language
            if (!document.documentElement.lang) {
              issues.push({ type: 'warning', rule: 'html-lang', message: 'Missing lang attribute on <html>', fix: 'Add lang="en" (or appropriate language code) to <html>', tool: 'modify_attribute' });
            }
            // Missing page title
            if (!document.title.trim()) {
              issues.push({ type: 'warning', rule: 'page-title', message: 'Page has no title', fix: 'Add a descriptive <title> element', tool: 'inject_js' });
            }
            // Low contrast candidates (basic heuristic)
            const body = root.querySelector('body') || root;
            const textEls = body.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, li, td, th, label, a');
            let lowContrast = 0;
            textEls.forEach(el => {
              const cs = window.getComputedStyle(el);
              const color = cs.color;
              const bg = cs.backgroundColor;
              if (color && bg && color === bg) {
                lowContrast++;
              }
            });
            if (lowContrast > 0) {
              issues.push({ type: 'warning', rule: 'color-contrast', message: lowContrast + ' elements with same text/background color', fix: 'Ensure text color contrasts with background (WCAG ratio >= 4.5:1)', tool: 'modify_style' });
            }
            // Missing heading hierarchy
            const headings = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
            let prevLevel = 0;
            headings.forEach(h => {
              const level = parseInt(h.tagName[1]);
              if (prevLevel > 0 && level > prevLevel + 1) {
                issues.push({ type: 'warning', rule: 'heading-order', message: 'Heading level skipped: h' + prevLevel + ' → h' + level, fix: 'Use sequential heading levels (h1 → h2 → h3)', tool: 'modify_html' });
              }
              prevLevel = level;
            });
            return { issues: issues, total: issues.length, errors: issues.filter(i=>i.type==='error').length, warnings: issues.filter(i=>i.type==='warning').length };
          })()`
        });
        break;
      }

      // --- Performance metrics ---
      case 'get_performance': {
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
            const perf = {};
            // Navigation timing
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) {
              perf.loadTime = Math.round(nav.loadEventEnd - nav.startTime);
              perf.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
              perf.ttfb = Math.round(nav.responseStart - nav.requestStart);
              perf.domInteractive = Math.round(nav.domInteractive - nav.startTime);
            }
            // LCP
            try {
              const lcp = performance.getEntriesByType('largest-contentful-paint');
              if (lcp.length) perf.lcp = Math.round(lcp[lcp.length-1].startTime);
            } catch(e){}
            // CLS
            try {
              const cls = performance.getEntriesByType('layout-shift');
              if (cls.length) perf.cls = cls.reduce((sum,e) => sum + (e.hadRecentInput ? 0 : e.value), 0).toFixed(4);
            } catch(e){}
            // Memory
            if (performance.memory) {
              perf.memory = {
                usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB',
                totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1048576) + ' MB',
              };
            }
            // DOM stats
            perf.domNodes = document.querySelectorAll('*').length;
            perf.domDepth = (function maxDepth(el, d) { let m = d; for (const c of el.children) m = Math.max(m, maxDepth(c, d+1)); return m; })(document.documentElement, 0);
            // Resources
            const resources = performance.getEntriesByType('resource');
            perf.resources = {
              total: resources.length,
              scripts: resources.filter(r=>r.initiatorType==='script').length,
              styles: resources.filter(r=>r.initiatorType==='css'||r.initiatorType==='link').length,
              images: resources.filter(r=>r.initiatorType==='img').length,
              totalSize: resources.reduce((s,r)=>s+(r.transferSize||0),0),
            };
            perf.resources.totalSizeMB = (perf.resources.totalSize / 1048576).toFixed(2) + ' MB';
            return perf;
          })()`
        });
        break;
      }

      // ========== Human-like automation tools ==========

      case 'human_click': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const btn = args.button === 'right' ? 2 : args.button === 'middle' ? 1 : 0;
        const dbl = args.doubleClick ? 'true' : 'false';
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  if (cs.display === 'none') return { error: 'Element is hidden (display:none). Use show_element or scroll_to first.', selector: '${sel}' };
  if (cs.visibility === 'hidden') return { error: 'Element is hidden (visibility:hidden).', selector: '${sel}' };
  if (parseFloat(cs.opacity) === 0) return { error: 'Element is invisible (opacity:0).', selector: '${sel}' };
  if (rect.width === 0 && rect.height === 0) return { error: 'Element has zero size — may be collapsed or not rendered.', selector: '${sel}' };
  const vw = window.innerWidth, vh = window.innerHeight;
  if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
  }
  const rect2 = el.getBoundingClientRect();
  const cx = rect2.left + rect2.width / 2;
  const cy = rect2.top + rect2.height / 2;
  // Random offset within 30% of element size to mimic imprecise human aim
  const ox = cx + (Math.random() - 0.5) * rect.width * 0.3;
  const oy = cy + (Math.random() - 0.5) * rect.height * 0.3;
  const common = { bubbles: true, cancelable: true, clientX: ox, clientY: oy, button: ${btn}, view: window };

  // Helper: random delay
  const delay = ms => new Promise(r => setTimeout(r, ms + Math.random() * ms * 0.4));

  // 1. Approach: mouseover → mouseenter
  el.dispatchEvent(new MouseEvent('mouseover', common));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...common, bubbles: false }));
  await delay(40);

  // 2. Micro movements (2-4 jitter moves)
  const jitters = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < jitters; i++) {
    const jx = ox + (Math.random() - 0.5) * 4;
    const jy = oy + (Math.random() - 0.5) * 4;
    el.dispatchEvent(new MouseEvent('mousemove', { ...common, clientX: jx, clientY: jy }));
    await delay(15);
  }

  // 3. Click sequence
  const doClick = async () => {
    el.dispatchEvent(new MouseEvent('mousedown', common));
    await delay(50 + Math.random() * 80);
    el.dispatchEvent(new MouseEvent('mouseup', common));
    el.dispatchEvent(new MouseEvent('click', common));
  };
  await doClick();

  // 4. Double click if requested
  if (${dbl}) {
    await delay(80);
    await doClick();
    el.dispatchEvent(new MouseEvent('dblclick', common));
  }

  return { ok: true, x: Math.round(ox), y: Math.round(oy) };
})()`
        });
        break;
      }

      case 'human_type': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const text = (args.text as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const speed = args.speed || 'normal';
        const clearFirst = args.clearFirst !== false;
        const baseDelay = speed === 'slow' ? 200 : speed === 'fast' ? 50 : 100;
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none).', selector: '${sel}' };
  if (cs.visibility === 'hidden') return { error: 'Element is hidden (visibility:hidden).', selector: '${sel}' };
  if (el.disabled) return { error: 'Element is disabled.', selector: '${sel}' };
  if (el.readOnly) return { error: 'Element is readOnly.', selector: '${sel}' };
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
  }
  el.focus();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));

  // Clear existing content
  if (${clearFirst}) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
  }

  const text = '${text}';
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const kOpts = { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true, cancelable: true };

    el.dispatchEvent(new KeyboardEvent('keydown', kOpts));
    el.dispatchEvent(new KeyboardEvent('keypress', kOpts));

    // Set value character by character
    const newVal = (el.value || '') + ch;
    if (nativeSetter) nativeSetter.call(el, newVal);
    else el.value = newVal;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));

    el.dispatchEvent(new KeyboardEvent('keyup', kOpts));

    // Human-like inter-keystroke delay with jitter
    const base = ${baseDelay};
    const jitter = base * 0.6;
    // Occasional longer pause (thinking hesitation)
    const pause = Math.random() < 0.08 ? base * 3 : 0;
    await new Promise(r => setTimeout(r, base + (Math.random() - 0.3) * jitter + pause));
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, length: text.length };
})()`
        });
        break;
      }

      case 'human_move': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const steps = Math.min(Math.max((args.steps as number) || 15, 5), 60);
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none). Cannot move mouse to hidden element.', selector: '${sel}' };
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
  }
  const updRect = el.getBoundingClientRect();
  const tx = updRect.left + updRect.width / 2 + (Math.random() - 0.5) * updRect.width * 0.2;
  const ty = updRect.top + updRect.height / 2 + (Math.random() - 0.5) * updRect.height * 0.2;

  // Random start point near current viewport area
  const sx = Math.random() * window.innerWidth;
  const sy = Math.random() * window.innerHeight;

  // Bézier control points for natural curve
  const cp1x = sx + (tx - sx) * 0.3 + (Math.random() - 0.5) * 120;
  const cp1y = sy + (ty - sy) * 0.2 + (Math.random() - 0.5) * 120;
  const cp2x = sx + (tx - sx) * 0.7 + (Math.random() - 0.5) * 80;
  const cp2y = sy + (ty - sy) * 0.8 + (Math.random() - 0.5) * 80;

  function bezier(t) {
    const u = 1 - t;
    return {
      x: u*u*u*sx + 3*u*u*t*cp1x + 3*u*t*t*cp2x + t*t*t*tx,
      y: u*u*u*sy + 3*u*u*t*cp1y + 3*u*t*t*cp2y + t*t*t*ty,
    };
  }

  const N = ${steps};
  for (let i = 1; i <= N; i++) {
    // Ease-in-out parameter
    let t = i / N;
    t = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    const p = bezier(t);
    const target = document.elementFromPoint(p.x, p.y) || document.body;
    target.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: p.x, clientY: p.y, view: window
    }));
    await new Promise(r => setTimeout(r, 8 + Math.random() * 12));
  }

  // Final mouseenter/over on target
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: tx, clientY: ty, view: window }));
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: tx, clientY: ty, view: window }));
  return { ok: true, from: { x: Math.round(sx), y: Math.round(sy) }, to: { x: Math.round(tx), y: Math.round(ty) } };
})()`
        });
        break;
      }

      case 'human_scroll': {
        const sel = args.selector ? (args.selector as string).replace(/'/g, "\\'") : '';
        const dir = args.direction === 'up' ? -1 : 1;
        const dist = (args.distance as number) || 600;
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  let targetY;
  if ('${sel}') {
    const el = document.querySelector('${sel}');
    if (!el) return { error: 'Element not found' };
    targetY = window.scrollY + el.getBoundingClientRect().top - window.innerHeight * 0.3;
  } else {
    targetY = window.scrollY + ${dir} * ${dist};
  }

  const startY = window.scrollY;
  const totalDelta = targetY - startY;
  if (Math.abs(totalDelta) < 5) return { ok: true, scrolled: 0 };

  // Break into wheel events with easing
  const steps = 12 + Math.floor(Math.random() * 8);
  for (let i = 1; i <= steps; i++) {
    // Ease-in-out
    let t = i / steps;
    t = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    const prevT = (i-1) / steps;
    const prevTe = prevT < 0.5 ? 2*prevT*prevT : 1 - Math.pow(-2*prevT+2,2)/2;
    const segDelta = (t - prevTe) * totalDelta;

    window.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true,
      deltaY: segDelta, deltaMode: 0, view: window
    }));
    window.scrollBy(0, segDelta);
    await new Promise(r => setTimeout(r, 18 + Math.random() * 25));
  }

  return { ok: true, scrolled: Math.round(window.scrollY - startY) };
})()`
        });
        break;
      }

      case 'human_drag': {
        const from = (args.from as string).replace(/'/g, "\\'");
        const to = (args.to as string).replace(/'/g, "\\'");
        const steps = Math.min(Math.max((args.steps as number) || 20, 8), 60);
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const srcEl = document.querySelector('${from}');
  const tgtEl = document.querySelector('${to}');
  if (!srcEl) return { error: 'Source element not found: ${from}' };
  if (!tgtEl) return { error: 'Target element not found: ${to}' };
  const srcCs = window.getComputedStyle(srcEl);
  const tgtCs = window.getComputedStyle(tgtEl);
  if (srcCs.display === 'none') return { error: 'Source element is hidden (display:none).', selector: '${from}' };
  if (tgtCs.display === 'none') return { error: 'Target element is hidden (display:none).', selector: '${to}' };
  // Auto-scroll source into view
  const srcR = srcEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (srcR.bottom < 0 || srcR.top > vh || srcR.right < 0 || srcR.left > vw) {
    srcEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
  }

  const sr = srcEl.getBoundingClientRect();
  const tr = tgtEl.getBoundingClientRect();
  const sx = sr.left + sr.width/2 + (Math.random()-0.5)*sr.width*0.2;
  const sy = sr.top + sr.height/2 + (Math.random()-0.5)*sr.height*0.2;
  const tx = tr.left + tr.width/2 + (Math.random()-0.5)*tr.width*0.2;
  const ty = tr.top + tr.height/2 + (Math.random()-0.5)*tr.height*0.2;

  const common = { bubbles: true, cancelable: true, view: window };

  // Hover source
  srcEl.dispatchEvent(new MouseEvent('mouseover', { ...common, clientX: sx, clientY: sy }));
  srcEl.dispatchEvent(new MouseEvent('mouseenter', { ...common, clientX: sx, clientY: sy, bubbles: false }));
  await new Promise(r => setTimeout(r, 60 + Math.random()*40));

  // Press down
  srcEl.dispatchEvent(new MouseEvent('mousedown', { ...common, clientX: sx, clientY: sy }));
  await new Promise(r => setTimeout(r, 80 + Math.random()*60));

  // Bézier drag path
  const cp1x = sx + (tx-sx)*0.3 + (Math.random()-0.5)*80;
  const cp1y = sy + (ty-sy)*0.2 + (Math.random()-0.5)*80;
  const cp2x = sx + (tx-sx)*0.7 + (Math.random()-0.5)*50;
  const cp2y = sy + (ty-sy)*0.8 + (Math.random()-0.5)*50;

  const N = ${steps};
  for (let i = 1; i <= N; i++) {
    let t = i/N;
    t = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
    const u = 1 - t;
    const px = u*u*u*sx + 3*u*u*t*cp1x + 3*u*t*t*cp2x + t*t*t*tx;
    const py = u*u*u*sy + 3*u*u*t*cp1y + 3*u*t*t*cp2y + t*t*t*ty;
    const curEl = document.elementFromPoint(px, py) || document.body;
    curEl.dispatchEvent(new MouseEvent('mousemove', { ...common, clientX: px, clientY: py }));
    await new Promise(r => setTimeout(r, 10 + Math.random()*15));
  }

  // Release on target
  tgtEl.dispatchEvent(new MouseEvent('mouseup', { ...common, clientX: tx, clientY: ty }));
  tgtEl.dispatchEvent(new MouseEvent('click', { ...common, clientX: tx, clientY: ty }));

  // Also dispatch native drag events for HTML5 DnD
  try {
    srcEl.dispatchEvent(new DragEvent('dragstart', { ...common, clientX: sx, clientY: sy }));
    tgtEl.dispatchEvent(new DragEvent('dragenter', { ...common, clientX: tx, clientY: ty }));
    tgtEl.dispatchEvent(new DragEvent('dragover', { ...common, clientX: tx, clientY: ty }));
    tgtEl.dispatchEvent(new DragEvent('drop', { ...common, clientX: tx, clientY: ty }));
    srcEl.dispatchEvent(new DragEvent('dragend', { ...common, clientX: tx, clientY: ty }));
  } catch(e) {}

  return { ok: true, from: {x:Math.round(sx),y:Math.round(sy)}, to: {x:Math.round(tx),y:Math.round(ty)} };
})()`
        });
        break;
      }

      // ========== Multimodal & coordinate tools ==========

      case 'screenshot_element': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        // Step 1: Get element bounds + device pixel ratio
        const boundsResult: any = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found' };
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 };
})()`
        });
        const bounds = boundsResult?.result || boundsResult;
        if (bounds?.error) { result = bounds; break; }
        // Step 2: Capture full visible tab
        const shot: any = await sendToBackground('SCREENSHOT');
        if (shot?.error) { result = shot; break; }
        const dataUrl = shot?.dataUrl || shot?.result?.dataUrl;
        if (!dataUrl) { result = { error: 'Screenshot capture failed' }; break; }
        // Step 3: Crop to element bounds using canvas
        try {
          const cropped = await cropScreenshot(dataUrl, bounds.x, bounds.y, bounds.width, bounds.height, bounds.dpr);
          result = { ok: true, dataUrl: cropped, bounds };
        } catch (e: any) {
          result = { error: `Crop failed: ${e.message}` };
        }
        break;
      }

      case 'screenshot_area': {
        const ax = args.x as number, ay = args.y as number;
        const aw = args.width as number, ah = args.height as number;
        // Get DPR
        const dprResult: any = await sendToContent('INJECT_JS', {
          code: `(function(){ return { dpr: window.devicePixelRatio || 1 }; })()`
        });
        const dpr = dprResult?.result?.dpr || dprResult?.dpr || 1;
        const shot2: any = await sendToBackground('SCREENSHOT');
        if (shot2?.error) { result = shot2; break; }
        const dataUrl2 = shot2?.dataUrl || shot2?.result?.dataUrl;
        if (!dataUrl2) { result = { error: 'Screenshot capture failed' }; break; }
        try {
          const cropped = await cropScreenshot(dataUrl2, ax, ay, aw, ah, dpr);
          result = { ok: true, dataUrl: cropped, region: { x: ax, y: ay, width: aw, height: ah } };
        } catch (e: any) {
          result = { error: `Crop failed: ${e.message}` };
        }
        break;
      }

      case 'get_element_bounds': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found' };
  const rect = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  const vw = window.innerWidth, vh = window.innerHeight;
  const inViewport = rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0;
  const isVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 && rect.width > 0 && rect.height > 0;
  return {
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
    top: Math.round(rect.top), left: Math.round(rect.left),
    bottom: Math.round(rect.bottom), right: Math.round(rect.right),
    isVisible, isInViewport: inViewport,
    styles: {
      color: cs.color, backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      display: cs.display, position: cs.position,
      opacity: cs.opacity, zIndex: cs.zIndex,
      overflow: cs.overflow, cursor: cs.cursor,
    }
  };
})()`
        });
        break;
      }

      case 'find_at_point': {
        const fx = args.x as number, fy = args.y as number;
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.elementFromPoint(${fx}, ${fy});
  if (!el) return { error: 'No element at this point' };
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  // Build a reasonable CSS selector
  let sel = tag;
  if (el.id) sel = '#' + el.id;
  else if (el.className && typeof el.className === 'string') sel = tag + '.' + el.className.trim().split(/\\s+/).join('.');
  return {
    tag, id: el.id || null,
    className: el.className || null,
    text: (el.textContent || '').trim().slice(0, 200),
    selector: sel,
    bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value]).slice(0, 20)),
    isInteractive: ['a','button','input','select','textarea'].includes(tag) || el.getAttribute('role') === 'button' || el.hasAttribute('onclick'),
  };
})()`
        });
        break;
      }

      case 'click_at_coords': {
        const cx = args.x as number, cy = args.y as number;
        const btn = args.button === 'right' ? 2 : 0;
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.elementFromPoint(${cx}, ${cy});
  if (!el) return { error: 'No element at coordinates (${cx}, ${cy})' };
  const common = { bubbles: true, cancelable: true, clientX: ${cx}, clientY: ${cy}, button: ${btn}, view: window };
  el.dispatchEvent(new MouseEvent('mouseover', common));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...common, bubbles: false }));
  await new Promise(r => setTimeout(r, 30 + Math.random() * 30));
  el.dispatchEvent(new MouseEvent('mousemove', common));
  await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
  el.dispatchEvent(new MouseEvent('mousedown', common));
  await new Promise(r => setTimeout(r, 50 + Math.random() * 60));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  el.dispatchEvent(new MouseEvent('click', common));
  const tag = el.tagName.toLowerCase();
  let sel = tag;
  if (el.id) sel = '#' + el.id;
  else if (el.className && typeof el.className === 'string') sel = tag + '.' + el.className.trim().split(/\\s+/)[0];
  return { ok: true, clicked: sel, x: ${cx}, y: ${cy} };
})()`
        });
        break;
      }

      case 'type_at_coords': {
        const tx = args.x as number, ty = args.y as number;
        const tText = (args.text as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.elementFromPoint(${tx}, ${ty});
  if (!el) return { error: 'No element at coordinates' };
  el.focus();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${tx}, clientY: ${ty} }));
  await new Promise(r => setTimeout(r, 50));
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(el, '${tText}');
  else el.value = '${tText}';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, tag: el.tagName.toLowerCase() };
})()`
        });
        break;
      }

      case 'get_interactive_map': {
        const viewportOnly = args.viewport_only !== false;
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]';
  const vw = window.innerWidth, vh = window.innerHeight;
  const onlyViewport = ${viewportOnly};
  const elements = [];
  document.querySelectorAll(selectors).forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (onlyViewport && (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw)) return;
    const tag = el.tagName.toLowerCase();
    let text = '';
    if (tag === 'input' || tag === 'textarea') {
      text = el.placeholder || el.value || el.getAttribute('aria-label') || '';
    } else {
      text = (el.textContent || '').trim().slice(0, 80);
    }
    let sel = tag;
    if (el.id) sel = '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim()) sel = tag + '.' + el.className.trim().split(/\\s+/)[0];
    elements.push({
      tag, type: el.type || el.getAttribute('role') || tag,
      text: text.slice(0, 80),
      selector: sel,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      center: { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) },
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
      ...(tag === 'input' || tag === 'select' || tag === 'textarea' ? {
        label: (function(){
          const id = el.id;
          if (id) { const lbl = document.querySelector('label[for="'+id+'"]'); if (lbl) return lbl.textContent.trim().slice(0,60); }
          const wrap = el.closest('label'); if (wrap) return wrap.textContent.trim().slice(0,60);
          return el.getAttribute('aria-label') || el.getAttribute('placeholder') || null;
        })(),
        required: el.required || el.getAttribute('aria-required') === 'true',
        name: el.name || null,
        value: (el.value || '').slice(0, 40) || null,
        pattern: el.pattern || null,
      } : {}),
      ariaLabel: el.getAttribute('aria-label') || null,
    });
  });
  return { elements, total: elements.length, viewport: { width: vw, height: vh } };
})()`
        });
        break;
      }

      case 'visual_query': {
        const vqSel = args.selector ? (args.selector as string).replace(/'/g, "\\'") : '';
        let vqDataUrl: string | undefined;

        if (vqSel) {
          // Element-scoped screenshot
          const boundsRes: any = await sendToContent('INJECT_JS', {
            code: `(function(){
  const el = document.querySelector('${vqSel}');
  if (!el) return { error: 'Element not found' };
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 };
})()`
          });
          const b = boundsRes?.result || boundsRes;
          if (b?.error) { result = b; break; }
          const s: any = await sendToBackground('SCREENSHOT');
          const du = s?.dataUrl || s?.result?.dataUrl;
          if (du) {
            try { vqDataUrl = await cropScreenshot(du, b.x, b.y, b.width, b.height, b.dpr); } catch {}
          }
        } else {
          // Full page screenshot
          const s: any = await sendToBackground('SCREENSHOT');
          vqDataUrl = s?.dataUrl || s?.result?.dataUrl;
        }

        if (!vqDataUrl) { result = { error: 'Screenshot capture failed' }; break; }

        // Return with special __imageDataUrl marker for multimodal injection
        result = {
          ok: true,
          __imageDataUrl: vqDataUrl,
          question: args.question,
          message: `Screenshot captured. Analyzing: "${args.question}"`,
        };
        break;
      }

      // ========== Batch & Extraction tools ==========

      case 'fill_form': {
        const fieldsStr = args.fields as string;
        let fields: Array<{selector: string; value: string}>;
        try { fields = JSON.parse(fieldsStr); } catch { result = { error: 'Invalid JSON in fields parameter' }; break; }
        if (!Array.isArray(fields) || fields.length === 0) { result = { error: 'fields must be a non-empty JSON array' }; break; }
        const submitSel = args.submit ? (args.submit as string).replace(/'/g, "\\'") : '';
        const fieldsJson = JSON.stringify(fields).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const fields = JSON.parse('${fieldsJson}');
  const results = [];
  const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  const nativeSelectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;

  for (const f of fields) {
    const el = document.querySelector(f.selector);
    if (!el) { results.push({ selector: f.selector, ok: false, error: 'not found' }); continue; }
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    try {
      if (tag === 'select') {
        if (nativeSelectSetter) nativeSelectSetter.call(el, f.value);
        else el.value = f.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (type === 'checkbox' || type === 'radio') {
        const want = f.value === 'true' || f.value === '1';
        if (el.checked !== want) el.click();
      } else if (tag === 'input' || tag === 'textarea') {
        const setter = tag === 'textarea' ? (nativeTextareaSetter || nativeInputSetter) : nativeInputSetter;
        if (setter) setter.call(el, f.value);
        else el.value = f.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.textContent = f.value;
      }
      results.push({ selector: f.selector, ok: true });
    } catch (e) {
      results.push({ selector: f.selector, ok: false, error: e.message });
    }
  }

  let submitResult = null;
  if ('${submitSel}') {
    const btn = document.querySelector('${submitSel}');
    if (btn) { btn.click(); submitResult = { ok: true }; }
    else { submitResult = { error: 'Submit button not found' }; }
  }

  const filled = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  return { filled, failed, total: results.length, details: results, submitResult };
})()`
        });
        break;
      }

      case 'navigate': {
        if (args.url) {
          result = await sendToBackground('NAVIGATE', { url: args.url, waitFor: args.waitFor, waitUntil: args.waitUntil });
        } else if (args.action) {
          result = await sendToBackground('NAVIGATE', { action: args.action, waitFor: args.waitFor, waitUntil: args.waitUntil });
        } else {
          result = { error: 'Provide either url or action parameter' };
        }
        break;
      }

      case 'extract_table': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const maxRows = Math.min((args.maxRows as number) || 200, 1000);
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const table = document.querySelector('${sel}');
  if (!table || table.tagName.toLowerCase() !== 'table') return { error: 'Table not found: ${sel}' };

  // Extract headers
  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  const headers = [];
  if (headerRow) {
    headerRow.querySelectorAll('th, td').forEach(cell => {
      headers.push(cell.textContent.trim());
    });
  }

  // Extract rows
  const rows = [];
  const bodyRows = table.querySelectorAll('tbody tr');
  const allRows = bodyRows.length > 0 ? bodyRows : table.querySelectorAll('tr');
  const startIdx = (bodyRows.length > 0) ? 0 : 1; // skip header row if no tbody
  let count = 0;
  for (let i = startIdx; i < allRows.length && count < ${maxRows}; i++) {
    const cells = allRows[i].querySelectorAll('td, th');
    if (cells.length === 0) continue;
    const row = {};
    cells.forEach((cell, j) => {
      const key = headers[j] || ('col_' + j);
      row[key] = cell.textContent.trim();
    });
    rows.push(row);
    count++;
  }

  return {
    headers,
    rows,
    rowCount: rows.length,
    totalRows: (bodyRows.length > 0 ? bodyRows : table.querySelectorAll('tr')).length - (bodyRows.length > 0 ? 0 : 1),
    truncated: count >= ${maxRows},
  };
})()`
        });
        break;
      }

      case 'extract_links': {
        const scope = args.selector ? (args.selector as string).replace(/'/g, "\\'") : '';
        const filter = args.filter ? (args.filter as string).replace(/'/g, "\\'").toLowerCase() : '';
        const extOnly = args.external_only ? 'true' : 'false';
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const root = '${scope}' ? document.querySelector('${scope}') : document;
  if (!root) return { error: 'Scope element not found: ${scope}' };
  const origin = location.origin;
  const links = [];
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    const text = a.textContent.trim().slice(0, 100);
    const isExternal = !href.startsWith(origin) && href.startsWith('http');
    if (${extOnly} && !isExternal) return;
    if ('${filter}' && !href.toLowerCase().includes('${filter}')) return;
    links.push({
      href,
      text,
      target: a.target || '_self',
      isExternal,
      rel: a.rel || null,
    });
  });
  return { links, total: links.length };
})()`
        });
        break;
      }

      case 'query_selector_all': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const limit = Math.min((args.limit as number) || 20, 100);
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const els = document.querySelectorAll('${sel}');
  const total = els.length;
  const items = [];
  for (let i = 0; i < Math.min(total, ${limit}); i++) {
    const el = els[i];
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    let uniqSel = tag;
    if (el.id) uniqSel = '#' + el.id;
    else if (el.className && typeof el.className === 'string' && el.className.trim()) {
      uniqSel = tag + '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.');
    }
    // nth-of-type if needed for uniqueness
    if (!el.id) {
      const parent = el.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (sibs.length > 1) uniqSel += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
    }
    items.push({
      index: i,
      tag,
      text: (el.textContent || '').trim().slice(0, 80),
      selector: uniqSel,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      attributes: Object.fromEntries([...el.attributes].slice(0, 8).map(a => [a.name, a.value.slice(0, 60)])),
    });
  }
  return { matches: items, total, returned: items.length, truncated: total > ${limit} };
})()`
        });
        break;
      }

      case 'get_cookies':
        result = await sendToBackground('GET_COOKIES', { name: args.name, domain: args.domain });
        break;

      case 'set_cookie':
        result = await sendToBackground('SET_COOKIE', {
          name: args.name,
          value: args.value,
          domain: args.domain,
          path: args.path || '/',
          secure: args.secure,
          httpOnly: args.httpOnly,
          sameSite: args.sameSite,
          expiresInSeconds: args.expiresInSeconds,
        });
        break;

      case 'emulate_device':
        result = await sendToBackground('EMULATE_DEVICE', {
          width: args.width,
          height: args.height,
          deviceScaleFactor: args.deviceScaleFactor,
          userAgent: args.userAgent,
          preset: args.preset,
          action: args.action,
        });
        break;

      case 'intercept_request':
        result = await sendToBackground('INTERCEPT_REQUEST', {
          urlPattern: args.urlPattern,
          action: args.action,
          responseBody: args.responseBody,
          responseStatus: args.responseStatus,
          responseHeaders: args.responseHeaders,
          headers: args.headers,
        });
        break;

      case 'block_urls':
        result = await sendToBackground('BLOCK_URLS', {
          patterns: args.patterns,
          action: args.action,
        });
        break;

      // ========== CDP Environment tools ==========

      case 'network_throttle':
        result = await sendToBackground('NETWORK_THROTTLE', {
          preset: args.preset,
          downloadKbps: args.downloadKbps,
          uploadKbps: args.uploadKbps,
          latencyMs: args.latencyMs,
          action: args.action,
        });
        break;

      case 'get_event_listeners': {
        const gel_sel = (args.selector as string).replace(/'/g, "\\'");
        result = await sendToBackground('GET_EVENT_LISTENERS', { selector: gel_sel });
        break;
      }

      case 'force_css_state':
        result = await sendToBackground('FORCE_CSS_STATE', {
          selector: args.selector,
          states: args.states,
          action: args.action,
        });
        break;

      case 'set_geolocation':
        result = await sendToBackground('SET_GEOLOCATION', {
          latitude: args.latitude,
          longitude: args.longitude,
          accuracy: args.accuracy,
          action: args.action,
        });
        break;

      case 'set_timezone':
        result = await sendToBackground('SET_TIMEZONE', {
          timezoneId: args.timezoneId,
          action: args.action,
        });
        break;

      case 'emulate_media':
        result = await sendToBackground('EMULATE_MEDIA', {
          colorScheme: args.colorScheme,
          mediaType: args.mediaType,
          reducedMotion: args.reducedMotion,
          forcedColors: args.forcedColors,
          action: args.action,
        });
        break;

      case 'pdf_page':
        result = await sendToBackground('PDF_PAGE', {
          landscape: args.landscape,
          printBackground: args.printBackground !== false,
          scale: args.scale,
          paperWidth: args.paperWidth,
          paperHeight: args.paperHeight,
        });
        break;

      // ========== DOM Utility tools ==========

      case 'search_text': {
        const stQuery = (args.query as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const stRegex = args.regex ? 'true' : 'false';
        const stVisOnly = args.visibleOnly ? 'true' : 'false';
        const stLimit = (args.limit as number) || 50;
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const query = '${stQuery}';
  const useRegex = ${stRegex};
  const visibleOnly = ${stVisOnly};
  const limit = ${stLimit};
  const matches = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const regex = useRegex ? new RegExp(query, 'gi') : null;
  let node;
  while ((node = walker.nextNode()) && matches.length < limit) {
    const text = node.textContent || '';
    const hasMatch = regex ? regex.test(text) : text.toLowerCase().includes(query.toLowerCase());
    if (!hasMatch) continue;
    if (regex) regex.lastIndex = 0;
    const el = node.parentElement;
    if (!el) continue;
    if (visibleOnly) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
    }
    const path = [];
    let p = el;
    while (p && p !== document.body) {
      let seg = p.tagName.toLowerCase();
      if (p.id) seg += '#' + p.id;
      else if (p.className) seg += '.' + p.className.toString().split(' ')[0];
      path.unshift(seg);
      p = p.parentElement;
    }
    matches.push({
      text: text.trim().slice(0, 200),
      element: path.join(' > '),
      tag: el.tagName.toLowerCase(),
      visible: !(window.getComputedStyle(el).display === 'none'),
    });
  }
  return { matches, total: matches.length };
})()`
        });
        break;
      }

      case 'toggle_class': {
        const tcSel = (args.selector as string).replace(/'/g, "\\'");
        const tcAdd = args.add ? (args.add as string).replace(/'/g, "\\'") : '';
        const tcRemove = args.remove ? (args.remove as string).replace(/'/g, "\\'") : '';
        const tcToggle = args.toggle ? (args.toggle as string).replace(/'/g, "\\'") : '';
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${tcSel}');
  if (!el) return { error: 'Element not found: ${tcSel}' };
  ${tcAdd ? `'${tcAdd}'.split(' ').forEach(c => c && el.classList.add(c));` : ''}
  ${tcRemove ? `'${tcRemove}'.split(' ').forEach(c => c && el.classList.remove(c));` : ''}
  ${tcToggle ? `'${tcToggle}'.split(' ').forEach(c => c && el.classList.toggle(c));` : ''}
  return { ok: true, classList: Array.from(el.classList) };
})()`
        });
        break;
      }

      case 'insert_element': {
        const ieSel = (args.selector as string).replace(/'/g, "\\'");
        const iePos = (args.position as string) || 'beforeend';
        const ieHtml = (args.html as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${ieSel}');
  if (!el) return { error: 'Element not found: ${ieSel}' };
  el.insertAdjacentHTML('${iePos}', '${ieHtml}');
  return { ok: true, position: '${iePos}', parentTag: el.tagName.toLowerCase(), childCount: el.childElementCount };
})()`
        });
        break;
      }

      case 'enable_stealth':
        result = await sendToBackground('ENABLE_STEALTH');
        break;

      case 'disable_stealth':
        result = await sendToBackground('DISABLE_STEALTH');
        break;

      // ========== Phase 24: Interaction tools ==========

      case 'hover': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        const dur = Math.min((args.duration as number) || 500, 10000);
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none).' };
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
  }
  const r2 = el.getBoundingClientRect();
  const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
  const common = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
  el.dispatchEvent(new MouseEvent('mouseover', common));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...common, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mousemove', common));
  await new Promise(r => setTimeout(r, ${dur}));
  const csAfter = window.getComputedStyle(el);
  return { ok: true, hoveredFor: ${dur}, tagName: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 80), stylesAfterHover: { color: csAfter.color, backgroundColor: csAfter.backgroundColor, display: csAfter.display, opacity: csAfter.opacity, visibility: csAfter.visibility } };
})()`
        });
        break;
      }

      case 'double_click': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none).' };
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const r2 = el.getBoundingClientRect();
  const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
  const common = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', common));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  el.dispatchEvent(new MouseEvent('click', common));
  el.dispatchEvent(new MouseEvent('mousedown', common));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  el.dispatchEvent(new MouseEvent('click', common));
  el.dispatchEvent(new MouseEvent('dblclick', common));
  return { ok: true };
})()`
        });
        break;
      }

      case 'right_click': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return { error: 'Element is hidden (display:none).' };
  const rect = el.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const r2 = el.getBoundingClientRect();
  const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
  const common = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', common));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  el.dispatchEvent(new MouseEvent('contextmenu', common));
  return { ok: true };
})()`
        });
        break;
      }

      case 'upload_file':
        result = await sendToBackground('UPLOAD_FILE', {
          selector: args.selector,
          fileName: args.fileName,
          content: args.content,
          mimeType: args.mimeType,
          base64: args.base64,
        });
        break;

      case 'focus': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  el.focus();
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  return { ok: true, tag: el.tagName.toLowerCase(), activeElement: document.activeElement === el };
})()`
        });
        break;
      }

      case 'blur': {
        const sel = (args.selector as string).replace(/'/g, "\\'");
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${sel}');
  if (!el) return { error: 'Element not found: ${sel}' };
  el.blur();
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return { ok: true, tag: el.tagName.toLowerCase() };
})()`
        });
        break;
      }

      // ========== Phase 24: Observation & Analysis tools ==========

      case 'observe_dom': {
        const obsSel = args.selector ? (args.selector as string).replace(/'/g, "\\'") : '';
        const obsDur = Math.min((args.duration as number) || 3000, 15000);
        const obsSubtree = args.subtree !== false;
        const obsAttrs = args.attributes !== false;
        const obsChildList = args.childList !== false;
        const obsCharData = args.characterData !== false;
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const root = '${obsSel}' ? document.querySelector('${obsSel}') : document.body;
  if (!root) return { error: 'Element not found: ${obsSel}' };
  const log = [];
  const start = Date.now();
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      const t = Date.now() - start;
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) log.push({ time: t, type: 'added', tag: n.tagName?.toLowerCase(), text: (n.textContent || '').slice(0, 60), parentSelector: m.target.tagName?.toLowerCase() });
          else if (n.nodeType === 3 && n.textContent?.trim()) log.push({ time: t, type: 'textAdded', text: n.textContent.slice(0, 60) });
        }
        for (const n of m.removedNodes) {
          if (n.nodeType === 1) log.push({ time: t, type: 'removed', tag: n.tagName?.toLowerCase(), text: (n.textContent || '').slice(0, 40) });
        }
      } else if (m.type === 'attributes') {
        log.push({ time: t, type: 'attribute', target: m.target.tagName?.toLowerCase(), attr: m.attributeName, oldValue: m.oldValue?.slice(0, 60), newValue: m.target.getAttribute?.(m.attributeName)?.slice(0, 60) });
      } else if (m.type === 'characterData') {
        log.push({ time: t, type: 'textChanged', text: (m.target.textContent || '').slice(0, 60) });
      }
      if (log.length >= 200) return; // cap
    }
  });
  observer.observe(root, { subtree: ${obsSubtree}, attributes: ${obsAttrs}, childList: ${obsChildList}, characterData: ${obsCharData}, attributeOldValue: true });
  await new Promise(r => setTimeout(r, ${obsDur}));
  observer.disconnect();
  return { mutations: log, total: log.length, duration: ${obsDur}, target: '${obsSel}' || 'body' };
})()`
        });
        break;
      }

      case 'get_computed_style': {
        const gcsSel = (args.selector as string).replace(/'/g, "\\'");
        const gcsProps = args.properties ? (args.properties as string).replace(/'/g, "\\'") : '';
        const gcsPseudo = args.pseudoElement ? (args.pseudoElement as string).replace(/'/g, "\\'") : '';
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const el = document.querySelector('${gcsSel}');
  if (!el) return { error: 'Element not found: ${gcsSel}' };
  const pseudo = '${gcsPseudo}' || null;
  const cs = window.getComputedStyle(el, pseudo);
  const propsStr = '${gcsProps}';
  if (propsStr) {
    const props = propsStr.split(',').map(p => p.trim());
    const result = {};
    for (const p of props) result[p] = cs.getPropertyValue(p);
    return { selector: '${gcsSel}', properties: result, pseudo: pseudo };
  }
  // Return key CSS properties
  const keys = ['display','position','width','height','margin','padding','border','color','background-color','background','font-family','font-size','font-weight','line-height','text-align','text-decoration','opacity','visibility','overflow','z-index','float','flex','grid','gap','box-sizing','cursor','pointer-events','transform','transition','animation','box-shadow','border-radius','outline','top','right','bottom','left','max-width','min-width','max-height','min-height','white-space','word-break','text-overflow'];
  const result = {};
  for (const k of keys) {
    const v = cs.getPropertyValue(k);
    if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') result[k] = v;
  }
  return { selector: '${gcsSel}', properties: result, pseudo: pseudo, totalProperties: cs.length };
})()`
        });
        break;
      }

      case 'monitor_events': {
        const meSel = (args.selector as string).replace(/'/g, "\\'");
        const meDur = Math.min((args.duration as number) || 5000, 15000);
        const meTypes = args.eventTypes ? (args.eventTypes as string).replace(/'/g, "\\'") : '';
        result = await sendToContent('INJECT_JS', {
          code: `(async function(){
  const el = document.querySelector('${meSel}');
  if (!el) return { error: 'Element not found: ${meSel}' };
  const defaultTypes = ['click','dblclick','mousedown','mouseup','mouseover','mouseenter','mouseleave','contextmenu','keydown','keyup','keypress','input','change','focus','blur','focusin','focusout','submit','scroll','wheel','touchstart','touchend','pointerdown','pointerup','dragstart','drop'];
  const types = '${meTypes}' ? '${meTypes}'.split(',').map(t => t.trim()) : defaultTypes;
  const log = [];
  const start = Date.now();
  const handlers = {};
  for (const type of types) {
    handlers[type] = (e) => {
      const entry = { time: Date.now() - start, type: e.type, target: e.target?.tagName?.toLowerCase() };
      if (e.clientX !== undefined) { entry.x = Math.round(e.clientX); entry.y = Math.round(e.clientY); }
      if (e.key) entry.key = e.key;
      if (e.target?.value !== undefined) entry.value = String(e.target.value).slice(0, 40);
      if (e.defaultPrevented) entry.defaultPrevented = true;
      log.push(entry);
    };
    el.addEventListener(type, handlers[type], true);
  }
  await new Promise(r => setTimeout(r, ${meDur}));
  for (const type of types) el.removeEventListener(type, handlers[type], true);
  return { events: log, total: log.length, duration: ${meDur}, selector: '${meSel}', monitored: types };
})()`
        });
        break;
      }

      // ========== Phase 24: CDP-powered tools ==========

      case 'js_coverage':
        result = await sendToBackground('JS_COVERAGE', {
          action: args.action,
          detailed: args.detailed,
        });
        break;

      case 'animation_speed':
        result = await sendToBackground('ANIMATION_SPEED', {
          rate: args.rate,
        });
        break;

      // ========== Phase 24: Page structure tools ==========

      case 'list_iframes': {
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const iframes = document.querySelectorAll('iframe');
  const list = [];
  iframes.forEach((iframe, i) => {
    const rect = iframe.getBoundingClientRect();
    const cs = window.getComputedStyle(iframe);
    let url = '';
    try { url = iframe.src || iframe.contentWindow?.location?.href || ''; } catch { url = iframe.src || '(cross-origin)'; }
    list.push({
      index: i,
      src: url.slice(0, 300),
      name: iframe.name || null,
      id: iframe.id || null,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      sandbox: iframe.sandbox?.value || null,
      loading: iframe.loading || 'eager',
      allow: iframe.allow || null,
    });
  });
  return { iframes: list, total: list.length };
})()`
        });
        break;
      }

      case 'pierce_shadow': {
        const psSel = (args.hostSelector as string).replace(/'/g, "\\'");
        const psInner = (args.innerSelector as string).replace(/'/g, "\\'");
        const psAction = (args.action as string) || 'query';
        const psProp = args.property ? (args.property as string).replace(/'/g, "\\'") : '';
        const psVal = args.value ? (args.value as string).replace(/'/g, "\\'") : '';
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const host = document.querySelector('${psSel}');
  if (!host) return { error: 'Shadow host not found: ${psSel}' };
  const shadow = host.shadowRoot;
  if (!shadow) return { error: 'No shadow root on element (may be closed shadow DOM)' };
  const el = shadow.querySelector('${psInner}');
  if (!el) return { error: 'Inner element not found: ${psInner} inside shadow of ${psSel}' };
  const action = '${psAction}';
  if (action === 'text') return { ok: true, text: (el.textContent || '').trim().slice(0, 3000) };
  if (action === 'click') { el.click(); return { ok: true, clicked: true }; }
  if (action === 'modify-style') {
    el.style.setProperty('${psProp}', '${psVal}');
    return { ok: true, property: '${psProp}', value: '${psVal}' };
  }
  // query
  const rect = el.getBoundingClientRect();
  const cs = window.getComputedStyle(el);
  return {
    ok: true, tag: el.tagName.toLowerCase(), id: el.id || null,
    className: el.className || null,
    text: (el.textContent || '').trim().slice(0, 200),
    bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    visible: cs.display !== 'none' && cs.visibility !== 'hidden',
    attributes: Object.fromEntries([...el.attributes].slice(0, 15).map(a => [a.name, a.value.slice(0, 80)])),
    childCount: el.children.length,
  };
})()`
        });
        break;
      }

      case 'extract_meta': {
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
  const meta = {};
  meta.title = document.title;
  meta.lang = document.documentElement.lang || null;
  meta.charset = document.characterSet;
  // Standard meta tags
  const metas = {};
  document.querySelectorAll('meta[name], meta[property]').forEach(m => {
    const key = m.getAttribute('name') || m.getAttribute('property');
    if (key) metas[key] = m.content;
  });
  meta.description = metas.description || null;
  meta.keywords = metas.keywords || null;
  meta.author = metas.author || null;
  meta.viewport = metas.viewport || null;
  meta.robots = metas.robots || null;
  // Canonical
  const canonical = document.querySelector('link[rel="canonical"]');
  meta.canonical = canonical?.href || null;
  // Open Graph
  const og = {};
  for (const [k, v] of Object.entries(metas)) {
    if (k.startsWith('og:')) og[k.slice(3)] = v;
  }
  if (Object.keys(og).length > 0) meta.openGraph = og;
  // Twitter Card
  const twitter = {};
  for (const [k, v] of Object.entries(metas)) {
    if (k.startsWith('twitter:')) twitter[k.slice(8)] = v;
  }
  if (Object.keys(twitter).length > 0) meta.twitterCard = twitter;
  // JSON-LD
  const jsonLd = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { jsonLd.push(JSON.parse(s.textContent)); } catch {}
  });
  if (jsonLd.length > 0) meta.jsonLd = jsonLd;
  // Favicons
  const favicons = [];
  document.querySelectorAll('link[rel*="icon"]').forEach(l => {
    favicons.push({ rel: l.rel, href: l.href, sizes: l.sizes?.value || null, type: l.type || null });
  });
  if (favicons.length > 0) meta.favicons = favicons;
  // Alternate links (hreflang, RSS)
  const alternates = [];
  document.querySelectorAll('link[rel="alternate"]').forEach(l => {
    alternates.push({ href: l.href, hreflang: l.hreflang || null, type: l.type || null, title: l.title || null });
  });
  if (alternates.length > 0) meta.alternates = alternates;
  return meta;
})()`
        });
        break;
      }

      case 'clear_site_data':
        result = await sendToBackground('CLEAR_SITE_DATA', {
          types: args.types,
        });
        break;

      default:
        return {
          tool: name,
          success: false,
          result: `Unknown tool: ${name}`,
          displayText: `Unknown tool: ${name}`,
        };
    }

    const success = !(result as any)?.error;
    return {
      toolCallId: call.id,
      tool: name,
      success,
      result,
      displayText: success
        ? formatSuccessResult(name, args, result)
        : `Failed: ${(result as any)?.error}`,
    };
  } catch (err: any) {
    return {
      toolCallId: call.id,
      tool: name,
      success: false,
      result: err.message,
      displayText: `Error: ${err.message}`,
    };
  }
}

async function sendToContent(type: string, payload?: unknown): Promise<unknown> {
  debugToolLog(`sendToContent: ${type}`, payload);
  const result = await chrome.runtime.sendMessage({ type, payload });
  debugToolLog(`response: ${type}`, result);
  return result;
}

async function sendToBackground(type: string, payload?: unknown): Promise<unknown> {
  debugToolLog(`sendToBackground: ${type}`, payload);
  const result = await chrome.runtime.sendMessage({ type, payload });
  debugToolLog(`response: ${type}`, result);
  return result;
}

/** Crop a screenshot data URL to a viewport region, accounting for devicePixelRatio */
async function cropScreenshot(
  dataUrl: string, x: number, y: number, w: number, h: number, dpr: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context failed')); return; }
      ctx.drawImage(img,
        Math.round(x * dpr), Math.round(y * dpr), cw, ch,  // source rect
        0, 0, cw, ch,                                        // dest rect
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

function debugToolLog(...args: unknown[]) {
  chrome.storage.local.get('kp_debug_mode').then(r => {
    if (r.kp_debug_mode) console.log('[KP:Tool]', ...args);
  });
}

function formatSuccessResult(name: string, args: Record<string, unknown>, result: unknown): string {
  switch (name) {
    case 'inspect_element': {
      const el = result as any;
      if (!el?.tagName) return 'Element not found';
      return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ')[0] : ''}> inspected`;
    }
    case 'modify_style':
      return `Set ${args.property}: ${args.value} on ${args.selector}`;
    case 'modify_text':
      return `Changed text of ${args.selector}`;
    case 'modify_attribute':
      return `Set ${args.attribute}="${args.value}" on ${args.selector}`;
    case 'modify_html':
      return `Updated HTML of ${args.selector}`;
    case 'inject_css':
      return `Injected CSS (${(args.css as string).length} chars)`;
    case 'inject_js': {
      const r = result as any;
      const time = r?.executionTime ? ` (${r.executionTime}ms)` : '';
      if (r?.error) return `JS error${time}: ${r.error}`;
      return `Executed JS (${(args.code as string).length} chars)${time}`;
    }
    case 'click':
      return `Clicked ${args.selector}`;
    case 'type_text':
      return `Typed "${(args.text as string).slice(0, 30)}" into ${args.selector}`;
    case 'read_text': {
      const text = (result as any)?.text?.slice(0, 100) || '';
      return `Read: "${text}"`;
    }
    case 'get_page_info':
      return `Page info retrieved`;
    case 'get_network_requests': {
      const r = result as any;
      const total = r?.total ?? (Array.isArray(result) ? (result as any[]).length : 0);
      const returned = r?.returned ?? total;
      return `${returned}/${total} requests captured`;
    }
    case 'hide_element':
      return `Hidden ${args.selector}`;
    case 'show_element':
      return `Shown ${args.selector}`;
    case 'get_page_sections': {
      const sections = Array.isArray(result) ? result : [];
      return `${sections.length} page sections found`;
    }
    case 'select_option':
      return `Selected "${args.value}" in ${args.selector}`;
    case 'keypress':
      return `Pressed ${args.key}`;
    case 'check_exists': {
      const r = result as any;
      const count = r?.count ?? (r?.exists ? 1 : 0);
      return r?.exists ? `✅ ${args.selector} found (${count} match${count > 1 ? 'es' : ''})` : `❌ ${args.selector} not found`;
    }
    case 'check_text_contains':
      return `Text check: ${(result as any)?.contains ? 'match found' : 'no match'}`;
    case 'remove_element':
      return `Removed ${args.selector}`;
    case 'clone_element':
      return `Cloned ${args.selector}`;
    case 'save_script':
      return `Saved script "${args.name}"`;
    case 'update_script':
      return `Updated script ${args.id}`;
    case 'run_script': {
      const s = result as any;
      return s?.error ? `Script failed: ${s.error}` : `Script executed`;
    }
    case 'list_scripts': {
      const scripts = Array.isArray(result) ? result : [];
      return `${scripts.length} saved scripts`;
    }
    case 'screenshot':
      return `Screenshot captured`;
    case 'highlight_element':
      return `Highlighted ${args.selector}`;
    case 'get_storage': {
      const r = result as any;
      if (args.key) return `Storage value retrieved for "${args.key}"`;
      return `${r?.count ?? '?'} ${args.type} entries`;
    }
    case 'set_storage':
      return `Set ${args.type} "${args.key}"`;
    case 'clear_storage':
      return `Cleared ${args.type}`;
    case 'accessibility_audit': {
      const a = result as any;
      return `Audit: ${a?.errors ?? 0} errors, ${a?.warnings ?? 0} warnings (${a?.total ?? 0} total)`;
    }
    case 'get_performance': {
      const p = result as any;
      return `Load: ${p?.loadTime ?? '?'}ms, TTFB: ${p?.ttfb ?? '?'}ms, DOM nodes: ${p?.domNodes ?? '?'}`;
    }
    case 'human_click':
      return `Human-clicked ${args.selector}${args.doubleClick ? ' (double)' : ''}`;
    case 'human_type':
      return `Typed "${(args.text as string).slice(0, 30)}" (${args.speed || 'normal'} speed)`;
    case 'human_move':
      return `Moved mouse to ${args.selector}`;
    case 'human_scroll':
      return `Scrolled ${args.selector || args.direction || 'down'}`;
    case 'human_drag':
      return `Dragged ${args.from} → ${args.to}`;
    case 'screenshot_element':
      return `Element screenshot captured: ${args.selector}`;
    case 'screenshot_area':
      return `Area screenshot: ${args.x},${args.y} ${args.width}×${args.height}`;
    case 'get_element_bounds': {
      const b = result as any;
      const r = b?.result || b;
      return `Bounds: ${r?.width}×${r?.height} at (${r?.x}, ${r?.y}) ${r?.isVisible ? '✅ visible' : '❌ hidden'}`;
    }
    case 'find_at_point': {
      const f = result as any;
      const r = f?.result || f;
      return `Found <${r?.tag || '?'}> at (${args.x}, ${args.y}): "${(r?.text || '').slice(0, 40)}"`;
    }
    case 'click_at_coords':
      return `Clicked at (${args.x}, ${args.y})`;
    case 'type_at_coords':
      return `Typed at (${args.x}, ${args.y}): "${(args.text as string).slice(0, 30)}"`;
    case 'get_interactive_map': {
      const m = result as any;
      const r = m?.result || m;
      return `${r?.total ?? '?'} interactive elements mapped`;
    }
    case 'visual_query':
      return `Visual query: "${(args.question as string).slice(0, 50)}"`;
    case 'enable_stealth':
      return `Stealth mode enabled — anti-detection active`;
    case 'disable_stealth':
      return `Stealth mode disabled`;
    case 'fill_form': {
      const r = result as any;
      const inner = r?.result || r;
      return `Form filled: ${inner?.filled ?? '?'}/${inner?.total ?? '?'} fields${inner?.submitResult ? ' + submitted' : ''}`;
    }
    case 'navigate': {
      if (args.url) return `Navigated to ${(args.url as string).slice(0, 60)}`;
      return `Navigation: ${args.action}`;
    }
    case 'extract_table': {
      const r = result as any;
      const inner = r?.result || r;
      return `Table extracted: ${inner?.rowCount ?? '?'} rows, ${inner?.headers?.length ?? '?'} columns`;
    }
    case 'extract_links': {
      const r = result as any;
      const inner = r?.result || r;
      return `${inner?.total ?? '?'} links extracted`;
    }
    case 'query_selector_all': {
      const r = result as any;
      const inner = r?.result || r;
      return `${inner?.total ?? '?'} elements matched (returned ${inner?.returned ?? '?'})`;
    }
    case 'get_cookies': {
      const r = result as any;
      return `${Array.isArray(r) ? r.length : (r?.cookies?.length ?? '?')} cookies retrieved`;
    }
    case 'set_cookie':
      return `Cookie "${args.name}" set`;
    case 'emulate_device': {
      if (args.action === 'reset') return 'Device emulation reset';
      if (args.preset) return `Emulating ${args.preset}`;
      return `Viewport: ${args.width}×${args.height}`;
    }
    case 'intercept_request': {
      if (args.action === 'clear') return 'All request intercepts cleared';
      return `Request intercept: ${args.action} on ${args.urlPattern || '*'}`;
    }
    case 'block_urls': {
      if (args.action === 'clear') return 'All URL blocks cleared';
      return `URL patterns blocked`;
    }
    case 'network_throttle': {
      if (args.action === 'reset') return 'Network throttle reset to normal';
      return `Network throttle: ${args.preset || 'custom'} (${args.downloadKbps || '?'}kbps↓ ${args.latencyMs || '?'}ms)`;
    }
    case 'get_event_listeners': {
      const r = result as any;
      const count = r?.listeners?.length || 0;
      return `Found ${count} event listener(s) on ${args.selector}`;
    }
    case 'force_css_state': {
      if (args.action === 'clear') return `Forced CSS states cleared on ${args.selector}`;
      return `Forced CSS states [${args.states}] on ${args.selector}`;
    }
    case 'set_geolocation': {
      if (args.action === 'reset') return 'Geolocation reset to real location';
      return `Geolocation set: ${args.latitude}, ${args.longitude}`;
    }
    case 'set_timezone': {
      if (args.action === 'reset') return 'Timezone reset';
      return `Timezone set: ${args.timezoneId}`;
    }
    case 'emulate_media': {
      if (args.action === 'reset') return 'Media emulation reset';
      const parts = [];
      if (args.colorScheme) parts.push(`color-scheme: ${args.colorScheme}`);
      if (args.mediaType) parts.push(`media: ${args.mediaType}`);
      if (args.reducedMotion) parts.push(`reduced-motion: ${args.reducedMotion}`);
      return parts.join(', ') || 'Media emulated';
    }
    case 'pdf_page': {
      return `PDF generated (${args.landscape ? 'landscape' : 'portrait'})`;
    }
    case 'search_text': {
      const r = result as any;
      return `Found ${r?.total || 0} match(es) for "${args.query}"`;
    }
    case 'toggle_class': {
      const r = result as any;
      return `Classes updated → [${(r?.classList || []).join(', ')}]`;
    }
    case 'insert_element':
      return `HTML inserted ${args.position} ${args.selector}`;
    // Phase 24
    case 'hover':
      return `Hovered ${args.selector} (${args.duration || 500}ms)`;
    case 'double_click':
      return `Double-clicked ${args.selector}`;
    case 'right_click':
      return `Right-clicked ${args.selector}`;
    case 'upload_file':
      return `Uploaded "${args.fileName}" to ${args.selector}`;
    case 'focus':
      return `Focused ${args.selector}`;
    case 'blur':
      return `Blurred ${args.selector}`;
    case 'observe_dom': {
      const r = result as any;
      const inner = r?.result || r;
      return `Observed ${inner?.total ?? 0} DOM mutations over ${args.duration || 3000}ms`;
    }
    case 'get_computed_style':
      return `Computed styles for ${args.selector}${args.properties ? ` (${args.properties})` : ''}`;
    case 'monitor_events': {
      const r = result as any;
      const inner = r?.result || r;
      return `Captured ${inner?.total ?? 0} events over ${args.duration || 5000}ms on ${args.selector}`;
    }
    case 'js_coverage': {
      if (args.action === 'start') return 'JS coverage collection started';
      const r = result as any;
      return `JS coverage: ${r?.scripts?.length ?? 0} scripts analyzed`;
    }
    case 'animation_speed':
      return `Animation speed set to ${args.rate}x`;
    case 'list_iframes': {
      const r = result as any;
      const inner = r?.result || r;
      return `${inner?.total ?? 0} iframes found`;
    }
    case 'pierce_shadow':
      return `Shadow DOM query: ${args.action || 'query'} on ${args.hostSelector} → ${args.innerSelector}`;
    case 'extract_meta': {
      const r = result as any;
      const inner = r?.result || r;
      return `Metadata extracted: "${inner?.title || '?'}"`;
    }
    case 'clear_site_data':
      return `Site data cleared${args.types ? ` (${args.types})` : ' (all)'}`;
    default:
      return `Done`;
  }
}
