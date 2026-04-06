// ============================================================
// Content Script v0.2 - Bridge between extension and page
// Handles: DOM reading, page sections, element inspection,
//          modifications, hook injection, and automation
// ============================================================
import type { Message } from '../shared/messaging';
import type { ElementInfo, PageContext, PageSection, BoxModel, AutomationAction, Patch } from '../shared/types';

// ---- State ----
let inspectMode = false;
let highlightEl: HTMLElement | null = null;
let hooksInjected = false;
const appliedPatches = new Map<string, { undo: () => void }>();

// ---- Highlight overlay for inspect mode ----
function createHighlight(): HTMLElement {
  const el = document.createElement('div');
  el.id = '__kp_highlight';
  el.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483647;
    border: 2px solid #7c6aff; background: rgba(124,106,255,0.08);
    transition: all 0.08s ease; display: none;
    box-shadow: 0 0 0 1px rgba(124,106,255,0.3);
  `;
  document.documentElement.appendChild(el);
  return el;
}

function showHighlight(rect: DOMRect) {
  if (!highlightEl) highlightEl = createHighlight();
  highlightEl.style.display = 'block';
  highlightEl.style.top = rect.top + 'px';
  highlightEl.style.left = rect.left + 'px';
  highlightEl.style.width = rect.width + 'px';
  highlightEl.style.height = rect.height + 'px';
}

function hideHighlight() {
  if (highlightEl) highlightEl.style.display = 'none';
}

// ---- Generate unique CSS selector ----
function getSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      if (classes.length > 0 && classes[0]) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

// ---- DOM path (breadcrumb) ----
function getDomPath(el: Element): string[] {
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    let label = current.tagName.toLowerCase();
    if (current.id) label += `#${current.id}`;
    else if (current.className && typeof current.className === 'string') {
      const cls = current.className.trim().split(/\s+/)[0];
      if (cls) label += `.${cls}`;
    }
    path.unshift(label);
    current = current.parentElement;
  }
  path.unshift('html');
  return path;
}

// ---- Box model ----
function getBoxModel(el: Element): BoxModel {
  const cs = window.getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    margin: { top: px(cs.marginTop), right: px(cs.marginRight), bottom: px(cs.marginBottom), left: px(cs.marginLeft) },
    padding: { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) },
    border: { top: px(cs.borderTopWidth), right: px(cs.borderRightWidth), bottom: px(cs.borderBottomWidth), left: px(cs.borderLeftWidth) },
    width: px(cs.width),
    height: px(cs.height),
  };
}

// ---- Extract element info (v0.2 enhanced) ----
function getElementInfo(el: Element): ElementInfo {
  const computed = window.getComputedStyle(el);
  const keyStyles = [
    'display', 'position', 'width', 'height', 'margin', 'padding',
    'color', 'background-color', 'font-size', 'font-weight', 'font-family',
    'border', 'border-radius', 'opacity', 'visibility', 'overflow', 'z-index',
    'flex-direction', 'justify-content', 'align-items', 'gap',
    'text-align', 'line-height', 'letter-spacing', 'box-shadow',
  ];

  const computedStyles: Record<string, string> = {};
  for (const prop of keyStyles) {
    computedStyles[prop] = computed.getPropertyValue(prop);
  }

  const attributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attributes[attr.name] = attr.value;
  }

  // Children summary
  const children = Array.from(el.children).slice(0, 10).map(c => ({
    tag: c.tagName.toLowerCase(),
    selector: getSelector(c),
    text: (c.textContent || '').trim().slice(0, 50),
  }));

  // Siblings summary
  const parent = el.parentElement;
  const siblings = parent
    ? Array.from(parent.children).filter(c => c !== el).slice(0, 6).map(c => ({
        tag: c.tagName.toLowerCase(),
        selector: getSelector(c),
        text: (c.textContent || '').trim().slice(0, 50),
      }))
    : [];

  return {
    tagName: el.tagName,
    id: el.id,
    className: el.className.toString(),
    textContent: (el.textContent || '').slice(0, 500),
    attributes,
    computedStyles,
    selector: getSelector(el),
    outerHTML: el.outerHTML.slice(0, 2000),
    boundingRect: el.getBoundingClientRect(),
    domPath: getDomPath(el),
    boxModel: getBoxModel(el),
    children,
    siblings,
  };
}

