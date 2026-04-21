import { useMemo, useState } from 'react';

interface HomeStatus {
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

interface HomeProps {
  onNavigate?: (view: string) => void;
  onRefresh?: () => Promise<void> | void;
  status: HomeStatus;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPageHostname(url: string | null | undefined) {
  if (!url) return 'No page context yet';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function Home({ onNavigate, onRefresh, status }: HomeProps) {
  const [refreshing, setRefreshing] = useState(false);

  const quickActions = useMemo(() => {
    if (!status.hasAI) {
      return [
        {
          title: 'Configure AI provider',
          desc: 'Add an API key before starting the assistant workflow.',
          action: () => onNavigate?.('settings'),
          cta: 'Open Settings',
        },
        {
          title: 'Check page context',
          desc: 'Verify the current tab is reachable and page data is available.',
          action: () => onNavigate?.('page'),
          cta: 'Open Context',
        },
      ];
    }

    return [
      {
        title: 'Continue in Assistant',
        desc: status.activeConversationName
          ? `Resume “${status.activeConversationName}” and keep iterating on the current task.`
          : 'Start the main assistant workflow with the current page already in scope.',
        action: () => onNavigate?.('assistant'),
        cta: 'Open Assistant',
      },
      {
        title: 'Review saved scripts',
        desc: 'Open your reusable fixes and automation snippets.',
        action: () => onNavigate?.('scripts'),
        cta: 'Open Library',
      },
    ];
  }, [onNavigate, status.activeConversationName, status.hasAI]);

  const recentItems = useMemo(
    () => [
      {
        title: 'Conversation',
        value: status.activeConversationName || 'No active conversation',
        meta: status.recentConversations[0] ? formatTime(status.recentConversations[0].updatedAt) : 'Start in Assistant',
        action: () => onNavigate?.('assistant'),
      },
      {
        title: 'Page',
        value: status.pageInfo?.title || 'No page context yet',
        meta: formatPageHostname(status.pageInfo?.url),
        action: () => onNavigate?.('page'),
      },
      {
        title: 'Library',
        value: status.recentScripts[0]?.name || 'No saved scripts yet',
        meta: status.recentScripts[0] ? formatTime(status.recentScripts[0].updatedAt) : 'Save your first script',
        action: () => onNavigate?.('scripts'),
      },
      {
        title: 'Changes',
        value: status.recentChanges[0]?.description || 'No recent changes',
        meta: status.recentChanges[0] ? formatTime(status.recentChanges[0].timestamp) : 'Review patch history',
        action: () => onNavigate?.('patches'),
      },
    ],
    [onNavigate, status],
  );

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="home-page home-page-compact">
      <div className="card home-compact-hero">
        <div className="home-compact-head">
          <div>
            <span className="home-compact-kicker">Sidebar overview</span>
            <h1>KuroPatch</h1>
            <p>
              Start from Assistant, keep the current page in scope, and jump to saved fixes only when you need them.
            </p>
          </div>
          <div className="home-compact-actions">
            <button className="btn" onClick={() => onNavigate?.('assistant')}>Open Assistant</button>
            <button className="btn secondary" onClick={() => onNavigate?.('page')}>Open Context</button>
            <button className="btn secondary" onClick={() => void handleRefresh()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="home-compact-stats">
          <div className="home-compact-stat">
            <span>AI</span>
            <strong>{status.hasAI ? 'Ready' : 'Setup needed'}</strong>
          </div>
          <div className="home-compact-stat">
            <span>Page</span>
            <strong>{status.pageInfo ? formatPageHostname(status.pageInfo.url) : 'No context'}</strong>
          </div>
          <div className="home-compact-stat">
            <span>Changes</span>
            <strong>{status.activePatchCount} active</strong>
          </div>
          <div className="home-compact-stat">
            <span>Library</span>
            <strong>{status.scriptCount} saved</strong>
          </div>
        </div>
      </div>

      <div className="card home-section-card home-section-card-compact">
        <div className="home-section-head compact">
          <div>
            <h2>Resume quickly</h2>
            <p>Short paths back into the current task flow.</p>
          </div>
        </div>
        <div className="home-compact-list">
          {recentItems.map((item) => (
            <button key={item.title} className="home-compact-item" onClick={item.action}>
              <span className="home-compact-item-label">{item.title}</span>
              <strong>{item.value}</strong>
              <span>{item.meta}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card home-section-card home-section-card-compact">
        <div className="home-section-head compact">
          <div>
            <h2>Recommended next steps</h2>
            <p>Keep the sidebar focused on one immediate action.</p>
          </div>
          <span className="badge info">{formatPageHostname(status.pageInfo?.url)}</span>
        </div>
        <div className="home-action-list home-action-list-compact">
          {quickActions.map((item) => (
            <button key={item.title} className="home-action-card home-action-card-compact" onClick={item.action}>
              <div>
                <div className="home-action-title">{item.title}</div>
                <div className="home-action-desc">{item.desc}</div>
              </div>
              <span className="home-action-cta">{item.cta}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card home-section-card home-section-card-compact">
        <div className="home-section-head compact">
          <div>
            <h2>Workspace snapshot</h2>
            <p>Low-frequency details stay here instead of competing with the main flow.</p>
          </div>
        </div>
        <div className="home-snapshot-grid">
          <div className="home-snapshot-item">
            <span>Conversations</span>
            <strong>{status.conversationCount}</strong>
          </div>
          <div className="home-snapshot-item">
            <span>Debug cases</span>
            <strong>{status.debugCaseCount}</strong>
          </div>
          <div className="home-snapshot-item">
            <span>Hooks enabled</span>
            <strong>{status.hooksEnabledCount}</strong>
          </div>
          <div className="home-snapshot-item">
            <span>Toggle scripts on</span>
            <strong>{status.activeScriptCount}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
