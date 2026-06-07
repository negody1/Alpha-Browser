import { BrowserWindow, dialog } from 'electron';
import { CHROME_LAYOUT, chromeBaselineTopHeightPx, getWebContentBounds } from '@alpha/shared-types';
import type { AdblockService } from '../adblock/AdblockService';
import type { TabManager } from '../tabs/TabManager';
import { resolveOverlayPageUrl, verifyOverlayPageUrl } from './overlay-url';

export type OverlayPanelKind =
  | 'groups-panel'
  | 'bookmarks-panel'
  | 'history-panel'
  | 'routing-panel'
  | 'downloads-panel';
export type OverlayPopupKind =
  | 'route-popup'
  | 'adblock-popup'
  | 'tab-menu'
  | 'group-menu'
  | 'omnibox-popup'
  | 'permission-popup'
  | 'screenshare-popup';
export type OverlayKind = OverlayPanelKind | OverlayPopupKind;
export type OverlayPanelPlacement = 'left' | 'right';

/** Anchor rect (renderer client px, relative to the shell content area). */
export interface OmniboxAnchor {
  x: number;
  y: number;
  width: number;
}

/** Geometry of the omnibox overlay (kept in sync with the renderer CSS). */
const OMNIBOX_GUTTER_PX = 12;
const OMNIBOX_ROW_PX = 44;
const OMNIBOX_LIST_VPAD_PX = 12;
const OMNIBOX_MAX_LIST_PX = 440;
const OMNIBOX_GAP_PX = 6;

const OVERLAY_PANEL_WIDTH = CHROME_LAYOUT.sidePanelWidth;
const DOWNLOADS_PANEL_WIDTH = CHROME_LAYOUT.downloadsPanelWidth;

/** Min gap between a popup and the window content edges when clamping. */
const POPUP_VIEWPORT_MARGIN_PX = 4;

const PANEL_PLACEMENT: Record<OverlayPanelKind, OverlayPanelPlacement> = {
  'groups-panel': 'left',
  'bookmarks-panel': 'left',
  'history-panel': 'left',
  'routing-panel': 'left',
  'downloads-panel': 'right',
};

const PANEL_WIDTH_PX: Record<OverlayPanelKind, number> = {
  'groups-panel': OVERLAY_PANEL_WIDTH,
  'bookmarks-panel': OVERLAY_PANEL_WIDTH,
  'history-panel': OVERLAY_PANEL_WIDTH,
  'routing-panel': OVERLAY_PANEL_WIDTH,
  'downloads-panel': DOWNLOADS_PANEL_WIDTH,
};

// Width/height include the 8px transparent shadow gutter (.overlay-popup-root padding).
const POPUP_SIZES: Record<OverlayPopupKind, { width: number; height: number }> = {
  'route-popup': { width: 296, height: 300 },
  'adblock-popup': { width: 296, height: 236 },
  'tab-menu': { width: 296, height: 200 },
  'group-menu': { width: 296, height: 256 },
  // Initial/fallback size only; the real bounds are computed per-sync.
  'omnibox-popup': { width: 480, height: 120 },
  // Width fixed; height computed per-prompt from the capability count.
  'permission-popup': { width: 340, height: 200 },
  // Large centered picker; internal grid scrolls.
  'screenshare-popup': { width: 640, height: 460 },
};

interface OverlayStateMessage {
  kind: OverlayKind;
  payload?: Record<string, unknown> | null;
  placement?: OverlayPanelPlacement;
}

export class OverlayWindowManager {
  private dockedWin: BrowserWindow | null = null;
  private dockedLoaded = false;
  private dockedVisible = false;
  private dockedKind: OverlayPanelKind | null = null;

  private popupWin: BrowserWindow | null = null;
  private popupLoaded = false;
  private popupShownAt = 0;
  private dockedShownAt = 0;

  // Omnibox dropdown (P2-C.2 Variant A): a dedicated, non-focusable child window
  // shown ABOVE the page WebContentsView. The address input keeps focus (window
  // is focusable:false), so typing/keyboard stay in the toolbar; this window is
  // display + mouse only. The web view is NEVER hidden.
  private omniboxWin: BrowserWindow | null = null;
  private omniboxLoaded = false;
  private omniboxVisible = false;

