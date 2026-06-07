import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { ShortcutsStore } from '../storage/ShortcutsStore';
import { shortcutReorderPayload, shortcutRemovePayload, shortcutUpsertPayload } from './schemas-shortcuts';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerShortcutsIpc(
  getStore: () => ShortcutsStore | null,
  broadcastChanged: () => void,
): void {
  ipcMain.handle('shortcuts:list', () => getStore()?.list() ?? []);

  ipcMain.handle('shortcuts:upsert', (_e, payload: unknown) => {
    const data = parsePayload(shortcutUpsertPayload, payload);
    const store = getStore();
    if (!data || !store) return null;
    const next = store.upsert(data);
    if (next) broadcastChanged();
    return next;
  });

  ipcMain.handle('shortcuts:remove', (_e, payload: unknown) => {
    const data = parsePayload(shortcutRemovePayload, payload);
    const store = getStore();
    if (!data || !store) return false;
    const ok = store.remove(data.id);
    if (ok) broadcastChanged();
    return ok;
  });

  ipcMain.handle('shortcuts:reorder', (_e, payload: unknown) => {
    const data = parsePayload(shortcutReorderPayload, payload);
    const store = getStore();
    if (!data || !store) return [];
    const next = store.reorder(data.ids);
    broadcastChanged();
    return next;
  });
}

