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
        result = await sendToContent('MODIFY_STYLE', {
          selector: args.selector,
          property: args.property,
          value: args.value,
        });
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

      case 'inject_js':
        result = await sendToContent('INJECT_JS', { code: args.code });
        break;

      case 'click':
        result = await sendToContent('AUTOMATE', { type: 'click', selector: args.selector });
        break;

      case 'type_text':
        result = await sendToContent('AUTOMATE', { type: 'input', selector: args.selector, value: args.text });
        break;

      case 'scroll_to':
        if (args.selector) {
          result = await sendToContent('AUTOMATE', { type: 'scrollToElement', selector: args.selector });
        } else {
          result = await sendToContent('AUTOMATE', { type: 'scroll', x: args.x || 0, y: args.y || 0 });
        }
        break;

      case 'read_text':
        result = await sendToContent('AUTOMATE', { type: 'readText', selector: args.selector });
        break;

      case 'get_page_info':
        result = await sendToBackground('GET_PAGE_CONTEXT');
        break;

      case 'get_console_logs':
        result = await sendToBackground('GET_HOOK_EVENTS');
        break;

      case 'get_network_requests':
        result = await sendToBackground('GET_NETWORK_REQUESTS');
        if (args.filter && Array.isArray(result)) {
          const f = (args.filter as string).toLowerCase();
          result = (result as any[]).filter(r => r.url?.toLowerCase().includes(f));
        }
        break;

      case 'start_hooks':
        result = await sendToBackground('INJECT_HOOKS', {
          fetch: true, xhr: true, console: true, errors: true,
          domMutation: true, scriptInject: true, events: false,
        });
        break;

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
        result = await sendToContent('AUTOMATE', {
          type: 'waitForSelector',
          selector: args.selector,
          timeout: args.timeout || 5000,
        });
        break;

      case 'get_page_sections':
        result = await sendToContent('READ_SECTIONS');
        break;

      case 'select_option':
        result = await sendToContent('AUTOMATE', { type: 'select', selector: args.selector, value: args.value });
        break;

      case 'keypress':
        result = await sendToContent('AUTOMATE', {
          type: 'keyboard',
          key: args.key,
          modifiers: args.modifiers,
        });
        break;

      case 'check_exists':
        result = await sendToContent('CHECK_EXISTS', { selector: args.selector });
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
        result = await sendToBackground('SCREENSHOT');
        break;

      case 'highlight_element': {
        const hlColor = (args.color as string) || '#7c6aff';
        const hlDuration = (args.duration as number) || 1500;
        result = await sendToContent('INJECT_JS', {
          code: `(function(){
            const el = document.querySelector('${(args.selector as string).replace(/'/g, "\\'")}');
            if (!el) return { error: 'Element not found' };
            const orig = el.style.cssText;
            el.style.outline = '3px solid ${hlColor}';
            el.style.outlineOffset = '2px';
            el.style.boxShadow = '0 0 12px ${hlColor}80';
            el.style.transition = 'outline 0.3s, box-shadow 0.3s';
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
              issues.push({ type: 'error', rule: 'img-alt', message: 'Image missing alt text', selector: el.src?.slice(0,80) || 'img' });
            });
            root.querySelectorAll('img[alt=""]').forEach(el => {
              issues.push({ type: 'warning', rule: 'img-alt-empty', message: 'Image has empty alt text (decorative?)', selector: el.src?.slice(0,80) || 'img' });
            });
            // Form inputs without labels
            root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])').forEach(el => {
              const id = el.id;
              const hasLabel = id && root.querySelector('label[for="'+id+'"]');
              const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
              const wrapped = el.closest('label');
              if (!hasLabel && !hasAria && !wrapped) {
                issues.push({ type: 'error', rule: 'input-label', message: 'Input missing label', selector: el.name || el.type || 'input' });
              }
            });
            // Empty links/buttons
            root.querySelectorAll('a, button').forEach(el => {
              const text = (el.textContent || '').trim();
              const aria = el.getAttribute('aria-label');
              const title = el.getAttribute('title');
              if (!text && !aria && !title && !el.querySelector('img,svg')) {
                issues.push({ type: 'error', rule: 'empty-interactive', message: 'Empty ' + el.tagName.toLowerCase() + ' (no text, aria-label, or title)', selector: el.className?.slice(0,40) || el.tagName });
              }
            });
            // Missing document language
            if (!document.documentElement.lang) {
              issues.push({ type: 'warning', rule: 'html-lang', message: 'Missing lang attribute on <html>' });
            }
            // Missing page title
            if (!document.title.trim()) {
              issues.push({ type: 'warning', rule: 'page-title', message: 'Page has no title' });
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
              issues.push({ type: 'warning', rule: 'color-contrast', message: lowContrast + ' elements with same text/background color' });
            }
            // Missing heading hierarchy
            const headings = root.querySelectorAll('h1,h2,h3,h4,h5,h6');
            let prevLevel = 0;
            headings.forEach(h => {
              const level = parseInt(h.tagName[1]);
              if (prevLevel > 0 && level > prevLevel + 1) {
                issues.push({ type: 'warning', rule: 'heading-order', message: 'Heading level skipped: h' + prevLevel + ' → h' + level });
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
  if (!el) return { error: 'Element not found' };
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
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
  if (!el) return { error: 'Element not found' };
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
  if (!el) return { error: 'Element not found' };
  const rect = el.getBoundingClientRect();
  const tx = rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.2;
  const ty = rect.top + rect.height / 2 + (Math.random() - 0.5) * rect.height * 0.2;

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
  if (!srcEl) return { error: 'Source element not found' };
  if (!tgtEl) return { error: 'Target element not found' };

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

      case 'enable_stealth':
        result = await sendToBackground('ENABLE_STEALTH');
        break;

      case 'disable_stealth':
        result = await sendToBackground('DISABLE_STEALTH');
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
    case 'inject_js':
      return `Executed JS (${(args.code as string).length} chars)`;
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
      const reqs = Array.isArray(result) ? result : [];
      return `${reqs.length} requests captured`;
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
    case 'check_exists':
      return `Element ${args.selector} ${(result as any)?.exists ? 'exists' : 'not found'}`;
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
    default:
      return `Done`;
  }
}
