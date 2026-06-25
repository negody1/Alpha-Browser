import type {
  HistoryUrlStat,
  OmniboxSuggestion,
  ShortcutLink,
  TabSnapshot,
} from '@alpha/shared-types';
import { normalizeAggregateUrl } from '@alpha/core-history';
import { resolveNavigationUrl } from '../navigation';

export const OMNIBOX_DEFAULT_LIMIT = 8;
export const OMNIBOX_MAX_LIMIT = 20;

export interface OmniboxDeps {
  /** Per-URL frecency aggregate (HistoryUrlStatStore.list()). */
  getUrlStats: () => HistoryUrlStat[];
  /** Top-sites / quick links (ShortcutsStore.list()). */
  getShortcuts: () => ShortcutLink[];
  /** Currently open tabs (TabManager.getState().tabs). */
  getOpenTabs: () => TabSnapshot[];
}

/** Internal scored candidate before projection to OmniboxSuggestion. */
interface Candidate {
  kind: OmniboxSuggestion['kind'];
  title: string;
  url: string;
  host: string | null;
  favicon: string | null;
  tabId?: string;
  score: number;
  /** Host eligible for inline completion (prefix match), if any. */
  inlineHost?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function looksLikeUrlInput(input: string): boolean {
  if (input.includes(' ')) return false;
  if (/^https?:\/\//i.test(input)) return true;
  if (/^localhost(?::\d+)?(\/|$)/i.test(input)) return true;
  return /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(input);
}

function hostFromUrl(url: string): string | null {
  try {
    let host = new URL(url).hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

/** Skip internal / non-navigable URLs in suggestions. */
function isSuggestableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function recencyBoost(lastVisitAt: string): number {
  const ts = Date.parse(lastVisitAt);
  if (Number.isNaN(ts)) return 0;
  const ageDays = (Date.now() - ts) / DAY_MS;
  if (ageDays < 1) return 3;
  if (ageDays < 7) return 2;
  if (ageDays < 30) return 1;
  return 0;
}

/**
 * Match the input against a candidate's host/url/title and return a match boost,
 * or null when there is no match. Higher boost = stronger (more prefix-like)
 * match. Pure lexical matching — no network, no fuzzy/ML.
 */
function matchBoost(
  input: string,
  fields: { host: string | null; url: string; title: string },
): { boost: number; hostPrefix: boolean } | null {
  const q = input.toLowerCase();
  const host = (fields.host ?? '').toLowerCase();
  const url = fields.url.toLowerCase();
  const urlNoScheme = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const title = fields.title.toLowerCase();

  if (host && host.startsWith(q)) return { boost: 3, hostPrefix: true };
  if (urlNoScheme.startsWith(q) || url.startsWith(q)) return { boost: 2, hostPrefix: false };
  if (host && host.includes(q)) return { boost: 1.5, hostPrefix: false };
  if (urlNoScheme.includes(q) || title.includes(q)) return { boost: 1, hostPrefix: false };
  return null;
}

/**
 * UI-independent omnibox engine. Aggregates local-only sources and returns a
 * ranked list of suggestions. The same engine is intended to serve both the
 * Toolbar address bar and the NTP search (P2-C.2 / P2-C.3).
 */
export class OmniboxService {
  constructor(private readonly deps: OmniboxDeps) {}

  query(rawInput: string, limit = OMNIBOX_DEFAULT_LIMIT): OmniboxSuggestion[] {
    const input = rawInput.trim();
    const cap = Math.min(Math.max(1, Math.floor(limit) || OMNIBOX_DEFAULT_LIMIT), OMNIBOX_MAX_LIMIT);
    if (!input) return [];

    const seen = new Set<string>();
    const out: OmniboxSuggestion[] = [];

    // 1) Default action item — always first so Enter == "do what I typed".
    const def = this.buildDefault(input);
    if (def) {
      out.push(def);
      const key = this.dedupeKey(def.url);
      if (key) seen.add(key);
    }

    // 2) Gather + score matched candidates from local sources.
    const candidates: Candidate[] = [
      ...this.openTabCandidates(input),
      ...this.historyCandidates(input),
      ...this.shortcutCandidates(input),
    ];
    candidates.sort((a, b) => b.score - a.score);

    // 3) Dedupe (against default + each other) and project, honoring the cap.
    let inlineAssigned = false;
    for (const c of candidates) {
      if (out.length >= cap) break;
      const key = this.dedupeKey(c.url);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);

      const suggestion: OmniboxSuggestion = {
        kind: c.kind,
        title: c.title,
        url: c.url,
        host: c.host,
        favicon: c.favicon,
        score: c.score,
      };
      if (c.tabId) suggestion.tabId = c.tabId;

      // Inline completion: assign once, to the top host-prefix match only.
      if (!inlineAssigned && c.inlineHost && c.inlineHost.length > input.length) {
        const lowerInput = input.toLowerCase();
        if (c.inlineHost.toLowerCase().startsWith(lowerInput)) {
          suggestion.inlineCompletion = c.inlineHost.slice(input.length);
          inlineAssigned = true;
        }
      }

      out.push(suggestion);
    }

    return out;
  }

  private buildDefault(input: string): OmniboxSuggestion | null {
    const resolved = resolveNavigationUrl(input);
    if (!resolved) return null;
    const isUrl = looksLikeUrlInput(input);
    return {
      kind: isUrl ? 'url' : 'search',
      title: input,
      url: resolved,
      // For a search, carry the raw query so the activation resolver searches by
      // text rather than the pre-resolved url (which is what caused webhp).
      query: isUrl ? undefined : input,
      host: isUrl ? hostFromUrl(resolved) : null,
      favicon: null,
      score: Number.MAX_SAFE_INTEGER,
    };
  }

  private openTabCandidates(input: string): Candidate[] {
    const tabs = this.deps.getOpenTabs();
    const result: Candidate[] = [];
    for (const tab of tabs) {
      if (tab.kind !== 'web') continue;
      if (!isSuggestableUrl(tab.url)) continue;
      const host = tab.domain ?? hostFromUrl(tab.url);
      const m = matchBoost(input, { host, url: tab.url, title: tab.title });
      if (!m) continue;
      result.push({
        kind: 'open-tab',
        title: tab.title || host || tab.url,
        url: tab.url,
        host,
        favicon: tab.favicon,
        tabId: tab.id,
        // Open tabs float to the top of the suggestion list when matched.
        score: 100 + m.boost,
        inlineHost: m.hostPrefix ? host ?? undefined : undefined,
      });
    }
    return result;
  }

  private historyCandidates(input: string): Candidate[] {
    const stats = this.deps.getUrlStats();
    const result: Candidate[] = [];
    for (const s of stats) {
      if (s.isHidden) continue;
      if (!isSuggestableUrl(s.url)) continue;
      const m = matchBoost(input, { host: s.host, url: s.url, title: s.title });
      if (!m) continue;
      const frecency =
        2 * s.typedCount + Math.log2(s.visitCount + 1) + recencyBoost(s.lastVisitAt);
      const pinnedBoost = s.isPinned ? 2 : 0;
      result.push({
        kind: 'history',
        title: s.title || s.host || s.url,
        url: s.url,
        host: s.host || null,
        favicon: s.favicon,
        score: 10 + frecency + m.boost + pinnedBoost,
        inlineHost: m.hostPrefix ? s.host : undefined,
      });
    }
    return result;
  }

  private shortcutCandidates(input: string): Candidate[] {
    const shortcuts = this.deps.getShortcuts();
    const result: Candidate[] = [];
    for (const link of shortcuts) {
      if (!isSuggestableUrl(link.url)) continue;
      const host = hostFromUrl(link.url);
      const m = matchBoost(input, { host, url: link.url, title: link.title });
      if (!m) continue;
      result.push({
        kind: 'shortcut',
        title: link.title || host || link.url,
        url: link.url,
        host,
        favicon: link.iconUrl ?? null,
        // Curated top-sites: modest base so a frequent history hit can outrank.
        score: 8 + m.boost,
        inlineHost: m.hostPrefix ? host ?? undefined : undefined,
      });
    }
    return result;
  }

  /** Collapse trivially-different URLs so the same site is not suggested twice. */
  private dedupeKey(url: string): string | null {
    const norm = normalizeAggregateUrl(url);
    return norm?.url ?? null;
  }
}