  // Permission prompt (P3-A): reuses the shared popup window. When a prompt is
  // shown, this holds the pending requestId so a dismiss (blur/Esc/replaced)
  // can be reported back to the PermissionService as "no choice".
  private pendingPermissionId: string | null = null;
  private onPermissionDismiss: ((requestId: string) => void) | null = null;

  // Screen-share picker (P3-C): same shared-popup reuse + dismiss plumbing as the
  // permission prompt; only one of the two is ever pending at a time.
  private pendingScreenShareId: string | null = null;
  private onScreenShareDismiss: ((requestId: string) => void) | null = null;

  // M1: once destroyAll() begins, no overlay window may be (re)created. The
  // dismiss callbacks fired during teardown can synchronously re-enter
  // openPopup() (PermissionService.dismiss → showNext → openPermissionPrompt),
  // which would otherwise resurrect a popup window after it was destroyed and
  // leak an orphaned OS window. This latch makes every create path a no-op.
  private shuttingDown = false;

  constructor(
    private readonly getManager: () => TabManager | null,
    private readonly getAdblock: () => AdblockService | null,
    private readonly preloadPath: string,
  ) {}

  attachToParent(window: BrowserWindow): void {
    const reposition = () => this.repositionDocked();
    window.on('resize', reposition);
    window.on('move', reposition);
    window.on('closed', () => this.destroyAll());

    window.on('focus', () => {
      setTimeout(() => this.maybeCloseDockedOnParentFocus(), 120);
    });

    window.on('blur', () => {
      setTimeout(() => {
        if (!this.dockedVisible) return;
        if (Date.now() - this.dockedShownAt < 150) return;
        const docked = this.dockedWin;
        if (docked && !docked.isDestroyed() && docked.isFocused()) return;
        const parent = this.getParent();
        if (!parent || parent.isDestroyed() || parent.isFocused()) return;
        this.closePanel();
      }, 120);
    });
  }

  warmup(): void {
    void this.ensureDockedLoaded();
    void this.ensurePopupLoaded();
  }

  togglePanel(kind: OverlayPanelKind): void {
    if (this.dockedVisible && this.dockedKind === kind) {
      this.closePanel();
      return;
    }
    void this.openPanel(kind);
  }

  async openPanel(kind: OverlayPanelKind): Promise<void> {
    const bounds = this.panelBounds(kind);
    if (!bounds) return;

    this.hidePopup();

    const win = await this.ensureDockedLoaded();
    if (!win) return;

    win.setBounds(bounds);
    this.sendState(win, {
      kind,
      payload: null,
      placement: PANEL_PLACEMENT[kind],
    });
    this.dockedKind = kind;
    this.dockedVisible = true;
    this.dockedShownAt = Date.now();
    win.show();
    win.focus();
    this.notifyOverlayState();
  }

  closePanel(): void {
    if (this.dockedWin && !this.dockedWin.isDestroyed()) {
      this.dockedWin.hide();
    }
    this.dockedVisible = false;
    this.dockedKind = null;
    this.notifyOverlayState();
  }

  openRoutePopup(clientX: number, clientY: number): void {
    const manager = this.getManager();
    if (!manager) return;
    const state = manager.getState();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    const domain = tab?.domain ?? null;
    // P2-A.3 Route Memory: surface the saved route class (if any) for this
    // domain so the popup can show "запомнено для сайта" and offer "forget".
    const remembered = domain ? manager.getRouting().getRememberedRouteClass(domain) : null;

    console.log('[alpha][overlay] openPopup request', {
      kind: 'route-popup',
      x: clientX,
      y: clientY,
      domain,
    });

    void this.openPopup('route-popup', clientX, clientY, {
      domain,
      hasDomain: !!domain,
      // P1: the popup checkmark reflects the per-tab routing intent (routeClass).
      current: tab?.routeClass ?? 'AUTO',
      routeSource: tab?.routeSource ?? 'default',
      remembered: remembered === 'PROXY' || remembered === 'DIRECT' ? remembered : null,
    });
  }

