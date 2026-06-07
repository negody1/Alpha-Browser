import { app } from 'electron';
import { join } from 'node:path';
import type { HistoryEntry, HistoryUrlStat } from '@alpha/shared-types';
import { normalizeAggregateUrl } from '@alpha/core-history';
import { loadJsonFile, saveJsonFile } from './atomic-json';

const SCHEMA_VERSION = 1 as const;
/** Soft cap; least-relevant rows are pruned beyond this. */
const MAX_STATS = 10_000;

interface HistoryUrlStatData {
  schemaVersion: typeof SCHEMA_VERSION;
  /** One-time backfill from the chronological journal has completed. */
  migratedFromJournal: boolean;
  /** Keyed by canonical normalized URL. */
  stats: Record<string, HistoryUrlStat>;
}

function emptyData(): HistoryUrlStatData {
  return { schemaVersion: SCHEMA_VERSION, migratedFromJournal: false, stats: {} };
}

function normalize(raw: unknown): HistoryUrlStatData {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawStats = (obj.stats && typeof obj.stats === 'object' ? obj.stats : {}) as Record<string, unknown>;
  const stats: Record<string, HistoryUrlStat> = {};
  for (const [key, value] of Object.entries(rawStats)) {
    const e = value as Record<string, unknown>;
    if (!e || typeof e.url !== 'string') continue;
    const lastVisitAt = typeof e.lastVisitAt === 'string' ? e.lastVisitAt : new Date().toISOString();
    stats[key] = {
      url: String(e.url),
      host: typeof e.host === 'string' ? e.host : '',
      title: typeof e.title === 'string' ? e.title : String(e.url),
      favicon: typeof e.favicon === 'string' ? e.favicon : null,
      visitCount: Number.isFinite(e.visitCount) ? Number(e.visitCount) : 1,
      typedCount: Number.isFinite(e.typedCount) ? Number(e.typedCount) : 0,
      firstVisitAt: typeof e.firstVisitAt === 'string' ? e.firstVisitAt : lastVisitAt,
      lastVisitAt,
      isPinned: e.isPinned === true,
      isHidden: e.isHidden === true,
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    migratedFromJournal: obj.migratedFromJournal === true,
    stats,
  };
}

/**
 * Separate aggregate store for per-URL visit statistics (frecency inputs).
 * Crash-safe via atomic write + `.bak` + `.corrupt` quarantine.
 */
export class HistoryUrlStatStore {
  private readonly filePath = join(app.getPath('userData'), 'history-url-stats.json');
  private data: HistoryUrlStatData;

  constructor() {
    const res = loadJsonFile<unknown>(this.filePath, emptyData());
    this.data = normalize(res.data);
  }

  list(): HistoryUrlStat[] {
    return Object.values(this.data.stats);
  }

  get(url: string): HistoryUrlStat | null {
    const key = normalizeAggregateUrl(url);
    if (!key) return null;
    return this.data.stats[key.url] ?? null;
  }

  /** Incrementally fold a single visit into the aggregate. */
  recordVisit(input: {
    url: string;
    title?: string | null;
    favicon?: string | null;
    typed?: boolean;
    visitedAt?: string;
  }): void {
    const key = normalizeAggregateUrl(input.url);
    if (!key) return;
    const now = input.visitedAt ?? new Date().toISOString();
    const title = input.title?.trim();
    const existing = this.data.stats[key.url];
    if (existing) {
      existing.visitCount += 1;
      if (input.typed) existing.typedCount += 1;
      if (title) existing.title = title;
      if (input.favicon) existing.favicon = input.favicon;
      if (now > existing.lastVisitAt) existing.lastVisitAt = now;
      if (now < existing.firstVisitAt) existing.firstVisitAt = now;
    } else {
      this.data.stats[key.url] = {
        url: key.url,
        host: key.host,
        title: title || key.url,
        favicon: input.favicon ?? null,
        visitCount: 1,
        typedCount: input.typed ? 1 : 0,
        firstVisitAt: now,
        lastVisitAt: now,
        isPinned: false,
        isHidden: false,
      };
    }
    this.prune();
    this.flush();
  }

  setPinned(url: string, pinned: boolean): boolean {
    const key = normalizeAggregateUrl(url);
    const stat = key ? this.data.stats[key.url] : undefined;
    if (!stat) return false;
    stat.isPinned = pinned;
    this.flush();
    return true;
  }

  setHidden(url: string, hidden: boolean): boolean {
    const key = normalizeAggregateUrl(url);
    const stat = key ? this.data.stats[key.url] : undefined;
    if (!stat) return false;
    stat.isHidden = hidden;
    this.flush();
    return true;
  }

  delete(url: string): boolean {
    const key = normalizeAggregateUrl(url);
    if (!key || !this.data.stats[key.url]) return false;
    delete this.data.stats[key.url];
    this.flush();
    return true;
  }

  clear(): void {
    this.data.stats = {};
    this.flush();
  }

  /**
   * One-time backfill from the chronological history journal. Safe to call on
   * every startup — it is a no-op once `migratedFromJournal` is set. Pinned/
   * hidden flags default to false for backfilled rows; typedCount is unknown
   * for historical visits and is left at 0.
   */
  migrateFromJournalOnce(getEntries: () => HistoryEntry[]): boolean {
    if (this.data.migratedFromJournal) return false;
    const entries = getEntries();
    for (const entry of entries) {
      const key = normalizeAggregateUrl(entry.url);
      if (!key) continue;
      const visitedAt = entry.visitedAt;
      const title = entry.title?.trim();
      const existing = this.data.stats[key.url];
      if (existing) {
        existing.visitCount += 1;
        if (visitedAt > existing.lastVisitAt) {
          existing.lastVisitAt = visitedAt;
          if (title) existing.title = title;
          if (entry.favicon) existing.favicon = entry.favicon;
        }
        if (visitedAt < existing.firstVisitAt) existing.firstVisitAt = visitedAt;
      } else {
        this.data.stats[key.url] = {
          url: key.url,
          host: key.host,
          title: title || key.url,
          favicon: entry.favicon ?? null,
          visitCount: 1,
          typedCount: 0,
          firstVisitAt: visitedAt,
          lastVisitAt: visitedAt,
          isPinned: false,
          isHidden: false,
        };
      }
    }
    this.data.migratedFromJournal = true;
    this.prune();
    this.flush();
    return true;
  }

  /** Drop the least-relevant rows when above the soft cap (keeps pinned). */
  private prune(): void {
    const keys = Object.keys(this.data.stats);
    if (keys.length <= MAX_STATS) return;
    const sorted = keys
      .map((k) => this.data.stats[k])
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        if (a.visitCount !== b.visitCount) return b.visitCount - a.visitCount;
        return Date.parse(b.lastVisitAt) - Date.parse(a.lastVisitAt);
      });
    const next: Record<string, HistoryUrlStat> = {};
    for (const stat of sorted.slice(0, MAX_STATS)) {
      next[stat.url] = stat;
    }
    this.data.stats = next;
  }

  private flush(): void {
    saveJsonFile(this.filePath, this.data);
  }
}
