import Store from 'electron-store';
import {
  DEFAULT_PROXY_ENDPOINT,
  DEFAULT_PROXY_KEY,
  type RouteMode,
  type RouteRule,
  type RoutesConfig,
} from '@alpha/shared-types';
import { validateProxyEndpoint } from '@alpha/core-routing';

interface RoutesData {
  version: 1;
  defaultRoute: RouteMode;
  proxyEndpoints: Record<string, string>;
  rules: RouteRule[];
}

function defaultConfig(): RoutesConfig {
  return {
    version: 1,
    defaultRoute: 'AUTO',
    proxyEndpoints: { [DEFAULT_PROXY_KEY]: DEFAULT_PROXY_ENDPOINT },
    rules: [],
  };
}

export class RoutesStore {
  private readonly store = new Store<RoutesData>({
    clearInvalidConfig: true,
    name: 'routes',
    defaults: defaultConfig() as RoutesData,
  });

  getConfig(): RoutesConfig {
    return {
      version: 1,
      defaultRoute: this.store.get('defaultRoute'),
      proxyEndpoints: { ...this.store.get('proxyEndpoints') },
      rules: [...this.store.get('rules')],
    };
  }

  setDefaultRoute(route: RouteMode): RoutesConfig {
    this.store.set('defaultRoute', route);
    return this.getConfig();
  }

  setProxyEndpoint(key: string, endpoint: string): RoutesConfig {
    if (!validateProxyEndpoint(endpoint)) {
      throw new Error('Invalid proxy endpoint');
    }
    const endpoints = { ...this.store.get('proxyEndpoints') };
    endpoints[key] = endpoint.trim();
    this.store.set('proxyEndpoints', endpoints);
    return this.getConfig();
  }

  addRule(domain: string, route: RouteMode): RouteRule {
    const now = new Date().toISOString();
    const rule: RouteRule = {
      domain: domain.trim().toLowerCase(),
      route,
      createdAt: now,
      updatedAt: now,
    };
    const rules = this.getConfig().rules.filter((r) => r.domain !== rule.domain);
    rules.push(rule);
    this.store.set('rules', rules);
    return rule;
  }

  updateRule(domain: string, route: RouteMode): RouteRule | null {
    const rules = this.getConfig().rules;
    const index = rules.findIndex((r) => r.domain === domain);
    if (index < 0) {
      return null;
    }
    const updated: RouteRule = {
      ...rules[index],
      route,
      updatedAt: new Date().toISOString(),
    };
    rules[index] = updated;
    this.store.set('rules', rules);
    return updated;
  }

  deleteRule(domain: string): boolean {
    const rules = this.getConfig().rules.filter((r) => r.domain !== domain);
    if (rules.length === this.getConfig().rules.length) {
      return false;
    }
    this.store.set('rules', rules);
    return true;
  }

  upsertRule(domain: string, route: RouteMode): RouteRule {
    const existing = this.getConfig().rules.find((r) => r.domain === domain);
    if (existing) {
      return this.updateRule(domain, route)!;
    }
    return this.addRule(domain, route);
  }
}