  openAdblockPopup(clientX: number, clientY: number): void {
    const manager = this.getManager();
    if (!manager) return;
    const adblock = this.getAdblock();
    const state = manager.getState();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    const domain = tab?.domain ?? null;

    console.log('[alpha][overlay] openPopup request', {
      kind: 'adblock-popup',
      x: clientX,
      y: clientY,
      domain,
    });

    const adblockState = adblock?.getState();
    void this.openPopup('adblock-popup', clientX, clientY, {
      domain,
      hasDomain: !!domain,
      adblockOn: adblockState?.enabled ?? true,
      siteDisabled: domain ? (adblock?.isSiteDisabled(domain) ?? false) : false,
      blockedOnTab: tab ? (adblockState?.blockedByTabId[tab.id] ?? 0) : 0,
      blockedTotal: adblockState?.blockedTotal ?? 0,
      hasAdblock: !!adblock,
    });
  }

  openTabMenu(tabId: string, clientX: number, clientY: number): void {
    const manager = this.getManager();
    if (!manager) return;
    const state = manager.getState();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const sessionGroups = state.sessionGroups;
    const inGroup = !!tab.sessionGroupId;
    const otherGroups = sessionGroups.filter((g) => g.id !== tab.sessionGroupId);

    void this.openPopup('tab-menu', clientX, clientY, {
      tabId,
      tabKind: tab.kind,
      inGroup,
      otherGroups: otherGroups.map((g) => ({ id: g.id, title: g.title, collapsed: g.collapsed })),
      hasGroups: sessionGroups.length > 0,
      groups: sessionGroups.map((g) => ({ id: g.id, title: g.title, collapsed: g.collapsed })),
    });
  }

  openGroupMenu(groupId: string, clientX: number, clientY: number): void {
    const manager = this.getManager();
    if (!manager) return;
    const state = manager.getState();
    const group = state.sessionGroups.find((g) => g.id === groupId);
    if (!group) return;

    void this.openPopup('group-menu', clientX, clientY, {
      groupId,
      collapsed: group.collapsed,
      tabCount: group.tabIds.length,
      groupColor: group.color,
    });
  }

  confirmCloseGroup(groupId: string): void {
    const parent = this.getParent();
    const manager = this.getManager();
    if (!parent || !manager) return;

    const group = manager.getState().sessionGroups.find((g) => g.id === groupId);
    if (!group || group.tabIds.length === 0) return;

    const result = dialog.showMessageBoxSync(parent, {
      type: 'warning',
      buttons: ['Отмена', 'Закрыть'],
      defaultId: 0,
      cancelId: 0,
      message: 'Закрыть группу и все вкладки внутри?',
    });
    if (result === 1) {
      manager.closeSessionGroup(groupId);
    }
  }

  closePopup(): void {
    this.hidePopup();
  }

  destroyAll(): void {
    // M1: latch first so any dismiss-triggered re-entry cannot recreate windows.
    this.shuttingDown = true;
    if (this.dockedWin && !this.dockedWin.isDestroyed()) {
      this.dockedWin.destroy();
    }
    if (this.popupWin && !this.popupWin.isDestroyed()) {
      this.popupWin.destroy();
    }
    if (this.omniboxWin && !this.omniboxWin.isDestroyed()) {
      this.omniboxWin.destroy();
    }
    if (this.pendingPermissionId) {
      const id = this.pendingPermissionId;
      this.pendingPermissionId = null;
      this.onPermissionDismiss?.(id);
    }
    if (this.pendingScreenShareId) {
      const id = this.pendingScreenShareId;
      this.pendingScreenShareId = null;
      this.onScreenShareDismiss?.(id);
    }
    this.dockedWin = null;
    this.popupWin = null;
    this.omniboxWin = null;
    this.dockedLoaded = false;
    this.popupLoaded = false;
    this.omniboxLoaded = false;
    this.dockedVisible = false;
    this.omniboxVisible = false;
    this.dockedKind = null;
  }

  // ── Omnibox overlay (P2-C.2 Variant A) ──────────────────────────────────────

