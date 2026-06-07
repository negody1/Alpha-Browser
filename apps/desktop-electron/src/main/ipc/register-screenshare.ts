import { ipcMain } from 'electron';
import type { ScreenShareService } from '../screenshare/ScreenShareService';

export function registerScreenShareIpc(getService: () => ScreenShareService | null): void {
  ipcMain.handle('screenshare:resolve', (_event, payload: unknown) => {
    const data = payload as { requestId?: unknown; sourceId?: unknown } | null;
    if (!data || typeof data.requestId !== 'string' || typeof data.sourceId !== 'string') return;
    getService()?.resolve(data.requestId, data.sourceId);
  });

  ipcMain.handle('screenshare:cancel', (_event, payload: unknown) => {
    const data = payload as { requestId?: unknown } | null;
    if (!data || typeof data.requestId !== 'string') return;
    getService()?.cancel(data.requestId);
  });
}
