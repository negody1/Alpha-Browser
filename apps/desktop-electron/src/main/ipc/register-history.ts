import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { HistoryStore } from '../storage/HistoryStore';
import { historyIdPayload } from './schemas-history';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerHistoryIpc(
  getStore: () => HistoryStore | null,
  broadcast: (event: 'history:changed') => void,
): void {
  ipcMain.handle('history:list', () => getStore()?.list() ?? []);

  ipcMain.handle('history:delete', (_e, payload: unknown) => {
    const data = parsePayload(historyIdPayload, payload);
    const store = getStore();
    if (!data || !store) return false;
    const ok = store.delete(data.id);
    if (ok) broadcast('history:changed');
    return ok;
  });

  ipcMain.handle('history:clear', () => {
    const store = getStore();
    if (!store) return false;
    store.clear();
    broadcast('history:changed');
    return true;
  });
}

