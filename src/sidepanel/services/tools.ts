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
    default:
      return `Done`;
  }
}
