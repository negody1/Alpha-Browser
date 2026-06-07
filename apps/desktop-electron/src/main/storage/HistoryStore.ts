import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { HistoryEntry, RouteMode } from '@alpha/shared-types';
import { sanitizeHistoryUrl, shouldDedupeVisit } from '@alpha/core-history';
import type { HistoryUrlStatStore } from './HistoryUrlStatStore';

interface HistoryData {
  version: 1;
  entries: HistoryEntry[];
}

export class HistoryStore {
  private readonly store = new Store<HistoryData>({
    clearInvalidConfig: true,
    name: 'history',
    defaults: {
      version: 1,
      entries: [],
    },
  });

  /** Separate per-URL aggregate updated in lock-step with the journal. */
  constructor(private readonly urlStats: HistoryUrlStatStore | null = null) {}

  list(): HistoryEntry[] {
    return [...this.store.get('entries')];
  }

  recordVisit(input: {
    url: string;
    title: string;
    favicon?: string | null;
    routeMode: RouteMode;
    /** True when the navigation originated from a typed address-bar entry. */
    typed?: boolean;
  }): HistoryEntry | null {
    const url = sanitizeHistoryUrl(input.url);
    if (!url) return null;

    // Fold into the per-URL aggregate (frecency inputs) regardless of journal
    // dedupe; the aggregate counts every recorded visit.
    this.urlStats?.recordVisit({
      url: input.url,
      title: input.title,
      favicon: input.favicon,
      typed: input.typed,
    });

    const now = new Date().toISOString();
    const entries = this.list();
    const prev = entries[0];
    if (prev && shouldDedupeVisit(prev, url)) {
      const updated: HistoryEntry = {
        ...prev,
        title: input.title?.trim() || prev.title,
        favicon: input.favicon ?? prev.favicon ?? null,
        visitedAt: now,
        routeMode: input.routeMode,
      };
      entries[0] = updated;
      this.store.set('entries', entries);
      return updated;
    }

    const entry: HistoryEntry = {
      id: randomUUID(),
      url,
      title: input.title?.trim() || url,
      favicon: input.favicon ?? null,
      visitedAt: now,
      routeMode: input.routeMode,
    };
    entries.unshift(entry);
    // keep bounded
    if (entries.length > 5000) entries.length = 5000;
    this.store.set('entries', entries);
    return entry;
  }

  delete(id: string): boolean {
    const entries = this.list();
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) return false;
    this.store.set('entries', next);
    return true;
  }

  clear(): void {
    this.store.set('entries', []);
  }
}