  /**
   * Show/refresh the omnibox dropdown above the page. Called on every keystroke /
   * selection change from the toolbar. Never hides or resizes the WebContentsView.
   */
  async syncOmnibox(
    payload: { suggestions: unknown[]; selectedIndex: number },
    anchor: OmniboxAnchor,
  ): Promise<void> {
    const parent = this.getParent();
    if (!parent) return;

    const count = Array.isArray(payload.suggestions) ? payload.suggestions.length : 0;
    if (count === 0) {
      this.hideOmnibox();
      return;
    }

    const win = await this.ensureOmniboxLoaded();
    if (!win) return;

    const content = parent.getContentBounds();
    const listHeight = Math.min(
      OMNIBOX_MAX_LIST_PX,
      OMNIBOX_LIST_VPAD_PX + count * OMNIBOX_ROW_PX,
    );
    const width = Math.round(anchor.width) + OMNIBOX_GUTTER_PX * 2;
    const height = listHeight + OMNIBOX_GUTTER_PX * 2;
    const x = Math.round(content.x + anchor.x - OMNIBOX_GUTTER_PX);
    const y = Math.round(content.y + anchor.y + OMNIBOX_GAP_PX - OMNIBOX_GUTTER_PX);

    win.setBounds({ x, y, width, height });
    this.sendState(win, { kind: 'omnibox-popup', payload });

    if (!this.omniboxVisible) {
      // showInactive + focusable:false → the address input keeps keyboard focus.
      win.showInactive();
      this.omniboxVisible = true;
    }
  }

  hideOmnibox(): void {
    if (this.omniboxWin && !this.omniboxWin.isDestroyed() && this.omniboxVisible) {
      this.omniboxWin.hide();
    }
    this.omniboxVisible = false;
  }

  /** Overlay → toolbar: a suggestion was clicked. */
  forwardOmniboxPick(index: number): void {
    this.forwardToParent('omnibox:picked', index);
  }

  /** Overlay → toolbar: a suggestion was hovered. */
  forwardOmniboxHover(index: number): void {
    this.forwardToParent('omnibox:hovered', index);
  }

  private forwardToParent(channel: string, payload: unknown): void {
    const parent = this.getParent();
    if (!parent || parent.webContents.isDestroyed()) return;
    parent.webContents.send(channel, payload);
  }

  private async ensureOmniboxLoaded(): Promise<BrowserWindow | null> {
    if (this.shuttingDown) return null;
    const parent = this.getParent();
    if (!parent) return null;

    if (this.omniboxWin && !this.omniboxWin.isDestroyed()) {
      return this.omniboxWin;
    }

    const cb = parent.getContentBounds();
    const size = POPUP_SIZES['omnibox-popup'];
    // Non-focusable so clicking suggestions never blurs the toolbar address input.
    const win = this.createChildWindow(
      parent,
      { x: cb.x + 100, y: cb.y + 100, width: size.width, height: size.height },
      'popup',
      { focusable: false },
    );
    this.omniboxWin = win;

    const ok = await this.loadOnce(win, 'omnibox-popup', {
      suggestions: [],
      selectedIndex: -1,
    });
    if (!ok) {
      this.omniboxWin = null;
      return null;
    }
    this.omniboxLoaded = true;
    win.hide();
    return win;
  }

  getOpenPanelKind(): OverlayPanelKind | null {
    return this.dockedVisible ? this.dockedKind : null;
  }

  // ── Permission prompt (P3-A) ────────────────────────────────────────────────

  /** Register the callback invoked when a permission popup is dismissed (no choice). */
  setPermissionDismissHandler(cb: (requestId: string) => void): void {
    this.onPermissionDismiss = cb;
  }

  /** Show the permission prompt anchored at the top-left of the web content area. */
  openPermissionPrompt(
    requestId: string,
    payload: { requestId: string; host: string; capabilities: string[] },
  ): void {
    const parent = this.getParent();
    if (!parent) {
      this.onPermissionDismiss?.(requestId);
      return;
    }

    const content = parent.getContentBounds();
    const area = this.webContentAreaScreen();
    const clientX = area ? area.screenX - content.x + 16 : 16;
    const clientY = area ? area.screenY - content.y + 12 : 80;

    this.pendingPermissionId = requestId;
    void this.openPopup('permission-popup', clientX, clientY, payload);
  }

