import { ipcMain, shell, type WebContents } from 'electron';
import type { UpdateCheckService, UpdateInfo } from '../updates/UpdateCheckService';

/** Only ever hand http(s) GitHub URLs to the OS. */
function isSafeReleaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.endsWith('github.com');
  } catch {
    return false;
  }
}

/**
 * PHASE 6 update-notification IPC. Notify-only: exposes a manual check, an
 * "open release page" action, and pushes `updates:available` once on startup
 * when a newer release exists. No downloads, no auto-install.
 */
export function registerUpdatesIpc(getService: () => UpdateCheckService | null): void {
  ipcMain.handle('updates:check', async (): Promise<UpdateInfo | null> => {
    return (await getService()?.check()) ?? null;
  });

  ipcMain.handle('updates:openReleasePage', (_e, payload: unknown) => {
    const data = payload as { url?: unknown } | null;
    const url = typeof data?.url === 'string' ? data.url : getService()?.releasesPageUrl() ?? '';
    if (url && isSafeReleaseUrl(url)) {
      void shell.openExternal(url);
      return true;
    }
    return false;
  });
}

/**
 * Run the one-shot startup check (best-effort) and push the result to the chrome
 * renderer if a newer version is available. Called after the window is ready.
 */
export function runStartupUpdateCheck(
  service: UpdateCheckService,
  getChrome: () => WebContents | null,
): void {
  void service.check().then((info) => {
    if (!info.available) return;
    const wc = getChrome();
    if (wc && !wc.isDestroyed()) {
      wc.send('updates:available', info);
    }
  });
}
