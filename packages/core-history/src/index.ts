/** Phase 5 — history store helpers */
export const HISTORY_PHASE = 5;

export function sanitizeHistoryUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  // Drop fragment always.
  url.hash = '';

  // Reduce sensitive / query-heavy URLs.
  const q = url.searchParams;
  const sensitiveKeys = ['token', 'access_token', 'refresh_token', 'code', 'password', 'passwd', 'session', 'sid'];
  for (const key of sensitiveKeys) {
    if (q.has(key)) {
      url.search = '';
      return url.toString();
    }
  }

  const rawQuery = url.search;
  if (rawQuery.length > 120) {
    url.search = '';
  }
  return url.toString();
}

export interface NormalizedAggregateUrl {
  /** Canonical URL used as the aggregate key. */
  url: string;
  /** Registrable-ish host with a leading `www.` stripped. */
  host: string;
}

/**
 * Canonicalize a URL for the per-URL aggregate (HistoryUrlStat) so that
 * trivially-different URLs collapse onto one key:
 * - runs through sanitizeHistoryUrl (drops fragment + sensitive/heavy queries)
 * - lowercases the host and strips a leading `www.`
 * - removes a trailing slash from non-root paths
 */
export function normalizeAggregateUrl(input: string): NormalizedAggregateUrl | null {
  const sanitized = sanitizeHistoryUrl(input);
  if (!sanitized) return null;
  let url: URL;
  try {
    url = new URL(sanitized);
  } catch {
    return null;
  }
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }
  url.hostname = host;
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return { url: url.toString(), host };
}

export function shouldDedupeVisit(prev: { url: string; visitedAt: string }, nextUrl: string): boolean {
  if (prev.url !== nextUrl) return false;
  const prevTs = Date.parse(prev.visitedAt);
  if (Number.isNaN(prevTs)) return false;
  return Date.now() - prevTs < 30_000; // 30s throttle
}
