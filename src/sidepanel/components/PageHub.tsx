import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConsoleEntry, ElementInfo, NetworkRequest, PageError } from '../../shared/types';
import { getPageContext } from '../services/page';

interface PageHubProps {
  onOpenInspect?: () => void;
  onOpenNetwork?: () => void;
}

type PageFocus = 'selection' | 'elements' | 'requests' | 'logs';

function getHostnameLabel(url?: string | null): string {
  if (!url) return 'No page connected';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return url.slice(0, 90);
  }
}

function isElementVisible(element: ElementInfo | null): boolean {
  if (!element) return false;
  const display = element.computedStyles?.display;
  const visibility = element.computedStyles?.visibility;
  return display !== 'none' && visibility !== 'hidden';
}

function getSelectionLabel(element: ElementInfo | null): string {
  if (!element) return 'Pick an element to carry context into the workspace.';
  return `<${element.tagName.toLowerCase()}> ${element.selector}`;
}

export default function PageHub({ onOpenInspect, onOpenNetwork }: PageHubProps) {
  const [pageContext, setPageContext] = useState<Awaited<ReturnType<typeof getPageContext>>>(null);
  const [requests, setRequests] = useState<NetworkRequest[]>([]);
  const [selection, setSelection] = useState<ElementInfo | null>(null);
  const [focus, setFocus] = useState<PageFocus>('selection');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);

  const refreshWorkspace = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);

    try {
      const [context, networkResponse] = await Promise.all([
        getPageContext(),
        chrome.runtime.sendMessage({ type: 'GET_NETWORK_REQUESTS' }).catch(() => [] as NetworkRequest[]),
      ]);

      setPageContext(context);
      setSelection((current) => context?.selectedElement ?? current);
      setRequests(Array.isArray(networkResponse) ? (networkResponse as NetworkRequest[]) : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspace();

    const interval = window.setInterval(() => {
      void refreshWorkspace(true);
    }, 5000);

    const handleFocus = () => {
      void refreshWorkspace(true);
    };

    const handleMessage = (msg: any) => {
      if (msg?.type === 'ELEMENT_SELECTED' && msg.payload) {
        setSelection(msg.payload as ElementInfo);
        setPicking(false);
        setFocus('selection');
      }
    };

    window.addEventListener('focus', handleFocus);
    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [refreshWorkspace]);

  const togglePick = useCallback(() => {
    if (picking) {
      chrome.runtime.sendMessage({ type: 'STOP_INSPECT' });
      setPicking(false);
      return;
    }
    chrome.runtime.sendMessage({ type: 'START_INSPECT' });
    setPicking(true);
  }, [picking]);

  const sections = pageContext?.sections ?? [];
  const visibleSections = useMemo(() => sections.filter((section) => section.visible).slice(0, 6), [sections]);
  const sortedRequests = useMemo(() => [...requests].sort((a, b) => b.startTime - a.startTime), [requests]);
  const failedRequests = useMemo(() => sortedRequests.filter((request) => request.failed || request.status >= 400), [sortedRequests]);
  const slowRequests = useMemo(() => sortedRequests.filter((request) => request.duration >= 500), [sortedRequests]);
  const requestHighlights = useMemo(() => {
    const highlighted = [
      ...failedRequests,
      ...slowRequests.filter((request) => !failedRequests.some((failed) => failed.id === request.id)),
    ];
    return (highlighted.length ? highlighted : sortedRequests).slice(0, 5);
  }, [failedRequests, slowRequests, sortedRequests]);
  const consoleHighlights = useMemo(
    () => [...(pageContext?.consoleLogs ?? [])].sort((a, b) => b.timestamp - a.timestamp).slice(0, 4),
    [pageContext],
  );
  const errorHighlights = useMemo(
    () => [...(pageContext?.errors ?? [])].sort((a, b) => b.timestamp - a.timestamp).slice(0, 3),
    [pageContext],
  );

  const signalCount = (pageContext?.consoleLogs.length ?? 0) + (pageContext?.errors.length ?? 0);
  const selectionVisible = isElementVisible(selection);

  const focusCards: Array<{ id: PageFocus; label: string; detail: string }> = [
    {
      id: 'selection',
      label: 'Selection',
      detail: selection ? selection.selector : 'No pinned element',
    },
    {
      id: 'elements',
      label: 'Structure',
      detail: `${sections.length} sections`,
    },
    {
      id: 'requests',
      label: 'Requests',
      detail: `${failedRequests.length} failed · ${slowRequests.length} slow`,
    },
    {
      id: 'logs',
      label: 'Signals',
      detail: `${signalCount} runtime events`,
    },
  ];

  const renderActiveSection = () => {
    if (focus === 'selection') {
      return (
        <section className="card page-workspace-card active">
          <div className="page-workspace-section-head compact">
            <div>
              <span className="page-workspace-section-kicker">Current selection</span>
              <h4>Keep element context visible</h4>
            </div>
            <div className="page-workspace-section-actions">
              <span className={`badge ${selection ? 'success' : 'warning'}`}>{selection ? 'Selected' : 'No selection'}</span>
              {selection ? <span className={`badge ${selectionVisible ? 'success' : 'warning'}`}>{selectionVisible ? 'Visible' : 'Hidden'}</span> : null}
            </div>
          </div>

          {selection ? (
            <>
              <div className="page-selection-hero compact">
                <div className="page-selection-tag">
                  {'<'}
                  {selection.tagName.toLowerCase()}
                  {selection.id ? <span className="page-selection-id">#{selection.id}</span> : null}
                  {'>'}
                </div>
                <div className="page-selection-selector">{selection.selector}</div>
                {selection.textContent ? <p className="page-selection-copy">“{selection.textContent.slice(0, 160)}”</p> : null}
              </div>

              <div className="page-workspace-metrics two-up compact">
                <div className="page-workspace-metric">
                  <span>Attributes</span>
                  <strong>{Object.keys(selection.attributes).length}</strong>
                </div>
                <div className="page-workspace-metric">
                  <span>Listeners</span>
                  <strong>{selection.eventListeners?.length ?? 0}</strong>
                </div>
              </div>

              <div className="page-selection-attrs">
                {Object.entries(selection.attributes).slice(0, 4).map(([key, value]) => (
                  <div key={key} className="page-selection-attr">
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
                {Object.keys(selection.attributes).length === 0 && (
                  <div className="page-inline-empty">This element has no notable attributes captured yet.</div>
                )}
              </div>
            </>
          ) : (
            <div className="page-card-empty">
              <div>
                <strong>No element is pinned yet</strong>
                <p>Use the picker to grab a live element, then keep its selector and quick facts here.</p>
              </div>
            </div>
          )}

          <div className="page-workspace-footer">
            <button className={`btn${picking ? '' : ' secondary'}`} type="button" onClick={togglePick}>
              {picking ? 'Stop picker' : 'Pick element'}
            </button>
            {onOpenInspect ? (
              <button className="btn secondary" type="button" onClick={onOpenInspect}>
                Open Inspect
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    if (focus === 'elements') {
      return (
        <section className="card page-workspace-card active">
          <div className="page-workspace-section-head compact">
            <div>
              <span className="page-workspace-section-kicker">Structure</span>
              <h4>Understand page layout fast</h4>
            </div>
            <div className="page-workspace-section-actions">
              <span className="badge info">{sections.length} sections</span>
            </div>
          </div>

          <div className="page-workspace-metrics two-up compact">
            <div className="page-workspace-metric">
              <span>Visible</span>
              <strong>{visibleSections.length}</strong>
            </div>
            <div className="page-workspace-metric">
              <span>Viewport</span>
              <strong>{pageContext?.viewport ? `${pageContext.viewport.width}×${pageContext.viewport.height}` : '—'}</strong>
            </div>
          </div>

          {visibleSections.length > 0 ? (
            <div className="page-section-list">
              {visibleSections.map((section) => (
                <div key={section.selector} className="page-section-item">
                  <div>
                    <div className="page-section-title">{section.role || section.tag}</div>
                    <div className="page-section-summary">{section.summary || section.selector}</div>
                  </div>
                  <div className="page-section-meta">
                    <span className="badge info">{section.tag}</span>
                    <span>{section.childCount} children</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="page-inline-empty">
              {loading ? 'Loading page structure…' : 'No structured sections are available yet for this page.'}
            </div>
          )}

          <div className="page-workspace-footer">
            <span className="page-footnote">Use Inspect when you need full computed styles, DOM breadcrumbs, and quick edits.</span>
            {onOpenInspect ? (
              <button className="btn secondary" type="button" onClick={onOpenInspect}>
                Inspect details
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    if (focus === 'requests') {
      return (
        <section className="card page-workspace-card active">
          <div className="page-workspace-section-head compact">
            <div>
              <span className="page-workspace-section-kicker">Requests</span>
              <h4>Spot failing and slow activity</h4>
            </div>
            <div className="page-workspace-section-actions">
              {failedRequests.length > 0 ? <span className="badge error">{failedRequests.length} failed</span> : null}
              {slowRequests.length > 0 ? <span className="badge warning">{slowRequests.length} slow</span> : null}
            </div>
          </div>

          <div className="page-workspace-metrics three-up compact">
            <div className="page-workspace-metric">
              <span>Total</span>
              <strong>{requests.length}</strong>
            </div>
            <div className="page-workspace-metric">
              <span>Failed</span>
              <strong>{failedRequests.length}</strong>
            </div>
            <div className="page-workspace-metric">
              <span>Slow</span>
              <strong>{slowRequests.length}</strong>
            </div>
          </div>

          {requestHighlights.length > 0 ? (
            <div className="page-request-list">
              {requestHighlights.map((request) => (
                <div key={request.id} className="page-request-item">
                  <div className="page-request-main">
                    <div className="page-request-line">
                      <span className="page-request-method">{request.method}</span>
                      <span className={`page-request-status ${request.failed || request.status >= 400 ? 'fail' : 'ok'}`}>
                        {request.status || '…'}
                      </span>
                      <span className="page-request-url" title={request.url}>{shortenUrl(request.url)}</span>
                    </div>
                    <div className="page-request-meta">
                      <span>{request.type}</span>
                      <span>{request.duration > 0 ? `${Math.round(request.duration)}ms` : 'pending'}</span>
                      <span>{relativeTime(request.startTime)}</span>
                    </div>
                  </div>
                  {request.failed || request.status >= 400 ? <span className="badge error">Needs attention</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="page-inline-empty">
              {loading ? 'Loading captured requests…' : 'No requests captured yet. Interact with the page to generate network activity.'}
            </div>
          )}

          <div className="page-workspace-footer">
            <span className="page-footnote">Use Network when you need filters, headers, and response previews.</span>
            {onOpenNetwork ? (
              <button className="btn secondary" type="button" onClick={onOpenNetwork}>
                Open Network
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    return (
      <section className="card page-workspace-card active">
        <div className="page-workspace-section-head compact">
          <div>
            <span className="page-workspace-section-kicker">Signals</span>
            <h4>Review runtime errors and console output</h4>
          </div>
          <div className="page-workspace-section-actions">
            {(pageContext?.errors.length ?? 0) > 0 ? <span className="badge error">{pageContext?.errors.length} errors</span> : null}
            {(pageContext?.consoleLogs.length ?? 0) > 0 ? <span className="badge info">{pageContext?.consoleLogs.length} console</span> : null}
          </div>
        </div>

        <div className="page-log-columns compact">
          <div>
            <div className="page-log-heading">Recent errors</div>
            {errorHighlights.length > 0 ? (
              <div className="page-log-list">
                {errorHighlights.map((error, index) => (
                  <LogErrorItem key={`${error.message}-${index}`} error={error} />
                ))}
              </div>
            ) : (
              <div className="page-inline-empty">No page errors captured right now.</div>
            )}
          </div>

          <div>
            <div className="page-log-heading">Console signals</div>
            {consoleHighlights.length > 0 ? (
              <div className="page-log-list">
                {consoleHighlights.map((entry, index) => (
                  <ConsoleItem key={`${entry.timestamp}-${index}`} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="page-inline-empty">No console signals captured right now.</div>
            )}
          </div>
        </div>

        <div className="page-workspace-footer">
          <span className="page-footnote">Assistant summaries can use these same signals to explain failures and unexpected page state.</span>
        </div>
      </section>
    );
  };

  return (
    <div className="product-pane page-hub page-workspace">
      <div className="product-pane-header page-hub-header page-workspace-top compact">
        <div className="page-workspace-header-text compact">
          <div>
            <span className="page-hub-kicker">Page context</span>
            <h3 style={{ margin: 0 }}>Review the live page from one place</h3>
            <p className="page-workspace-subtitle">
              {pageContext
                ? `${getHostnameLabel(pageContext.url)} · ${pageContext.title}`
                : 'Open a normal web page to inspect the active tab, captured requests, and runtime signals.'}
            </p>
          </div>
          <div className="page-workspace-health compact">
            <span className={`badge ${pageContext ? 'success' : 'warning'}`}>
              {pageContext ? 'Page connected' : 'No page context'}
            </span>
            <span className={`badge ${signalCount > 0 ? 'info' : 'warning'}`}>
              {signalCount > 0 ? `${signalCount} signals` : 'No signals yet'}
            </span>
          </div>
        </div>

        <div className="page-workspace-actions compact">
          <button className={`btn${picking ? '' : ' secondary'}`} type="button" onClick={togglePick}>
            {picking ? 'Picking…' : 'Pick element'}
          </button>
          <button className="btn secondary" type="button" onClick={() => void refreshWorkspace(true)}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="page-context-summary">
        {focusCards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`page-context-stat${focus === card.id ? ' active' : ''}`}
            onClick={() => setFocus(card.id)}
            aria-pressed={focus === card.id}
          >
            <span>{card.label}</span>
            <strong>{card.detail}</strong>
          </button>
        ))}
      </div>

      {renderActiveSection()}
    </div>
  );
}

function LogErrorItem({ error }: { error: PageError }) {
  return (
    <div className="page-log-item error">
      <div className="page-log-meta">
        <span className="badge error">Error</span>
        <span>{relativeTime(error.timestamp)}</span>
      </div>
      <strong>{error.message}</strong>
      {error.source ? <span>{error.source}{error.lineno ? `:${error.lineno}` : ''}</span> : null}
    </div>
  );
}

function ConsoleItem({ entry }: { entry: ConsoleEntry }) {
  const tone = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warning' : 'info';
  return (
    <div className={`page-log-item ${entry.level}`}>
      <div className="page-log-meta">
        <span className={`badge ${tone}`}>{entry.level}</span>
        <span>{relativeTime(entry.timestamp)}</span>
      </div>
      <strong>{entry.args[0] || 'Console signal'}</strong>
      {entry.args.length > 1 ? <span>{entry.args.slice(1).join(' ')}</span> : null}
    </div>
  );
}
