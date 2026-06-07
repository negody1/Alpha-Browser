export { normalizeDomain, hostMatchesDomain } from './domain';
export { validateProxyEndpoint, parseProxyEndpoint, getDefaultProxyConfig } from './proxy';
export { matchDomainRule, effectiveFromMode } from './rules';
export {
  resolveRouteForUrl,
  resolveRouteForHost,
  resolvedAfterFallback,
  type ResolveRouteContext,
} from './resolver';
export { generatePacScript, hostInPacRules, type PacBuildInput } from './pac';
export { isRetryableNetworkError } from './errors';
