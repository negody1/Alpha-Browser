import { ipcMain } from 'electron';
import type { SessionRegistry } from '../sessions/SessionRegistry';
import type { TabManager } from '../tabs/TabManager';

/** Result of a PROXY identity reset (see SessionRegistry.resetProxyIdentity). */
export interface ResetProxyIdentityResult {
  ok: boolean;
  /** Number of open PROXY tabs that were reloaded after the reset. */
  reloadedTabs: number;
  error?: string;
}

/**
 * P4.7 Privacy IPC. Exposes the PROXY-only identity reset. The handler clears
 * the persist:alpha-proxy session storage/cache via SessionRegistry (DIRECT is
 * never touched) and then reloads open PROXY tabs via TabManager.
 */
export function registerPrivacyIpc(
  getSessions: () => SessionRegistry | null,
  getManager: () => TabManager | null,
): void {
  ipcMain.handle('privacy:resetProxyIdentity', async (): Promise<ResetProxyIdentityResult> => {
    const sessions = getSessions();
    if (!sessions) {
      return { ok: false, reloadedTabs: 0, error: 'SESSIONS_UNAVAILABLE' };
    }
    try {
      await sessions.resetProxyIdentity();
      const reloadedTabs = getManager()?.reloadProxyTabs() ?? 0;
      return { ok: true, reloadedTabs };
    } catch (e) {
      return { ok: false, reloadedTabs: 0, error: String(e) };
    }
  });
}