// ---- Page sections detection (v0.2) ----
function readSections(): PageSection[] {
  const sections: PageSection[] = [];
  const sectionTags = ['header', 'nav', 'main', 'footer', 'aside', 'section', 'article', 'form', 'dialog'];

  // Detect semantic elements
  for (const tag of sectionTags) {
    document.querySelectorAll(tag).forEach(el => {
      const rect = el.getBoundingClientRect();
      sections.push({
        tag: el.tagName.toLowerCase(),
        role: guessRole(el),
        selector: getSelector(el),
        summary: (el.textContent || '').trim().slice(0, 80),
        childCount: el.children.length,
        visible: rect.height > 0 && rect.width > 0,
      });
    });
  }

  // Detect role attributes
  document.querySelectorAll('[role]').forEach(el => {
    const role = el.getAttribute('role') || '';
    if (!sections.some(s => s.selector === getSelector(el))) {
      const rect = el.getBoundingClientRect();
      sections.push({
        tag: el.tagName.toLowerCase(),
        role,
        selector: getSelector(el),
        summary: (el.textContent || '').trim().slice(0, 80),
        childCount: el.children.length,
        visible: rect.height > 0 && rect.width > 0,
      });
    }
  });

  // Detect large direct children of body that might be sections
  if (document.body) {
    Array.from(document.body.children).forEach(el => {
      if (el.id === '__kp_highlight') return;
      const sel = getSelector(el);
      if (sections.some(s => s.selector === sel)) return;
      const rect = el.getBoundingClientRect();
      if (rect.height > 100) {
        sections.push({
          tag: el.tagName.toLowerCase(),
          role: guessRole(el),
          selector: sel,
          summary: (el.textContent || '').trim().slice(0, 80),
          childCount: el.children.length,
          visible: rect.height > 0 && rect.width > 0,
        });
      }
    });
  }

  return sections.slice(0, 30);
}

function guessRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (role) return role;
  if (tag === 'header' || tag === 'nav') return tag;
  if (tag === 'main') return 'main';
  if (tag === 'footer') return 'footer';
  if (tag === 'aside') return 'aside';
  if (tag === 'form') return 'form';
  if (tag === 'dialog') return 'dialog';
  if (tag === 'article') return 'article';
  // Heuristic: check class names for common patterns
  const cls = (el.className || '').toString().toLowerCase();
  if (cls.includes('hero') || cls.includes('banner')) return 'hero';
  if (cls.includes('sidebar')) return 'aside';
  if (cls.includes('modal') || cls.includes('popup') || cls.includes('dialog')) return 'dialog';
  if (cls.includes('footer')) return 'footer';
  if (cls.includes('header') || cls.includes('topbar') || cls.includes('navbar')) return 'header';
  if (cls.includes('nav') || cls.includes('menu')) return 'nav';
  return 'section';
}

// ---- Read page context (v0.2 enhanced) ----
function readPageContext(): PageContext {
  const bodyChildren = document.body ? Array.from(document.body.children) : [];
  const domParts: string[] = [];

  function summarizeNode(el: Element, depth: number = 0) {
    if (depth > 4 || domParts.length > 80) return;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const indent = '  '.repeat(depth);
    const text = el.textContent?.trim().slice(0, 40) || '';
    domParts.push(`${indent}<${tag}${id}${cls}>${text ? ` "${text}..."` : ''}`);
    Array.from(el.children).slice(0, 6).forEach(c => summarizeNode(c, depth + 1));
  }

  bodyChildren.slice(0, 15).forEach(c => {
    if ((c as HTMLElement).id === '__kp_highlight') return;
    summarizeNode(c);
  });

  return {
    url: location.href,
    title: document.title,
    textSummary: (document.body?.innerText || '').slice(0, 1500),
    domSummary: domParts.join('\n'),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    sections: readSections(),
    consoleLogs: [],
    errors: [],
  };
}

// ---- Inspect mode handlers ----
function onInspectMouseMove(e: MouseEvent) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.id !== '__kp_highlight') {
    showHighlight(el.getBoundingClientRect());
  }
}

function onInspectClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  stopInspect();

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.id !== '__kp_highlight') {
    const info = getElementInfo(el);
    chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: info });
  }
}

function startInspect() {
  inspectMode = true;
  document.addEventListener('mousemove', onInspectMouseMove, true);
  document.addEventListener('click', onInspectClick, true);
}

function stopInspect() {
  inspectMode = false;
  document.removeEventListener('mousemove', onInspectMouseMove, true);
  document.removeEventListener('click', onInspectClick, true);
  hideHighlight();
}

