// ============================================================
// Storage utility – wraps chrome.storage.local (v0.2)
// ============================================================
import type { AIProviderConfig, HookConfig, Patch, Flow, Session, ChatSession, UserScript } from './types';

const KEYS = {
  AI_CONFIG: 'kp_ai_config',
  HOOK_CONFIG: 'kp_hook_config',
  PATCHES: 'kp_patches',
  DEBUG_MODE: 'kp_debug_mode',
  FLOWS: 'kp_flows',
  SESSIONS: 'kp_sessions',
  CURRENT_SESSION: 'kp_current_session',
  SCRIPTS: 'kp_scripts',
} as const;

export async function getDebugMode(): Promise<boolean> {
  const result = await chrome.storage.local.get(KEYS.DEBUG_MODE);
  return result[KEYS.DEBUG_MODE] ?? false;
}

export async function setDebugMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEYS.DEBUG_MODE]: enabled });
}

export async function getAIConfig(): Promise<AIProviderConfig | null> {
  const result = await chrome.storage.local.get(KEYS.AI_CONFIG);
  return result[KEYS.AI_CONFIG] ?? null;
}

export async function setAIConfig(config: AIProviderConfig): Promise<void> {
  await chrome.storage.local.set({ [KEYS.AI_CONFIG]: config });
}

export async function getHookConfig(): Promise<HookConfig> {
  const result = await chrome.storage.local.get(KEYS.HOOK_CONFIG);
  return result[KEYS.HOOK_CONFIG] ?? {
    fetch: true,
    xhr: true,
    console: true,
    errors: true,
    domMutation: true,
    scriptInject: true,
    events: false,
    navigation: true,
    timers: false,
  };
}

export async function setHookConfig(config: HookConfig): Promise<void> {
  await chrome.storage.local.set({ [KEYS.HOOK_CONFIG]: config });
}

// --- Patches ---
export async function getPatches(): Promise<Patch[]> {
  const result = await chrome.storage.local.get(KEYS.PATCHES);
  return result[KEYS.PATCHES] ?? [];
}

export async function setPatches(patches: Patch[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.PATCHES]: patches });
}

export async function addPatch(patch: Patch): Promise<void> {
  const patches = await getPatches();
  patches.push(patch);
  await setPatches(patches);
}

export async function removePatch(id: string): Promise<void> {
  const patches = await getPatches();
  await setPatches(patches.filter(p => p.id !== id));
}

export async function updatePatch(id: string, updates: Partial<Patch>): Promise<void> {
  const patches = await getPatches();
  const idx = patches.findIndex(p => p.id === id);
  if (idx >= 0) {
    patches[idx] = { ...patches[idx], ...updates };
    await setPatches(patches);
  }
}

// --- Flows ---
export async function getFlows(): Promise<Flow[]> {
  const result = await chrome.storage.local.get(KEYS.FLOWS);
  return result[KEYS.FLOWS] ?? [];
}

export async function setFlows(flows: Flow[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.FLOWS]: flows });
}

export async function addFlow(flow: Flow): Promise<void> {
  const flows = await getFlows();
  flows.push(flow);
  await setFlows(flows);
}

export async function updateFlow(id: string, updates: Partial<Flow>): Promise<void> {
  const flows = await getFlows();
  const idx = flows.findIndex(f => f.id === id);
  if (idx >= 0) {
    flows[idx] = { ...flows[idx], ...updates };
    await setFlows(flows);
  }
}

export async function removeFlow(id: string): Promise<void> {
  const flows = await getFlows();
  await setFlows(flows.filter(f => f.id !== id));
}

// --- Sessions ---
export async function getSessions(): Promise<Session[]> {
  const result = await chrome.storage.local.get(KEYS.SESSIONS);
  return result[KEYS.SESSIONS] ?? [];
}

export async function setSessions(sessions: Session[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.SESSIONS]: sessions });
}

export async function addSession(session: Session): Promise<void> {
  const sessions = await getSessions();
  sessions.push(session);
  await setSessions(sessions);
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<void> {
  const sessions = await getSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...updates };
    await setSessions(sessions);
  }
}

export async function removeSession(id: string): Promise<void> {
  const sessions = await getSessions();
  await setSessions(sessions.filter(s => s.id !== id));
}

export async function getCurrentSessionId(): Promise<string | null> {
  const result = await chrome.storage.local.get(KEYS.CURRENT_SESSION);
  return result[KEYS.CURRENT_SESSION] ?? null;
}

export async function setCurrentSessionId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ [KEYS.CURRENT_SESSION]: id });
}

// --- User Scripts ---
export async function getScripts(): Promise<UserScript[]> {
  const result = await chrome.storage.local.get(KEYS.SCRIPTS);
  return result[KEYS.SCRIPTS] ?? [];
}

export async function setScripts(scripts: UserScript[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.SCRIPTS]: scripts });
}

export async function addScript(script: UserScript): Promise<void> {
  const scripts = await getScripts();
  scripts.push(script);
  await setScripts(scripts);
}

export async function updateScript(id: string, updates: Partial<UserScript>): Promise<void> {
  const scripts = await getScripts();
  const idx = scripts.findIndex(s => s.id === id);
  if (idx >= 0) {
    scripts[idx] = { ...scripts[idx], ...updates, updatedAt: Date.now() };
    await setScripts(scripts);
  }
}

export async function removeScript(id: string): Promise<void> {
  const scripts = await getScripts();
  await setScripts(scripts.filter(s => s.id !== id));
}

export async function getScriptById(id: string): Promise<UserScript | null> {
  const scripts = await getScripts();
  return scripts.find(s => s.id === id) ?? null;
}

// --- Chat Sessions ---
const CHAT_KEY = 'kp_chat_sessions';
const CHAT_ACTIVE_KEY = 'kp_chat_active';

export async function getChatSessions(): Promise<ChatSession[]> {
  const result = await chrome.storage.local.get(CHAT_KEY);
  return result[CHAT_KEY] ?? [];
}

export async function setChatSessions(sessions: ChatSession[]): Promise<void> {
  await chrome.storage.local.set({ [CHAT_KEY]: sessions });
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  const sessions = await getChatSessions();
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  // Keep max 50 sessions
  await setChatSessions(sessions.slice(0, 50));
}

export async function deleteChatSession(id: string): Promise<void> {
  const sessions = await getChatSessions();
  await setChatSessions(sessions.filter(s => s.id !== id));
}

export async function getActiveChatSessionId(): Promise<string | null> {
  const result = await chrome.storage.local.get(CHAT_ACTIVE_KEY);
  return result[CHAT_ACTIVE_KEY] ?? null;
}

export async function setActiveChatSessionId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ [CHAT_ACTIVE_KEY]: id });
}
