import type { EffectiveRoute, RouteMode, RoutesConfig } from '@alpha/shared-types';
import { DEFAULT_PROXY_KEY } from '@alpha/shared-types';
import { hostMatchesDomain, normalizeDomain } from './domain';
import { parseProxyEndpoint } from './proxy';
import { effectiveFromMode } from './rules';

export interface PacBuildInput {
  config: RoutesConfig;
  temporaryOverrides?: Record<string, RouteMode>;
  sessionHints?: Record<string, EffectiveRoute>;
}

interface HostRoute {
  domain: string;
  effective: EffectiveRoute;
}

export function generatePacScript(input: PacBuildInput): string {
  const proxy = parseProxyEndpoint(
    input.config.proxyEndpoints[DEFAULT_PROXY_KEY] ?? 'SOCKS5 127.0.0.1:1080',
    DEFAULT_PROXY_KEY,
  );
  const proxyPac = proxy?.pacValue ?? 'SOCKS5 127.0.0.1:1080';

  const hostRoutes = collectHostRoutes(input);

  const lines = hostRoutes.map(({ domain, effective }) => {
    const fn = effective === 'PROXY' ? proxyPac : 'DIRECT';
    return `  if (dnsDomainIs(host, ".${domain}") || host === "${domain}") return "${fn}";`;
  });

  return `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  // Always bypass proxy for loopback / local dev servers.
  // This prevents dev UI from breaking when default route is PROXY.
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";
${lines.join('\n')}
  return "DIRECT";
}`;
}

function collectHostRoutes(input: PacBuildInput): HostRoute[] {
  const map = new Map<string, EffectiveRoute>();

  const add = (rawDomain: string, mode: RouteMode, hint?: EffectiveRoute) => {
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      return;
    }
    map.set(domain, effectiveFromMode(mode, hint ?? input.sessionHints?.[domain]));
  };

  for (const rule of input.config.rules) {
    add(rule.domain, rule.route, input.sessionHints?.[normalizeDomain(rule.domain)]);
  }

  if (input.sessionHints) {
    for (const [domain, effective] of Object.entries(input.sessionHints)) {
      const d = normalizeDomain(domain);
      if (d && !map.has(d)) {
        map.set(d, effective);
      }
    }
  }

  if (input.temporaryOverrides) {
    for (const [domain, mode] of Object.entries(input.temporaryOverrides)) {
      const d = normalizeDomain(domain);
      if (d) {
        map.set(d, effectiveFromMode(mode, input.sessionHints?.[d]));
      }
    }
  }

  return [...map.entries()]
    .map(([domain, effective]) => ({ domain, effective }))
    .sort((a, b) => b.domain.length - a.domain.length);
}

export function hostInPacRules(host: string, input: PacBuildInput): boolean {
  const domain = normalizeDomain(host);
  const routes = collectHostRoutes(input);
  return routes.some((r) => hostMatchesDomain(domain, r.domain));
}