// ---- DOM/Style modifications ----
function modifyDom(payload: any) {
  const { selector, action, attr, value } = payload;
  const el = document.querySelector(selector);
  if (!el) return { error: `Element not found: ${selector}` };

  const before = el.outerHTML.slice(0, 200);

  switch (action) {
    case 'setText': el.textContent = value; break;
    case 'setAttribute': el.setAttribute(attr, value); break;
    case 'removeAttribute': el.removeAttribute(attr); break;
    case 'addClass': el.classList.add(value); break;
    case 'removeClass': el.classList.remove(value); break;
    case 'setHTML': el.innerHTML = value; break;
    case 'hide': (el as HTMLElement).style.display = 'none'; break;
    case 'show': (el as HTMLElement).style.display = ''; break;
    case 'remove': el.remove(); break;
    case 'clone': {
      const clone = el.cloneNode(true);
      el.parentElement?.insertBefore(clone, el.nextSibling);
      break;
    }
  }

  return { ok: true, before, after: el.outerHTML?.slice(0, 200) ?? before };
}

function modifyStyle(payload: any) {
  const { selector, property, value } = payload;
  const el = document.querySelector(selector) as HTMLElement;
  if (!el) return { error: `Element not found: ${selector}` };

  const before = el.style.getPropertyValue(property);
  el.style.setProperty(property, value);

  return { ok: true, before, after: value };
}

function injectJs(payload: any) {
  const { code } = payload;
  try {
    const script = document.createElement('script');
    script.textContent = code;
    document.documentElement.appendChild(script);
    script.remove();
    return { ok: true };
  } catch (e: any) {
    return { error: e.message };
  }
}

function injectCss(payload: any) {
  const { css } = payload;
  try {
    const style = document.createElement('style');
    style.id = `__kp_css_${Date.now()}`;
    style.textContent = css;
    document.head.appendChild(style);
    return { ok: true, styleId: style.id };
  } catch (e: any) {
    return { error: e.message };
  }
}

function inspectElement(payload: any) {
  const { selector } = payload;
  const el = document.querySelector(selector);
  if (!el) return { error: `Element not found: ${selector}` };
  return getElementInfo(el);
}

// ---- Automation actions (v0.2 enhanced) ----
async function executeAutomation(action: AutomationAction): Promise<any> {
  switch (action.type) {
    case 'click': {
      const el = document.querySelector(action.selector) as HTMLElement;
      if (!el) return { error: 'Element not found' };
      el.click();
      return { ok: true };
    }
    case 'input': {
      const el = document.querySelector(action.selector) as HTMLInputElement;
      if (!el) return { error: 'Element not found' };
      // Better input simulation for React/Vue
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, action.value);
      else el.value = action.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'select': {
      const el = document.querySelector(action.selector) as HTMLSelectElement;
      if (!el) return { error: 'Element not found' };
      el.value = action.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'scroll': {
      window.scrollTo({ left: action.x, top: action.y, behavior: 'smooth' });
      return { ok: true };
    }
    case 'scrollToElement': {
      const el = document.querySelector(action.selector);
      if (!el) return { error: 'Element not found' };
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { ok: true };
    }
    case 'wait': {
      await new Promise(r => setTimeout(r, Math.min(action.ms, 10000)));
      return { ok: true };
    }
    case 'waitForSelector': {
      const timeout = Math.min(action.timeout ?? 5000, 30000);
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (document.querySelector(action.selector)) return { ok: true, found: true };
        await new Promise(r => setTimeout(r, 200));
      }
      return { error: 'Timeout waiting for selector' };
    }
    case 'readText': {
      const el = document.querySelector(action.selector);
      if (!el) return { error: 'Element not found' };
      return { ok: true, text: (el.textContent || '').trim() };
    }
    case 'keyboard': {
      const opts: KeyboardEventInit = { key: action.key, bubbles: true };
      if (action.modifiers?.includes('ctrl')) opts.ctrlKey = true;
      if (action.modifiers?.includes('shift')) opts.shiftKey = true;
      if (action.modifiers?.includes('alt')) opts.altKey = true;
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', opts));
      return { ok: true };
    }
    case 'checkExists': {
      const exists = !!document.querySelector(action.selector);
      return { ok: true, exists };
    }
    case 'checkTextContains': {
      const el = document.querySelector(action.selector);
      if (!el) return { ok: true, contains: false, reason: 'Element not found' };
      const contains = (el.textContent || '').includes(action.text);
      return { ok: true, contains };
    }
  }
}

