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
    description: 'Select and inspect a page element by CSS selector. Returns tag, classes, attributes, computed styles, text content, bounding box, DOM path, box model, children (up to 20), siblings, parent context (tag, selector, display, position, childCount), shadow DOM children (if present), visibility diagnosis, and iframe info.',
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
    description: 'Change CSS properties on an element. Supports single property or batch mode. Returns computed values after change.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      property: { type: 'string', description: 'CSS property name (e.g. "color", "display"). Omit if using styles param.' },
      value: { type: 'string', description: 'New CSS value. Omit if using styles param.' },
      styles: { type: 'string', description: 'JSON object for batch mode: {"color":"red","font-size":"16px","display":"flex"}. Overrides property/value.' },
    },
    required: ['selector'],
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
    description: 'Set or change an HTML attribute on an element. Returns the final attribute value to confirm the change took effect.',
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
    description: 'Execute JavaScript code in the page context. Returns execution result, timing, and detailed error info. Supports async/promise code. Set awaitPromise=true to automatically await async functions/promises.',
    parameters: {
      code: { type: 'string', description: 'JavaScript code to execute' },
      timeout: { type: 'number', description: 'Max execution time in ms (default 10000, max 30000). Prevents infinite loops from hanging.' },
      awaitPromise: { type: 'boolean', description: 'If true, automatically wraps code in (async () => { ... })() and awaits the result. Use for fetch(), setTimeout-based, or any async operation.' },
      allFrames: { type: 'boolean', description: 'If true, execute in ALL frames (including iframes). Default: main frame only.' },
    },
    required: ['code'],
  },
  {
    name: 'click',
    description: 'Click an element on the page. Pre-validates visibility and auto-scrolls into viewport if offscreen. Supports right-click, middle-click, and double-click.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to click' },
      button: { type: 'string', description: 'Mouse button: "left" (default), "right" (context menu), "middle"', enum: ['left', 'right', 'middle'] },
      clickCount: { type: 'number', description: 'Click count: 1 (default single), 2 (double-click)' },
    },
    required: ['selector'],
  },
  {
    name: 'type_text',
    description: 'Type text into an input or textarea element. Pre-validates visibility, disabled, and readOnly state. Auto-scrolls into viewport. Works with React/Vue controlled inputs.',
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
    description: 'Simulate keyboard key presses on the focused element. Supports combos like "Ctrl+A", "Ctrl+C", "Shift+Tab". Pass an array of keys for sequences.',
    parameters: {
      key: { type: 'string', description: 'Key name (e.g. "Enter", "Escape", "Tab", "a") or combo (e.g. "Ctrl+A", "Ctrl+Shift+I")' },
      modifiers: { type: 'string', description: 'Comma-separated modifiers: ctrl,shift,alt (alternative to combo syntax)' },
      sequence: { type: 'string', description: 'JSON array of keys to press in sequence with 50ms delay between each. E.g. ["Tab","Tab","Enter"]. Overrides key param.' },
    },
    required: ['key'],
  },
  {
    name: 'scroll_to',
    description: 'Scroll to a position or element on the page. Auto-returns the final scroll position.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to scroll to (optional, use x/y for absolute)' },
      x: { type: 'number', description: 'X coordinate' },
      y: { type: 'number', description: 'Y coordinate' },
      behavior: { type: 'string', description: 'Scroll behavior: "smooth" (animated, default) or "instant" (immediate jump)', enum: ['smooth', 'instant'] },
    },
  },
  {
    name: 'read_text',
    description: 'Read the text content of an element. Supports structured mode: extract tables as JSON, lists as arrays, forms as field objects.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      mode: { type: 'string', description: 'Extraction mode: "text" (default), "structured" (auto-detect table/list/form and return structured data)', enum: ['text', 'structured'] },
    },
    required: ['selector'],
  },
  {
    name: 'check_exists',
    description: 'Check if an element exists in the DOM. Returns existence status and match count. Supports optional retry with delay for async content.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to check' },
      retries: { type: 'number', description: 'Number of retry attempts if not found (default 0). Each retry waits retryDelay ms.' },
      retryDelay: { type: 'number', description: 'Delay between retries in ms (default 500)' },
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
    description: 'Get current page URL, title, viewport size, DOM structure summary, and detected page sections. Optionally pass a section selector to get a detailed deep-dive of that region (full DOM tree + all text + interactive elements).',
    parameters: {
      section: { type: 'string', description: 'CSS selector of a section to deep-dive into. Returns detailed DOM tree, all text, and interactive elements within that section (up to 5000 chars).' },
    },
  },
  {
    name: 'get_console_logs',
    description: 'Get recent console logs and errors from the page. Supports filtering by log level and text search.',
    parameters: {
      level: { type: 'string', description: 'Filter by level: "error", "warn", "log", "info", "debug". Comma-separated for multiple.' },
      search: { type: 'string', description: 'Text substring to search for in log messages (case-insensitive)' },
      limit: { type: 'number', description: 'Max entries to return (default 50)' },
    },
  },
  {
    name: 'get_network_requests',
    description: 'Get recent network requests with status, timing, headers, and optional response body. Supports filtering and waiting for new matching requests.',
    parameters: {
      filter: { type: 'string', description: 'URL substring filter (case-insensitive)' },
      status: { type: 'string', description: 'Filter by status: a number (200), range ("4xx", "5xx"), or "failed" for all errors' },
      method: { type: 'string', description: 'Filter by HTTP method: GET, POST, PUT, DELETE, etc.' },
      type: { type: 'string', description: 'Filter by resource type: xhr, fetch, script, document, stylesheet, image, font' },
      limit: { type: 'number', description: 'Max requests to return (default 50, max 200)' },
      waitForNew: { type: 'boolean', description: 'If true, wait up to 10s for a NEW matching request to arrive (useful after triggering an action). Returns only the new request(s).' },
    },
  },
  {
    name: 'start_hooks',
    description: 'Start monitoring page events. By default monitors all event types. Use the types parameter to select specific ones for less noise.',
    parameters: {
      types: { type: 'string', description: 'Comma-separated event types to monitor: fetch, xhr, console, errors, domMutation, scriptInject. Default: all.' },
      urlFilter: { type: 'string', description: 'Only log network events (fetch/xhr) matching this URL substring' },
    },
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
    description: 'Wait for an element to appear (or DISAPPEAR) in the DOM, a JS condition, or network idle. On timeout, returns detailed diagnostics.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to wait for' },
      timeout: { type: 'number', description: 'Max wait time in ms (default 5000, max 30000)' },
      visible: { type: 'boolean', description: 'If true, also require the element to be visible (not display:none, visibility:hidden, or opacity:0)' },
      absent: { type: 'boolean', description: 'If true, wait for the element to DISAPPEAR from DOM (or become hidden if visible=true). Great for waiting for loading spinners/overlays to go away.' },
      condition: { type: 'string', description: 'JavaScript expression that must return truthy. Evaluated every poll. Alternative to selector. Example: "document.querySelector(\".loaded\") && !document.querySelector(\".spinner\")"' },
      pollInterval: { type: 'number', description: 'Poll interval in ms (default 200, min 50, max 2000)' },
      networkIdle: { type: 'boolean', description: 'If true, wait until no network requests for 500ms. Ignores selector/condition params. Great for waiting after AJAX/fetch actions complete.' },
    },
  },

  // --- Screenshot & Visual tools ---
  {
    name: 'screenshot',
    description: 'Capture a screenshot. Supports visible viewport or full-page scroll-stitch capture. Returns base64 data URL.',
    parameters: {
      format: { type: 'string', description: 'Image format: "png" (default, lossless) or "webp" (smaller, lossy)', enum: ['png', 'webp'] },
      quality: { type: 'number', description: 'Quality for WebP format: 0-100 (default: 80). Ignored for PNG.' },
      fullPage: { type: 'boolean', description: 'If true, capture the ENTIRE page by scrolling and stitching screenshots. Warning: slow for very tall pages.' },
    },
  },
  {
    name: 'highlight_element',
    description: 'Temporarily flash/highlight an element with colored outline and optional text label. Great for showing users what you found or annotating elements.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of element to highlight' },
      color: { type: 'string', description: 'Highlight color (default: "#7c6aff")' },
      duration: { type: 'number', description: 'Duration in ms (default: 1500)' },
      label: { type: 'string', description: 'Text label to show near the element (e.g. "BUG: missing alt", "Found it!"). Appears as tooltip badge.' },
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
    description: 'Run a basic accessibility audit on the page. Each issue includes a suggested fix and which tool to use for remediation. Checks: images without alt text, missing form labels, low-contrast text, missing ARIA roles, empty links/buttons, missing lang attribute, missing page title, heading hierarchy.',
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
    description: 'Simulate a human-like click on an element. Pre-validates visibility (returns actionable error if hidden/collapsed). Auto-scrolls into viewport if offscreen. Dispatches full realistic mouse event sequence (mouseover → mouseenter → mousemove × N → mousedown → mouseup → click) with random offset and timing jitter.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the target element' },
      button: { type: 'string', description: 'Mouse button: "left" (default), "right", "middle"', enum: ['left', 'right', 'middle'] },
      doubleClick: { type: 'boolean', description: 'If true, perform a double click' },
    },
    required: ['selector'],
  },
  {
    name: 'human_type',
    description: 'Type text into an input character by character with human-like timing. Pre-validates visibility, disabled, and readOnly state. Auto-scrolls into viewport if offscreen. Each character is typed with a random delay, simulating natural keystroke cadence. Works with React/Vue controlled inputs.',
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
    description: 'Simulate human-like mouse movement to an element. Pre-validates visibility. Auto-scrolls into viewport if offscreen. Generates a Bézier curve trajectory from a random starting point to the target, dispatching mousemove events along the path.',
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
    description: 'Simulate a human-like drag and drop. Pre-validates visibility of both source and target. Auto-scrolls source into viewport if offscreen. Dispatches mousedown → Bézier mousemove path → mouseup + drop. Works with native drag-and-drop, sortable lists, sliders, etc.',
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
    description: 'Get a map of all interactive elements (buttons, links, inputs, selects, textareas) with bounding rectangles, labels, and types. For form elements, includes: associated label text, required/name/value/pattern attributes. Also includes ariaLabel for all elements. Returns array of { tag, type, text, selector, bounds, center, label?, required?, name?, value? }.',
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

  // --- Batch & Extraction tools ---
  {
    name: 'fill_form',
    description: 'Batch-fill a form in one call. Accepts an array of field definitions. Far more efficient than calling type_text multiple times. Automatically handles: text inputs, textareas, checkboxes, radio buttons, select dropdowns, and React/Vue controlled inputs. Returns a summary of filled/failed fields.',
    parameters: {
      fields: { type: 'string', description: 'JSON array of fields: [{"selector": "...", "value": "..."}]. For checkbox/radio, value is "true"/"false". For select, value is the option value.' },
      submit: { type: 'string', description: 'Optional CSS selector of submit button to click after filling all fields' },
    },
    required: ['fields'],
  },
  {
    name: 'navigate',
    description: 'Navigate the current tab to a URL, or go back/forward/reload in history. Essential for multi-page workflows.',
    parameters: {
      url: { type: 'string', description: 'URL to navigate to (optional — use action for back/forward/reload)' },
      action: { type: 'string', description: 'Navigation action: "back", "forward", "reload" (optional — use url for direct navigation)', enum: ['back', 'forward', 'reload'] },
      waitFor: { type: 'string', description: 'CSS selector to wait for after navigation (default: waits for page load). Helps confirm navigation completed.' },
      waitUntil: { type: 'string', description: 'When to consider navigation complete: "load" (default), "domcontentloaded" (faster), "networkidle" (wait until no requests for 500ms)', enum: ['load', 'domcontentloaded', 'networkidle'] },
    },
  },
  {
    name: 'extract_table',
    description: 'Extract a <table> element as structured JSON data. Returns headers and rows. Handles colspan/rowspan, nested tables, and tables without <thead>. Much more efficient than reading cells one by one.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the table element' },
      maxRows: { type: 'number', description: 'Maximum rows to extract (default: 200). Use to limit large tables.' },
    },
    required: ['selector'],
  },
  {
    name: 'extract_links',
    description: 'Extract all links from the page or a scoped section. Returns href, text, target, and whether the link is external. Useful for sitemap analysis, broken link detection, or navigation mapping.',
    parameters: {
      selector: { type: 'string', description: 'Optional CSS selector to scope link extraction to a section (e.g. "nav", "main", ".sidebar"). Extracts from entire page if omitted.' },
      filter: { type: 'string', description: 'URL substring filter (case-insensitive). Only return links matching this pattern.' },
      external_only: { type: 'boolean', description: 'If true, only return external links (different origin)' },
    },
  },
  {
    name: 'query_selector_all',
    description: 'Query ALL elements matching a CSS selector and return summary info for each (tag, text snippet, selector, bounds, visibility). Unlike inspect_element which returns only the first match, this returns up to N matches. Ideal for counting elements, batch analysis, or finding the right element among many.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to match' },
      limit: { type: 'number', description: 'Max elements to return (default: 20, max: 100)' },
    },
    required: ['selector'],
  },
  {
    name: 'get_cookies',
    description: 'Read cookies for the current page using the Chrome cookies API. Unlike get_storage(type="cookies"), this can access httpOnly cookies and provides full cookie metadata (domain, path, secure, httpOnly, sameSite, expiration). Essential for auth debugging.',
    parameters: {
      name: { type: 'string', description: 'Filter by cookie name (optional — returns all cookies for current URL if omitted)' },
      domain: { type: 'string', description: 'Filter by domain (optional — uses current page URL by default)' },
    },
  },
  {
    name: 'set_cookie',
    description: 'Set a cookie with full options using the Chrome cookies API. Can set httpOnly, secure, sameSite, and expiration. Essential for testing auth states.',
    parameters: {
      name: { type: 'string', description: 'Cookie name' },
      value: { type: 'string', description: 'Cookie value' },
      domain: { type: 'string', description: 'Cookie domain (optional — uses current page domain)' },
      path: { type: 'string', description: 'Cookie path (default: "/")' },
      secure: { type: 'boolean', description: 'Secure flag (default: false)' },
      httpOnly: { type: 'boolean', description: 'HttpOnly flag (default: false)' },
      sameSite: { type: 'string', description: 'SameSite policy', enum: ['no_restriction', 'lax', 'strict'] },
      expiresInSeconds: { type: 'number', description: 'Seconds from now until expiration (default: 86400 = 24h). Use 0 for session cookie.' },
    },
    required: ['name', 'value'],
  },
  {
    name: 'emulate_device',
    description: 'Emulate a device by setting viewport size, device pixel ratio, and user agent. Great for responsive design testing. Use action="reset" to restore defaults.',
    parameters: {
      width: { type: 'number', description: 'Viewport width in pixels' },
      height: { type: 'number', description: 'Viewport height in pixels' },
      deviceScaleFactor: { type: 'number', description: 'Device pixel ratio (default: 1)' },
      userAgent: { type: 'string', description: 'Custom user agent string (optional)' },
      preset: { type: 'string', description: 'Device preset: "iphone14", "iphone-se", "ipad", "pixel7", "galaxy-s21", "desktop-hd", "desktop-4k"', enum: ['iphone14', 'iphone-se', 'ipad', 'pixel7', 'galaxy-s21', 'desktop-hd', 'desktop-4k'] },
      action: { type: 'string', description: '"reset" to undo device emulation and restore defaults', enum: ['reset'] },
    },
  },
  {
    name: 'intercept_request',
    description: 'Intercept and modify network requests. Can mock API responses, modify request headers, or block requests. Uses Chrome Debugger Protocol. Call with action="clear" to stop all interceptions.',
    parameters: {
      urlPattern: { type: 'string', description: 'URL pattern to intercept (glob, e.g. "*api/users*")' },
      action: { type: 'string', description: 'What to do: "mock" (return custom response), "modify-headers" (change request headers), "block" (block request), "clear" (remove all intercepts)', enum: ['mock', 'modify-headers', 'block', 'clear'] },
      responseBody: { type: 'string', description: 'For "mock": the response body to return (JSON string or plain text)' },
      responseStatus: { type: 'number', description: 'For "mock": HTTP status code (default: 200)' },
      responseHeaders: { type: 'string', description: 'For "mock": JSON object of response headers. Default: {"Content-Type": "application/json"}' },
      headers: { type: 'string', description: 'For "modify-headers": JSON object of headers to add/override on the request' },
    },
    required: ['action'],
  },
  {
    name: 'block_urls',
    description: 'Block network requests matching URL patterns. Uses Chrome Debugger Protocol Network.setBlockedURLs. Useful for: blocking ads/trackers, testing without CDN, simulating offline resources. Call with action="clear" to unblock all.',
    parameters: {
      patterns: { type: 'string', description: 'JSON array of URL patterns to block (glob syntax). E.g. ["*google-analytics.com*", "*doubleclick.net*", "*.ad.*"]' },
      action: { type: 'string', description: '"clear" to remove all blocked URL patterns', enum: ['clear'] },
    },
  },

  // --- Stealth / Anti-Detection tools ---
  {
    name: 'enable_stealth',
    description: 'Activate stealth anti-detection mode to bypass anti-debugging protections on the page. This is ESSENTIAL when CAPTCHAs or other security elements refuse to render because they detect debugging/automation. Stealth mode: (1) Neutralizes `debugger` statement traps (infinite pause loops), (2) Spoofs DevTools detection (window size, timing, console tricks), (3) Removes `navigator.webdriver` and other automation flags, (4) Protects `Function.prototype.toString()` to hide overridden functions, (5) Hides KuroPatch DOM artifacts from page scripts, (6) Detaches chrome.debugger to remove the yellow "debugging" banner. The stealth code is injected before page scripts run. Subsequent page navigations auto-reinject stealth if enabled. Use this BEFORE loading a page with anti-debug protection, or call it and then reload the page.',
    parameters: {},
  },
  {
    name: 'disable_stealth',
    description: 'Deactivate stealth anti-detection mode. Re-enables normal debugging behavior.',
    parameters: {},
  },

  // --- CDP Environment & Network tools ---
  {
    name: 'network_throttle',
    description: 'Simulate network conditions (slow 3G, fast 3G, offline, custom). Uses Chrome Debugger Protocol. Essential for testing loading states, offline fallbacks, and performance under poor network. Call with action="reset" to restore normal speed.',
    parameters: {
      preset: { type: 'string', description: 'Network preset: "slow-3g" (400kbps/400ms), "fast-3g" (1.6Mbps/150ms), "4g" (9Mbps/20ms), "offline" (no connection)', enum: ['slow-3g', 'fast-3g', '4g', 'offline'] },
      downloadKbps: { type: 'number', description: 'Custom download speed in kbps (overrides preset)' },
      uploadKbps: { type: 'number', description: 'Custom upload speed in kbps (overrides preset)' },
      latencyMs: { type: 'number', description: 'Custom latency in ms (overrides preset)' },
      action: { type: 'string', description: '"reset" to restore normal network conditions', enum: ['reset'] },
    },
  },
  {
    name: 'get_event_listeners',
    description: 'Get all event listeners attached to an element. Uses Chrome Debugger Protocol to reveal listeners that are invisible to normal JS introspection. Shows: event type, handler preview, useCapture, passive, once. Essential for debugging "click does nothing" issues.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to inspect listeners on' },
    },
    required: ['selector'],
  },
  {
    name: 'force_css_state',
    description: 'Force an element into a CSS pseudo-class state (:hover, :focus, :active, :focus-within, :visited). Uses Chrome Debugger Protocol. Essential for inspecting hover menus, focus rings, active button states without actually hovering. Call with action="clear" to remove forced states.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element' },
      states: { type: 'string', description: 'Comma-separated pseudo-states to force: "hover", "focus", "active", "focus-within", "visited". E.g. "hover,focus"' },
      action: { type: 'string', description: '"clear" to remove all forced states from the element', enum: ['clear'] },
    },
    required: ['selector'],
  },
  {
    name: 'set_geolocation',
    description: 'Override the browser geolocation. Uses Chrome Debugger Protocol Emulation. Useful for testing location-based features, maps, store locators, geo-restricted content. Call with action="reset" to restore real location.',
    parameters: {
      latitude: { type: 'number', description: 'Latitude (-90 to 90). E.g. 40.7128 for New York' },
      longitude: { type: 'number', description: 'Longitude (-180 to 180). E.g. -74.006 for New York' },
      accuracy: { type: 'number', description: 'Accuracy in meters (default: 100)' },
      action: { type: 'string', description: '"reset" to restore real geolocation', enum: ['reset'] },
    },
  },
  {
    name: 'set_timezone',
    description: 'Override the browser timezone. Uses Chrome Debugger Protocol Emulation. Useful for testing date/time displays, scheduling UIs, timezone-sensitive logic. Call with action="reset" to restore.',
    parameters: {
      timezoneId: { type: 'string', description: 'IANA timezone ID. E.g. "America/New_York", "Europe/London", "Asia/Tokyo", "Pacific/Auckland"' },
      action: { type: 'string', description: '"reset" to restore real timezone', enum: ['reset'] },
    },
  },
  {
    name: 'emulate_media',
    description: 'Override CSS media features for testing. Toggle dark/light mode, print styles, reduced motion, forced colors. Uses Chrome Debugger Protocol. Call with action="reset" to restore.',
    parameters: {
      colorScheme: { type: 'string', description: 'Override prefers-color-scheme: "light" or "dark"', enum: ['light', 'dark'] },
      mediaType: { type: 'string', description: 'Override media type: "screen" or "print"', enum: ['screen', 'print'] },
      reducedMotion: { type: 'string', description: 'Override prefers-reduced-motion: "reduce" or "no-preference"', enum: ['reduce', 'no-preference'] },
      forcedColors: { type: 'string', description: 'Override forced-colors: "active" or "none"', enum: ['active', 'none'] },
      action: { type: 'string', description: '"reset" to restore all media overrides', enum: ['reset'] },
    },
  },
  {
    name: 'pdf_page',
    description: 'Export the current page as a PDF file. Uses Chrome Debugger Protocol Page.printToPDF. Returns a downloadable data URL. Useful for: saving page state, generating reports, archiving pages.',
    parameters: {
      landscape: { type: 'boolean', description: 'Landscape orientation (default: false / portrait)' },
      printBackground: { type: 'boolean', description: 'Include background graphics and colors (default: true)' },
      scale: { type: 'number', description: 'Scale factor 0.1-2.0 (default: 1.0)' },
      paperWidth: { type: 'number', description: 'Paper width in inches (default: 8.5)' },
      paperHeight: { type: 'number', description: 'Paper height in inches (default: 11)' },
    },
  },

  // --- DOM Utility tools ---
  {
    name: 'search_text',
    description: 'Find ALL occurrences of text on the visible page. Returns each match with: the matched text, the containing element selector, element tag, surrounding context text, and whether it is visible. Much more powerful than Ctrl+F — works with hidden text too.',
    parameters: {
      query: { type: 'string', description: 'Text to search for (case-insensitive substring match)' },
      regex: { type: 'boolean', description: 'If true, treat query as a regular expression' },
      visibleOnly: { type: 'boolean', description: 'If true, only return matches in visible elements (default: false)' },
      limit: { type: 'number', description: 'Max matches to return (default: 50)' },
    },
    required: ['query'],
  },
  {
    name: 'toggle_class',
    description: 'Add, remove, or toggle CSS classes on an element. Simpler than modify_attribute for class manipulation. Returns the final class list.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector' },
      add: { type: 'string', description: 'Space-separated class names to add' },
      remove: { type: 'string', description: 'Space-separated class names to remove' },
      toggle: { type: 'string', description: 'Space-separated class names to toggle (add if absent, remove if present)' },
    },
    required: ['selector'],
  },
  {
    name: 'insert_element',
    description: 'Insert HTML content relative to an element. Unlike modify_html (which replaces innerHTML), this ADDS content without destroying existing content. Uses insertAdjacentHTML.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the reference element' },
      position: { type: 'string', description: 'Where to insert: "beforebegin" (before element), "afterbegin" (first child), "beforeend" (last child), "afterend" (after element)', enum: ['beforebegin', 'afterbegin', 'beforeend', 'afterend'] },
      html: { type: 'string', description: 'HTML content to insert' },
    },
    required: ['selector', 'position', 'html'],
  },

  // ========== Phase 24: New Interaction tools ==========
  {
    name: 'hover',
    description: 'Hover over an element to trigger CSS :hover styles and JS mouseover/mouseenter handlers. Essential for testing dropdown menus, tooltips, hover cards, and hover-dependent UI. Returns element info after hover.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to hover over' },
      duration: { type: 'number', description: 'How long to maintain hover state in ms (default: 500). Use longer duration for delayed animations or transitions.' },
    },
    required: ['selector'],
  },
  {
    name: 'double_click',
    description: 'Double-click an element. Dispatches full mousedown→mouseup→click→mousedown→mouseup→click→dblclick event sequence. Useful for text selection, opening editors, tree node expansion, or any UI that responds to double-click.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to double-click' },
    },
    required: ['selector'],
  },
  {
    name: 'right_click',
    description: 'Right-click (context menu) on an element. Dispatches mousedown(button=2) → mouseup → contextmenu event sequence. Useful for triggering custom context menus or testing right-click behavior.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to right-click' },
    },
    required: ['selector'],
  },
  {
    name: 'upload_file',
    description: 'Set a file on an <input type="file"> element. Creates a virtual file with specified content and triggers change events. Uses Chrome Debugger Protocol for reliable file setting that works with all frameworks.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the file input element' },
      fileName: { type: 'string', description: 'Name of the file (e.g. "test.txt", "image.png", "data.json")' },
      content: { type: 'string', description: 'File content as text, or base64-encoded data for binary files' },
      mimeType: { type: 'string', description: 'MIME type (default: auto-detect from extension). E.g. "text/plain", "image/png", "application/json"' },
      base64: { type: 'boolean', description: 'If true, content is base64-encoded binary data' },
    },
    required: ['selector', 'fileName', 'content'],
  },
  {
    name: 'focus',
    description: 'Focus an element. Dispatches focus and focusin events. Useful for activating inputs, triggering focus-based UI (dropdowns, auto-complete), or testing :focus CSS styles.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to focus' },
    },
    required: ['selector'],
  },
  {
    name: 'blur',
    description: 'Blur (unfocus) the currently focused element or a specific element. Dispatches blur and focusout events. Useful for triggering validation, closing dropdowns, or testing blur handlers.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to blur' },
    },
    required: ['selector'],
  },

  // ========== Phase 24: Observation & analysis tools ==========
  {
    name: 'observe_dom',
    description: 'Watch for DOM mutations (additions, removals, attribute changes, text changes) on an element for a specified duration. Essential for debugging dynamic content, AJAX updates, SPA routing, framework reactivity. Returns a timestamped log of all changes observed.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to observe (default: document.body)' },
      duration: { type: 'number', description: 'Observation duration in ms (default: 3000, max: 15000)' },
      subtree: { type: 'boolean', description: 'Observe entire subtree of descendants (default: true)' },
      attributes: { type: 'boolean', description: 'Watch attribute changes (default: true)' },
      childList: { type: 'boolean', description: 'Watch child element additions/removals (default: true)' },
      characterData: { type: 'boolean', description: 'Watch text content changes (default: true)' },
    },
  },
  {
    name: 'get_computed_style',
    description: 'Get the final computed CSS values for an element after cascade, inheritance, and browser defaults. Essential for CSS debugging — shows what the browser ACTUALLY renders. Can target specific properties or return all. Supports pseudo-elements.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element' },
      properties: { type: 'string', description: 'Comma-separated CSS properties to return (e.g. "color,font-size,display,margin"). Returns key properties if omitted.' },
      pseudoElement: { type: 'string', description: 'Get styles for a pseudo-element: "::before", "::after", "::first-line", "::placeholder"' },
    },
    required: ['selector'],
  },
  {
    name: 'monitor_events',
    description: 'Monitor all events fired on an element for a duration. Records click, keydown, input, focus, blur, custom events, etc. with timestamps. Essential for debugging "why does my click not work" or "what events fire on this element".',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of the element to monitor' },
      duration: { type: 'number', description: 'Monitoring duration in ms (default: 5000, max: 15000)' },
      eventTypes: { type: 'string', description: 'Comma-separated event types to monitor (default: all common events). E.g. "click,keydown,input,focus,blur,change"' },
    },
    required: ['selector'],
  },

  // ========== Phase 24: CDP-powered tools ==========
  {
    name: 'js_coverage',
    description: 'Measure JavaScript code coverage — which code runs and which is dead/unused. Start coverage, perform user actions, then stop to get a report showing percentage of bytes used per script. Essential for performance optimization and identifying unused JS.',
    parameters: {
      action: { type: 'string', description: '"start" to begin collecting coverage, "stop" to stop and return results', enum: ['start', 'stop'] },
      detailed: { type: 'boolean', description: 'If true, include per-function coverage breakdown (more data). Default: false.' },
    },
    required: ['action'],
  },
  {
    name: 'animation_speed',
    description: 'Control CSS animation and transition playback speed globally. Slow down animations to debug them, speed up to skip waiting, or pause entirely. Uses Chrome Debugger Protocol Animation domain.',
    parameters: {
      rate: { type: 'number', description: 'Playback rate multiplier. 1.0 = normal, 0.25 = quarter speed, 0.5 = half speed, 2.0 = double, 0 = paused, 10 = 10x fast-forward' },
    },
    required: ['rate'],
  },

  // ========== Phase 24: Page structure tools ==========
  {
    name: 'list_iframes',
    description: 'List all iframes on the page with their URLs, dimensions, sandbox attributes, and loading state. Essential for understanding page composition, debugging embedded content, or identifying ad/tracker frames.',
    parameters: {},
  },
  {
    name: 'pierce_shadow',
    description: 'Query and interact with elements inside Shadow DOM boundaries. Normal CSS selectors cannot cross shadow roots — this tool can. Essential for inspecting/modifying web components (Lit, Stencil, Shoelace, etc.).',
    parameters: {
      hostSelector: { type: 'string', description: 'CSS selector of the shadow host element (the custom element)' },
      innerSelector: { type: 'string', description: 'CSS selector to query INSIDE the shadow root' },
      action: { type: 'string', description: 'What to do: "query" (return element info), "text" (read text), "click" (click element), "modify-style" (change CSS)', enum: ['query', 'text', 'click', 'modify-style'] },
      property: { type: 'string', description: 'For "modify-style": CSS property name' },
      value: { type: 'string', description: 'For "modify-style": CSS property value' },
    },
    required: ['hostSelector', 'innerSelector'],
  },
  {
    name: 'extract_meta',
    description: 'Extract page metadata: title, description, canonical URL, Open Graph tags, Twitter Card tags, JSON-LD structured data, favicons, lang, charset, viewport settings. Essential for SEO debugging, content verification, and social preview testing.',
    parameters: {},
  },
  {
    name: 'clear_site_data',
    description: 'Clear all stored data for the current site origin: cache, cookies, storage (localStorage, sessionStorage, indexedDB), service workers. Uses Chrome Debugger Protocol. Essential for testing fresh page loads and debugging auth/state issues.',
    parameters: {
      types: { type: 'string', description: 'Comma-separated data types to clear: "cache", "cookies", "storage", "serviceworkers". Default: all.' },
    },
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
