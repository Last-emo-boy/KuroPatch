// ============================================================
// Page context service - requests context from content script
// ============================================================
import type { PageContext } from '../../shared/types';

export async function getPageContext(): Promise<PageContext | null> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
    return resp as PageContext;
  } catch (e) {
    console.warn('Failed to get page context:', e);
    return null;
  }
}
