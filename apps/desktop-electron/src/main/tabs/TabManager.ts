import {
  BrowserWindow,
  WebContentsView,
  type WebContents,
  type WebContentsView as WebContentsViewType,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  GROUP_COLOR_PRESETS,
  NTP_URL,
  SETTINGS_URL,
  chromeBaselineTopHeightPx,
  getWebContentBounds,
  type AdblockStateSnapshot,
  type BrowserStateSnapshot,
  type PasswordStateSnapshot,
  type ProxyClientSnapshot,
  type RouteClass,
  type RouteMode,
  type RoutePartition,
  type SessionGroup,
  type TabSnapshot,
} from '@alpha/shared-types';
import { normalizeDomain } from '@alpha/core-routing';
import { isAllowedNavigationUrl } from '../navigation';
import type { RoutingService } from '../routing/RoutingService';
import type { ProxyClientService } from '../proxy/ProxyClientService';
import type { SessionRegistry } from '../sessions/SessionRegistry';
import type { SavedGroupsStore } from '../storage/SavedGroupsStore';
import type { SessionStore, PersistedGroup } from '../storage/SessionStore';
import type { HistoryStore } from '../storage/HistoryStore';
import type { AdblockService } from '../adblock/AdblockService';
import type { PasswordService } from '../passwords/PasswordService';
import { pickFaviconUrl } from './favicon';
import { applyNavigationFlags, applyUrl } from './navigation-sync';
import {
  applyProxyFingerprint,
  reapplyProxyFingerprint,
  releaseProxyFingerprint,
  wireDetachedDevTools,
} from './proxy-fingerprint';
import { navLog, adblockTakeForWc } from '../nav-timings';
import type { SessionGroupEntry, TabEntry } from './types';

const WEB_PREFS = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
} as const;

/**
 * Resolve a per-tab routing intent to a concrete Electron session.
 * P1: AUTO is treated as DIRECT (no automatic migration yet).
 */
function partitionForRouteClass(routeClass: RouteClass): RoutePartition {
  return routeClass === 'PROXY' ? 'PROXY' : 'DIRECT';
}

export class TabManager {
  private readonly tabs = new Map<string, TabEntry>();
  private tabOrder: string[] = [];
  private readonly sessionGroups = new Map<string, SessionGroupEntry>();
  private readonly navFallbackKeys = new Set<string>();
  /** Tabs whose next main-frame navigation came from a typed address entry. */
  private readonly typedNavTabIds = new Set<string>();
  private activeTabId: string | null = null;
  private shuttingDown = false;
  /** True while restoring a persisted session — suppresses re-persisting. */
  private restoring = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private chromeTopHeightPx = chromeBaselineTopHeightPx();
  /** Raw chrome-stack height from renderer (before baseline clamp). */
  private chromeStackMeasuredHeightPx = chromeBaselineTopHeightPx();
  /** Tab whose page is in HTML5 fullscreen; its view fills the whole window. */
  private fullscreenTabId: string | null = null;
  private proxySnapshot: ProxyClientSnapshot;
  private adblockSnapshot: AdblockStateSnapshot;
  private passwordsSnapshot: PasswordStateSnapshot;
  private readonly onWindowClose = (): void => {
    this.destroyAll();
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly chromeWebContents: WebContents,
    private readonly savedGroups: SavedGroupsStore,
    private readonly routing: RoutingService,
    private readonly proxyClient: ProxyClientService,
    private readonly history: HistoryStore,
    private adblock: AdblockService | null,
    private readonly passwords: PasswordService | null,
    private readonly session: SessionStore | null = null,
    private readonly sessions: SessionRegistry | null = null,
  ) {
    this.proxySnapshot = proxyClient.getState();
    this.proxyClient.on('state', (s) => {
      this.proxySnapshot = s;
      this.emitState();
    });
    this.adblockSnapshot = adblock?.getState() ?? {
      enabled: true,
      disabledDomains: [],
      blockedTotal: 0,
      blockedByTabId: {},
    };
    this.passwordsSnapshot = {
      available: false,
      neverSaveOrigins: [],
      pendingPrompt: null,
    };
    this.window.on('resize', () => this.layoutViews());
    // Cleanup before window is destroyed (closed fires too late).
    this.window.on('close', this.onWindowClose);
    // Persisted groups come back as dormant menu entries (Chrome-like saved
    // groups): visible in the menus, but their tabs are NOT auto-reopened.
    this.loadPersistedGroups();
    const id = randomUUID();
    this.tabs.set(id, this.createNtpEntry(id));
    this.tabOrder = [id];
    this.activeTabId = id;
  }

  private safeRemoveChildView(view: WebContentsViewType): void {
    try {
      if (this.window.isDestroyed()) return;
      this.window.contentView.removeChildView(view);
    } catch (e) {
      console.warn('[alpha][tabs] removeChildView failed', { err: String(e) });
    }
  }

  private safeCloseWebContents(wc: WebContents | undefined): void {
    try {
      if (!wc || wc.isDestroyed()) return;
      wc.close();
    } catch (e) {
      console.warn('[alpha][tabs] webContents.close failed', { err: String(e) });
    }
  }

  private teardownTabView(entry: TabEntry): void {
    const view = entry.view;
    entry.view = null;
    if (!view) return;
    this.safeRemoveChildView(view);
    try {
      releaseProxyFingerprint(view.webContents);
      this.safeCloseWebContents(view.webContents);
    } catch (e) {
      console.warn('[alpha][tabs] teardownTabView failed', { err: String(e) });
    }
  }

  /**
   * Rebuild group.tabIds from tab.sessionGroupId (source of truth).
   * Groups are persistent (Chrome-like): they are NOT deleted when empty —
   * an empty group is "dormant" and stays in the menus until explicitly
   * deleted. While a group has open web tabs, its remembered `urls` mirror
   * them; a dormant group keeps its last remembered urls.
   */
  private normalizeSessionGroups(): void {
    for (const group of this.sessionGroups.values()) {
      group.tabIds = this.tabOrder.filter(
        (id) => this.tabs.get(id)?.sessionGroupId === group.id,
      );
      if (group.tabIds.length > 0) {
        const webUrls = group.tabIds
          .map((id) => this.tabs.get(id))
          .filter(
            (t): t is TabEntry => !!t && t.kind === 'web' && isAllowedNavigationUrl(t.url),
          )
          .map((t) => t.url);
        group.urls = webUrls;
      }
    }
  }

