import { type Session } from 'electron';
import net from 'node:net';
import {
  DEFAULT_PROXY_KEY,
  type EffectiveRoute,
  type ResolvedRoute,
  type RouteClass,
  type RouteMode,
  type RoutingStateSnapshot,
  type RoutesConfig,
} from '@alpha/shared-types';
import {
  generatePacScript,
  isRetryableNetworkError,
  normalizeDomain,
  parseProxyEndpoint,
  resolveRouteForHost,
  resolveRouteForUrl,
} from '@alpha/core-routing';
import type { RoutesStore } from '../storage/RoutesStore';

export class RoutingService {
  private readonly sessionHints = new Map<string, EffectiveRoute>();
  private readonly temporaryOverrides = new Map<string, RouteMode>();
  private proxyAvailable = true;
  private pendingRememberDomain: string | null = null;
  private pendingReloadTabId: string | null = null;

  constructor(
    private readonly routesStore: RoutesStore,
    private readonly session: Session,
  ) {}

  getConfig(): RoutesConfig {
    return this.routesStore.getConfig();
  }

  getRoutingState(): RoutingStateSnapshot {
    return {
      defaultRoute: this.routesStore.getConfig().defaultRoute,
      proxyEndpoints: this.routesStore.getConfig().proxyEndpoints,
      rules: this.routesStore.getConfig().rules,
      temporaryOverrides: Object.fromEntries(this.temporaryOverrides),
      sessionHints: Object.fromEntries(this.sessionHints),
      proxyAvailable: this.proxyAvailable,
      pendingRememberDomain: this.pendingRememberDomain,
      pendingReloadTabId: this.pendingReloadTabId,
    };
  }

  resolveForUrl(url: string): ResolvedRoute {
    return resolveRouteForUrl(url, this.routesStore.getConfig(), this.context());
  }

  resolveForHost(host: string): ResolvedRoute {
    return resolveRouteForHost(host, this.routesStore.getConfig(), this.context());
  }

  setTemporaryOverride(domain: string, mode: RouteMode): void {
    const d = normalizeDomain(domain);
    if (!d) {
      return;
    }
    this.temporaryOverrides.set(d, mode);
  }

  clearTemporaryOverride(domain: string): void {
    this.temporaryOverrides.delete(normalizeDomain(domain));
  }

  setSessionHint(domain: string, effective: EffectiveRoute): void {
    const d = normalizeDomain(domain);
    if (d) {
      this.sessionHints.set(d, effective);
    }
  }

  clearSessionHint(domain: string): void {
    this.sessionHints.delete(normalizeDomain(domain));
  }

  setPendingRemember(domain: string | null): void {
    this.pendingRememberDomain = domain ? normalizeDomain(domain) : null;
  }

  setPendingReloadTabId(tabId: string | null): void {
    this.pendingReloadTabId = tabId;
  }

  /**
   * P2-A Route Memory (write side). Persist or forget the user's explicit
   * per-tab route choice for a domain:
   * - AUTO  → delete any saved rule (the user reverted to default behavior);
   * - DIRECT/PROXY → upsert a saved rule.
   *
   * This is a DATA-LAYER write only. It does NOT apply transport to any session
   * and does NOT re-enable PAC — transport is still owned solely by
   * SessionRegistry / TabEntry.partition.
   */
  rememberRoute(domain: string, routeClass: RouteClass): void {
    const d = normalizeDomain(domain);
    if (!d) {
      return;
    }
    if (routeClass === 'AUTO') {
      this.routesStore.deleteRule(d);
    } else {
      this.routesStore.upsertRule(d, routeClass);
    }
  }

  /**
   * P2-A Route Memory (read side). Return the remembered explicit route class
   * for a host, or null if the user never saved one. Matches only an exact
   * saved rule for the normalized host; it deliberately ignores
   * defaultRoute / temporary overrides / session hints (those are advisory and
   * are NOT part of per-tab memory). A saved AUTO rule is treated as "no memory".
   */
  getRememberedRouteClass(host: string): RouteClass | null {
    const d = normalizeDomain(host);
    if (!d) {
      return null;
    }
    const rule = this.routesStore.getConfig().rules.find((r) => r.domain === d);
    if (!rule || rule.route === 'AUTO') {
      return null;
    }
    return rule.route;
  }

