/** ZONE 1: route/proxy/adblock quick actions — native menu only (no React overlay). */
import { Menu, type BrowserWindow, type WebContents } from 'electron';
import { normalizeDomain } from '@alpha/core-routing';
import type { RouteMode } from '@alpha/shared-types';
import type { AdblockService } from '../adblock/AdblockService';
import type { TabManager } from '../tabs/TabManager';

function applyRouteMode(manager: TabManager, domain: string, mode: RouteMode): void {
  const routing = manager.getRouting();
  routing.setTemporaryOverride(normalizeDomain(domain), mode);
  routing.setPendingReloadTabId(manager.getState().activeTabId);
  void manager.refreshRouting();
}

export function showRouteNativeMenu(
  window: BrowserWindow,
  manager: TabManager,
  adblock: AdblockService | null,
  chromeWebContents: WebContents,
  x: number,
  y: number,
): void {
  const state = manager.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab?.domain) {
    return;
  }

  const domain = tab.domain;
  const current: RouteMode =
    tab.routeMode === 'ERROR' ? 'AUTO' : (tab.routeMode as RouteMode);
  const adblockState = adblock?.getState();
  const adblockOn = adblockState?.enabled ?? true;
  const siteDisabled = adblock?.isSiteDisabled(domain) ?? false;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Авто',
      type: 'radio',
      checked: current === 'AUTO',
      click: () => applyRouteMode(manager, domain, 'AUTO'),
    },
    {
      label: 'Напрямую',
      type: 'radio',
      checked: current === 'DIRECT',
      click: () => applyRouteMode(manager, domain, 'DIRECT'),
    },
    {
      label: 'Через прокси',
      type: 'radio',
      checked: current === 'PROXY',
      click: () => applyRouteMode(manager, domain, 'PROXY'),
    },
    { type: 'separator' },
    {
      label: 'Запомнить для сайта',
      click: () => {
        const route: RouteMode =
          tab.routeSource === 'fallback' || tab.routeMode === 'ERROR' ? 'PROXY' : current;
        manager.getRouting().saveCurrentRouteAsRule(normalizeDomain(domain), route);
        void manager.refreshRouting();
      },
    },
    { type: 'separator' },
    {
      label:
        adblockOn && !siteDisabled
          ? 'AdBlock: выкл. на этом сайте'
          : 'AdBlock: вкл. на этом сайте',
      enabled: !!adblock,
      click: () => {
        if (!adblock) return;
        adblock.setEnabled(true);
        adblock.toggleSite(domain, !siteDisabled);
      },
    },
    { type: 'separator' },
    {
      label: 'Настройки маршрутизации…',
      click: () => {
        chromeWebContents.send('shell:open-routing-settings');
      },
    },
  ];

  Menu.buildFromTemplate(template).popup({ window, x, y });
}
