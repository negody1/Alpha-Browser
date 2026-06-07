import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { DownloadsService } from '../downloads/DownloadsService';
import { downloadIdPayload } from './schemas-downloads';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerDownloadsIpc(getService: () => DownloadsService | null): void {
  ipcMain.handle('downloads:list', () => getService()?.list() ?? []);
  ipcMain.handle('downloads:getDownloadDir', () => getService()?.getDownloadDir() ?? null);
  ipcMain.handle('downloads:chooseDownloadDir', async () => (await getService()?.chooseDownloadDir()) ?? null);

  ipcMain.handle('downloads:cancel', (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    return getService()?.cancel(data.id) ?? false;
  });

  ipcMain.handle('downloads:resume', (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    return getService()?.resume(data.id) ?? false;
  });

  ipcMain.handle('downloads:retry', (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    return getService()?.retry(data.id) ?? false;
  });

  ipcMain.handle('downloads:remove', (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    return getService()?.removeEntry(data.id) ?? false;
  });

  ipcMain.handle('downloads:clearCompleted', () => {
    getService()?.clearCompleted();
    return true;
  });

  ipcMain.handle('downloads:openFile', async (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    return (await getService()?.openFile(data.id)) ?? false;
  });

  ipcMain.handle('downloads:showInFolder', (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    return getService()?.showInFolder(data.id) ?? false;
  });

  ipcMain.handle('downloads:isDangerous', (_e, payload: unknown) => {
    const data = parsePayload(downloadIdPayload, payload);
    if (!data) return false;
    const snap = getService()?.list().find((x) => x.id === data.id);
    if (!snap) return false;
    return getService()?.isDangerousFilename(snap.filename) ?? false;
  });
}

