import { ipcMain } from 'electron';
import type { z } from 'zod';
import { normalizeUrlList } from '@alpha/core-groups';
import { resolveNavigationUrl } from '../navigation';
import type { SavedGroupsStore } from '../storage/SavedGroupsStore';
import type { TabManager } from '../tabs/TabManager';
import {
  savedGroupCreatePayload,
  savedGroupIdPayload,
  savedGroupUpdatePayload,
  savedGroupUrlPayload,
  sessionGroupCreatePayload,
  sessionGroupIdPayload,
  sessionGroupColorPayload,
  sessionGroupRenamePayload,
  sessionGroupReorderTabsPayload,
  sessionGroupTabOnlyPayload,
  sessionGroupTabPayload,
} from './schemas-groups';

function parsePayload<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerGroupsIpc(
  getManager: () => TabManager | null,
  getStore: () => SavedGroupsStore | null,
): void {
  const notify = () => getManager()?.broadcastSavedGroups();

  ipcMain.handle('savedGroups:list', () => getStore()?.list() ?? []);

  ipcMain.handle('savedGroups:create', (_event, payload: unknown) => {
    const data = parsePayload(savedGroupCreatePayload, payload);
    const store = getStore();
    if (!data || !store) {
      return null;
    }
    const urls = data.urls
      ?.map((u) => resolveNavigationUrl(u))
      .filter((u): u is string => !!u);
    const group = store.create({ title: data.title, color: data.color, urls });
    notify();
    return group;
  });

  ipcMain.handle('savedGroups:update', (_event, payload: unknown) => {
    const data = parsePayload(savedGroupUpdatePayload, payload);
    const store = getStore();
    if (!data || !store) {
      return null;
    }
    const patch: { title?: string; color?: string; urls?: string[] } = {};
    if (data.title !== undefined) {
      patch.title = data.title;
    }
    if (data.color !== undefined) {
      patch.color = data.color;
    }
    if (data.urls !== undefined) {
      patch.urls = normalizeUrlList(
        data.urls.map((u) => resolveNavigationUrl(u)).filter((u): u is string => !!u),
      );
    }
    const updated = store.update(data.id, patch);
    notify();
    return updated;
  });

  ipcMain.handle('savedGroups:delete', (_event, payload: unknown) => {
    const data = parsePayload(savedGroupIdPayload, payload);
    const store = getStore();
    if (!data || !store) {
      return false;
    }
    const ok = store.delete(data.id);
    notify();
    return ok;
  });

  ipcMain.handle('savedGroups:addUrl', (_event, payload: unknown) => {
    const data = parsePayload(savedGroupUrlPayload, payload);
    const store = getStore();
    if (!data || !store) {
      return null;
    }
    const resolved = resolveNavigationUrl(data.url);
    if (!resolved) {
      return null;
    }
    const updated = store.addUrl(data.id, resolved);
    notify();
    return updated;
  });

  ipcMain.handle('savedGroups:removeUrl', (_event, payload: unknown) => {
    const data = parsePayload(savedGroupUrlPayload, payload);
    const store = getStore();
    if (!data || !store) {
      return null;
    }
    const resolved = resolveNavigationUrl(data.url);
    if (!resolved) {
      return null;
    }
    const updated = store.removeUrl(data.id, resolved);
    notify();
    return updated;
  });

  ipcMain.handle('savedGroups:open', (_event, payload: unknown) => {
    const data = parsePayload(savedGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.openSavedGroup(data.id);
  });

  ipcMain.handle('sessionGroups:create', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupCreatePayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.createSessionGroup(data);
  });

  ipcMain.handle('sessionGroups:createWithNewTab', () => {
    return getManager()?.createSessionGroupWithNewTab();
  });

  ipcMain.handle('sessionGroups:rename', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupRenamePayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.renameSessionGroup(data.groupId, data.title);
  });

  ipcMain.handle('sessionGroups:setColor', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupColorPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.setSessionGroupColor(data.groupId, data.color);
  });

  ipcMain.handle('sessionGroups:toggleCollapsed', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.toggleSessionGroupCollapsed(data.groupId);
  });

  ipcMain.handle('sessionGroups:addTab', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupTabPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.addTabToSessionGroup(data.groupId, data.tabId);
  });

  ipcMain.handle('sessionGroups:reorderTabs', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupReorderTabsPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.reorderSessionGroupTabs(data.groupId, data.tabIds);
  });

  ipcMain.handle('sessionGroups:removeTab', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupTabOnlyPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.removeTabFromSessionGroup(data.tabId);
  });

  ipcMain.handle('sessionGroups:ungroup', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.ungroupSessionGroup(data.groupId);
  });

  ipcMain.handle('sessionGroups:closeGroup', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.closeSessionGroup(data.groupId);
  });

  ipcMain.handle('sessionGroups:open', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.openSessionGroup(data.groupId);
  });

  ipcMain.handle('sessionGroups:delete', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.deleteSessionGroup(data.groupId);
  });

  ipcMain.handle('sessionGroups:saveAsWorkspace', (_event, payload: unknown) => {
    const data = parsePayload(sessionGroupIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.saveSessionGroupAsWorkspace(data.groupId);
  });
}
