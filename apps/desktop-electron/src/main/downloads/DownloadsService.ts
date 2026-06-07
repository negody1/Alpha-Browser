import { dialog, shell, type DownloadItem, type Session, type WebContents } from 'electron';
import { normalizeDomain } from '@alpha/core-routing';
import type { RouteMode } from '@alpha/shared-types';
import { DownloadsStore } from '../storage/DownloadsStore';
import type { TabManager } from '../tabs/TabManager';

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.scr',
  '.jar',
]);

export class DownloadsService {
  private readonly items = new Map<string, DownloadItem>();
  /** Sessions whose will-download listener is already attached (idempotency). */
  private readonly registeredSessions = new Set<Session>();

  constructor(
    private readonly store: DownloadsStore,
    private readonly getTabs: () => TabManager | null,
    private readonly broadcastChanged: () => void,
  ) {}

  /**
   * Attach the will-download listener to each provided session (DIRECT +
   * PROXY). Idempotent: a session is wired at most once, so a download (which
   * belongs to exactly one session) fires a single event — no duplicates.
   */
  register(sessions: Session[]): void {
    for (const sess of sessions) {
      if (this.registeredSessions.has(sess)) continue;
      this.registeredSessions.add(sess);
      sess.on('will-download', (event, item, webContents) => {
        void this.onWillDownload(event, item, webContents);
      });
    }
  }

  list() {
    return this.store.list();
  }

  getDownloadDir(): string {
    return this.store.getDownloadDir();
  }

  async chooseDownloadDir(): Promise<string | null> {
    const res = await dialog.showOpenDialog({
      title: 'Выберите папку для загрузок',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    this.store.setDownloadDir(res.filePaths[0]);
    this.broadcastChanged();
    return res.filePaths[0];
  }

  removeEntry(id: string): boolean {
    const ok = this.store.remove(id);
    if (ok) this.broadcastChanged();
    return ok;
  }

  clearCompleted(): void {
    this.store.clearCompleted();
    this.broadcastChanged();
  }

  cancel(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    try {
      item.cancel();
      return true;
    } finally {
      this.store.setStatus(id, 'cancelled', null);
      this.broadcastChanged();
    }
  }

  resume(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    if (!item.canResume()) return false;
    try {
      item.resume();
      this.store.update(id, { status: 'downloading', error: null });
      this.broadcastChanged();
      return true;
    } catch {
      return false;
    }
  }

  retry(id: string): boolean {
    const snap = this.store.list().find((x) => x.id === id);
    if (!snap) return false;
    const tabs = this.getTabs();
    const tabId = tabs?.getState().activeTabId;
    if (!tabs || !tabId) return false;
    // start a new navigation to same URL; browser will download again if server responds with attachment.
    void tabs.navigateTab(tabId, snap.url, snap.url);
    return true;
  }

  async openFile(id: string): Promise<boolean> {
    const snap = this.store.list().find((x) => x.id === id);
    if (!snap?.savePath) return false;
    // main-only open. Renderer must show warning for dangerous extensions.
    const result = await shell.openPath(snap.savePath);
    return !result;
  }

  showInFolder(id: string): boolean {
    const snap = this.store.list().find((x) => x.id === id);
    if (!snap?.savePath) return false;
    shell.showItemInFolder(snap.savePath);
    return true;
  }

  isDangerousFilename(filename: string): boolean {
    const lower = filename.toLowerCase();
    for (const ext of DANGEROUS_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  private async onWillDownload(
    _event: Electron.Event,
    item: DownloadItem,
    webContents: WebContents,
  ): Promise<void> {
    const url = item.getURL();
    const filename = item.getFilename();
    const mimeType = item.getMimeType() || null;

    // Derive routing context from the active tab / webContents mapping when possible.
    const tabs = this.getTabs();
    const tabEntry = tabs?.findTabByWebContentsId(webContents.id);
    const pageUrl = tabEntry?.url ?? url;
    const resolved = tabs?.getRouting().resolveForUrl(pageUrl);
    const routeMode: RouteMode = resolved?.mode === 'ERROR' ? 'PROXY' : (resolved?.mode as RouteMode) ?? 'AUTO';
    const domain = normalizeDomain(pageUrl) || normalizeDomain(url);

    const snap = this.store.create({
      url,
      filename,
      mimeType,
      totalBytes: item.getTotalBytes() > 0 ? item.getTotalBytes() : null,
      routeMode,
      domain,
    });

    const savePath = this.store.computeSavePath(filename);
    item.setSavePath(savePath);
    this.store.update(snap.id, {
      savePath,
      status: 'downloading',
      canResume: item.canResume(),
    });

    this.items.set(snap.id, item);
    this.broadcastChanged();

    item.on('updated', () => {
      const received = item.getReceivedBytes();
      const total = item.getTotalBytes() > 0 ? item.getTotalBytes() : null;
      const progress = total ? Math.min(1, received / total) : 0;
      const paused = item.isPaused();
      this.store.update(snap.id, {
        receivedBytes: received,
        totalBytes: total,
        progress,
        status: paused ? 'paused' : 'downloading',
        canResume: item.canResume(),
      });
      this.broadcastChanged();
    });

    item.once('done', (_event, state) => {
      const completedAt = new Date().toISOString();
      const canResume = item.canResume();
      if (state === 'completed') {
        this.store.update(snap.id, { status: 'completed', completedAt, canResume: false, progress: 1 });
      } else if (state === 'cancelled') {
        this.store.update(snap.id, { status: 'cancelled', completedAt, canResume: false });
      } else if (state === 'interrupted') {
        this.store.update(snap.id, { status: 'interrupted', completedAt, canResume, error: 'Загрузка прервана' });
      } else {
        this.store.update(snap.id, { status: 'failed', completedAt, canResume: false, error: 'Ошибка загрузки' });
      }
      this.items.delete(snap.id);
      this.broadcastChanged();
    });
  }
}

