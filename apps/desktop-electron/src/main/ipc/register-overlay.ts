import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { OverlayPanelKind, OverlayWindowManager } from '../shell/OverlayWindowManager';
import {
  groupContextMenuPayload,
  routeMenuPayload,
  tabContextMenuPayload,
} from './schemas-shell';

function parsePayload<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

const panelKinds = new Set<string>([
  'groups-panel',
  'bookmarks-panel',
  'history-panel',
  'routing-panel',
  'downloads-panel',
]);

export function registerOverlayIpc(getOverlay: () => OverlayWindowManager | null): void {
  ipcMain.handle('overlay:openPanel', (_event, payload: unknown) => {
    const kind = (payload as { kind?: string })?.kind;
    if (!kind || !panelKinds.has(kind)) return;
    getOverlay()?.openPanel(kind as OverlayPanelKind);
  });

  ipcMain.handle('overlay:togglePanel', (_event, payload: unknown) => {
    const kind = (payload as { kind?: string })?.kind;
    if (!kind || !panelKinds.has(kind)) return;
    getOverlay()?.togglePanel(kind as OverlayPanelKind);
  });

  ipcMain.handle('overlay:closePanel', () => {
    getOverlay()?.closePanel();
  });

  ipcMain.handle('overlay:closePopup', () => {
    getOverlay()?.closePopup();
  });

  ipcMain.handle('overlay:confirmCloseGroup', (_event, payload: unknown) => {
    const groupId = (payload as { groupId?: string })?.groupId;
    if (!groupId) return;
    getOverlay()?.confirmCloseGroup(groupId);
  });

  // Omnibox overlay (P2-C.2 Variant A). The toolbar (address input keeps focus)
  // drives content; the overlay window is display + mouse only and never hides
  // the page WebContentsView.
  ipcMain.handle('omnibox:overlaySync', (_event, payload: unknown) => {
    const data = payload as
      | { suggestions?: unknown; selectedIndex?: unknown; anchor?: { x?: unknown; y?: unknown; width?: unknown } }
      | null;
    const overlay = getOverlay();
    if (!data || !overlay) return;
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const selectedIndex = typeof data.selectedIndex === 'number' ? data.selectedIndex : -1;
    const a = data.anchor ?? {};
    const anchor = {
      x: typeof a.x === 'number' ? a.x : 0,
      y: typeof a.y === 'number' ? a.y : 0,
      width: typeof a.width === 'number' ? a.width : 0,
    };
    void overlay.syncOmnibox({ suggestions, selectedIndex }, anchor);
  });

  ipcMain.handle('omnibox:overlayHide', () => {
    getOverlay()?.hideOmnibox();
  });

  ipcMain.handle('omnibox:overlayPick', (_event, payload: unknown) => {
    const index = (payload as { index?: unknown })?.index;
    if (typeof index !== 'number') return;
    getOverlay()?.forwardOmniboxPick(index);
  });

  ipcMain.handle('omnibox:overlayHover', (_event, payload: unknown) => {
    const index = (payload as { index?: unknown })?.index;
    if (typeof index !== 'number') return;
    getOverlay()?.forwardOmniboxHover(index);
  });
}

export function registerShellOverlayHandlers(
  getOverlay: () => OverlayWindowManager | null,
): void {
  ipcMain.handle('shell:showTabContextMenu', (_event, payload: unknown) => {
    const data = parsePayload(tabContextMenuPayload, payload);
    if (!data) return;
    getOverlay()?.openTabMenu(data.tabId, data.x, data.y);
  });

  ipcMain.handle('shell:showGroupContextMenu', (_event, payload: unknown) => {
    const data = parsePayload(groupContextMenuPayload, payload);
    if (!data) return;
    getOverlay()?.openGroupMenu(data.groupId, data.x, data.y);
  });

  ipcMain.handle('shell:showRouteMenu', (_event, payload: unknown) => {
    const data = parsePayload(routeMenuPayload, payload);
    if (!data) return;
    console.log('[alpha][overlay-ipc] openPopup', { kind: 'route-popup', x: data.x, y: data.y });
    getOverlay()?.openRoutePopup(data.x, data.y);
  });

  ipcMain.handle('shell:showAdblockMenu', (_event, payload: unknown) => {
    const data = parsePayload(routeMenuPayload, payload);
    if (!data) return;
    console.log('[alpha][overlay-ipc] openPopup', { kind: 'adblock-popup', x: data.x, y: data.y });
    getOverlay()?.openAdblockPopup(data.x, data.y);
  });
}


export function registerShellRenameIpc(getManager: () => import('../tabs/TabManager').TabManager | null): void {
  ipcMain.handle('shell:requestGroupRename', (_event, payload: unknown) => {
    const groupId = (payload as { groupId?: string })?.groupId;
    const manager = getManager();
    const parent = manager?.getBrowserWindow();
    if (!groupId || !parent || parent.webContents.isDestroyed()) return;
    parent.webContents.send('shell:start-group-rename', { groupId });
  });
}
