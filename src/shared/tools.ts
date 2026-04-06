// ============================================================
// AI Tool-Use System
// Defines tools the AI can call to interact with the page
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  enum?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  tool: string;
  success: boolean;
  result: unknown;
  displayText: string;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'inspect_element',
    description: 'Select and inspect a page element by CSS selector. Returns tag, classes, attributes, computed styles, text content, bounding box, DOM path (breadcrumb), box model, children, and siblings.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to inspect' },
    },
    required: ['selector'],
  },
  {
    name: 'get_page_sections',
    description: 'Get a structural overview of the page: identified sections (header, nav, main, footer, form, dialog, hero, etc.) with their selectors and summaries.',
    parameters: {},
  },
  {
    name: 'modify_style',
    description: 'Change a CSS property on an element. The change is applied immediately.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      property: { type: 'string', description: 'CSS property name (e.g. "color", "display", "font-size", "border-radius", "gap")' },
      value: { type: 'string', description: 'New CSS value' },
    },
    required: ['selector', 'property', 'value'],
  },
  {
    name: 'modify_text',
    description: 'Change the text content of an element.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: 'New text content' },
    },
    required: ['selector', 'text'],
  },
  {
    name: 'modify_attribute',
    description: 'Set or change an HTML attribute on an element.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      attribute: { type: 'string', description: 'Attribute name' },
      value: { type: 'string', description: 'Attribute value' },
    },
    required: ['selector', 'attribute', 'value'],
  },
  {
    name: 'modify_html',
    description: 'Replace the inner HTML of an element.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      html: { type: 'string', description: 'New inner HTML content' },
    },
    required: ['selector', 'html'],
  },
  {
    name: 'inject_css',
    description: 'Inject a block of CSS rules into the page. Good for batch visual changes.',
    parameters: {
      css: { type: 'string', description: 'CSS rules to inject (e.g. ".btn { color: red; }")' },
    },
    required: ['css'],
  },
  {
    name: 'inject_js',
    description: 'Execute JavaScript code in the page context. Use for patching runtime behavior, changing playback rates, modifying global state, etc.',
    parameters: {
      code: { type: 'string', description: 'JavaScript code to execute' },
    },
    required: ['code'],
  },
  {
    name: 'click',
    description: 'Click an element on the page.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to click' },
    },
    required: ['selector'],
  },
  {
    name: 'type_text',
    description: 'Type text into an input or textarea element. Works with React/Vue controlled inputs.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the input' },
      text: { type: 'string', description: 'Text to type' },
    },
    required: ['selector', 'text'],
  },
  {
    name: 'select_option',
    description: 'Select an option in a <select> dropdown.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the select element' },
      value: { type: 'string', description: 'Option value to select' },
    },
    required: ['selector', 'value'],
  },
  {
    name: 'keypress',
    description: 'Simulate a keyboard key press on the focused element.',
    parameters: {
      key: { type: 'string', description: 'Key name (e.g. "Enter", "Escape", "Tab", "a")' },
      modifiers: { type: 'string', description: 'Comma-separated modifiers: ctrl,shift,alt' },
    },
    required: ['key'],
  },
  {
    name: 'scroll_to',
    description: 'Scroll to a position or element on the page.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to scroll to (optional, use x/y for absolute)' },
      x: { type: 'number', description: 'X coordinate' },
      y: { type: 'number', description: 'Y coordinate' },
    },
  },
  {
    name: 'read_text',
    description: 'Read the text content of an element.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
  },
  {
    name: 'check_exists',
    description: 'Check if an element exists in the DOM.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to check' },
    },
    required: ['selector'],
  },
  {
    name: 'check_text_contains',
    description: 'Check if an element\'s text contains a specific substring.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: 'Text to search for' },
    },
    required: ['selector', 'text'],
  },
  {
    name: 'get_page_info',
    description: 'Get current page URL, title, viewport size, DOM structure summary, and detected page sections.',
    parameters: {},
  },
  {
    name: 'get_console_logs',
    description: 'Get recent console logs and errors from the page.',
    parameters: {},
  },
  {
    name: 'get_network_requests',
    description: 'Get list of recent network requests with status codes. Useful for finding failed API calls.',
    parameters: {
      filter: { type: 'string', description: 'Optional URL filter string' },
    },
  },
  {
    name: 'start_hooks',
    description: 'Start monitoring page events: fetch, XHR, console, errors, DOM mutations, script injections, navigation changes.',
    parameters: {},
  },
  {
    name: 'hide_element',
    description: 'Hide an element by setting display:none.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
  },
  {
    name: 'show_element',
    description: 'Show a hidden element by resetting display.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
  },
  {
    name: 'remove_element',
    description: 'Remove an element from the DOM entirely.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
  },
  {
    name: 'clone_element',
    description: 'Clone an element and insert the clone after the original.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
  },
  {
    name: 'wait_for',
    description: 'Wait for an element to appear in the DOM.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to wait for' },
      timeout: { type: 'number', description: 'Max wait time in ms (default 5000)' },
    },
    required: ['selector'],
  },

  // --- Script management tools ---
  {
    name: 'save_script',
    description: 'Save a reusable script that the user can run again later. Use this when the user wants to persist a JS or CSS snippet for repeated use (e.g. downloading stream video, auto-filling forms, custom page modifications). The script is stored permanently and appears in the Scripts tab. Set mode to "toggle" for persistent effects that can be turned on/off (like hiding elements, CSS overrides), or "action" for one-shot operations (like downloading a video, scraping data).',
    parameters: {
      name: { type: 'string', description: 'Human-readable name for the script' },
      description: { type: 'string', description: 'What this script does' },
      type: { type: 'string', description: 'Script type: "js" or "css"', enum: ['js', 'css'] },
      code: { type: 'string', description: 'The JavaScript or CSS code' },
      mode: { type: 'string', description: 'Script mode: "action" (one-shot run) or "toggle" (on/off persistent effect like hiding elements)', enum: ['action', 'toggle'] },
      trigger: { type: 'string', description: 'When to run: "manual" (user clicks run), "auto" (runs on every page load), "url-match" (runs on matching URLs)', enum: ['manual', 'auto', 'url-match'] },
      urlPattern: { type: 'string', description: 'URL pattern for url-match trigger (glob, e.g. "*://example.com/*")' },
      tags: { type: 'string', description: 'Comma-separated tags for organization (e.g. "video,download")' },
      undoCode: { type: 'string', description: 'For toggle mode JS scripts: code to run when turning OFF (to undo the effect)' },
    },
    required: ['name', 'description', 'type', 'code'],
  },
  {
    name: 'update_script',
    description: 'Update an existing saved script. Use this to iterate on a script after testing — fix bugs, improve logic, change trigger settings.',
    parameters: {
      id: { type: 'string', description: 'Script ID to update' },
      name: { type: 'string', description: 'New name (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
      code: { type: 'string', description: 'New code (optional)' },
      trigger: { type: 'string', description: 'New trigger mode (optional)', enum: ['manual', 'auto', 'url-match'] },
      urlPattern: { type: 'string', description: 'New URL pattern (optional)' },
      tags: { type: 'string', description: 'New comma-separated tags (optional)' },
    },
    required: ['id'],
  },
  {
    name: 'run_script',
    description: 'Execute a saved script by its ID on the current page. Returns the execution result.',
    parameters: {
      id: { type: 'string', description: 'Script ID to run' },
    },
    required: ['id'],
  },
  {
    name: 'list_scripts',
    description: 'List all saved user scripts with their IDs, names, types, and status.',
    parameters: {},
  },
];

// Format tools for Anthropic API
export function toolsForAnthropic() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) }])
      ),
      required: t.required ?? [],
    },
  }));
}

// Format tools for OpenAI API
export function toolsForOpenAI() {
  return TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) }])
        ),
        required: t.required ?? [],
      },
    },
  }));
}
