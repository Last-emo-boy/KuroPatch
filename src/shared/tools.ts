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

  // --- Screenshot & Visual tools ---
  {
    name: 'screenshot',
    description: 'Capture a screenshot of the visible page area. Returns a base64 data URL of the PNG image. Use to visually verify changes or document state.',
    parameters: {},
  },
  {
    name: 'highlight_element',
    description: 'Temporarily flash/highlight an element on the page to draw attention. Useful after making changes to show what was affected.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of element to highlight' },
      color: { type: 'string', description: 'Highlight color (default: "#7c6aff")' },
      duration: { type: 'number', description: 'Duration in ms (default: 1500)' },
    },
    required: ['selector'],
  },

  // --- Storage & Cookie tools ---
  {
    name: 'get_storage',
    description: 'Read localStorage, sessionStorage, or cookies from the page. Use for debugging auth tokens, cached data, or user preferences.',
    parameters: {
      type: { type: 'string', description: 'Storage type to read', enum: ['localStorage', 'sessionStorage', 'cookies'] },
      key: { type: 'string', description: 'Specific key to read (omit for all)' },
    },
    required: ['type'],
  },
  {
    name: 'set_storage',
    description: 'Write to localStorage or sessionStorage. Use for testing with different cached values or user states.',
    parameters: {
      type: { type: 'string', description: 'Storage type', enum: ['localStorage', 'sessionStorage'] },
      key: { type: 'string', description: 'Key to set' },
      value: { type: 'string', description: 'Value to set' },
    },
    required: ['type', 'key', 'value'],
  },
  {
    name: 'clear_storage',
    description: 'Clear localStorage, sessionStorage, or all cookies. Use to test fresh/clean state.',
    parameters: {
      type: { type: 'string', description: 'Storage type to clear', enum: ['localStorage', 'sessionStorage', 'cookies'] },
    },
    required: ['type'],
  },

  // --- Accessibility & Performance tools ---
  {
    name: 'accessibility_audit',
    description: 'Run a basic accessibility audit on the page. Checks: images without alt text, missing form labels, low-contrast text, missing ARIA roles, empty links/buttons, missing lang attribute, missing page title. Returns list of issues found.',
    parameters: {
      selector: { type: 'string', description: 'Scope audit to a specific element (optional, default: entire page)' },
    },
  },
  {
    name: 'get_performance',
    description: 'Get page performance metrics: load timing, largest contentful paint (LCP), cumulative layout shift (CLS), first input delay (FID), memory usage, DOM node count, resource loading stats.',
    parameters: {},
  },

  // --- Human-like automation tools ---
  {
    name: 'human_click',
    description: 'Simulate a human-like click on an element. Unlike `click`, this dispatches a full realistic mouse event sequence (mouseover → mouseenter → mousemove × N → mousedown → mouseup → click) with a random offset from center and natural timing jitter. Useful for bypassing bot-detection, testing real user interactions, or triggering hover-dependent UI.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the target element' },
      button: { type: 'string', description: 'Mouse button: "left" (default), "right", "middle"', enum: ['left', 'right', 'middle'] },
      doubleClick: { type: 'boolean', description: 'If true, perform a double click' },
    },
    required: ['selector'],
  },
  {
    name: 'human_type',
    description: 'Type text into an input character by character with human-like timing. Each character is typed with a random delay (50-180ms by default), simulating natural keystroke cadence. Dispatches keydown → keypress → input → keyup per character. Works with React/Vue controlled inputs.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the input/textarea' },
      text: { type: 'string', description: 'Text to type' },
      speed: { type: 'string', description: 'Typing speed: "slow" (~200ms/char), "normal" (~100ms/char), "fast" (~50ms/char)', enum: ['slow', 'normal', 'fast'] },
      clearFirst: { type: 'boolean', description: 'Clear existing value before typing (default: true)' },
    },
    required: ['selector', 'text'],
  },
  {
    name: 'human_move',
    description: 'Simulate human-like mouse movement to an element. Generates a Bézier curve trajectory from a random starting point to the target, dispatching mousemove events along the path. Useful for triggering hover states, tooltips, dropdowns, or warm-up before a click.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to move mouse toward' },
      steps: { type: 'number', description: 'Number of intermediate mousemove events (default: 15, more = smoother)' },
    },
    required: ['selector'],
  },
  {
    name: 'human_scroll',
    description: 'Simulate human-like scrolling with inertia and variable speed. Instead of instant scroll, this dispatches multiple wheel events with easing, mimicking a real mouse wheel or trackpad scroll.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to scroll to (optional — uses coordinates if omitted)' },
      direction: { type: 'string', description: 'Scroll direction: "down", "up" (used when no selector)', enum: ['down', 'up'] },
      distance: { type: 'number', description: 'Pixel distance to scroll (default: 600, used when no selector)' },
    },
  },
  {
    name: 'human_drag',
    description: 'Simulate a human-like drag and drop. Dispatches mousedown on source → multiple mousemove events along a Bézier path → mouseup + drop on target. Works with native drag-and-drop, sortable lists, sliders, etc.',
    parameters: {
      from: { type: 'string', description: 'CSS selector of the drag source element' },
      to: { type: 'string', description: 'CSS selector of the drop target element' },
      steps: { type: 'number', description: 'Intermediate move events during drag (default: 20)' },
    },
    required: ['from', 'to'],
  },

  // --- Multimodal & coordinate tools ---
  {
    name: 'screenshot_element',
    description: 'Take a screenshot cropped to a specific element. Returns a base64 data URL image. When the AI model is multimodal, it can analyze the screenshot visually. Great for: reading text in images/canvas, identifying visual elements, verifying CSS rendering, capturing component state, captcha images.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to screenshot' },
    },
    required: ['selector'],
  },
  {
    name: 'screenshot_area',
    description: 'Take a screenshot of a specific rectangular region of the viewport. Returns a base64 data URL image. Useful for capturing a portion of the page without needing a specific selector.',
    parameters: {
      x: { type: 'number', description: 'X coordinate of the top-left corner (viewport pixels)' },
      y: { type: 'number', description: 'Y coordinate of the top-left corner (viewport pixels)' },
      width: { type: 'number', description: 'Width of the capture region in pixels' },
      height: { type: 'number', description: 'Height of the capture region in pixels' },
    },
    required: ['x', 'y', 'width', 'height'],
  },
  {
    name: 'get_element_bounds',
    description: 'Get the precise bounding rectangle, visibility, and computed styles of an element. Returns x, y, width, height, isVisible, isInViewport, and key computed styles (color, bgColor, fontSize, display, position, opacity, zIndex). Essential for coordinate-based operations.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
    },
    required: ['selector'],
  },
  {
    name: 'find_at_point',
    description: 'Identify the element at specific viewport coordinates. Returns tag name, text content, selector, bounding rect, and attributes. Useful after a multimodal model returns coordinates from a screenshot — use this to resolve coordinates to a concrete element.',
    parameters: {
      x: { type: 'number', description: 'X viewport coordinate' },
      y: { type: 'number', description: 'Y viewport coordinate' },
    },
    required: ['x', 'y'],
  },
  {
    name: 'click_at_coords',
    description: 'Click at exact viewport coordinates (x, y). Dispatches a full mouse event sequence on whatever element is at that point. Useful after multimodal analysis returns click targets as coordinates. Combines human-like timing with coordinate precision.',
    parameters: {
      x: { type: 'number', description: 'X viewport coordinate' },
      y: { type: 'number', description: 'Y viewport coordinate' },
      button: { type: 'string', description: 'Mouse button: "left" (default), "right"', enum: ['left', 'right'] },
    },
    required: ['x', 'y'],
  },
  {
    name: 'type_at_coords',
    description: 'Focus the element at (x, y) coordinates and type text into it. Useful when multimodal analysis identifies an input field by position rather than selector.',
    parameters: {
      x: { type: 'number', description: 'X viewport coordinate of the input' },
      y: { type: 'number', description: 'Y viewport coordinate of the input' },
      text: { type: 'string', description: 'Text to type' },
    },
    required: ['x', 'y', 'text'],
  },
  {
    name: 'get_interactive_map',
    description: 'Get a map of all interactive elements (buttons, links, inputs, selects, textareas) with their bounding rectangles, text labels, and types. This gives the AI (especially multimodal models) a complete picture of what can be clicked/typed on the page. Returns an array of { tag, type, text, selector, bounds: {x, y, width, height} }.',
    parameters: {
      viewport_only: { type: 'boolean', description: 'Only include elements currently visible in viewport (default: true)' },
    },
  },
  {
    name: 'visual_query',
    description: 'Take a screenshot and send it along with a question to the multimodal AI model. The model will analyze the image and answer. Use for: reading text in images/canvas, identifying UI elements visually, solving captchas, checking visual layout, finding elements that cannot be identified by DOM alone. The screenshot is automatically included as an image in the next AI turn.',
    parameters: {
      question: { type: 'string', description: 'What to ask about the screenshot (e.g. "What text is in the captcha image?", "Where is the login button?", "What color is the header?")' },
      selector: { type: 'string', description: 'Optionally scope the screenshot to a specific element (e.g. a captcha image). If omitted, captures the full visible page.' },
    },
    required: ['question'],
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
