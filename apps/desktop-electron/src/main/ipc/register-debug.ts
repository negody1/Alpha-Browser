import { ipcMain } from 'electron';
import type { AdblockService } from '../adblock/AdblockService';
import type { TabManager } from '../tabs/TabManager';
import { getNavLog, clearNavLog } from '../debug/navDebug';

/**
 * IPC for the in-app debug overlay: navigation trace (find the handler that opens
 * a bad target) and adblock cosmetic/network status — all copyable by the user
 * without a terminal.
 */
export function registerDebugIpc(
  getAdblock: () => AdblockService | null,
  getTabs: () => TabManager | null,
): void {
  ipcMain.handle('alpha:debug:navLog', () => getNavLog());
  ipcMain.handle('alpha:debug:navClear', () => {
    clearNavLog();
    return true;
  });
  ipcMain.handle('alpha:debug:adblockStatus', (_e, payload: unknown) => {
    const url = payload && typeof payload === 'object' && typeof (payload as { url?: unknown }).url === 'string'
      ? (payload as { url: string }).url
      : undefined;
    return getAdblock()?.getDebugStatus(url) ?? null;
  });
  // While the panel is open, hide the active page view so the shell-DOM overlay
  // is visible above the native guest WebContentsView.
  ipcMain.handle('alpha:debug:setOverlayOpen', (_e, payload: unknown) => {
    const open = !!(payload && typeof payload === 'object' && (payload as { open?: unknown }).open);
    getTabs()?.setActiveViewVisible(!open);
    return true;
  });
}
