import { ipcMain } from 'electron';
import type { TabManager } from '../tabs/TabManager';
import { chromeTopHeightPayload } from './schemas-shell';

function parseChromeTopHeight(value: unknown): { heightPx: number } | null {
  const result = chromeTopHeightPayload.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerShellIpc(getManager: () => TabManager | null): void {
  ipcMain.handle('shell:setChromeTopHeight', (_event, payload: unknown) => {
    const data = parseChromeTopHeight(payload);
    const manager = getManager();
    if (!data || !manager) return;
    manager.setChromeTopHeightPx(data.heightPx);
  });
}
