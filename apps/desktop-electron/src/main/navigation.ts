import { DEFAULT_SEARCH_URL } from '@alpha/shared-types';

const MAX_URL_LENGTH = 2048;

export function resolveNavigationUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return sanitizeHttpUrl(trimmed);
  }

  if (/^localhost(?::\d+)?(\/|$)/i.test(trimmed)) {
    return sanitizeHttpUrl(`http://${trimmed}`);
  }

  const looksLikeHost = /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed) && !trimmed.includes(' ');
  if (looksLikeHost) {
    return sanitizeHttpUrl(`https://${trimmed}`);
  }

  return `${DEFAULT_SEARCH_URL}${encodeURIComponent(trimmed)}`;
}

/** MVP: only http/https allowed from the address bar. */
export function sanitizeHttpUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    if (url.length > MAX_URL_LENGTH) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function isAllowedNavigationUrl(url: string): boolean {
  return sanitizeHttpUrl(url) !== '';
}

/**
 * True when `raw` is a Google URL with no actual search query — i.e. the
 * homepage, /webhp, or /search with an empty q. A search activation must NEVER
 * resolve here; the navigate handler rewrites such a target back into a real
 * search. (A user who explicitly typed/picked google.com is a different path and
 * is allowed.)
 */
export function isQuerylessGoogle(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) return false;
    const p = u.pathname;
    if (p === '/' || p === '' || p === '/webhp') return true;
    if (p === '/search') {
      const q = u.searchParams.get('q');
      return !q || q.trim() === '';
    }
    return false;
  } catch {
    return false;
  }
}

/** Build a guaranteed Google search URL for an exact (non-URL) query. */
export function forceSearchUrl(query: string): string {
  return `${DEFAULT_SEARCH_URL}${encodeURIComponent(query.trim())}`;
}

/**
 * Schemes the privileged chrome renderer is allowed to hand off to the OS via
 * shell.openExternal. Everything else (file:, custom protocol handlers, etc.)
 * is rejected so a compromised chrome renderer cannot trigger arbitrary
 * protocol launches (S1).
 */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