  /** Hide the prompt after an explicit choice (suppresses the dismiss callback). */
  resolvePermissionPopup(requestId: string): void {
    if (this.pendingPermissionId === requestId) {
      this.pendingPermissionId = null;
    }
    this.hidePopup();
  }

  // ── Screen-share picker (P3-C) ──────────────────────────────────────────────

  setScreenShareDismissHandler(cb: (requestId: string) => void): void {
    this.onScreenShareDismiss = cb;
  }

  /** Show the screen-share picker centered over the web content area. */
  openScreenSharePrompt(
    requestId: string,
    payload: { requestId: string; host: string | null; sources: unknown[] },
  ): void {
    const parent = this.getParent();
    if (!parent) {
      this.onScreenShareDismiss?.(requestId);
      return;
    }

    const content = parent.getContentBounds();
    const area = this.webContentAreaScreen();
    const size = POPUP_SIZES['screenshare-popup'];
    const baseX = area ? area.screenX - content.x : 0;
    const baseY = area ? area.screenY - content.y : 0;
    const areaW = area ? area.width : content.width;
    const areaH = area ? area.height : content.height;
    const clientX = baseX + Math.max(0, (areaW - size.width) / 2);
    const clientY = baseY + Math.max(0, (areaH - size.height) / 2);

    this.pendingScreenShareId = requestId;
    void this.openPopup('screenshare-popup', clientX, clientY, payload as Record<string, unknown>);
  }

  /** Hide the picker after an explicit choice/cancel (suppresses dismiss). */
  resolveScreenSharePopup(requestId: string): void {
    if (this.pendingScreenShareId === requestId) {
      this.pendingScreenShareId = null;
    }
    this.hidePopup();
  }

  private async openPopup(
    kind: OverlayPopupKind,
    clientX: number,
    clientY: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.shuttingDown) return;
    const parent = this.getParent();
    if (!parent) {
      console.warn('[alpha][overlay] openPopup — no parent');
      return;
    }

    // If a permission prompt is being replaced by a different popup, report it
    // as dismissed so the pending Electron callback is not left hanging.
    if (this.pendingPermissionId && kind !== 'permission-popup') {
      const id = this.pendingPermissionId;
      this.pendingPermissionId = null;
      this.onPermissionDismiss?.(id);
    }
    if (this.pendingScreenShareId && kind !== 'screenshare-popup') {
      const id = this.pendingScreenShareId;
      this.pendingScreenShareId = null;
      this.onScreenShareDismiss?.(id);
    }

    const win = await this.ensurePopupLoaded();
    if (!win) {
      console.warn('[alpha][overlay] openPopup — popup window unavailable');
      return;
    }

    const content = parent.getContentBounds();

    const size = this.popupSize(kind, payload);
    // clientX/clientY are relative to the shell webContents (full content area, incl. chrome).
    // Context menus (tab/group) and toolbar popups (route/adblock) anchor in the chrome zone,
    // so clamp to the whole content area — NOT the web band — otherwise they get pushed down.
    const anchorX = content.x + Math.round(clientX);
    const anchorY = content.y + Math.round(clientY);
    const minX = content.x + POPUP_VIEWPORT_MARGIN_PX;
    const minY = content.y + POPUP_VIEWPORT_MARGIN_PX;
    const maxX = content.x + content.width - size.width - POPUP_VIEWPORT_MARGIN_PX;
    const maxY = content.y + content.height - size.height - POPUP_VIEWPORT_MARGIN_PX;

    const bounds = {
      x: Math.round(Math.min(Math.max(minX, anchorX), maxX)),
      y: Math.round(Math.min(Math.max(minY, anchorY), maxY)),
      width: size.width,
      height: size.height,
    };

    console.log('[alpha][overlay] popup bounds', { kind, ...bounds });