  private logGroupsDebug(action: string): void {
    if (process.env.NODE_ENV === 'production') return;
    const groups = [...this.sessionGroups.values()].map((g) => ({
      id: g.id.slice(0, 8),
      title: g.title,
      collapsed: g.collapsed,
      tabIds: g.tabIds.length,
    }));
    console.debug('[alpha][groups]', action, {
      groups,
      tabOrderLen: this.tabOrder.length,
      tabsLen: this.tabs.size,
      activeTabId: this.activeTabId?.slice(0, 8) ?? null,
    });
  }

  attachAdblock(service: AdblockService): void {
    this.adblock = service;
    this.setAdblockSnapshot(service.getState());
  }

  syncToRenderer(): void {
    this.emitState();
  }

  createTab(
    initialUrl?: string,
    options?: { activate?: boolean; sessionGroupId?: string; routeClass?: RouteClass },
  ): BrowserStateSnapshot {
    const id = randomUUID();
    if (initialUrl && isAllowedNavigationUrl(initialUrl)) {
      const entry = this.createWebEntry(id, initialUrl, options?.routeClass ?? 'AUTO');
      entry.view = this.createWebView(id, entry.partition);
      this.tabs.set(id, entry);
      this.insertTabIdAfterActive(id);
      this.attachAndLoad(entry);
    } else {
      this.tabs.set(id, this.createNtpEntry(id));
      this.insertTabIdAfterActive(id);
    }

    if (options?.sessionGroupId) {
      this.assignTabToGroup(id, options.sessionGroupId);
    }

    if (options?.activate !== false) {
      this.switchTab(id);
    } else {
      this.emitState();
    }
    return this.getState();
  }

  closeTab(tabId: string): BrowserStateSnapshot {
    const entry = this.tabs.get(tabId);
    if (!entry) {
      return this.getState();
    }

    const groupId = entry.sessionGroupId;
    if (this.fullscreenTabId === tabId) {
      this.fullscreenTabId = null;
    }
    this.teardownTabView(entry);
    this.tabs.delete(tabId);
    this.typedNavTabIds.delete(tabId);
    // P2-B: drop this tab's per-tab adblock counter so closed tabs don't leak
    // entries in blockedByTabId. blockedTotal (lifetime) is intentionally kept.
    this.adblock?.resetCountersForTab(tabId);
    this.tabOrder = this.tabOrder.filter((id) => id !== tabId);

    if (groupId) {
      this.removeTabIdFromGroup(groupId, tabId);
      this.pruneEmptyGroup(groupId);
    }

    if (this.tabs.size === 0) {
      const id = randomUUID();
      this.tabs.set(id, this.createNtpEntry(id));
      this.tabOrder = [id];
      this.activeTabId = id;
    } else if (this.activeTabId === tabId) {
      const next = this.tabOrder[0] ?? [...this.tabs.keys()][0];
      this.switchTab(next);
    }

    this.layoutViews();
    this.emitState();
    return this.getState();
  }

  switchTab(tabId: string): BrowserStateSnapshot {
    if (!this.tabs.has(tabId)) {
      return this.getState();
    }
    this.activeTabId = tabId;
    this.updateViewVisibility();
    this.emitState();
    return this.getState();
  }

  /**
   * Open the in-shell settings page as a singleton internal tab. If a settings
   * tab already exists it is focused instead of opening a duplicate.
   */
  openSettings(): BrowserStateSnapshot {
    const existing = this.tabOrder
      .map((id) => this.tabs.get(id))
      .find((t): t is TabEntry => !!t && t.kind === 'internal' && t.url === SETTINGS_URL);
    if (existing) {
      return this.switchTab(existing.id);
    }
    const id = randomUUID();
    this.tabs.set(id, this.createInternalEntry(id, SETTINGS_URL, 'Настройки'));
    this.insertTabIdAfterActive(id);
    return this.switchTab(id);
  }

  navigateTab(tabId: string, _input: string, resolvedUrl: string): BrowserStateSnapshot {
    const entry = this.tabs.get(tabId);
    if (!entry || !resolvedUrl || !isAllowedNavigationUrl(resolvedUrl)) {
      return this.getState();
    }

    navLog(entry.id, 'tabManager:navigateTab', {
      fromKind: entry.kind,
      partition: entry.partition,
      routeClass: entry.routeClass,
      // Whether the shared proxy transport was already ready before this nav.
      proxyStatus: this.proxySnapshot.status,
      proxyReady: !!this.proxySnapshot.localSocks,
      hasView: !!entry.view,
    });

    entry.loadFailed = false;
    // Mark this tab so the resulting main-frame navigation is counted as a
    // typed visit in the URL aggregate (frecency).
    this.typedNavTabIds.add(tabId);
    if (entry.kind === 'ntp' || entry.kind === 'internal') {
      this.promoteToWeb(entry, resolvedUrl);
    } else if (entry.view) {
      void entry.view.webContents.loadURL(resolvedUrl);
      entry.url = resolvedUrl;
    }

    this.emitState();
    return this.getState();
  }

  goBack(tabId?: string): BrowserStateSnapshot {
    const entry = this.getEntry(tabId);
    if (entry?.kind === 'web' && entry.view?.webContents.canGoBack()) {
      entry.view.webContents.goBack();
    }
    return this.getState();
  }

  goForward(tabId?: string): BrowserStateSnapshot {
    const entry = this.getEntry(tabId);
    if (entry?.kind === 'web' && entry.view?.webContents.canGoForward()) {
      entry.view.webContents.goForward();
    }
    return this.getState();
  }

  reload(tabId?: string): BrowserStateSnapshot {
    const entry = this.getEntry(tabId);
    if (entry?.kind === 'web' && entry.view) {
      entry.loadFailed = false;
      if (entry.crashed) {
        this.recoverCrashedTab(entry);
      } else {
        entry.view.webContents.reload();
      }
    }
    return this.getState();
  }

  stop(tabId?: string): BrowserStateSnapshot {
    const entry = this.getEntry(tabId);
    if (entry?.kind === 'web' && entry.view) {
      entry.view.webContents.stop();
      entry.isLoading = false;
      this.emitState();
    }
    return this.getState();
  }

