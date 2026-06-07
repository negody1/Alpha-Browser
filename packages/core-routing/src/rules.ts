import type { EffectiveRoute, RouteMode, RouteRule } from '@alpha/shared-types';
import { hostMatchesDomain, normalizeDomain } from './domain';

export function matchDomainRule(host: string, rules: RouteRule[]): RouteRule | null {
  const domain = normalizeDomain(host);
  if (!domain) {
    return null;
  }

  let best: RouteRule | null = null;
  for (const rule of rules) {
    const ruleDomain = normalizeDomain(rule.domain);
    if (!ruleDomain) {
      continue;
    }
    if (hostMatchesDomain(domain, ruleDomain) || hostMatchesDomain(host, ruleDomain)) {
      if (!best || ruleDomain.length > normalizeDomain(best.domain).length) {
        best = rule;
      }
    }
  }
  return best;
}

export function effectiveFromMode(
  mode: RouteMode,
  sessionHint: EffectiveRoute | undefined,
): EffectiveRoute {
  if (mode === 'DIRECT') {
    return 'DIRECT';
  }
  if (mode === 'PROXY') {
    return 'PROXY';
  }
  return sessionHint ?? 'DIRECT';
}
