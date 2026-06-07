import {
  DEFAULT_PROXY_ENDPOINT,
  DEFAULT_PROXY_KEY,
  type BrowserStateSnapshot,
} from '@alpha/shared-types';

export function emptyBrowserState(): BrowserStateSnapshot {
  return {
    tabs: [],
    sessionGroups: [],
    activeTabId: '',
    routing: {
      defaultRoute: 'AUTO',
      proxyEndpoints: { [DEFAULT_PROXY_KEY]: DEFAULT_PROXY_ENDPOINT },
      rules: [],
      temporaryOverrides: {},
      sessionHints: {},
      proxyAvailable: true,
      pendingRememberDomain: null,
      pendingReloadTabId: null,
    },
    proxy: {
      status: 'DISCONNECTED',
      runtimeMode: 'IN_PROCESS_TEST',
      localSocksEndpoint: DEFAULT_PROXY_ENDPOINT,
      localSocks: null,
      errorReason: null,
      lastError: null,
      lastChangedAt: new Date().toISOString(),
      restartAttempt: 0,
    },
    adblock: {
      enabled: true,
      disabledDomains: [],
      blockedTotal: 0,
      blockedByTabId: {},
    },
    passwords: {
      available: false,
      neverSaveOrigins: [],
      pendingPrompt: null,
    },
  };
}
