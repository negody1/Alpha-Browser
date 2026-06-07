import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { BookmarksStore } from '../storage/BookmarksStore';
import {
  bookmarkIdPayload,
  bookmarkUpdatePayload,
  bookmarkUpsertPayload,
  folderCreatePayload,
  folderIdPayload,
  folderUpdatePayload,
} from './schemas-bookmarks';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerBookmarksIpc(
  getStore: () => BookmarksStore | null,
  broadcast: (event: 'bookmarks:changed') => void,
): void {
  ipcMain.handle('bookmarks:list', () => {
    const store = getStore();
    if (!store) return { bookmarks: [], folders: [] };
    return { bookmarks: store.listBookmarks(), folders: store.listFolders() };
  });

  ipcMain.handle('bookmarks:upsert', (_e, payload: unknown) => {
    const data = parsePayload(bookmarkUpsertPayload, payload);
    const store = getStore();
    if (!data || !store) return null;
    const b = store.upsertBookmark(data);
    broadcast('bookmarks:changed');
    return b;
  });

  ipcMain.handle('bookmarks:update', (_e, payload: unknown) => {
    const data = parsePayload(bookmarkUpdatePayload, payload);
    const store = getStore();
    if (!data || !store) return null;
    const b = store.updateBookmark(data.id, data);
    broadcast('bookmarks:changed');
    return b;
  });

  ipcMain.handle('bookmarks:delete', (_e, payload: unknown) => {
    const data = parsePayload(bookmarkIdPayload, payload);
    const store = getStore();
    if (!data || !store) return false;
    const ok = store.deleteBookmark(data.id);
    if (ok) broadcast('bookmarks:changed');
    return ok;
  });

  ipcMain.handle('bookmarks:folders:create', (_e, payload: unknown) => {
    const data = parsePayload(folderCreatePayload, payload);
    const store = getStore();
    if (!data || !store) return null;
    const folder = store.createFolder(data);
    broadcast('bookmarks:changed');
    return folder;
  });

  ipcMain.handle('bookmarks:folders:update', (_e, payload: unknown) => {
    const data = parsePayload(folderUpdatePayload, payload);
    const store = getStore();
    if (!data || !store) return null;
    const folder = store.updateFolder(data.id, data);
    broadcast('bookmarks:changed');
    return folder;
  });

  ipcMain.handle('bookmarks:folders:delete', (_e, payload: unknown) => {
    const data = parsePayload(folderIdPayload, payload);
    const store = getStore();
    if (!data || !store) return false;
    const ok = store.deleteFolder(data.id);
    if (ok) broadcast('bookmarks:changed');
    return ok;
  });
}