// ---- Apply / rollback patches (v0.2 with css/event types) ----
function applyPatch(patch: Patch) {
  const el = patch.target ? document.querySelector(patch.target) as HTMLElement : null;

  let undoFn: () => void;

  switch (patch.type) {
    case 'style': {
      if (!el) return { error: `Target not found: ${patch.target}` };
      const prop = patch.description;
      const original = el.style.getPropertyValue(prop);
      el.style.setProperty(prop, patch.after);
      undoFn = () => el.style.setProperty(prop, original);
      break;
    }
    case 'dom': {
      if (!el) return { error: `Target not found: ${patch.target}` };
      const original = el.outerHTML;
      el.outerHTML = patch.after;
      undoFn = () => {
        const parent = el.parentElement;
        if (parent) parent.innerHTML = original;
      };
      break;
    }
    case 'css': {
      const result = injectCss({ css: patch.after });
      const styleId = (result as any)?.styleId;
      undoFn = () => {
        const s = document.getElementById(styleId);
        if (s) s.remove();
      };
      break;
    }
    case 'js': {
      injectJs({ code: patch.after });
      undoFn = () => {};
      break;
    }
    case 'event': {
      injectJs({ code: patch.after });
      undoFn = () => {};
      break;
    }
    default:
      return { error: `Unknown patch type: ${patch.type}` };
  }

  appliedPatches.set(patch.id, { undo: undoFn });
  return { ok: true };
}

function rollbackPatch(id: string) {
  const patch = appliedPatches.get(id);
  if (patch) {
    patch.undo();
    appliedPatches.delete(id);
  }
  return { ok: true };
}

function rollbackAll() {
  for (const [, patch] of appliedPatches) {
    patch.undo();
  }
  appliedPatches.clear();
  return { ok: true };
}

// ---- Hook injection ----
function injectHooks(config: any) {
  if (hooksInjected) removeHooks();

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.dataset.config = JSON.stringify(config);
  script.id = '__kp_hooks_script';
  document.documentElement.appendChild(script);
  hooksInjected = true;

  window.addEventListener('message', onHookMessage);
}

function removeHooks() {
  const script = document.getElementById('__kp_hooks_script');
  if (script) script.remove();
  window.removeEventListener('message', onHookMessage);
  window.postMessage({ type: '__KP_REMOVE_HOOKS' }, '*');
  hooksInjected = false;
}

function onHookMessage(e: MessageEvent) {
  if (e.source !== window) return;
  if (e.data?.type === '__KP_HOOK_EVENT') {
    chrome.runtime.sendMessage({
      type: 'HOOK_EVENT',
      payload: e.data.payload,
    });
  }
}

// ---- Message listener ----
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'READ_DOM':
        return readPageContext();
      case 'READ_SECTIONS':
        return readSections();
      case 'INSPECT_ELEMENT':
        return inspectElement(msg.payload);
      case 'ELEMENT_INFO': {
        const { selector } = msg.payload as any;
        const el = document.querySelector(selector);
        if (!el) return { error: `Element not found: ${selector}` };
        return getElementInfo(el);
      }
      case 'START_INSPECT':
        startInspect();
        return { ok: true };
      case 'STOP_INSPECT':
        stopInspect();
        return { ok: true };
      case 'MODIFY_DOM':
        return modifyDom(msg.payload);
      case 'MODIFY_STYLE':
        return modifyStyle(msg.payload);
      case 'INJECT_JS':
        return injectJs(msg.payload);
      case 'INJECT_CSS':
        return injectCss(msg.payload);
      case 'AUTOMATE':
        return executeAutomation(msg.payload as AutomationAction);
      case 'CHECK_EXISTS': {
        const { selector } = msg.payload as any;
        return { ok: true, exists: !!document.querySelector(selector) };
      }
      case 'CHECK_TEXT': {
        const { selector, text } = msg.payload as any;
        const el = document.querySelector(selector);
        if (!el) return { ok: true, contains: false };
        return { ok: true, contains: (el.textContent || '').includes(text) };
      }
      case 'INJECT_HOOKS':
        injectHooks(msg.payload);
        return { ok: true };
      case 'REMOVE_HOOKS':
        removeHooks();
        return { ok: true };
      case 'APPLY_PATCH':
        return applyPatch(msg.payload as Patch);
      case 'ROLLBACK_PATCH':
        return rollbackPatch(msg.payload as string);
      case 'ROLLBACK_ALL':
        return rollbackAll();
      default:
        return { error: `Unknown content message: ${msg.type}` };
    }
  })().then(sendResponse);
  return true;
});
