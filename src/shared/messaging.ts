// ============================================================
// Messaging protocol between background, sidepanel, content
// ============================================================

export type MessageType =
  // Background ↔ SidePanel
  | 'GET_PAGE_CONTEXT'
  | 'PAGE_CONTEXT'
  | 'GET_NETWORK_REQUESTS'
  | 'NETWORK_REQUESTS'
  | 'GET_HOOK_EVENTS'
  | 'HOOK_EVENTS'
  | 'GET_HOOK_SUMMARY'
  | 'SET_HOOK_CONFIG'
  | 'EXECUTE_ACTION'
  | 'ACTION_RESULT'
  | 'APPLY_PATCH'
  | 'ROLLBACK_PATCH'
  | 'TOGGLE_PATCH'
  | 'ROLLBACK_ALL'
  | 'GET_PATCHES'
  | 'PATCHES'
  | 'RUN_FLOW_STEP'
  // Content Script ↔ Background
  | 'INJECT_HOOKS'
  | 'REMOVE_HOOKS'
  | 'READ_DOM'
  | 'READ_SECTIONS'
  | 'MODIFY_DOM'
  | 'MODIFY_STYLE'
  | 'INJECT_JS'
  | 'SELECT_ELEMENT'
  | 'ELEMENT_SELECTED'
  | 'ELEMENT_INFO'
  | 'INSPECT_ELEMENT'
  | 'START_INSPECT'
  | 'STOP_INSPECT'
  | 'AUTOMATE'
  | 'CHECK_EXISTS'
  | 'CHECK_TEXT'
  // Injected → Content → Background
  | 'HOOK_EVENT'
  | 'CONSOLE_ENTRY'
  | 'PAGE_ERROR'
  | 'INJECT_CSS';

export interface Message {
  type: MessageType;
  payload?: unknown;
  requestId?: string;
}

let _reqId = 0;
function nextRequestId(): string {
  return `req_${++_reqId}_${Date.now()}`;
}

/**
 * Send a message to the active tab's content script via the background.
 */
export function sendToContent(tabId: number, msg: Message): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg);
}

/**
 * Send a message from content script to the background.
 */
export function sendToBackground(msg: Message): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

/**
 * Send a message and wait for a response with matching requestId.
 */
export function sendRequest(tabId: number, type: MessageType, payload?: unknown): Promise<unknown> {
  const requestId = nextRequestId();
  return new Promise((resolve, reject) => {
    const listener = (message: Message) => {
      if (message.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.sendMessage(tabId, { type, payload, requestId }).catch(reject);
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(`Request ${type} timed out`));
    }, 30000);
  });
}