  createSessionGroup(payload: {
    title: string;
    color: string;
    tabIds?: string[];
  }): BrowserStateSnapshot {
    const groupId = randomUUID();
    const group: SessionGroupEntry = {
      id: groupId,
      title: payload.title.trim() || 'Группа',
      color: payload.color,
      collapsed: false,
      tabIds: [],
      urls: [],
      sourceSavedGroupId: null,
    };
    this.sessionGroups.set(groupId, group);

    if (payload.tabIds?.length) {
      for (const tabId of payload.tabIds) {
        if (this.tabs.has(tabId)) {
          this.assignTabToGroup(tabId, groupId);
        }
      }
    }
    group.collapsed = false;
    this.normalizeSessionGroups();
    this.logGroupsDebug('createSessionGroup');

    this.emitState();
    return this.getState();
  }

  /** Chrome-like: new tab group + fresh NTP tab inside it (no URL prompt). */
  createSessionGroupWithNewTab(): BrowserStateSnapshot {
    const groupId = randomUUID();
    const color = GROUP_COLOR_PRESETS[this.sessionGroups.size % GROUP_COLOR_PRESETS.length];
    const group: SessionGroupEntry = {
      id: groupId,
      title: 'Группа',
      color,
      collapsed: false,
      tabIds: [],
      urls: [],
      sourceSavedGroupId: null,
    };
    this.sessionGroups.set(groupId, group);
    this.createTab(undefined, { sessionGroupId: groupId, activate: true });
    this.normalizeSessionGroups();
    this.logGroupsDebug('createSessionGroupWithNewTab');
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('shell:start-group-rename', { groupId });
    }
    return this.getState();
  }

  renameSessionGroup(groupId: string, title: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (group) {
      group.title = title.trim() || 'Группа';
      this.emitState();
    }
    return this.getState();
  }

  setSessionGroupColor(groupId: string, color: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (group) {
      group.color = color;
      if (group.sourceSavedGroupId) {
        this.savedGroups.update(group.sourceSavedGroupId, { color });
        this.broadcastSavedGroups();
      }
      this.emitState();
    }
    return this.getState();
  }

  toggleSessionGroupCollapsed(groupId: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (group) {
      const before = group.collapsed;
      group.collapsed = !group.collapsed;
      const after = group.collapsed;
      this.normalizeSessionGroups();
      if (!group.collapsed) {
        const focus =
          group.tabIds.find((id) => id === this.activeTabId) ?? group.tabIds[0];
        if (focus) this.switchTab(focus);
      }
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[alpha][groups-main] toggleCollapsed', {
          groupId: groupId.slice(0, 8),
          before,
          after,
          tabIds: group.tabIds.length,
        });
        this.logGroupsDebug('toggleSessionGroupCollapsed');
      }
      this.emitState();
    }
    return this.getState();
  }

  addTabToSessionGroup(groupId: string, tabId: string): BrowserStateSnapshot {
    if (this.tabs.has(tabId) && this.sessionGroups.has(groupId)) {
      const group = this.sessionGroups.get(groupId)!;
      this.assignTabToGroup(tabId, groupId);
      group.collapsed = false;
      this.normalizeSessionGroups();
      this.logGroupsDebug('addTabToSessionGroup');
      this.emitState();
    }
    return this.getState();
  }

  reorderSessionGroupTabs(groupId: string, tabIds: string[]): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (!group) return this.getState();
    const existing = new Set(group.tabIds);
    const next: string[] = [];
    for (const id of tabIds) {
      if (existing.has(id)) next.push(id);
    }
    for (const id of group.tabIds) {
      if (!next.includes(id)) next.push(id);
    }
    group.tabIds = next;
    this.emitState();
    return this.getState();
  }

  removeTabFromSessionGroup(tabId: string): BrowserStateSnapshot {
    const entry = this.tabs.get(tabId);
    if (!entry?.sessionGroupId) {
      return this.getState();
    }
    const groupId = entry.sessionGroupId;
    entry.sessionGroupId = null;
    this.removeTabIdFromGroup(groupId, tabId);
    this.pruneEmptyGroup(groupId);
    this.emitState();
    return this.getState();
  }

  ungroupSessionGroup(groupId: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (!group) {
      return this.getState();
    }
    for (const tabId of [...group.tabIds]) {
      const entry = this.tabs.get(tabId);
      if (entry) {
        entry.sessionGroupId = null;
      }
    }
    this.sessionGroups.delete(groupId);
    this.emitState();
    return this.getState();
  }

  /**
   * Close a group's tabs but KEEP the group as a dormant menu entry that
   * remembers its tabs. (Use deleteSessionGroup to remove it entirely.)
   */
  closeSessionGroup(groupId: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (!group) {
      return this.getState();
    }

    this.normalizeSessionGroups();
    // Remember all current web-tab URLs before we tear the tabs down.
    const rememberedUrls = group.tabIds
      .map((id) => this.tabs.get(id))
      .filter((t): t is TabEntry => !!t && t.kind === 'web' && isAllowedNavigationUrl(t.url))
      .map((t) => t.url);

    const tabIds = group.tabIds.filter((id) => this.tabs.has(id));
    const activeId = this.activeTabId;
    const closeOrder =
      activeId && tabIds.includes(activeId)
        ? [...tabIds.filter((id) => id !== activeId), activeId]
        : [...tabIds];

    for (const tabId of closeOrder) {
      if (this.tabs.has(tabId)) {
        this.closeTab(tabId);
      }
    }

    // Group stays (dormant) with its remembered URLs.
    const stillThere = this.sessionGroups.get(groupId);
    if (stillThere) {
      stillThere.tabIds = [];
      stillThere.urls = rememberedUrls;
    }
    this.emitState();
    return this.getState();
  }

  saveSessionGroupAsWorkspace(groupId: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (!group) {
      return this.getState();
    }

    const urls = group.tabIds
      .map((id) => this.tabs.get(id))
      .filter((t): t is TabEntry => !!t && t.kind === 'web' && isAllowedNavigationUrl(t.url))
      .map((t) => t.url);

    if (group.sourceSavedGroupId) {
      this.savedGroups.update(group.sourceSavedGroupId, {
        title: group.title,
        color: group.color,
        urls,
      });
    } else {
      const saved = this.savedGroups.create({
        title: group.title,
        color: group.color,
        urls,
      });
      group.sourceSavedGroupId = saved.id;
    }

    this.broadcastSavedGroups();
    this.emitState();
    return this.getState();
  }

  openSavedGroup(savedGroupId: string): BrowserStateSnapshot {
    const existing = [...this.sessionGroups.values()].find(
      (g) => g.sourceSavedGroupId === savedGroupId,
    );
    if (existing) {
      const savedMeta = this.savedGroups.getById(savedGroupId);
      if (savedMeta) {
        existing.color = savedMeta.color;
        existing.title = savedMeta.title;
      }
      existing.collapsed = false;
      const focusTab = existing.tabIds.find((id) => this.tabs.has(id)) ?? existing.tabIds[0];
      if (focusTab) {
        this.switchTab(focusTab);
      }
      this.emitState();
      return this.getState();
    }

    const saved = this.savedGroups.getById(savedGroupId);
    if (!saved || saved.urls.length === 0) {
      return this.getState();
    }

    const groupId = randomUUID();
    const group: SessionGroupEntry = {
      id: groupId,
      title: saved.title,
      color: saved.color,
      collapsed: false,
      tabIds: [],
      urls: [],
      sourceSavedGroupId: saved.id,
    };
    this.sessionGroups.set(groupId, group);

    let firstTabId: string | null = null;
    for (const url of saved.urls) {
      if (!isAllowedNavigationUrl(url)) {
        continue;
      }
      const tabId = randomUUID();
      const entry = this.createWebEntry(tabId, url);
      entry.sessionGroupId = groupId;
      entry.view = this.createWebView(tabId, entry.partition);
      this.tabs.set(tabId, entry);
      group.tabIds.push(tabId);
      this.insertTabIdAfterActive(tabId);
      this.attachAndLoad(entry);
      if (!firstTabId) {
        firstTabId = tabId;
      }
    }

    if (firstTabId) {
      this.switchTab(firstTabId);
    } else {
      this.emitState();
    }
    return this.getState();
  }

  getState(): BrowserStateSnapshot {
    for (const id of this.tabs.keys()) {
      if (!this.tabOrder.includes(id)) {
        this.tabOrder.push(id);
      }
    }
    this.normalizeSessionGroups();
    const tabs: TabSnapshot[] = this.tabOrder
      .map((id) => this.tabs.get(id))
      .filter((t): t is TabEntry => !!t)
      .map((t) => {
      const route =
        t.kind === 'web' && isAllowedNavigationUrl(t.url)
          ? this.routing.resolveForUrl(t.url)
          : null;
      return {
        id: t.id,
        kind: t.kind,
        title: t.loadFailed ? `Ошибка: ${t.url}` : t.title,
        url: t.url,
        favicon: t.kind === 'web' ? t.favicon : null,
        isActive: t.id === this.activeTabId,
        isLoading: t.isLoading,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        crashed: t.crashed,
        sessionGroupId: t.sessionGroupId,
        audible: t.audible,
        muted: t.muted,
        routeMode: route?.mode ?? 'AUTO',
        routeSource: route?.source ?? 'default',
        routeError: route?.error ?? null,
        domain: route?.domain ?? null,
        routeClass: t.routeClass,
        partition: t.partition,
      };
    });

    const sessionGroups: SessionGroup[] = [...this.sessionGroups.values()].map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
      tabIds: [...g.tabIds],
      urls: [...g.urls],
      sourceSavedGroupId: g.sourceSavedGroupId,
    }));

    return {
      tabs,
      sessionGroups,
      activeTabId: this.activeTabId ?? tabs[0]?.id ?? '',
      routing: this.routing.getRoutingState(),
      proxy: this.proxySnapshot,
      adblock: this.adblockSnapshot,
      passwords: this.passwordsSnapshot,
    };
  }

  getRouting(): RoutingService {
    return this.routing;
  }

  /**
   * P4.7: after a PROXY identity reset, reload every open PROXY web tab so live
   * pages drop their now-cleared cookies/storage and re-fetch a fresh session.
   * DIRECT tabs are never touched. Returns how many tabs were reloaded.
   */
  reloadProxyTabs(): number {
    let reloaded = 0;
    for (const entry of this.tabs.values()) {
      if (
        entry.kind === 'web' &&
        entry.partition === 'PROXY' &&
        entry.view &&
        !entry.view.webContents.isDestroyed()
      ) {
        entry.loadFailed = false;
        entry.isLoading = true;
        entry.crashed = false;
        entry.view.webContents.reload();
        reloaded += 1;
      }
    }
    if (reloaded > 0) {
      this.emitState();
    }
    return reloaded;
  }

  findTabByWebContentsId(webContentsId: number): TabEntry | null {
    for (const entry of this.tabs.values()) {
      if (entry.view?.webContents?.id === webContentsId) {
        return entry;
      }
    }
    return null;
  }

  reorderTabs(tabIds: string[]): BrowserStateSnapshot {
    const existing = new Set(this.tabs.keys());
    const next: string[] = [];
    for (const id of tabIds) {
      if (existing.has(id)) next.push(id);
    }
    for (const id of this.tabOrder) {
      if (!next.includes(id) && existing.has(id)) next.push(id);
    }
    // ensure all tabs present
    for (const id of existing) {
      if (!next.includes(id)) next.push(id);
    }
    this.tabOrder = next;
    this.emitState();
    return this.getState();
  }

  duplicateTab(tabId: string, preserveGroup = true): BrowserStateSnapshot {
    const src = this.tabs.get(tabId);
    if (!src || src.kind !== 'web' || !isAllowedNavigationUrl(src.url)) {
      return this.getState();
    }
    const id = randomUUID();
    const entry = this.createWebEntry(id, src.url, src.routeClass);
    entry.view = this.createWebView(id, entry.partition);
    this.tabs.set(id, entry);
    // Insert after source tab in global order.
    const idx = this.tabOrder.indexOf(tabId);
    if (idx >= 0) this.tabOrder.splice(idx + 1, 0, id);
    else this.tabOrder.push(id);

    if (preserveGroup && src.sessionGroupId && this.sessionGroups.has(src.sessionGroupId)) {
      entry.sessionGroupId = src.sessionGroupId;
      const group = this.sessionGroups.get(src.sessionGroupId)!;
      const gIdx = group.tabIds.indexOf(tabId);
      if (gIdx >= 0) group.tabIds.splice(gIdx + 1, 0, id);
      else group.tabIds.push(id);
    }

    this.attachAndLoad(entry);
    this.switchTab(id);
    this.emitState();
    return this.getState();
  }

  private insertTabIdAfterActive(id: string): void {
    if (!this.tabOrder.includes(id)) {
      const activeIdx = this.activeTabId ? this.tabOrder.indexOf(this.activeTabId) : -1;
      if (activeIdx >= 0) {
        this.tabOrder.splice(activeIdx + 1, 0, id);
      } else {
        this.tabOrder.push(id);
      }
    }
  }

  // ── Group persistence (Chrome-like saved tab groups) ──

  private serializeGroups(): PersistedGroup[] {
    return [...this.sessionGroups.values()].map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
      urls: [...g.urls],
    }));
  }

  /**
   * P1 manual per-tab routing. Sets the tab's routing intent and, for an
   * already-loaded web tab, migrates its view to the matching Electron session
   * (DIRECT = defaultSession, PROXY = persist:alpha-proxy). The single shared
   * sing-box/localSocks transport backs the PROXY session — no per-tab tunnel.
   */
  setTabRoute(tabId: string | undefined, routeClass: RouteClass): BrowserStateSnapshot {
    const entry = this.getEntry(tabId);
    if (!entry) {
      return this.getState();
    }
    entry.routeClass = routeClass;
    // P2-A Route Memory: persist (DIRECT/PROXY) or forget (AUTO) the choice for
    // this tab's domain so future tabs of the same site open in the same route.
    // Only web tabs have a meaningful domain; data-layer write only (no PAC).
    if (entry.kind === 'web' && isAllowedNavigationUrl(entry.url)) {
      const host = normalizeDomain(entry.url);
      if (host) {
        this.routing.rememberRoute(host, routeClass);
      }
    }
    const target = partitionForRouteClass(routeClass);
    if (entry.kind === 'web' && entry.view && entry.partition !== target) {
      this.migrateTabPartition(entry, target);
    } else {
      // NTP/internal tabs (or no partition change) just remember the intent;
      // the binding happens lazily when the tab becomes/loads a web page.
      entry.partition = target;
      this.emitState();
    }
    return this.getState();
  }

  /**
   * P3-B Tab Audio: mute/unmute a tab (Chrome-style, single click — no menu).
   * The intent is stored on the entry and survives view recreation.
   */
  setTabMuted(tabId: string | undefined, muted: boolean): BrowserStateSnapshot {
    const entry = this.getEntry(tabId);
    if (!entry) {
      return this.getState();
    }
    entry.muted = muted;
    if (entry.view && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.setAudioMuted(muted);
    }
    this.emitState();
    return this.getState();
  }

  /**
   * Move a live web tab to a different Electron session without changing the
   * active tab: keep the URL, tear down the old WebContentsView (no leak),
   * create a fresh view in the target session, and reload the URL there.
   */
  private migrateTabPartition(entry: TabEntry, target: RoutePartition): void {
    const url = entry.url;
    this.teardownTabView(entry);
    entry.partition = target;
    entry.isLoading = true;
    entry.loadFailed = false;
    entry.crashed = false;
    entry.canGoBack = false;
    entry.canGoForward = false;
    entry.view = this.createWebView(entry.id, target);
    entry.url = url;
    this.attachAndLoad(entry);
    this.updateViewVisibility();
    this.emitState();
    console.log('[alpha][tabs] per-tab route migrated', {
      tab: entry.id.slice(0, 8),
      partition: target,
    });
  }

  private schedulePersist(): void {
    if (!this.session || this.restoring || this.shuttingDown) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushSession();
    }, 300);
  }

  private flushSession(): void {
    if (!this.session) return;
    try {
      this.session.saveGroups(this.serializeGroups());
    } catch (e) {
      console.warn('[alpha][session] persist failed', { err: String(e) });
    }
  }

  /** Load persisted groups as dormant menu entries (no tabs reopened). */
  private loadPersistedGroups(): void {
    if (!this.session) return;
    this.restoring = true;
    try {
      for (const g of this.session.loadGroups()) {
        if (this.sessionGroups.has(g.id)) continue;
        this.sessionGroups.set(g.id, {
          id: g.id,
          title: g.title,
          color: g.color,
          collapsed: g.collapsed,
          tabIds: [],
          urls: Array.isArray(g.urls) ? [...g.urls] : [],
          sourceSavedGroupId: null,
        });
      }
    } catch (e) {
      console.warn('[alpha][session] load groups failed', { err: String(e) });
    } finally {
      this.restoring = false;
    }
  }

  /** Open a dormant group (recreate tabs from remembered URLs) or focus it if already open. */
  openSessionGroup(groupId: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (!group) {
      return this.getState();
    }

    const openTabs = group.tabIds.filter((id) => this.tabs.has(id));
    if (openTabs.length > 0) {
      group.collapsed = false;
      this.switchTab(openTabs[0]);
      return this.getState();
    }

    group.collapsed = false;
    const urls = group.urls.filter((u) => isAllowedNavigationUrl(u));
    if (urls.length === 0) {
      this.createTab(undefined, { sessionGroupId: groupId, activate: true });
      return this.getState();
    }

    let firstTabId: string | null = null;
    for (const url of urls) {
      const tabId = randomUUID();
      const entry = this.createWebEntry(tabId, url);
      entry.sessionGroupId = groupId;
      entry.view = this.createWebView(tabId, entry.partition);
      this.tabs.set(tabId, entry);
      this.insertTabIdAfterActive(tabId);
      this.attachAndLoad(entry);
      if (!firstTabId) {
        firstTabId = tabId;
      }
    }
    this.normalizeSessionGroups();
    if (firstTabId) {
      this.switchTab(firstTabId);
    } else {
      this.emitState();
    }
    return this.getState();
  }

  /** Permanently remove a group: close its open tabs and drop the record. */
  deleteSessionGroup(groupId: string): BrowserStateSnapshot {
    const group = this.sessionGroups.get(groupId);
    if (!group) {
      return this.getState();
    }
    this.normalizeSessionGroups();
    const tabIds = group.tabIds.filter((id) => this.tabs.has(id));
    const activeId = this.activeTabId;
    const closeOrder =
      activeId && tabIds.includes(activeId)
        ? [...tabIds.filter((id) => id !== activeId), activeId]
        : [...tabIds];
    for (const tabId of closeOrder) {
      if (this.tabs.has(tabId)) {
        this.closeTab(tabId);
      }
    }
    this.sessionGroups.delete(groupId);
    this.emitState();
    return this.getState();
  }

  async refreshRouting(): Promise<BrowserStateSnapshot> {
    await this.routing.applyPac();
    this.emitState();
    return this.getState();
  }

  notifyState(): BrowserStateSnapshot {
    this.emitState();
    return this.getState();
  }

  async applyRouteChangeAndReload(tabId: string, _domain: string): Promise<BrowserStateSnapshot> {
    await this.routing.applyPac();
    this.routing.setPendingReloadTabId(null);
    const entry = this.tabs.get(tabId);
    if (entry?.view && entry.kind === 'web') {
      entry.view.webContents.reload();
    }
    this.emitState();
    return this.getState();
  }

  private assignTabToGroup(tabId: string, groupId: string): void {
    const entry = this.tabs.get(tabId);
    const group = this.sessionGroups.get(groupId);
    if (!entry || !group) {
      return;
    }

    if (entry.sessionGroupId && entry.sessionGroupId !== groupId) {
      this.removeTabIdFromGroup(entry.sessionGroupId, tabId);
      this.pruneEmptyGroup(entry.sessionGroupId);
    }

    entry.sessionGroupId = groupId;
    if (!group.tabIds.includes(tabId)) {
      group.tabIds.push(tabId);
    }
  }

  private removeTabIdFromGroup(groupId: string, tabId: string): void {
    const group = this.sessionGroups.get(groupId);
    if (!group) {
      return;
    }
    group.tabIds = group.tabIds.filter((id) => id !== tabId);
  }

  private pruneEmptyGroup(_groupId: string): void {
    // Intentionally a no-op: groups are persistent and remain in the menus
    // even with zero open tabs (dormant). They are only removed via
    // deleteSessionGroup or ungroupSessionGroup.
  }

  private getEntry(tabId?: string): TabEntry | undefined {
    const id = tabId ?? this.activeTabId;
    return id ? this.tabs.get(id) : undefined;
  }

  private createNtpEntry(id: string): TabEntry {
    return {
      id,
      kind: 'ntp',
      title: 'Новая вкладка',
      url: NTP_URL,
      favicon: null,
      view: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      crashed: false,
      sessionGroupId: null,
      loadFailed: false,
      audible: false,
      muted: false,
      routeClass: 'AUTO',
      partition: 'DIRECT',
    };
  }

  private createInternalEntry(id: string, url: string, title: string): TabEntry {
    return {
      id,
      kind: 'internal',
      title,
      url,
      favicon: null,
      view: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      crashed: false,
      sessionGroupId: null,
      loadFailed: false,
      audible: false,
      muted: false,
      routeClass: 'AUTO',
      partition: 'DIRECT',
    };
  }

  /**
   * P2-A Route Memory (apply side). Decide the initial route class for a brand
   * new / promoted web tab:
   * - an explicit per-tab intent (DIRECT/PROXY, e.g. inherited from an opener)
   *   always wins and is returned unchanged;
   * - only when the intent is AUTO do we consult saved memory for the URL's
   *   domain and, if found, open the tab directly in that remembered class.
   * This is NOT AUTO fallback and NOT affinity — it applies only a previously
   * saved explicit choice, at tab-creation time only.
   */
  private resolveInitialRouteClass(url: string, requested: RouteClass): RouteClass {
    if (requested !== 'AUTO') {
      return requested;
    }
    if (!isAllowedNavigationUrl(url)) {
      return 'AUTO';
    }
    const host = normalizeDomain(url);
    const remembered = host ? this.routing.getRememberedRouteClass(host) : null;
    return remembered ?? 'AUTO';
  }

  private createWebEntry(id: string, url: string, routeClass: RouteClass = 'AUTO'): TabEntry {
    const effective = this.resolveInitialRouteClass(url, routeClass);
    return {
      id,
      kind: 'web',
      title: url,
      url,
      favicon: null,
      view: null,
      isLoading: true,
      canGoBack: false,
      canGoForward: false,
      crashed: false,
      sessionGroupId: null,
      loadFailed: false,
      audible: false,
      muted: false,
      routeClass: effective,
      partition: partitionForRouteClass(effective),
    };
  }

  private promoteToWeb(entry: TabEntry, url: string): void {
    navLog(entry.id, 'tabManager:promoteToWeb');
    entry.kind = 'web';
    applyUrl(entry, url);
    entry.title = url;
    entry.favicon = null;
    entry.isLoading = true;
    entry.loadFailed = false;
    // P2-A Route Memory: a fresh NTP tab carries routeClass AUTO; on promotion
    // honor a saved choice for the destination domain. An explicit per-tab
    // choice (DIRECT/PROXY) is preserved as-is by resolveInitialRouteClass.
    entry.routeClass = this.resolveInitialRouteClass(url, entry.routeClass);
    entry.partition = partitionForRouteClass(entry.routeClass);
    entry.view = this.createWebView(entry.id, entry.partition);
    this.attachAndLoad(entry);
    this.updateViewVisibility();
  }

  private createWebView(tabId: string, partition: RoutePartition): WebContentsViewType {
    const sess = this.sessions?.getSession(partition);
    const view = new WebContentsView({
      webPreferences: {
        ...WEB_PREFS,
        preload: join(__dirname, '../preload/guest.js'),
        // P1 Route Partitions: attach the view to the DIRECT or PROXY session.
        // Falls back to the default session only if the registry is absent.
        ...(sess ? { session: sess } : {}),
      },
    });
    navLog(tabId, 'tabManager:webContents-created', { partition, wcId: view.webContents.id });
    this.wireWebContents(view.webContents, tabId);
    applyProxyFingerprint(view.webContents, partition);
    navLog(tabId, 'tabManager:fingerprint-applied', { partition });
    // P3-B Tab Audio: a fresh webContents starts unmuted and silent. Re-apply the
    // tab's mute intent so it survives DIRECT↔PROXY migration and tab restore;
    // audible is reset and will be re-emitted by 'audio-state-changed'.
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.audible = false;
      if (entry.muted) {
        view.webContents.setAudioMuted(true);
      }
    }
    this.window.contentView.addChildView(view);
    return view;
  }

  private attachAndLoad(entry: TabEntry): void {
    if (!entry.view) {
      return;
    }
    this.layoutViews();
    navLog(entry.id, 'tabManager:loadURL-called', { url: entry.url, partition: entry.partition });
    void entry.view.webContents.loadURL(entry.url).catch(() => {
      entry.loadFailed = true;
      entry.isLoading = false;
      entry.title = `Ошибка: ${entry.url}`;
      this.emitState();
    });
  }

  private wireWebContents(webContents: WebContents, tabId: string): void {
    wireDetachedDevTools(webContents, () => this.tabs.get(tabId)?.partition === 'PROXY');

    webContents.on('did-start-loading', () => {
      navLog(tabId, 'event:did-start-loading');
      const entry = this.tabs.get(tabId);
      if (!entry) {
        return;
      }
      entry.isLoading = true;
      entry.crashed = false;
      entry.loadFailed = false;
      if (entry.kind === 'web') {
        entry.favicon = null;
        const domain = normalizeDomain(entry.url);
        if (domain) {
          this.navFallbackKeys.delete(`${tabId}:${domain}`);
        }
      }
      this.emitState();
    });

    webContents.on('dom-ready', () => {
      navLog(tabId, 'event:dom-ready');
    });

    webContents.on('did-stop-loading', () => {
      const entry = this.tabs.get(tabId);
      if (!entry) {
        return;
      }
      entry.isLoading = false;
      applyNavigationFlags(entry, webContents);
      this.emitState();
    });

    webContents.on('did-fail-load', (_event, errorCode, _desc, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      navLog(tabId, 'event:did-fail-load', { errorCode, url: validatedURL });
      // ERR_ABORTED (-3) is not a real failure: it fires on redirects,
      // superseded navigations and webContents.stop(). Treating it as an error
      // leaves a stale "Ошибка:" title on pages that actually load.
      if (errorCode === -3) {
        return;
      }
      const entry = this.tabs.get(tabId);
      if (!entry) {
        return;
      }

      // A failed navigation shouldn't leak the typed marker onto a later nav.
      this.typedNavTabIds.delete(tabId);

      const domain = normalizeDomain(validatedURL || entry.url);
      const attemptKey = `${tabId}:${domain}`;

      if (
        domain &&
        entry.kind === 'web' &&
        !this.navFallbackKeys.has(attemptKey) &&
        this.routing.shouldAllowAutoFallback(domain, errorCode)
      ) {
        this.navFallbackKeys.add(attemptKey);
        this.routing.setSessionHint(domain, 'PROXY');
        void this.routing.applyPac().then(() => {
          if (entry.view && !entry.view.webContents.isDestroyed()) {
            entry.loadFailed = false;
            entry.isLoading = true;
            this.routing.setPendingRemember(domain);
            entry.view.webContents.reload();
            this.emitState();
          }
        });
        return;
      }

      entry.loadFailed = true;
      entry.isLoading = false;
      entry.title = `Ошибка: ${validatedURL || entry.url}`;
      this.emitState();
    });

    webContents.on('did-finish-load', () => {
      navLog(tabId, 'event:did-finish-load', { adblock: adblockTakeForWc(webContents.id) ?? undefined });
      const entry = this.tabs.get(tabId);
      if (!entry) {
        return;
      }
      // P4.3: re-apply the PROXY timezone override as a safety net. The initial
      // pre-navigation override does not survive the first document commit, so it
      // is re-asserted here (and on did-navigate). No-op for DIRECT / DevTools-open.
      reapplyProxyFingerprint(webContents, entry.partition);
      // Success point: a fully-loaded page must never keep a stale error state.
      entry.loadFailed = false;
      entry.isLoading = false;
      if (entry.kind === 'web') {
        entry.title = webContents.getTitle() || entry.url;
      }
      this.emitState();
    });

    webContents.on('did-navigate', (_event, url) => {
      const entry = this.tabs.get(tabId);
      if (!entry || entry.kind !== 'web') {
        return;
      }
      if (!isAllowedNavigationUrl(url)) {
        webContents.stop();
        return;
      }
      // P4.3: re-apply the PROXY timezone override on every committed main-frame
      // navigation (this is the point the original code missed — the new document
      // lost the pre-navigation override). No-op for DIRECT / DevTools-open.
      reapplyProxyFingerprint(webContents, entry.partition);
      applyUrl(entry, url);
      applyNavigationFlags(entry, webContents);
      // History record (sanitized/throttled in HistoryStore).
      const route = this.routing.resolveForUrl(url);
      const routeMode: RouteMode = route.mode === 'ERROR' ? 'PROXY' : (route.mode as RouteMode);
      const typed = this.typedNavTabIds.delete(tabId);
      this.history.recordVisit({
        url,
        title: entry.title,
        favicon: entry.favicon,
        routeMode,
        typed,
      });
      this.broadcastHistory();
      // Password prompt heuristic: after login submit, prompt on successful navigate (same origin).
      if (this.passwords) {
        void this.passwords.maybeCreatePromptAfterNavigation(tabId, url).then(() => {
          void this.passwords!.isAvailable().then((available) => {
            this.setPasswordsSnapshot(this.passwords!.getStateSnapshot(available));
            this.broadcastPasswords();
          });
        });
      }
      this.emitState();
    });

    webContents.on('did-navigate-in-page', (_event, url) => {
      const entry = this.tabs.get(tabId);
      if (!entry || entry.kind !== 'web') {
        return;
      }
      if (!isAllowedNavigationUrl(url)) {
        return;
      }
      applyUrl(entry, url);
      applyNavigationFlags(entry, webContents);
      const route = this.routing.resolveForUrl(url);
      const routeMode: RouteMode = route.mode === 'ERROR' ? 'PROXY' : (route.mode as RouteMode);
      this.history.recordVisit({
        url,
        title: entry.title,
        favicon: entry.favicon,
        routeMode,
      });
      this.broadcastHistory();
      if (this.passwords) {
        void this.passwords.maybeCreatePromptAfterNavigation(tabId, url).then(() => {
          void this.passwords!.isAvailable().then((available) => {
            this.setPasswordsSnapshot(this.passwords!.getStateSnapshot(available));
            this.broadcastPasswords();
          });
        });
      }
      this.emitState();
    });

    webContents.on('page-title-updated', (_event, title) => {
      const entry = this.tabs.get(tabId);
      if (!entry || entry.loadFailed) {
        return;
      }
      entry.title = title || entry.url;
      this.emitState();
    });

    webContents.on('page-favicon-updated', (_event, favicons) => {
      const entry = this.tabs.get(tabId);
      if (!entry || entry.kind !== 'web') {
        return;
      }
      const next = pickFaviconUrl(favicons);
      if (next !== entry.favicon) {
        entry.favicon = next;
        this.emitState();
      }
    });

    webContents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigationUrl(url)) {
        event.preventDefault();
      }
    });

    webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigationUrl(url)) {
        // P1: a child tab (window.open / target=_blank / OAuth popup) inherits
        // the opener tab's routing intent so the popup stays on the same session.
        const opener = this.tabs.get(tabId);
        this.createTab(url, { routeClass: opener?.routeClass ?? 'AUTO' });
      }
      return { action: 'deny' };
    });

    // P3-B Tab Audio: track whether the page is emitting audio so the TabBar can
    // show a speaker indicator. Muting is applied separately (entry.muted) and
    // re-applied on view recreation (migrate/restore) inside createWebView.
    webContents.on('audio-state-changed', (event) => {
      const entry = this.tabs.get(tabId);
      if (!entry) return;
      if (entry.audible === event.audible) return;
      entry.audible = event.audible;
      this.emitState();
    });

    // HTML5 fullscreen: expand the active view to fill the whole window (it sits
    // above the chrome HTML, so chrome is naturally covered), restore on leave.
    webContents.on('enter-html-full-screen', () => {
      this.fullscreenTabId = tabId;
      this.layoutViews();
    });

    webContents.on('leave-html-full-screen', () => {
      if (this.fullscreenTabId === tabId) {
        this.fullscreenTabId = null;
      }
      this.layoutViews();
    });

    webContents.on('render-process-gone', (_event, details) => {
      const entry = this.tabs.get(tabId);
      if (!entry) {
        return;
      }
      if (this.fullscreenTabId === tabId) {
        this.fullscreenTabId = null;
      }
      entry.crashed = true;
      entry.isLoading = false;
      entry.title = `Сбой вкладки (${details.reason})`;
      if (entry.view) {
        this.teardownTabView(entry);
      }
      this.emitState();
    });
  }

  private recoverCrashedTab(entry: TabEntry): void {
    const url = entry.url;
    entry.crashed = false;
    entry.loadFailed = false;
    entry.view = this.createWebView(entry.id, entry.partition);
    this.attachAndLoad(entry);
    entry.url = url;
    this.updateViewVisibility();
  }

  private updateViewVisibility(): void {
    if (this.shuttingDown || this.window.isDestroyed()) return;
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    const activeGroupId = active?.sessionGroupId;
    const activeGroup = activeGroupId ? this.sessionGroups.get(activeGroupId) : undefined;

    for (const entry of this.tabs.values()) {
      if (!entry.view) {
        continue;
      }
      let visible = entry.id === this.activeTabId && entry.kind === 'web' && !entry.crashed;

      if (activeGroup?.collapsed && entry.sessionGroupId === activeGroupId) {
        visible =
          entry.id === this.activeTabId && entry.kind === 'web' && !entry.crashed;
      }

      entry.view.setVisible(visible);
    }
    this.layoutViews();
  }

  getChromeTopHeightPx(): number {
    return this.chromeTopHeightPx;
  }

  /** Measured chrome-stack height (tab bar + toolbar + banners) before baseline clamp. */
  getChromeStackMeasuredHeightPx(): number {
    return this.chromeStackMeasuredHeightPx;
  }

  /** Measured chrome stack from renderer (tab bar + toolbar + banners + password prompt). */
  setChromeTopHeightPx(heightPx: number): void {
    const measured = Math.round(heightPx);
    this.chromeStackMeasuredHeightPx = measured;
    const next = Math.max(chromeBaselineTopHeightPx(), measured);
    if (next === this.chromeTopHeightPx) {
      return;
    }
    this.chromeTopHeightPx = next;
    this.layoutViews();
  }

  getBrowserWindow(): BrowserWindow {
    return this.window;
  }

  private layoutViews(): void {
    if (this.shuttingDown || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const bounds = getWebContentBounds(width, height, this.chromeTopHeightPx);
    const fullBounds = { x: 0, y: 0, width, height };
    for (const entry of this.tabs.values()) {
      if (entry.view) {
        entry.view.setBounds(entry.id === this.fullscreenTabId ? fullBounds : bounds);
      }
    }
  }

  private destroyAll(): void {
    if (this.shuttingDown) return;

    // Capture the final session before tearing down (close fires once).
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.flushSession();

    this.shuttingDown = true;

    try {
      if (!this.window.isDestroyed()) {
        this.window.removeListener('close', this.onWindowClose);
      }
    } catch (e) {
      console.warn('[alpha][tabs] removeListener failed', { err: String(e) });
    }

    const ids = Array.from(this.tabs.keys());
    for (const tabId of ids) {
      const entry = this.tabs.get(tabId);
      if (!entry) continue;
      this.tabs.delete(tabId);
      this.teardownTabView(entry);
    }

    this.tabOrder = [];
    this.activeTabId = null;
    this.tabs.clear();
    this.sessionGroups.clear();
  }

  private emitState(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('tabs:state-changed', this.getState());
    }
    this.schedulePersist();
  }

  broadcastSavedGroups(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('saved-groups:changed', this.savedGroups.list());
    }
  }

  broadcastBookmarks(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('bookmarks:changed');
    }
  }

  broadcastHistory(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('history:changed');
    }
  }

  broadcastDownloads(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('downloads:changed');
    }
  }

  broadcastAdblock(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('adblock:changed');
    }
  }

  broadcastPasswords(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('passwords:changed');
    }
  }

  broadcastShortcuts(): void {
    if (!this.chromeWebContents.isDestroyed()) {
      this.chromeWebContents.send('shortcuts:changed');
    }
  }

  setAdblockSnapshot(next: AdblockStateSnapshot): void {
    this.adblockSnapshot = next;
    this.emitState();
  }

  setPasswordsSnapshot(next: PasswordStateSnapshot): void {
    this.passwordsSnapshot = next;
    this.emitState();
  }
}
