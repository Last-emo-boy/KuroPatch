import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAIConfig,
  getActiveChatSessionId,
  getChatSessions,
  getCurrentSessionId,
  getHookConfig,
  getPatches,
  getScripts,
  getSessions,
} from '../shared/storage';
import Home from './components/Home';
import Chat from './components/Chat';
import Settings from './components/Settings';
import Scripts from './components/Scripts';
import Inspect from './components/Inspect';
import Network from './components/Network';
import Hooks from './components/Hooks';
import Patches from './components/Patches';
import Flows from './components/Flows';
import Sessions from './components/Sessions';
import PageHub from './components/PageHub';
import Lab from './components/Lab';

type View =
  | 'home'
  | 'assistant'
  | 'page'
  | 'settings'
  | 'scripts'
  | 'inspect'
  | 'network'
  | 'hooks'
  | 'patches'
  | 'flows'
  | 'sessions'
  | 'lab';

type PrimaryView = 'assistant' | 'page' | 'scripts';
type MoreView = 'home' | 'patches' | 'lab' | 'settings';

interface DashboardStatus {
  hasAI: boolean;
  pageInfo: { title: string; url: string } | null;
  patchCount: number;
  activePatchCount: number;
  scriptCount: number;
  activeScriptCount: number;
  conversationCount: number;
  debugCaseCount: number;
  hooksEnabledCount: number;
  activeConversationName: string | null;
  currentCaseName: string | null;
  recentConversations: Array<{ id: string; name: string; updatedAt: number }>;
  recentScripts: Array<{ id: string; name: string; updatedAt: number; lastRunResult?: string }>;
  recentChanges: Array<{ id: string; description: string; timestamp: number; enabled: boolean }>;
  recentCases: Array<{ id: string; name: string; updatedAt: number }>;
}

const PRIMARY_NAV_ITEMS: Array<{ id: PrimaryView; label: string }> = [
  { id: 'assistant', label: 'Assistant' },
  { id: 'page', label: 'Context' },
  { id: 'scripts', label: 'Library' },
];

const MORE_NAV_ITEMS: Array<{ id: MoreView; label: string }> = [
  { id: 'home', label: 'Overview' },
  { id: 'patches', label: 'Changes' },
  { id: 'lab', label: 'Lab' },
  { id: 'settings', label: 'Settings' },
];

const EMPTY_STATUS: DashboardStatus = {
  hasAI: false,
  pageInfo: null,
  patchCount: 0,
  activePatchCount: 0,
  scriptCount: 0,
  activeScriptCount: 0,
  conversationCount: 0,
  debugCaseCount: 0,
  hooksEnabledCount: 0,
  activeConversationName: null,
  currentCaseName: null,
  recentConversations: [],
  recentScripts: [],
  recentChanges: [],
  recentCases: [],
};

function formatPageLabel(url: string | undefined, fallback: string) {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    return parsed.hostname || fallback;
  } catch {
    return fallback;
  }
}

function getSurfaceLabel(view: View): string {
  if (view === 'assistant') return 'Assistant';
  if (view === 'page' || view === 'inspect' || view === 'network') return 'Context';
  if (view === 'scripts') return 'Library';
  if (view === 'patches') return 'Changes';
  if (view === 'lab' || view === 'hooks' || view === 'flows' || view === 'sessions') return 'Lab';
  if (view === 'settings') return 'Settings';
  return 'Overview';
}

