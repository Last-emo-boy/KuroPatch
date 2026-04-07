// ============================================================
// Shared Types for KuroPatch v0.2
// ============================================================

// --- AI Provider ---
export type AIProviderType = 'anthropic' | 'openai' | 'openai-compatible';

export interface AIProviderConfig {
  type: AIProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// --- Page Context (enhanced v0.2) ---
export interface PageContext {
  url: string;
  title: string;
  textSummary: string;
  domSummary: string;
  viewport: { width: number; height: number };
  sections: PageSection[];
  selectedElement?: ElementInfo;
  consoleLogs: ConsoleEntry[];
  errors: PageError[];
}

export interface PageSection {
  tag: string;
  role: string; // header, nav, main, footer, form, dialog, aside, section, hero, unknown
  selector: string;
  summary: string; // first 80 chars of text
  childCount: number;
  visible: boolean;
}

export interface ElementInfo {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  selector: string;
  outerHTML: string;
  boundingRect: DOMRect | null;
  // v0.2 additions
  domPath: string[]; // breadcrumb: ['html', 'body', 'div#app', ...]
  boxModel?: BoxModel;
  children: { tag: string; selector: string; text: string }[];
  siblings: { tag: string; selector: string; text: string }[];
  eventListeners?: string[]; // ['click', 'mouseenter', ...]
}

export interface BoxModel {
  margin: Spacing;
  padding: Spacing;
  border: Spacing;
  width: number;
  height: number;
}

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: string[];
  timestamp: number;
}

export interface PageError {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  timestamp: number;
}

// --- Network ---
export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  type: 'xhr' | 'fetch' | 'script' | 'document' | 'stylesheet' | 'image' | 'font' | 'other';
  status: number;
  statusText: string;
  startTime: number;
  duration: number;
  size?: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  responsePreview?: string;
  failed: boolean;
  initiator?: string;
}

// --- Hooks ---
export interface HookEvent {
  id: string;
  type: 'fetch' | 'xhr' | 'console' | 'error' | 'dom-mutation' | 'script-inject' | 'event' | 'navigation' | 'timer';
  summary: string;
  detail: unknown;
  timestamp: number;
}

export interface HookConfig {
  fetch: boolean;
  xhr: boolean;
  console: boolean;
  errors: boolean;
  domMutation: boolean;
  scriptInject: boolean;
  events: boolean;
  navigation: boolean;
  timers: boolean;
}

export interface HookSummary {
  totalEvents: number;
  domMutationCount: number;
  scriptInjectCount: number;
  fetchCount: number;
  xhrCount: number;
  errorCount: number;
  navigationCount: number;
  timerCount: number;
  topMutatedSelectors: { selector: string; count: number }[];
  recentErrors: string[];
}

// --- Patches (enhanced v0.2) ---
export type PatchType = 'style' | 'dom' | 'js' | 'css' | 'event';
export type PatchCategory = 'visual' | 'behavior' | 'content' | 'debug';

export interface Patch {
  id: string;
  type: PatchType;
  category: PatchCategory;
  target: string;
  description: string;
  before: string;
  after: string;
  applied: boolean;
  enabled: boolean;
  order: number;
  timestamp: number;
  sessionId?: string;
}

// --- Flows (v0.2 new) ---
export interface Flow {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
  createdAt: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'partial' | 'failed';
}

export interface FlowStep {
  id: string;
  action: AutomationAction;
  label: string;
  timeout: number;
  retries: number;
  continueOnError: boolean;
  status?: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  duration?: number;
}

// --- Sessions (v0.2 new) ---
export interface Session {
  id: string;
  name: string;
  url: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  patches: Patch[];
  actions: SessionAction[];
  aiSummary: string;
  notes: string;
  errorSnapshot: string[];
  networkSnapshot: { failed: number; slow: number; total: number };
}

export interface SessionAction {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  result?: string;
}

// --- Chat Sessions ---
export interface ChatSession {
  id: string;
  name: string;
  items: ChatSessionItem[];
  aiMessages: ChatSessionAIMsg[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionItem {
  id: string;
  type: 'user' | 'text' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResult?: { tool: string; success: boolean; result: unknown; displayText: string };
  timestamp: number;
}

export interface ChatSessionAIMsg {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
}

// --- User Scripts (persistent reusable snippets) ---
export type ScriptType = 'js' | 'css';
export type ScriptTrigger = 'manual' | 'auto' | 'url-match';
export type ScriptMode = 'action' | 'toggle'; // action = one-shot run, toggle = on/off persistent effect

export interface UserScript {
  id: string;
  name: string;
  description: string;
  type: ScriptType;
  code: string;
  trigger: ScriptTrigger;
  mode: ScriptMode;
  urlPattern?: string; // glob or regex for url-match trigger
  enabled: boolean;
  active: boolean; // for toggle scripts: currently applied on page
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunResult?: string;
  tags: string[];
  undoCode?: string; // JS to run when toggling OFF (for toggle mode)
  activeStyleId?: string; // ID of injected <style> element (for CSS toggle scripts)
}

// --- Automation ---
export type AutomationAction =
  | { type: 'click'; selector: string }
  | { type: 'input'; selector: string; value: string }
  | { type: 'select'; selector: string; value: string }
  | { type: 'scroll'; x: number; y: number }
  | { type: 'scrollToElement'; selector: string }
  | { type: 'wait'; ms: number }
  | { type: 'waitForSelector'; selector: string; timeout?: number }
  | { type: 'readText'; selector: string }
  | { type: 'keyboard'; key: string; modifiers?: string[] }
  | { type: 'checkExists'; selector: string }
  | { type: 'checkTextContains'; selector: string; text: string };
