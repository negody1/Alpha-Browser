import { describe, expect, it } from 'vitest';
import {
  generatePacScript,
  matchDomainRule,
  normalizeDomain,
  parseProxyEndpoint,
  resolveRouteForHost,
  validateProxyEndpoint,
} from './index';
import type { RoutesConfig } from '@alpha/shared-types';

const baseConfig: RoutesConfig = {
  version: 1,
  defaultRoute: 'AUTO',
  proxyEndpoints: { PROXY_MAIN: 'SOCKS5 127.0.0.1:1080' },
  rules: [
    {
      domain: 'youtube.com',
      route: 'PROXY',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      domain: 'gosuslugi.ru',
      route: 'DIRECT',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('normalizeDomain', () => {
  it('strips www and protocol', () => {
    expect(normalizeDomain('https://www.youtube.com/watch')).toBe('youtube.com');
  });

  it('returns eTLD+1 for subdomains', () => {
    expect(normalizeDomain('m.github.com')).toBe('github.com');
  });
});

describe('matchDomainRule', () => {
  it('matches longest applicable rule', () => {
    const rule = matchDomainRule('www.youtube.com', baseConfig.rules);
    expect(rule?.domain).toBe('youtube.com');
    expect(rule?.route).toBe('PROXY');
  });
});

describe('resolveRouteForHost', () => {
  it('uses saved rule over session hint', () => {
    const r = resolveRouteForHost('gosuslugi.ru', baseConfig, {
      sessionHints: { 'gosuslugi.ru': 'PROXY' },
    });
    expect(r.effective).toBe('DIRECT');
    expect(r.source).toBe('saved-rule');
  });

  it('uses temporary override over saved rule', () => {
    const r = resolveRouteForHost('youtube.com', baseConfig, {
      temporaryOverrides: { 'youtube.com': 'DIRECT' },
    });
    expect(r.effective).toBe('DIRECT');
    expect(r.source).toBe('temporary-override');
  });

  it('defaults AUTO to DIRECT without hint', () => {
    const r = resolveRouteForHost('example.com', baseConfig, {});
    expect(r.mode).toBe('AUTO');
    expect(r.effective).toBe('DIRECT');
    expect(r.source).toBe('default');
  });
});

describe('generatePacScript', () => {
  it('routes youtube through proxy', () => {
    const pac = generatePacScript({ config: baseConfig });
    expect(pac).toContain('youtube.com');
    expect(pac).toContain('SOCKS5 127.0.0.1:1080');
    expect(pac).toContain('gosuslugi.ru');
    expect(pac).toContain('DIRECT');
  });
});

describe('validateProxyEndpoint', () => {
  it('rejects credentials in url', () => {
    expect(validateProxyEndpoint('SOCKS5 user:pass@127.0.0.1:1080')).toBe(false);
  });

  it('accepts socks5 host port', () => {
    expect(validateProxyEndpoint('SOCKS5 127.0.0.1:1080')).toBe(true);
    expect(parseProxyEndpoint('SOCKS5 127.0.0.1:1080')?.pacValue).toBe('SOCKS5 127.0.0.1:1080');
  });
});