export default function App() {
  const [view, setView] = useState<View>('assistant');
  const [status, setStatus] = useState<DashboardStatus>(EMPTY_STATUS);

  const refreshStatus = useCallback(async () => {
    const [config, patches, scripts, chatSessions, activeChatId, sessions, currentSessionId, hookConfig] = await Promise.all([
      getAIConfig(),
      getPatches(),
      getScripts(),
      getChatSessions(),
      getActiveChatSessionId(),
      getSessions(),
      getCurrentSessionId(),
      getHookConfig(),
    ]);

    let pageInfo: { title: string; url: string } | null = null;
    try {
      const ctx = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
      if (ctx && typeof ctx === 'object') {
        pageInfo = {
          title: (ctx as { title?: string }).title || 'Current page',
          url: (ctx as { url?: string }).url || '',
        };
      }
    } catch {
      pageInfo = null;
    }

    const sortedChats = [...chatSessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const sortedScripts = [...scripts].sort((a, b) => b.updatedAt - a.updatedAt);
    const sortedPatches = [...patches].sort((a, b) => b.timestamp - a.timestamp);
    const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

    setStatus({
      hasAI: Boolean(config?.apiKey),
      pageInfo,
      patchCount: patches.length,
      activePatchCount: patches.filter((patch) => patch.enabled !== false).length,
      scriptCount: scripts.length,
      activeScriptCount: scripts.filter((script) => script.mode === 'toggle' && script.active).length,
      conversationCount: chatSessions.length,
      debugCaseCount: sessions.length,
      hooksEnabledCount: Object.values(hookConfig).filter(Boolean).length,
      activeConversationName: sortedChats.find((session) => session.id === activeChatId)?.name ?? sortedChats[0]?.name ?? null,
      currentCaseName: sortedSessions.find((session) => session.id === currentSessionId)?.name ?? null,
      recentConversations: sortedChats.slice(0, 3).map((session) => ({
        id: session.id,
        name: session.name,
        updatedAt: session.updatedAt,
      })),
      recentScripts: sortedScripts.slice(0, 3).map((script) => ({
        id: script.id,
        name: script.name,
        updatedAt: script.updatedAt,
        lastRunResult: script.lastRunResult,
      })),
      recentChanges: sortedPatches.slice(0, 3).map((patch) => ({
        id: patch.id,
        description: patch.description,
        timestamp: patch.timestamp,
        enabled: patch.enabled !== false,
      })),
      recentCases: sortedSessions.slice(0, 3).map((session) => ({
        id: session.id,
        name: session.name,
        updatedAt: session.updatedAt,
      })),
    });
  }, []);

  useEffect(() => {
    void refreshStatus();

    const handleStorageChange = (_changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local') {
        void refreshStatus();
      }
    };

    const handleFocus = () => {
      void refreshStatus();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshStatus]);

  const renderView = () => {
    if (view === 'home') {
      return <Home onNavigate={setView as (v: string) => void} onRefresh={refreshStatus} status={status} />;
    }

    if (view === 'settings') {
      return (
        <div className="product-pane">
          <div className="product-pane-header">
            <button className="btn secondary" onClick={() => setView('assistant')} style={{ padding: '4px 10px', fontSize: 11 }}>
              ← Assistant
            </button>
            <h3 style={{ margin: 0 }}>Settings</h3>
          </div>
          <Settings />
        </div>
      );
    }

    if (view === 'scripts') {
      return <Scripts />;
    }

    if (view === 'page') {
      return <PageHub onOpenInspect={() => setView('inspect')} onOpenNetwork={() => setView('network')} />;
    }

    if (view === 'inspect') {
      return <Inspect onBack={() => setView('page')} />;
    }

    if (view === 'network') {
      return <Network onBack={() => setView('page')} />;
    }

    if (view === 'hooks') {
      return <Hooks onBack={() => setView('lab')} />;
    }

    if (view === 'patches') {
      return <Patches />;
    }

    if (view === 'flows') {
      return <Flows onBack={() => setView('lab')} />;
    }

    if (view === 'sessions') {
      return <Sessions onBack={() => setView('lab')} />;
    }

    return (
      <Lab
        onOpenHooks={() => setView('hooks')}
        onOpenFlows={() => setView('flows')}
        onOpenSessions={() => setView('sessions')}
      />
    );
  };

  const secondarySubtitle = status.pageInfo
    ? `${status.pageInfo.title} · ${formatPageLabel(status.pageInfo.url, status.pageInfo.title)}`
    : 'No page context yet';

  if (view === 'assistant') {
    return (
      <div className="app product-shell product-shell-minimal">
        <div className="product-main product-main-minimal">
          <Chat
            onOpenSettings={() => setView('settings')}
            onOpenScripts={() => setView('scripts')}
            onOpenPanel={setView as (v: string) => void}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app product-shell product-shell-secondary">
      <div className="product-main">
        <div className="product-minimal-bar">
          <button className="product-minimal-back" onClick={() => setView('assistant')} type="button">
            ← Chat
          </button>
          <div className="product-minimal-copy">
            <div className="product-minimal-title">{getSurfaceLabel(view)}</div>
            <div className="product-minimal-subtitle">{secondarySubtitle}</div>
          </div>
          <button className="product-status-refresh" onClick={() => void refreshStatus()} type="button">
            Refresh
          </button>
        </div>

        <div className="product-content product-content-secondary">{renderView()}</div>
      </div>
    </div>
  );
}
