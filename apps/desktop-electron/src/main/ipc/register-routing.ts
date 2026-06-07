import { ipcMain } from 'electron';
import type { z } from 'zod';
import { normalizeDomain } from '@alpha/core-routing';
import type { TabManager } from '../tabs/TabManager';
import { emptyBrowserState } from './empty-state';
import {
  addRulePayload,
  domainPayload,
  reloadTabPayload,
  saveRouteRulePayload,
  setDefaultRoutePayload,
  setProxyEndpointPayload,
  setTemporaryOverridePayload,
} from './schemas-routing';

function parsePayload<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerRoutingIpc(getManager: () => TabManager | null): void {
  ipcMain.handle('routing:getState', () => getManager()?.getState() ?? null);

  // A3: canonical contract is the full RoutingStateSnapshot (BrowserStateSnapshot['routing']),
  // matching the preload type and what the routing overlay/settings UIs consume
  // ({ defaultRoute, proxyEndpoints, rules, ... }). Previously this returned only
  // the rules array, which broke the overlay routing panel's defaults.
  ipcMain.handle('routing:getRules', () => {
    return getManager()?.getState().routing ?? emptyBrowserState().routing;
  });

  ipcMain.handle('routing:setDefaultRoute', async (_event, payload: unknown) => {
    const data = parsePayload(setDefaultRoutePayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    manager.getRouting().setDefaultRoute(data.route);
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:setProxyEndpoint', async (_event, payload: unknown) => {
    const data = parsePayload(setProxyEndpointPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    try {
      manager.getRouting().setProxyEndpoint(data.endpoint);
      return manager.refreshRouting();
    } catch {
      return null;
    }
  });

  ipcMain.handle('routing:addRule', async (_event, payload: unknown) => {
    const data = parsePayload(addRulePayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    manager.getRouting().addRule(normalizeDomain(data.domain), data.route);
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:updateRule', async (_event, payload: unknown) => {
    const data = parsePayload(addRulePayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    manager.getRouting().updateRule(normalizeDomain(data.domain), data.route);
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:deleteRule', async (_event, payload: unknown) => {
    const data = parsePayload(domainPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    manager.getRouting().deleteRule(normalizeDomain(data.domain));
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:setTemporaryOverride', async (_event, payload: unknown) => {
    const data = parsePayload(setTemporaryOverridePayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    const domain = normalizeDomain(data.domain);
    manager.getRouting().setTemporaryOverride(domain, data.mode);
    manager.getRouting().setPendingReloadTabId(manager.getState().activeTabId);
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:clearTemporaryOverride', async (_event, payload: unknown) => {
    const data = parsePayload(domainPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    manager.getRouting().clearTemporaryOverride(normalizeDomain(data.domain));
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:saveCurrentRouteAsRule', async (_event, payload: unknown) => {
    const data = parsePayload(saveRouteRulePayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    manager.getRouting().saveCurrentRouteAsRule(normalizeDomain(data.domain), data.route);
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:reloadPac', async () => {
    const manager = getManager();
    if (!manager) {
      return null;
    }
    return manager.refreshRouting();
  });

  ipcMain.handle('routing:confirmReload', async (_event, payload: unknown) => {
    const data = parsePayload(reloadTabPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    const tab = manager.getState().tabs.find((t) => t.id === data.tabId);
    if (!tab?.domain) {
      return manager.getState();
    }
    return manager.applyRouteChangeAndReload(data.tabId, tab.domain);
  });

  ipcMain.handle('routing:dismissRemember', () => {
    const manager = getManager();
    if (!manager) {
      return null;
    }
    manager.getRouting().setPendingRemember(null);
    return manager.notifyState();
  });

  ipcMain.handle('routing:dismissReload', () => {
    const manager = getManager();
    if (!manager) {
      return null;
    }
    manager.getRouting().setPendingReloadTabId(null);
    return manager.notifyState();
  });

  ipcMain.handle('routing:openDirectFallback', async (_event, payload: unknown) => {
    const data = parsePayload(domainPayload, payload);
    const manager = getManager();
    if (!data || !manager) {
      return null;
    }
    const domain = normalizeDomain(data.domain);
    manager.getRouting().setTemporaryOverride(domain, 'DIRECT');
    await manager.getRouting().applyPac();
    const tabId = manager.getState().activeTabId;
    return manager.applyRouteChangeAndReload(tabId, domain);
  });
}
