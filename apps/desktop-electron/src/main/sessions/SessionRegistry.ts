import { session, type Session } from 'electron';
import type { ProxyClientSnapshot, RoutePartition } from '@alpha/shared-types';
import { applySessionSecurityPolicy } from '../session-policy';

export type { RoutePartition };

/** Persistent partition used for proxied tabs. Isolated cookie/storage jar. */
const PROXY_PARTITION = 'persist:alpha-proxy';

/**
 * P4.3: PROXY-only Accept-Language. `en-US` matches the NL egress and avoids
 * leaking the user's `ru` locale on proxied tabs. Chromium also derives
 * `navigator.language(s)` from this, so JS + HTTP locale stay consistent.
 * DIRECT (defaultSession) keeps the system locale untouched.
 */
const PROXY_ACCEPT_LANGUAGES = 'en-US,en;q=0.9';

/**
 * Owns the Electron sessions used as Route Partitions (P1) and is the SINGLE
 * authority that applies transport (proxy) to active browsing sessions.
 *
 * - DIRECT = `session.defaultSession` (reused to preserve existing
 *   cookies/logins). Commit 5: always explicit `mode: 'direct'` — the legacy
 *   RoutingService PAC no longer touches it.
 * - PROXY  = `session.fromPartition('persist:alpha-proxy')` — pointed at the
 *   single shared local sing-box SOCKS endpoint. One transport for all proxied
 *   tabs; never per-tab.
 *
 * Source of truth for which session a tab uses is `TabEntry.partition`.
 * RoutingService is now advisory only (rules / routeSource / UI hints) and
 * does NOT call `setProxy` on any active session.
 */
export class SessionRegistry {
  private readonly direct: Session;
  private readonly proxy: Session;

  constructor() {
    this.direct = session.defaultSession;
    this.proxy = session.fromPartition(PROXY_PARTITION);
  }

  /**
   * Commit 5: pin the DIRECT session (defaultSession) to explicit direct mode
   * so no leftover/legacy PAC can route its tabs through SOCKS. A DIRECT tab is
   * always direct. Idempotent and safe to call at startup.
   */
  applyDirectBaseline(): void {
    void this.direct
      .setProxy({ mode: 'direct' })
      .then(() => {
        console.log('[alpha][sessions] DIRECT session pinned to mode:direct');
      })
      .catch((e) => {
        console.warn('[alpha][sessions] DIRECT setProxy(direct) failed', { err: String(e) });
      });
  }

  /**
   * P4.3: PROXY-only locale. Sets the PROXY session's Accept-Language header and,
   * via Chromium, `navigator.language(s)` to `en-US` so the proxied fingerprint
   * matches the NL egress instead of leaking `ru`. The current UA is preserved
   * (passed back unchanged), so only the language list changes. DIRECT
   * (defaultSession) is never touched. Idempotent; safe to call at startup.
   */
  applyProxyLocale(): void {
    try {
      const ua = this.proxy.getUserAgent();
      this.proxy.setUserAgent(ua, PROXY_ACCEPT_LANGUAGES);
      console.log('[alpha][sessions] PROXY session locale set', {
        acceptLanguages: PROXY_ACCEPT_LANGUAGES,
      });
    } catch (e) {
      console.warn('[alpha][sessions] PROXY setUserAgent(acceptLanguages) failed', {
        err: String(e),
      });
    }
  }

  /** Resolve a concrete session for a partition. */
  getSession(partition: RoutePartition): Session {
    return partition === 'PROXY' ? this.proxy : this.direct;
  }

  /**
   * P4.7 Reset PROXY Identity: wipe ALL site data for the PROXY partition only.
   *
   * Operates EXCLUSIVELY on `this.proxy` (persist:alpha-proxy). The DIRECT
   * session (defaultSession) is never referenced here, so DIRECT cookies,
   * logins, localStorage and cache are guaranteed untouched. App-level stores
   * (bookmarks/history/passwords/groups/route memory/adblock) live in JSON
   * files outside any session and are likewise unaffected.
   *
   * Clears: cookies, localStorage, IndexedDB, service workers, cache storage,
   * filesystem/quota, WebSQL, shader cache, the HTTP cache, and the in-memory
   * host-resolver (DNS) cache. Transport/proxy rules are NOT changed — the next
   * PROXY request still egresses through the same sing-box endpoint.
   */
  async resetProxyIdentity(): Promise<void> {
    await this.proxy.clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'websql',
        'serviceworkers',
        'cachestorage',
      ],
    });
    await this.proxy.clearCache();
    try {
      await this.proxy.clearHostResolverCache();
    } catch (e) {
      console.warn('[alpha][sessions] clearHostResolverCache unavailable', { err: String(e) });
    }
    console.log('[alpha][sessions] PROXY identity reset (storage + cache cleared)');
  }

  /** All managed sessions (for cross-partition registration/iteration). */
  partitions(): Session[] {
    return [this.direct, this.proxy];
  }

  /** Apply the default-deny permission/security policy to every partition. */
  applySecurityToAll(): void {
    for (const s of this.partitions()) {
      applySessionSecurityPolicy(s);
    }
  }

  /**
   * Point the PROXY session at the single shared local SOCKS endpoint
   * (`localSocks` from ProxyClientService). The endpoint/process is shared by
   * all proxied tabs — never per-tab.
   *
   * Scope note (Commit 3): the DIRECT session is `defaultSession`, which is
   * still owned by the legacy RoutingService PAC (current tabs depend on it),
   * so we deliberately do NOT reconfigure DIRECT here. DIRECT becomes an
   * explicit `mode: 'direct'` in Commit 4 when the global PAC is retired.
   *
   * `localSocks = null` (transport not ready / ERROR): the PROXY session is set
   * to `direct` so it never points at a dead port. No tab uses the PROXY
   * session yet, so this is inert for current browsing.
   */
  applyProxyEndpoint(localSocks: ProxyClientSnapshot['localSocks']): void {
    if (localSocks && localSocks.host === '127.0.0.1' && localSocks.port > 0) {
      const rules = `socks5://127.0.0.1:${localSocks.port}`;
      void this.proxy
        .setProxy({ mode: 'fixed_servers', proxyRules: rules })
        .then(() => {
          console.log('[alpha][sessions] PROXY session proxy set', {
            mode: 'fixed_servers',
            scheme: 'socks5', // Chromium resolves the hostname remotely over SOCKS5
            host: '127.0.0.1',
            port: localSocks.port,
          });
        })
        .catch((e) => {
          console.warn('[alpha][sessions] PROXY setProxy failed', { err: String(e) });
        });
      return;
    }

    void this.proxy
      .setProxy({ mode: 'direct' })
      .then(() => {
        console.log('[alpha][sessions] PROXY session proxy cleared (transport not ready)');
      })
      .catch((e) => {
        console.warn('[alpha][sessions] PROXY setProxy(direct) failed', { err: String(e) });
      });
  }
}
