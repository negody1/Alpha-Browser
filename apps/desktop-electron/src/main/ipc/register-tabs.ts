import { app, ipcMain } from 'electron';
import type { z } from 'zod';
import type { TabManager } from '../tabs/TabManager';
import { resolveNavigationUrl } from '../navigation';
import { navMark, navLog } from '../nav-timings';
import {
  createTabPayload,
  navigateTabPayload,
  optionalTabIdPayload,
  resolveUrlPayload,
  tabIdPayload,
  tabOrderPayload,
  tabDuplicatePayload,
  tabSetRoutePayload,
  tabSetMutedPayload,
} from './schemas';
import { emptyBrowserState } from './empty-state';

function parsePayload<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerTabsIpc(getManager: () => TabManager | null): void {
  ipcMain.handle('tabs:getState', () =>
    getManager()?.getState() ?? emptyBrowserState(),
  );

  ipcMain.handle('tabs:create', (_event, payload: unknown) => {
    const data = parsePayload(createTabPayload, payload);
    const manager = getManager();
    if (!manager) {
      return emptyBrowserState();
    }
    const url = data?.url ? resolveNavigationUrl(data.url) : undefined;
    return manager.createTab(url || undefined);
  });

  ipcMain.handle('tabs:close', (_event, payload: unknown) => {
    const data = parsePayload(tabIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.closeTab(data.tabId);
  });

  ipcMain.handle('tabs:switch', (_event, payload: unknown) => {
    const data = parsePayload(tabIdPayload, payload);
    if (!data) {
      return getManager()?.getState();
    }
    return getManager()?.switchTab(data.tabId);
  });

  ipcMain.handle('tabs:navigate', (_event, payload: unknown) => {
    const data = parsePayload(navigateTabPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return manager?.getState();
    }
    navMark(data.tabId);
    navLog(data.tabId, 'ipc:navigate-received', { input: data.input });
    const resolved = resolveNavigationUrl(data.input);
    if (!resolved) {
      return manager.getState();
    }
    navLog(data.tabId, 'ipc:url-resolved', { resolved });
    return manager.navigateTab(data.tabId, data.input, resolved);
  });

  ipcMain.handle('tabs:goBack', (_event, payload: unknown) => {
    const data = parsePayload(optionalTabIdPayload, payload);
    return getManager()?.goBack(data?.tabId) ?? emptyBrowserState();
  });

  ipcMain.handle('tabs:goForward', (_event, payload: unknown) => {
    const data = parsePayload(optionalTabIdPayload, payload);
    return getManager()?.goForward(data?.tabId) ?? emptyBrowserState();
  });

  ipcMain.handle('tabs:reload', (_event, payload: unknown) => {
    const data = parsePayload(optionalTabIdPayload, payload);
    return getManager()?.reload(data?.tabId) ?? emptyBrowserState();
  });

  ipcMain.handle('tabs:stop', (_event, payload: unknown) => {
    const data = parsePayload(optionalTabIdPayload, payload);
    return getManager()?.stop(data?.tabId) ?? emptyBrowserState();
  });

  ipcMain.handle('tabs:reorder', (_event, payload: unknown) => {
    const data = parsePayload(tabOrderPayload, payload);
    const manager = getManager();
    if (!data || !manager) return manager?.getState();
    return manager.reorderTabs(data.tabIds);
  });

  ipcMain.handle('tabs:duplicate', (_event, payload: unknown) => {
    const data = parsePayload(tabDuplicatePayload, payload);
    const manager = getManager();
    if (!data || !manager) return manager?.getState();
    return manager.duplicateTab(data.tabId, data.preserveGroup);
  });

  ipcMain.handle('tabs:openSettings', () =>
    getManager()?.openSettings() ?? emptyBrowserState(),
  );

  ipcMain.handle('tabs:setRoute', (_event, payload: unknown) => {
    const data = parsePayload(tabSetRoutePayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return manager?.getState() ?? emptyBrowserState();
    }
    return manager.setTabRoute(data.tabId, data.routeClass);
  });

  ipcMain.handle('tabs:setMuted', (_event, payload: unknown) => {
    const data = parsePayload(tabSetMutedPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return manager?.getState() ?? emptyBrowserState();
    }
    return manager.setTabMuted(data.tabId, data.muted);
  });

  ipcMain.handle('alpha:navigate:resolve', (_event, payload: unknown) => {
    const data = parsePayload(resolveUrlPayload, payload);
    if (!data) {
      return '';
    }
    return resolveNavigationUrl(data.input);
  });

  ipcMain.handle('alpha:app:getVersion', () => app.getVersion());
}
