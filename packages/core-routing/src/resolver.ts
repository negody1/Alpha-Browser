import type {
  EffectiveRoute,
  ResolvedRoute,
  RouteBadgeMode,
  RouteMode,
  RouteRule,
  RouteSource,
  RoutesConfig,
} from '@alpha/shared-types';
import { DEFAULT_PROXY_KEY } from '@alpha/shared-types';
import { normalizeDomain } from './domain';
import { effectiveFromMode, matchDomainRule } from './rules';

export interface ResolveRouteContext {
  temporaryOverrides?: Record<string, RouteMode>;
  sessionHints?: Record<string, EffectiveRoute>;
  proxyAvailable?: boolean;
}

export function resolveRouteForUrl(
  url: string,
  config: RoutesConfig,
  context: ResolveRouteContext = {},
): ResolvedRoute {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return emptyResolved('');
  }
  return resolveRouteForHost(host, config, context);
}

export function resolveRouteForHost(
  host: string,
  config: RoutesConfig,
  context: ResolveRouteContext = {},
): ResolvedRoute {
  const domain = normalizeDomain(host);
  if (!domain) {
    return emptyResolved(domain);
  }

  const proxyAvailable = context.proxyAvailable !== false;
  const temp = context.temporaryOverrides?.[domain];
  const hint = context.sessionHints?.[domain];
  const rule = matchDomainRule(host, config.rules);

  if (temp) {
    const effective = effectiveFromMode(temp, hint);
    return buildResolved({
      domain,
      mode: temp,
      effective,
      source: 'temporary-override',
      proxyAvailable,
    });
  }

  if (rule) {
    const effective = effectiveFromMode(rule.route, hint);
    return buildResolved({
      domain,
      mode: rule.route,
      effective,
      source: 'saved-rule',
      proxyAvailable,
    });
  }

  if (hint) {
    return buildResolved({
      domain,
      mode: 'AUTO',
      effective: hint,
      source: 'session-hint',
      proxyAvailable,
    });
  }

  const effective = effectiveFromMode(config.defaultRoute, undefined);
  return buildResolved({
    domain,
    mode: config.defaultRoute,
    effective,
    source: 'default',
    proxyAvailable,
  });
}

function buildResolved(input: {
  domain: string;
  mode: RouteMode;
  effective: EffectiveRoute;
  source: RouteSource;
  proxyAvailable: boolean;
}): ResolvedRoute {
  let mode: RouteBadgeMode = input.mode;
  let error: string | null = null;

  if (input.effective === 'PROXY' && !input.proxyAvailable) {
    mode = 'ERROR';
    error = 'Прокси недоступен';
  }

  return {
    domain: input.domain,
    mode,
    effective: input.effective,
    proxyKey: DEFAULT_PROXY_KEY,
    source: input.source,
    error,
  };
}

function emptyResolved(domain: string): ResolvedRoute {
  return {
    domain,
    mode: 'AUTO',
    effective: 'DIRECT',
    proxyKey: DEFAULT_PROXY_KEY,
    source: 'default',
    error: null,
  };
}

/** After AUTO network failure → PROXY retry succeeded. */
export function resolvedAfterFallback(domain: string, proxyAvailable: boolean): ResolvedRoute {
  return buildResolved({
    domain,
    mode: 'AUTO',
    effective: 'PROXY',
    source: 'fallback',
    proxyAvailable,
  });
}
