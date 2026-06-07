import { DEFAULT_PROXY_ENDPOINT, DEFAULT_PROXY_KEY } from '@alpha/shared-types';

export interface ParsedProxyEndpoint {
  key: string;
  pacValue: string;
}

const PROXY_PATTERN =
  /^(SOCKS5|SOCKS|HTTP|HTTPS)\s+([a-z0-9.-]+|\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/i;

/** Reject embedded credentials and invalid formats. */
export function validateProxyEndpoint(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) {
    return false;
  }
  if (trimmed.includes('@') || trimmed.includes('://')) {
    return false;
  }
  return PROXY_PATTERN.test(trimmed);
}

export function parseProxyEndpoint(
  endpoint: string,
  key = DEFAULT_PROXY_KEY,
): ParsedProxyEndpoint | null {
  if (!validateProxyEndpoint(endpoint)) {
    return null;
  }

  const match = endpoint.trim().match(PROXY_PATTERN);
  if (!match) {
    return null;
  }

  const scheme = match[1].toUpperCase();
  const host = match[2];
  const port = match[3];

  let pacScheme = 'PROXY';
  if (scheme === 'SOCKS5' || scheme === 'SOCKS') {
    pacScheme = 'SOCKS5';
  } else if (scheme === 'HTTPS') {
    pacScheme = 'HTTPS';
  }

  return {
    key,
    pacValue: `${pacScheme} ${host}:${port}`,
  };
}

export function getDefaultProxyConfig(): ParsedProxyEndpoint {
  return parseProxyEndpoint(DEFAULT_PROXY_ENDPOINT, DEFAULT_PROXY_KEY)!;
}