  saveCurrentRouteAsRule(domain: string, route: RouteMode): RoutesConfig {
    const d = normalizeDomain(domain);
    this.routesStore.upsertRule(d, route);
    this.temporaryOverrides.delete(d);
    this.pendingRememberDomain = null;
    return this.routesStore.getConfig();
  }

  setDefaultRoute(route: RouteMode): RoutesConfig {
    return this.routesStore.setDefaultRoute(route);
  }

  setProxyEndpoint(endpoint: string): RoutesConfig {
    return this.routesStore.setProxyEndpoint(DEFAULT_PROXY_KEY, endpoint);
  }

  addRule(domain: string, route: RouteMode) {
    return this.routesStore.addRule(normalizeDomain(domain), route);
  }

  updateRule(domain: string, route: RouteMode) {
    return this.routesStore.updateRule(normalizeDomain(domain), route);
  }

  deleteRule(domain: string) {
    return this.routesStore.deleteRule(normalizeDomain(domain));
  }

  shouldAllowAutoFallback(domain: string, errorCode: number): boolean {
    const resolved = this.resolveForHost(domain);
    if (resolved.source === 'saved-rule' && resolved.mode !== 'AUTO') {
      return false;
    }
    if (resolved.source === 'temporary-override' && resolved.mode === 'DIRECT') {
      return false;
    }
    if (resolved.effective === 'PROXY') {
      return false;
    }
    return isRetryableNetworkError(errorCode);
  }

  async checkProxyAvailable(): Promise<boolean> {
    const config = this.routesStore.getConfig();
    const endpoint = config.proxyEndpoints[DEFAULT_PROXY_KEY];
    const parsed = parseProxyEndpoint(endpoint ?? '');
    if (!parsed) {
      this.proxyAvailable = false;
      return false;
    }

    // Local-only healthcheck for embedded SOCKS/HTTP proxy endpoint.
    // We only do a TCP connect to host:port (no URL/request logging).
    const match = endpoint!.trim().match(
      /^(SOCKS5|SOCKS|HTTP|HTTPS)\s+([a-z0-9.-]+|\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/i,
    );
    if (!match) {
      this.proxyAvailable = false;
      return false;
    }

    const host = match[2];
    const port = Number(match[3]);

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: 500 }, () => {
        socket.destroy();
        this.proxyAvailable = true;
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        this.proxyAvailable = false;
        resolve(false);
      });
      socket.setTimeout(500, () => {
        socket.destroy();
        this.proxyAvailable = false;
        resolve(false);
      });
    });
  }

  /**
   * Commit 5 (P1): advisory only. RoutingService no longer determines transport
   * for active browsing sessions — that is owned exclusively by SessionRegistry
   * (DIRECT = mode:direct, PROXY = fixed_servers socks5://localSocks), keyed off
   * `TabEntry.partition`.
   *
   * This method now just refreshes the `proxyAvailable` advisory flag used by
   * the resolver/UI hints. It intentionally does NOT call `session.setProxy`, so
   * a saved rule (e.g. youtube.com → PROXY) can never silently reroute a
   * DIRECT-partition tab through SOCKS via PAC.
   *
   * The PAC generator is kept (imported lazily below) only as a data source for
   * future route-memory work; it is not applied to any session here.
   */
  async applyPac(): Promise<void> {
    await this.checkProxyAvailable();
  }

  /**
   * Build the PAC script from current rules/overrides/hints. Advisory/data-layer
   * helper retained for diagnostics and future route memory; NOT applied to any
   * active session in P1.
   */
  buildPacScript(): string {
    return generatePacScript({
      config: this.routesStore.getConfig(),
      temporaryOverrides: Object.fromEntries(this.temporaryOverrides),
      sessionHints: Object.fromEntries(this.sessionHints),
    });
  }

  private context() {
    return {
      temporaryOverrides: Object.fromEntries(this.temporaryOverrides),
      sessionHints: Object.fromEntries(this.sessionHints),
      proxyAvailable: this.proxyAvailable,
    };
  }
}
