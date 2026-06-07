import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DownloadItemSnapshot, DownloadStatus, RouteMode } from '@alpha/shared-types';

interface DownloadsData {
  version: 1;
  items: DownloadItemSnapshot[];
  downloadDir: string | null;
}

function defaultDir(): string {
  return app.getPath('downloads');
}

function sanitizeFilename(input: string): string {
  const base = basename(input || 'download');
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'download';
}

function uniquePath(dir: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  const ext = extname(safe);
  const name = ext ? safe.slice(0, -ext.length) : safe;
  let candidate = join(dir, safe);
  let n = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${name} (${n})${ext}`);
    n += 1;
    if (n > 999) break;
  }
  return candidate;
}

export class DownloadsStore {
  private readonly store = new Store<DownloadsData>({
    clearInvalidConfig: true,
    name: 'downloads',
    defaults: {
      version: 1,
      items: [],
      downloadDir: null,
    },
  });

  list(): DownloadItemSnapshot[] {
    return [...this.store.get('items')];
  }

  getDownloadDir(): string {
    return this.store.get('downloadDir') || defaultDir();
  }

  setDownloadDir(dir: string | null): void {
    this.store.set('downloadDir', dir);
  }

  create(payload: {
    url: string;
    filename: string;
    mimeType?: string | null;
    totalBytes?: number | null;
    routeMode?: RouteMode;
    domain?: string | null;
  }): DownloadItemSnapshot {
    const now = new Date().toISOString();
    const item: DownloadItemSnapshot = {
      id: randomUUID(),
      url: payload.url,
      filename: sanitizeFilename(payload.filename),
      startedAt: now,
      completedAt: null,
      mimeType: payload.mimeType ?? null,
      totalBytes: payload.totalBytes ?? null,
      receivedBytes: 0,
      progress: 0,
      status: 'pending',
      canResume: false,
      savePath: null,
      error: null,
      routeMode: payload.routeMode ?? 'AUTO',
      domain: payload.domain ?? null,
    };
    const items = this.list();
    items.unshift(item);
    if (items.length > 1000) items.length = 1000;
    this.store.set('items', items);
    return item;
  }

  update(id: string, patch: Partial<DownloadItemSnapshot>): DownloadItemSnapshot | null {
    const items = this.list();
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    items[idx] = { ...items[idx], ...patch };
    this.store.set('items', items);
    return items[idx];
  }

  remove(id: string): boolean {
    const items = this.list();
    const next = items.filter((x) => x.id !== id);
    if (next.length === items.length) return false;
    this.store.set('items', next);
    return true;
  }

  clearCompleted(): void {
    const items = this.list().filter((x) => x.status !== 'completed');
    this.store.set('items', items);
  }

  computeSavePath(filename: string): string {
    return uniquePath(this.getDownloadDir(), filename);
  }

  setStatus(id: string, status: DownloadStatus, lastError?: string | null) {
    const patch: Partial<DownloadItemSnapshot> = { status };
    if (lastError !== undefined) patch.error = lastError;
    return this.update(id, patch);
  }
}

