// ============================================================
// Injected Hook Script - runs in the PAGE context
// Intercepts: fetch, XHR, console, errors, DOM mutations,
//             dynamic script injection
// ============================================================
(function () {
  const configEl = document.getElementById('__kp_hooks_script');
  const config = configEl?.dataset.config ? JSON.parse(configEl.dataset.config) : {};
  const urlFilter = (config.urlFilter || '') as string;

  function matchesUrlFilter(url: string): boolean {
    if (!urlFilter) return true;
    return url.toLowerCase().includes(urlFilter.toLowerCase());
  }

  function emit(type: string, summary: string, detail?: unknown) {
    window.postMessage({
      type: '__KP_HOOK_EVENT',
      payload: {
        id: `hook_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type,
        summary,
        detail,
        timestamp: Date.now(),
      },
    }, '*');
  }

  // ---- Fetch hook ----
  if (config.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      const method = (args[1]?.method || 'GET').toUpperCase();
      if (!matchesUrlFilter(url)) return originalFetch.apply(this, args);

      const reqBody = args[1]?.body;
      const reqBodyStr = typeof reqBody === 'string' ? reqBody.slice(0, 5000) : undefined;
      emit('fetch', `${method} ${url}`, { url, method, requestBody: reqBodyStr });

      try {
        const resp = await originalFetch.apply(this, args);
        // Clone and read response body for API-type requests
        let responsePreview: string | undefined;
        try {
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.includes('json') || contentType.includes('text') || contentType.includes('xml')) {
            const cloned = resp.clone();
            const text = await cloned.text();
            responsePreview = text.slice(0, 5000);
          }
        } catch { /* response body may not be readable */ }

        emit('fetch', `${method} ${url} → ${resp.status}`, {
          url, method, status: resp.status, ok: resp.ok,
          responsePreview,
        });
        return resp;
      } catch (err: any) {
        emit('fetch', `${method} ${url} → ERROR: ${err.message}`, {
          url, method, error: err.message,
        });
        throw err;
      }
    };
  }

  // ---- XHR hook ----
  if (config.xhr) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
      (this as any).__kp_method = method;
      (this as any).__kp_url = url.toString();
      return originalOpen.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      const method = (this as any).__kp_method || 'GET';
      const url = (this as any).__kp_url || '';

      if (!matchesUrlFilter(url)) return originalSend.apply(this, args);

      // Capture request body
      const reqBody = typeof args[0] === 'string' ? args[0].slice(0, 5000) : undefined;

      this.addEventListener('load', () => {
        // Capture response body for text-based responses
        let responsePreview: string | undefined;
        try {
          const ct = this.getResponseHeader('content-type') || '';
          if (ct.includes('json') || ct.includes('text') || ct.includes('xml')) {
            responsePreview = (this.responseText || '').slice(0, 5000);
          }
        } catch { /* ignore */ }
        emit('xhr', `${method} ${url} → ${this.status}`, {
          url, method, status: this.status, responsePreview,
        });
      });

      this.addEventListener('error', () => {
        emit('xhr', `${method} ${url} → ERROR`, { url, method });
      });

      emit('xhr', `${method} ${url} (sending)`, { url, method, requestBody: reqBody });
      return originalSend.apply(this, args);
    };
  }

  // ---- Console hook ----
  if (config.console) {
    const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
    for (const level of levels) {
      const original = console[level];
      console[level] = function (...args: any[]) {
        const stringArgs = args.map((a) => {
          try {
            return typeof a === 'object' ? JSON.stringify(a).slice(0, 200) : String(a);
          } catch {
            return String(a);
          }
        });
        emit('console', `[${level}] ${stringArgs.join(' ').slice(0, 300)}`, {
          level, args: stringArgs,
        });
        return original.apply(console, args);
      };
    }
  }

  // ---- Error hook ----
  if (config.errors) {
    window.addEventListener('error', (e) => {
      emit('error', `Error: ${e.message} at ${e.filename}:${e.lineno}`, {
        message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno,
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason?.message || String(e.reason);
      emit('error', `Unhandled Promise Rejection: ${reason}`, { reason });
    });
  }

  // ---- DOM Mutation hook ----
  let mutationObserver: MutationObserver | null = null;
  if (config.domMutation) {
    let mutationBatch: MutationRecord[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    mutationObserver = new MutationObserver((mutations) => {
      mutationBatch.push(...mutations);
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          const added = mutationBatch.reduce((s, m) => s + m.addedNodes.length, 0);
          const removed = mutationBatch.reduce((s, m) => s + m.removedNodes.length, 0);
          const attrs = mutationBatch.filter((m) => m.type === 'attributes').length;

          if (added + removed + attrs > 0) {
            emit('dom-mutation',
              `DOM: +${added} -${removed} nodes, ${attrs} attribute changes`,
              { added, removed, attrs }
            );
          }

          mutationBatch = [];
          flushTimer = null;
        }, 500);
      }
    });

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: false,
    });
  }

  // ---- Script injection detection ----
  if (config.scriptInject) {
    const scriptObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLScriptElement) {
            const src = node.src || '(inline)';
            emit('script-inject', `Script injected: ${src}`, { src, inline: !node.src });
          }
        }
      }
    });

    scriptObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ---- Cleanup listener ----
  window.addEventListener('message', (e) => {
    if (e.data?.type === '__KP_REMOVE_HOOKS') {
      mutationObserver?.disconnect();
      // Note: fetch/xhr/console hooks can't be fully reverted in page context
    }
  });
})();
