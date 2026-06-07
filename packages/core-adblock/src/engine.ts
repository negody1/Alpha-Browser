export type AdblockResourceType =
  | 'mainFrame'
  | 'subFrame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xhr'
  | 'media'
  | 'websocket'
  | 'other';

export interface AdblockRuleSetInput {
  blockedDomains: string[];
  blockedHostnames: string[];
  urlContains: string[];
}

export interface AdblockMatchInput {
  url: string;
  hostname: string;
  resourceType: AdblockResourceType;
}

export interface AdblockDecision {
  block: boolean;
  reason: 'domain' | 'hostname' | 'contains' | null;
}

/**
 * Lightweight matcher:
 * - set membership for domain/hostname
 * - substring matching for urlContains (lowercased)
 * - small positive cache to reduce CPU overhead
 *
 * Not an ABP parser; intentionally limited.
 */
export class AdblockEngine {
  private blockedDomains = new Set<string>();
  private blockedHostnames = new Set<string>();
  private urlContains: string[] = [];

  private cache = new Map<string, boolean>();
  private cacheKeys: string[] = [];

  constructor(input: AdblockRuleSetInput) {
    this.setRules(input);
  }

  setRules(input: AdblockRuleSetInput): void {
    this.blockedDomains = new Set(normalizeList(input.blockedDomains));
    this.blockedHostnames = new Set(normalizeList(input.blockedHostnames));
    this.urlContains = normalizeList(input.urlContains);
    this.clearCache();
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheKeys = [];
  }

  match(input: AdblockMatchInput): AdblockDecision {
    const host = input.hostname.toLowerCase();
    const key = `${host}|${input.resourceType}|${input.url.length > 140 ? input.url.slice(0, 140) : input.url}`.toLowerCase();

    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return { block: cached, reason: cached ? 'hostname' : null };
    }

    // Never block main frame by default (avoid “site doesn't open” class of failures).
    if (input.resourceType === 'mainFrame') {
      this.remember(key, false);
      return { block: false, reason: null };
    }

    // Domain match: eTLD+1 style simplified (suffix based).
    if (isHostInSet(host, this.blockedDomains)) {
      this.remember(key, true);
      return { block: true, reason: 'domain' };
    }

    // Hostname exact/suffix match.
    if (isHostInSet(host, this.blockedHostnames)) {
      this.remember(key, true);
      return { block: true, reason: 'hostname' };
    }

    const url = input.url.toLowerCase();
    for (const part of this.urlContains) {
      if (part && url.includes(part)) {
        this.remember(key, true);
        return { block: true, reason: 'contains' };
      }
    }

    this.remember(key, false);
    return { block: false, reason: null };
  }

  private remember(key: string, value: boolean) {
    this.cache.set(key, value);
    this.cacheKeys.push(key);
    if (this.cacheKeys.length > 2000) {
      const oldest = this.cacheKeys.splice(0, 500);
      for (const k of oldest) this.cache.delete(k);
    }
  }
}

function normalizeList(list: string[]): string[] {
  return list
    .map((s) => String(s ?? '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50_000);
}

/**
 * Parse a bundled list line into a `[directive, value]` pair.
 * Accepts both `:` and `=` as the separator (tolerant of typos like
 * `contains=...`), and ignores comments / unknown directives.
 */
function parseDirective(line: string): [directive: string, value: string] | null {
  const match = line.match(/^(domain|host|contains)\s*[:=]\s*(.+)$/i);
  if (!match) return null;
  return [match[1].toLowerCase(), match[2].trim()];
}

export function parseBundledList(text: string): AdblockRuleSetInput {
  const blockedDomains: string[] = [];
  const blockedHostnames: string[] = [];
  const urlContains: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parsed = parseDirective(line);
    if (!parsed) continue;
    const [directive, value] = parsed;
    if (!value) continue;
    if (directive === 'domain') blockedDomains.push(value);
    else if (directive === 'host') blockedHostnames.push(value);
    else if (directive === 'contains') urlContains.push(value.toLowerCase());
  }

  return { blockedDomains, blockedHostnames, urlContains };
}

export function mergeRuleSets(a: AdblockRuleSetInput, b: AdblockRuleSetInput): AdblockRuleSetInput {
  return {
    blockedDomains: [...a.blockedDomains, ...b.blockedDomains],
    blockedHostnames: [...a.blockedHostnames, ...b.blockedHostnames],
    urlContains: [...a.urlContains, ...b.urlContains],
  };
}

function isHostInSet(host: string, set: Set<string>): boolean {
  if (set.has(host)) return true;
  // suffix match: a.b.c matches b.c and c
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join('.');
    if (set.has(suffix)) return true;
  }
  return false;
}