    win.setBounds(bounds);
    this.sendState(win, { kind, payload });
    this.popupShownAt = Date.now();
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.show();
    win.focus();
    console.log('[alpha][overlay] popup show', { kind });
  }

  private popupSize(
    kind: OverlayPopupKind,
    payload: Record<string, unknown>,
  ): { width: number; height: number } {
    const base = POPUP_SIZES[kind];

    if (kind === 'permission-popup') {
      const caps = Array.isArray(payload.capabilities) ? payload.capabilities.length : 1;
      // gutter + header + label + caps rows + buttons row.
      const height = 150 + Math.max(1, caps) * 32;
      return { width: base.width, height };
    }

    if (kind !== 'tab-menu') {
      return base;
    }

    let items = 2;
    if (payload.inGroup) {
      items += 1;
      const other = (payload.otherGroups as unknown[])?.length ?? 0;
      items += other;
    } else {
      items += 1;
      const groups = (payload.groups as unknown[])?.length ?? 0;
      items += groups;
    }
    // 16px gutter + 12px menu padding + ~34px per row.
    const height = Math.min(320, Math.max(132, 44 + items * 34));
    return { width: base.width, height };
  }

  private hidePopup(): void {
    const permDismissId = this.pendingPermissionId;
    const ssDismissId = this.pendingScreenShareId;
    this.pendingPermissionId = null;
    this.pendingScreenShareId = null;
    if (this.popupWin && !this.popupWin.isDestroyed()) {
      this.popupWin.setAlwaysOnTop(false);
      this.popupWin.hide();
    }
    if (permDismissId) this.onPermissionDismiss?.(permDismissId);
    if (ssDismissId) this.onScreenShareDismiss?.(ssDismissId);
  }

  private async ensureDockedLoaded(): Promise<BrowserWindow | null> {
    if (this.shuttingDown) return null;
    const parent = this.getParent();
    if (!parent) return null;

    if (this.dockedWin && !this.dockedWin.isDestroyed()) {
      return this.dockedWin;
    }

    const bounds = this.panelBounds('groups-panel');
    if (!bounds) return null;

    const win = this.createChildWindow(parent, bounds, 'panel');
    this.bindEscapeClose(win, () => this.closePanel());
    this.bindDockedBlurClose(win);
    this.dockedWin = win;

    const ok = await this.loadOnce(win, 'groups-panel');
    if (!ok) {
      this.dockedWin = null;
      return null;
    }
    this.dockedLoaded = true;
    return win;
  }

  private async ensurePopupLoaded(): Promise<BrowserWindow | null> {
    if (this.shuttingDown) return null;
    const parent = this.getParent();
    if (!parent) return null;

    if (this.popupWin && !this.popupWin.isDestroyed()) {
      return this.popupWin;
    }

    const cb = parent.getContentBounds();
    const size = POPUP_SIZES['route-popup'];
    const win = this.createChildWindow(
      parent,
      { x: cb.x + 100, y: cb.y + 100, width: size.width, height: size.height },
      'popup',
    );
    this.bindEscapeClose(win, () => this.hidePopup());
    this.bindPopupBlurClose(win);
    this.popupWin = win;

    const ok = await this.loadOnce(win, 'route-popup', {
      domain: '_warmup',
      current: 'AUTO',
      routeSource: 'default',
    });
    if (!ok) {
      this.popupWin = null;
      return null;
    }
    this.popupLoaded = true;
    win.hide();
    return win;
  }

  private async loadOnce(
    win: BrowserWindow,
    kind: OverlayKind,
    payload?: Record<string, unknown>,
  ): Promise<boolean> {
    let url: string;
    try {
      url = resolveOverlayPageUrl(kind, payload);
    } catch (err) {
      console.error('[alpha][overlay] resolve url failed', err);
      return false;
    }

    console.log('[alpha][overlay] loading url', url);

    try {
      await verifyOverlayPageUrl(url);
    } catch (err) {
      console.error('[alpha][overlay] verify failed — NOT loading main shell', err);
      if (!win.isDestroyed()) win.destroy();
      return false;
    }

    try {
      await win.loadURL(url);
    } catch (err) {
      console.error('[alpha][overlay] loadURL failed', err);
      if (!win.isDestroyed()) win.destroy();
      return false;
    }

    if (process.env.ALPHA_OVERLAY_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    return true;
  }

  private sendState(win: BrowserWindow, state: OverlayStateMessage): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('overlay:setState', state);
  }

  private panelBounds(kind: OverlayPanelKind): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const placement = PANEL_PLACEMENT[kind];
    const area = this.webContentAreaScreen();
    if (!area) return null;

    const width = PANEL_WIDTH_PX[kind];
    const x =
      placement === 'left'
        ? area.screenX
        : area.screenX + Math.max(0, area.width - width);

    return {
      x: Math.round(x),
      y: Math.round(area.screenY),
      width,
      height: Math.round(area.height),
    };
  }

  private repositionDocked(): void {
    const win = this.dockedWin;
    if (!win || win.isDestroyed() || !this.dockedVisible || !this.dockedKind) return;
    const bounds = this.panelBounds(this.dockedKind);
    if (!bounds) return;
    win.setBounds(bounds);
  }

  /**
   * Web content band in screen coordinates — same layout as WebContentsView (getWebContentBounds).
   * Docked panel uses a slice of this rect (left or right edge only).
   */
  private webContentAreaScreen(): {
    screenX: number;
    screenY: number;
    width: number;
    height: number;
  } | null {
    const parent = this.getParent();
    if (!parent) return null;

    const content = parent.getContentBounds();
    const manager = this.getManager();
    const chromeTop = manager?.getChromeTopHeightPx() ?? chromeBaselineTopHeightPx();
    // Use the exact same layout fn as the WebContentsView so the panel top aligns
    // pixel-perfectly with the web content / NTP top — no extra offset, no filler.
    const web = getWebContentBounds(content.width, content.height, chromeTop);

    const screenX = content.x + web.x;
    const screenY = content.y + web.y;
    const height = Math.max(0, content.height - web.y);

    return {
      screenX,
      screenY,
      width: web.width,
      height,
    };
  }

  private getParent(): BrowserWindow | null {
    const win = this.getManager()?.getBrowserWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  private createChildWindow(
    parent: BrowserWindow,
    bounds: { x: number; y: number; width: number; height: number },
    mode: 'panel' | 'popup',
    opts?: { focusable?: boolean },
  ): BrowserWindow {
    const win = new BrowserWindow({
      parent,
      modal: false,
      frame: false,
      transparent: mode === 'popup',
      backgroundColor: mode === 'popup' ? '#00000000' : '#0E1116',
      show: false,
      paintWhenInitiallyHidden: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: opts?.focusable ?? true,
      hasShadow: false,
      thickFrame: false,
      ...bounds,
      webPreferences: {
        preload: this.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Stay above parent (incl. WebContentsView) without floating over other apps.
    win.setAlwaysOnTop(false);

    return win;
  }

  private bindPopupBlurClose(win: BrowserWindow): void {
    // Close whenever focus leaves the popup (click on page/toolbar/sidebar, Alt-Tab, etc.).
    // We must NOT keep it open when the parent regains focus — that's exactly the
    // "click outside" case. Only a short grace window suppresses the initial show transient.
    win.on('blur', () => {
      setTimeout(() => {
        if (win.isDestroyed() || !this.popupWin || this.popupWin !== win) return;
        if (!win.isVisible() || win.isFocused()) return;
        if (Date.now() - this.popupShownAt < 250) return;
        this.hidePopup();
      }, 100);
    });
  }

  private bindDockedBlurClose(win: BrowserWindow): void {
    win.on('blur', () => {
      setTimeout(() => this.maybeCloseDockedOnParentFocus(), 120);
    });
  }

  private maybeCloseDockedOnParentFocus(): void {
    if (!this.dockedVisible) return;

    const docked = this.dockedWin;
    if (!docked || docked.isDestroyed()) return;
    if (docked.isFocused()) return;
    if (Date.now() - this.dockedShownAt < 150) return;

    const parent = this.getParent();
    if (!parent || parent.isDestroyed()) return;

    if (parent.isFocused()) {
      this.closePanel();
    }
  }

  private bindEscapeClose(win: BrowserWindow, close: () => void): void {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        close();
      }
    });
  }

  private notifyOverlayState(): void {
    const parent = this.getParent();
    if (!parent || parent.webContents.isDestroyed()) return;
    parent.webContents.send('shell:overlay-state', {
      openPanel: this.dockedVisible ? this.dockedKind : null,
    });
  }
}

export { OVERLAY_PANEL_WIDTH };
