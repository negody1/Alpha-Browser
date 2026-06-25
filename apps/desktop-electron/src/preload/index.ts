import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  Bookmark,
  BookmarkFolder,
  BrowserStateSnapshot,
  DownloadItemSnapshot,
  HistoryEntry,
  RouteClass,
  RouteMode,
  SavedGroup,
  AdblockStateSnapshot,
  PasswordEntryMetadata,
  ShortcutLink,
  OmniboxSuggestion,
  PermissionCapability,
  PermissionSiteEntry,
  UpdateNotice,
  ProxyDiagnosticsSnapshot,
  AccessDetails,
  ActivationState,
} from '@alpha/shared-types';

export interface AlphaApi {
  getVersion: () => Promise<string>;
  shell: {
    setChromeTopHeight: (heightPx: number) => Promise<void>;
    showTabContextMenu: (tabId: string, x: number, y: number) => Promise<void>;
    showGroupContextMenu: (groupId: string, x: number, y: number) => Promise<void>;
    showRouteMenu: (x: number, y: number) => Promise<void>;
    showAdblockMenu: (x: number, y: number) => Promise<void>;
    onStartGroupRename: (listener: (groupId: string) => void) => () => void;
    onOpenRoutingSettings: (listener: () => void) => () => void;
    requestGroupRename: (groupId: string) => Promise<void>;
    onOverlayState: (listener: (state: { openPanel: string | null }) => void) => () => void;
  };
  permission: {
    resolve: (requestId: string, allow: boolean) => Promise<void>;
    list: () => Promise<PermissionSiteEntry[]>;
    remove: (host: string, capability: PermissionCapability) => Promise<PermissionSiteEntry[]>;
    removeSite: (host: string) => Promise<PermissionSiteEntry[]>;
    clearAll: () => Promise<PermissionSiteEntry[]>;
    onChanged: (listener: () => void) => () => void;
  };
  screenShare: {
    resolve: (requestId: string, sourceId: string) => Promise<void>;
    cancel: (requestId: string) => Promise<void>;
  };
  overlay: {
    togglePanel: (kind: 'groups-panel' | 'bookmarks-panel' | 'history-panel' | 'routing-panel' | 'downloads-panel') => Promise<void>;
    openPanel: (kind: 'groups-panel' | 'bookmarks-panel' | 'history-panel' | 'routing-panel' | 'downloads-panel') => Promise<void>;
    closePanel: () => Promise<void>;
    closePopup: () => Promise<void>;
    confirmCloseGroup: (groupId: string) => Promise<void>;
    onSetState: (listener: (state: { kind: string; payload?: Record<string, unknown> | null; placement?: 'left' | 'right' }) => void) => () => void;
  };

  resolveNavigationUrl: (input: string) => Promise<string>;
  tabs: {
    getState: () => Promise<BrowserStateSnapshot>;
    create: (payload?: { url?: string }) => Promise<BrowserStateSnapshot>;
    close: (tabId: string) => Promise<BrowserStateSnapshot>;
    switch: (tabId: string) => Promise<BrowserStateSnapshot>;
    navigate: (
      tabId: string,
      input: string,
      meta?: { source?: 'toolbar' | 'home' | 'ntp'; suggestionKind?: string },
    ) => Promise<BrowserStateSnapshot>;
    goBack: (tabId?: string) => Promise<BrowserStateSnapshot>;
    goForward: (tabId?: string) => Promise<BrowserStateSnapshot>;
    reload: (tabId?: string) => Promise<BrowserStateSnapshot>;
    recover: (tabId: string) => Promise<BrowserStateSnapshot>;
    closeOthers: (tabId: string) => Promise<BrowserStateSnapshot>;
    closeToRight: (tabId: string) => Promise<BrowserStateSnapshot>;
    stop: (tabId?: string) => Promise<BrowserStateSnapshot>;
    reorder: (tabIds: string[]) => Promise<BrowserStateSnapshot>;
    duplicate: (tabId: string) => Promise<BrowserStateSnapshot>;
    openSettings: () => Promise<BrowserStateSnapshot>;
    setRoute: (routeClass: RouteClass, tabId?: string) => Promise<BrowserStateSnapshot>;
    setMuted: (muted: boolean, tabId?: string) => Promise<BrowserStateSnapshot>;
    onStateChanged: (listener: (state: BrowserStateSnapshot) => void) => () => void;
  };
  savedGroups: {
    list: () => Promise<SavedGroup[]>;
    create: (payload: {
      title: string;
      color: string;
      urls?: string[];
    }) => Promise<SavedGroup | null>;
    update: (payload: {
      id: string;
      title?: string;
      color?: string;
      urls?: string[];
    }) => Promise<SavedGroup | null>;
    delete: (id: string) => Promise<boolean>;
    addUrl: (id: string, url: string) => Promise<SavedGroup | null>;
    removeUrl: (id: string, url: string) => Promise<SavedGroup | null>;
    open: (id: string) => Promise<BrowserStateSnapshot>;
    onChanged: (listener: (groups: SavedGroup[]) => void) => () => void;
  };
  sessionGroups: {
    create: (payload: {
      title: string;
      color: string;
      tabIds?: string[];
    }) => Promise<BrowserStateSnapshot>;
    createWithNewTab: () => Promise<BrowserStateSnapshot>;
    rename: (groupId: string, title: string) => Promise<BrowserStateSnapshot>;
    setColor: (groupId: string, color: string) => Promise<BrowserStateSnapshot>;
    toggleCollapsed: (groupId: string) => Promise<BrowserStateSnapshot>;
    addTab: (groupId: string, tabId: string) => Promise<BrowserStateSnapshot>;
    reorderTabs: (groupId: string, tabIds: string[]) => Promise<BrowserStateSnapshot>;
    removeTab: (tabId: string) => Promise<BrowserStateSnapshot>;
    ungroup: (groupId: string) => Promise<BrowserStateSnapshot>;
    closeGroup: (groupId: string) => Promise<BrowserStateSnapshot>;
    open: (groupId: string) => Promise<BrowserStateSnapshot>;
    delete: (groupId: string) => Promise<BrowserStateSnapshot>;
    saveAsWorkspace: (groupId: string) => Promise<BrowserStateSnapshot>;
  };
  routing: {
    getState: () => Promise<BrowserStateSnapshot>;
    getRules: () => Promise<BrowserStateSnapshot['routing']>;
    setDefaultRoute: (route: RouteMode) => Promise<BrowserStateSnapshot>;
    setProxyEndpoint: (endpoint: string) => Promise<BrowserStateSnapshot>;
    addRule: (domain: string, route: RouteMode) => Promise<BrowserStateSnapshot>;
    updateRule: (domain: string, route: RouteMode) => Promise<BrowserStateSnapshot>;
    deleteRule: (domain: string) => Promise<BrowserStateSnapshot>;
    setTemporaryOverride: (domain: string, mode: RouteMode) => Promise<BrowserStateSnapshot>;
    clearTemporaryOverride: (domain: string) => Promise<BrowserStateSnapshot>;
    saveCurrentRouteAsRule: (domain: string, route: RouteMode) => Promise<BrowserStateSnapshot>;
    reloadPac: () => Promise<BrowserStateSnapshot>;
    confirmReload: (tabId: string) => Promise<BrowserStateSnapshot>;
    dismissRemember: () => Promise<BrowserStateSnapshot>;
    dismissReload: () => Promise<BrowserStateSnapshot>;
    openDirectFallback: (domain: string) => Promise<BrowserStateSnapshot>;
  };
  bookmarks: {
    list: () => Promise<{ bookmarks: Bookmark[]; folders: BookmarkFolder[] }>;
    upsert: (payload: {
      url: string;
      title: string;
      favicon?: string | null;
      folderId?: string | null;
    }) => Promise<Bookmark | null>;
    update: (payload: {
      id: string;
      title?: string;
      url?: string;
      favicon?: string | null;
      folderId?: string | null;
    }) => Promise<Bookmark | null>;
    delete: (id: string) => Promise<boolean>;
    createFolder: (payload: { title: string; parentId?: string | null }) => Promise<BookmarkFolder | null>;
    updateFolder: (payload: { id: string; title?: string; parentId?: string | null }) => Promise<BookmarkFolder | null>;
    deleteFolder: (id: string) => Promise<boolean>;
    onChanged: (listener: () => void) => () => void;
  };
  history: {
    list: () => Promise<HistoryEntry[]>;
    delete: (id: string) => Promise<boolean>;
    clear: () => Promise<boolean>;
    onChanged: (listener: () => void) => () => void;
  };
  downloads: {
    list: () => Promise<DownloadItemSnapshot[]>;
    getDownloadDir: () => Promise<string | null>;
    chooseDownloadDir: () => Promise<string | null>;
    cancel: (id: string) => Promise<boolean>;
    resume: (id: string) => Promise<boolean>;
    retry: (id: string) => Promise<boolean>;
    remove: (id: string) => Promise<boolean>;
    clearCompleted: () => Promise<boolean>;
    openFile: (id: string) => Promise<boolean>;
    showInFolder: (id: string) => Promise<boolean>;
    isDangerous: (id: string) => Promise<boolean>;
    onChanged: (listener: () => void) => () => void;
  };
  adblock: {
    getState: () => Promise<AdblockStateSnapshot | null>;
    setEnabled: (enabled: boolean) => Promise<boolean>;
    setSiteDisabled: (domain: string, disabled: boolean) => Promise<boolean>;
    onChanged: (listener: () => void) => () => void;
  };
  privacy: {
    /** Clears cookies/storage/cache for the PROXY profile only (DIRECT untouched). */
    resetProxyIdentity: () => Promise<{ ok: boolean; reloadedTabs: number; error?: string }>;
  };
  updates: {
    check: () => Promise<UpdateNotice | null>;
    openReleasePage: (url?: string) => Promise<boolean>;
    onAvailable: (listener: (info: UpdateNotice) => void) => () => void;
  };
  proxy: {
    diagnostics: () => Promise<ProxyDiagnosticsSnapshot | null>;
    checkEgress: () => Promise<ProxyDiagnosticsSnapshot | null>;
    retry: () => Promise<ProxyDiagnosticsSnapshot | null>;
  };
  activation: {
    getState: () => Promise<ActivationState | null>;
    register: (email: string) => Promise<ActivationState | null>;
    activate: (email: string, code: string) => Promise<ActivationState | null>;
    checkStatus: () => Promise<ActivationState | null>;
    getDetails: () => Promise<AccessDetails | null>;
  };
  passwords: {
    isAvailable: () => Promise<boolean>;
    listMetadata: () => Promise<PasswordEntryMetadata[]>;
    reveal: (id: string) => Promise<string | null>;
    update: (id: string, payload: { username?: string; password?: string }) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
    setNeverSave: (origin: string, never: boolean) => Promise<boolean>;
    promptAction: (id: string, action: 'save' | 'dismiss' | 'never') => Promise<boolean>;
    onChanged: (listener: () => void) => () => void;
  };
  shortcuts: {
    list: () => Promise<ShortcutLink[]>;
    upsert: (payload: { id?: string; title: string; url: string; iconUrl?: string | null }) => Promise<ShortcutLink | null>;
    remove: (id: string) => Promise<boolean>;
    reorder: (ids: string[]) => Promise<ShortcutLink[]>;
    onChanged: (listener: () => void) => () => void;
  };
  omnibox: {
    query: (input: string, limit?: number) => Promise<OmniboxSuggestion[]>;
    overlaySync: (payload: {
      suggestions: OmniboxSuggestion[];
      selectedIndex: number;
      anchor: { x: number; y: number; width: number };
    }) => Promise<void>;
    overlayHide: () => Promise<void>;
    overlayPick: (index: number) => Promise<void>;
    overlayHover: (index: number) => Promise<void>;
    onPicked: (listener: (index: number) => void) => () => void;
    onHovered: (listener: (index: number) => void) => () => void;
  };
  debug: {
    omnibox: boolean;
    adblock: boolean;
  };
}

const alphaApi: AlphaApi = {
  getVersion: () => ipcRenderer.invoke('alpha:app:getVersion') as Promise<string>,
  shell: {
    setChromeTopHeight: (heightPx) =>
      ipcRenderer.invoke('shell:setChromeTopHeight', { heightPx }) as Promise<void>,
    showTabContextMenu: (tabId, x, y) =>
      ipcRenderer.invoke('shell:showTabContextMenu', { tabId, x, y }) as Promise<void>,
    showGroupContextMenu: (groupId, x, y) =>
      ipcRenderer.invoke('shell:showGroupContextMenu', { groupId, x, y }) as Promise<void>,
    showRouteMenu: (x, y) =>
      ipcRenderer.invoke('shell:showRouteMenu', { x, y }) as Promise<void>,
    showAdblockMenu: (x, y) =>
      ipcRenderer.invoke('shell:showAdblockMenu', { x, y }) as Promise<void>,
    onStartGroupRename: (listener) => {
      const handler = (_event: IpcRendererEvent, payload: { groupId: string }) => {
        listener(payload.groupId);
      };
      ipcRenderer.on('shell:start-group-rename', handler);
      return () => ipcRenderer.removeListener('shell:start-group-rename', handler);
    },
    onOpenRoutingSettings: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('shell:open-routing-settings', handler);
      return () => ipcRenderer.removeListener('shell:open-routing-settings', handler);
    },
    requestGroupRename: (groupId) =>
      ipcRenderer.invoke('shell:requestGroupRename', { groupId }) as Promise<void>,
    onOverlayState: (listener) => {
      const handler = (_event: IpcRendererEvent, state: { openPanel: string | null }) => listener(state);
      ipcRenderer.on('shell:overlay-state', handler);
      return () => ipcRenderer.removeListener('shell:overlay-state', handler);
    },
  },
  permission: {
    resolve: (requestId: string, allow: boolean) =>
      ipcRenderer.invoke('permission:resolve', { requestId, allow }) as Promise<void>,
    list: () => ipcRenderer.invoke('permission:list') as Promise<PermissionSiteEntry[]>,
    remove: (host: string, capability: PermissionCapability) =>
      ipcRenderer.invoke('permission:remove', { host, capability }) as Promise<PermissionSiteEntry[]>,
    removeSite: (host: string) =>
      ipcRenderer.invoke('permission:removeSite', { host }) as Promise<PermissionSiteEntry[]>,
    clearAll: () => ipcRenderer.invoke('permission:clearAll') as Promise<PermissionSiteEntry[]>,
    onChanged: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on('permission:changed', handler);
      return () => ipcRenderer.removeListener('permission:changed', handler);
    },
  },
  screenShare: {
    resolve: (requestId: string, sourceId: string) =>
      ipcRenderer.invoke('screenshare:resolve', { requestId, sourceId }) as Promise<void>,
    cancel: (requestId: string) =>
      ipcRenderer.invoke('screenshare:cancel', { requestId }) as Promise<void>,
  },
  overlay: {
    togglePanel: (kind) => ipcRenderer.invoke('overlay:togglePanel', { kind }) as Promise<void>,
    openPanel: (kind) => ipcRenderer.invoke('overlay:openPanel', { kind }) as Promise<void>,
    closePanel: () => ipcRenderer.invoke('overlay:closePanel') as Promise<void>,
    closePopup: () => ipcRenderer.invoke('overlay:closePopup') as Promise<void>,
    confirmCloseGroup: (groupId) =>
      ipcRenderer.invoke('overlay:confirmCloseGroup', { groupId }) as Promise<void>,
    onSetState: (listener) => {
      const handler = (_event: IpcRendererEvent, state: { kind: string; payload?: Record<string, unknown> | null; placement?: 'left' | 'right' }) => listener(state);
      ipcRenderer.on('overlay:setState', handler);
      return () => ipcRenderer.removeListener('overlay:setState', handler);
    },
  },
  resolveNavigationUrl: (input: string) =>
    ipcRenderer.invoke('alpha:navigate:resolve', { input }) as Promise<string>,
  tabs: {
    getState: () => ipcRenderer.invoke('tabs:getState') as Promise<BrowserStateSnapshot>,
    create: (payload) =>
      ipcRenderer.invoke('tabs:create', payload ?? {}) as Promise<BrowserStateSnapshot>,
    close: (tabId) => ipcRenderer.invoke('tabs:close', { tabId }) as Promise<BrowserStateSnapshot>,
    switch: (tabId) => ipcRenderer.invoke('tabs:switch', { tabId }) as Promise<BrowserStateSnapshot>,
    navigate: (tabId, input, meta) =>
      ipcRenderer.invoke('tabs:navigate', {
        tabId,
        input,
        source: meta?.source,
        suggestionKind: meta?.suggestionKind,
      }) as Promise<BrowserStateSnapshot>,
    goBack: (tabId) =>
      ipcRenderer.invoke('tabs:goBack', { tabId }) as Promise<BrowserStateSnapshot>,
    goForward: (tabId) =>
      ipcRenderer.invoke('tabs:goForward', { tabId }) as Promise<BrowserStateSnapshot>,
    reload: (tabId) =>
      ipcRenderer.invoke('tabs:reload', { tabId }) as Promise<BrowserStateSnapshot>,
    recover: (tabId) =>
      ipcRenderer.invoke('tabs:recover', { tabId }) as Promise<BrowserStateSnapshot>,
    closeOthers: (tabId) =>
      ipcRenderer.invoke('tabs:closeOthers', { tabId }) as Promise<BrowserStateSnapshot>,
    closeToRight: (tabId) =>
      ipcRenderer.invoke('tabs:closeToRight', { tabId }) as Promise<BrowserStateSnapshot>,
    stop: (tabId) => ipcRenderer.invoke('tabs:stop', { tabId }) as Promise<BrowserStateSnapshot>,
    reorder: (tabIds) => ipcRenderer.invoke('tabs:reorder', { tabIds }) as Promise<BrowserStateSnapshot>,
    duplicate: (tabId) =>
      ipcRenderer.invoke('tabs:duplicate', { tabId, preserveGroup: true }) as Promise<BrowserStateSnapshot>,
    openSettings: () =>
      ipcRenderer.invoke('tabs:openSettings') as Promise<BrowserStateSnapshot>,
    setRoute: (routeClass, tabId) =>
      ipcRenderer.invoke('tabs:setRoute', { routeClass, tabId }) as Promise<BrowserStateSnapshot>,
    setMuted: (muted, tabId) =>
      ipcRenderer.invoke('tabs:setMuted', { muted, tabId }) as Promise<BrowserStateSnapshot>,
    onStateChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, state: BrowserStateSnapshot) => listener(state);
      ipcRenderer.on('tabs:state-changed', handler);
      return () => ipcRenderer.removeListener('tabs:state-changed', handler);
    },
  },
  savedGroups: {
    list: () => ipcRenderer.invoke('savedGroups:list') as Promise<SavedGroup[]>,
    create: (payload) =>
      ipcRenderer.invoke('savedGroups:create', payload) as Promise<SavedGroup | null>,
    update: (payload) =>
      ipcRenderer.invoke('savedGroups:update', payload) as Promise<SavedGroup | null>,
    delete: (id) => ipcRenderer.invoke('savedGroups:delete', { id }) as Promise<boolean>,
    addUrl: (id, url) =>
      ipcRenderer.invoke('savedGroups:addUrl', { id, url }) as Promise<SavedGroup | null>,
    removeUrl: (id, url) =>
      ipcRenderer.invoke('savedGroups:removeUrl', { id, url }) as Promise<SavedGroup | null>,
    open: (id) => ipcRenderer.invoke('savedGroups:open', { id }) as Promise<BrowserStateSnapshot>,
    onChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, groups: SavedGroup[]) => listener(groups);
      ipcRenderer.on('saved-groups:changed', handler);
      return () => ipcRenderer.removeListener('saved-groups:changed', handler);
    },
  },
  sessionGroups: {
    create: (payload) =>
      ipcRenderer.invoke('sessionGroups:create', payload) as Promise<BrowserStateSnapshot>,
    createWithNewTab: () =>
      ipcRenderer.invoke('sessionGroups:createWithNewTab') as Promise<BrowserStateSnapshot>,
    rename: (groupId, title) =>
      ipcRenderer.invoke('sessionGroups:rename', { groupId, title }) as Promise<BrowserStateSnapshot>,
    setColor: (groupId, color) =>
      ipcRenderer.invoke('sessionGroups:setColor', { groupId, color }) as Promise<BrowserStateSnapshot>,
    toggleCollapsed: (groupId) =>
      ipcRenderer.invoke('sessionGroups:toggleCollapsed', {
        groupId,
      }) as Promise<BrowserStateSnapshot>,
    addTab: (groupId, tabId) =>
      ipcRenderer.invoke('sessionGroups:addTab', { groupId, tabId }) as Promise<BrowserStateSnapshot>,
    reorderTabs: (groupId, tabIds) =>
      ipcRenderer.invoke('sessionGroups:reorderTabs', { groupId, tabIds }) as Promise<BrowserStateSnapshot>,
    removeTab: (tabId) =>
      ipcRenderer.invoke('sessionGroups:removeTab', { tabId }) as Promise<BrowserStateSnapshot>,
    ungroup: (groupId) =>
      ipcRenderer.invoke('sessionGroups:ungroup', { groupId }) as Promise<BrowserStateSnapshot>,
    closeGroup: (groupId) =>
      ipcRenderer.invoke('sessionGroups:closeGroup', { groupId }) as Promise<BrowserStateSnapshot>,
    open: (groupId) =>
      ipcRenderer.invoke('sessionGroups:open', { groupId }) as Promise<BrowserStateSnapshot>,
    delete: (groupId) =>
      ipcRenderer.invoke('sessionGroups:delete', { groupId }) as Promise<BrowserStateSnapshot>,
    saveAsWorkspace: (groupId) =>
      ipcRenderer.invoke('sessionGroups:saveAsWorkspace', {
        groupId,
      }) as Promise<BrowserStateSnapshot>,
  },
  routing: {
    getState: () => ipcRenderer.invoke('routing:getState') as Promise<BrowserStateSnapshot>,
    getRules: () => ipcRenderer.invoke('routing:getRules') as Promise<BrowserStateSnapshot['routing']>,
    setDefaultRoute: (route) =>
      ipcRenderer.invoke('routing:setDefaultRoute', { route }) as Promise<BrowserStateSnapshot>,
    setProxyEndpoint: (endpoint) =>
      ipcRenderer.invoke('routing:setProxyEndpoint', { endpoint }) as Promise<BrowserStateSnapshot>,
    addRule: (domain, route) =>
      ipcRenderer.invoke('routing:addRule', { domain, route }) as Promise<BrowserStateSnapshot>,
    updateRule: (domain, route) =>
      ipcRenderer.invoke('routing:updateRule', { domain, route }) as Promise<BrowserStateSnapshot>,
    deleteRule: (domain) =>
      ipcRenderer.invoke('routing:deleteRule', { domain }) as Promise<BrowserStateSnapshot>,
    setTemporaryOverride: (domain, mode) =>
      ipcRenderer.invoke('routing:setTemporaryOverride', {
        domain,
        mode,
      }) as Promise<BrowserStateSnapshot>,
    clearTemporaryOverride: (domain) =>
      ipcRenderer.invoke('routing:clearTemporaryOverride', { domain }) as Promise<BrowserStateSnapshot>,
    saveCurrentRouteAsRule: (domain, route) =>
      ipcRenderer.invoke('routing:saveCurrentRouteAsRule', { domain, route }) as Promise<BrowserStateSnapshot>,
    reloadPac: () => ipcRenderer.invoke('routing:reloadPac') as Promise<BrowserStateSnapshot>,
    confirmReload: (tabId) =>
      ipcRenderer.invoke('routing:confirmReload', { tabId }) as Promise<BrowserStateSnapshot>,
    dismissRemember: () =>
      ipcRenderer.invoke('routing:dismissRemember') as Promise<BrowserStateSnapshot>,
    dismissReload: () =>
      ipcRenderer.invoke('routing:dismissReload') as Promise<BrowserStateSnapshot>,
    openDirectFallback: (domain) =>
      ipcRenderer.invoke('routing:openDirectFallback', { domain }) as Promise<BrowserStateSnapshot>,
  },
  bookmarks: {
    list: () => ipcRenderer.invoke('bookmarks:list') as Promise<{ bookmarks: Bookmark[]; folders: BookmarkFolder[] }>,
    upsert: (payload) => ipcRenderer.invoke('bookmarks:upsert', payload) as Promise<Bookmark | null>,
    update: (payload) => ipcRenderer.invoke('bookmarks:update', payload) as Promise<Bookmark | null>,
    delete: (id) => ipcRenderer.invoke('bookmarks:delete', { id }) as Promise<boolean>,
    createFolder: (payload) =>
      ipcRenderer.invoke('bookmarks:folders:create', payload) as Promise<BookmarkFolder | null>,
    updateFolder: (payload) =>
      ipcRenderer.invoke('bookmarks:folders:update', payload) as Promise<BookmarkFolder | null>,
    deleteFolder: (id) => ipcRenderer.invoke('bookmarks:folders:delete', { id }) as Promise<boolean>,
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('bookmarks:changed', handler);
      return () => ipcRenderer.removeListener('bookmarks:changed', handler);
    },
  },
  history: {
    list: () => ipcRenderer.invoke('history:list') as Promise<HistoryEntry[]>,
    delete: (id) => ipcRenderer.invoke('history:delete', { id }) as Promise<boolean>,
    clear: () => ipcRenderer.invoke('history:clear') as Promise<boolean>,
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('history:changed', handler);
      return () => ipcRenderer.removeListener('history:changed', handler);
    },
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list') as Promise<DownloadItemSnapshot[]>,
    getDownloadDir: () => ipcRenderer.invoke('downloads:getDownloadDir') as Promise<string | null>,
    chooseDownloadDir: () => ipcRenderer.invoke('downloads:chooseDownloadDir') as Promise<string | null>,
    cancel: (id) => ipcRenderer.invoke('downloads:cancel', { id }) as Promise<boolean>,
    resume: (id) => ipcRenderer.invoke('downloads:resume', { id }) as Promise<boolean>,
    retry: (id) => ipcRenderer.invoke('downloads:retry', { id }) as Promise<boolean>,
    remove: (id) => ipcRenderer.invoke('downloads:remove', { id }) as Promise<boolean>,
    clearCompleted: () => ipcRenderer.invoke('downloads:clearCompleted') as Promise<boolean>,
    openFile: (id) => ipcRenderer.invoke('downloads:openFile', { id }) as Promise<boolean>,
    showInFolder: (id) => ipcRenderer.invoke('downloads:showInFolder', { id }) as Promise<boolean>,
    isDangerous: (id) => ipcRenderer.invoke('downloads:isDangerous', { id }) as Promise<boolean>,
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('downloads:changed', handler);
      return () => ipcRenderer.removeListener('downloads:changed', handler);
    },
  },
  adblock: {
    getState: () => ipcRenderer.invoke('adblock:getState') as Promise<AdblockStateSnapshot | null>,
    setEnabled: (enabled) => ipcRenderer.invoke('adblock:setEnabled', { enabled }) as Promise<boolean>,
    setSiteDisabled: (domain, disabled) =>
      ipcRenderer.invoke('adblock:setSiteDisabled', { domain, disabled }) as Promise<boolean>,
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('adblock:changed', handler);
      return () => ipcRenderer.removeListener('adblock:changed', handler);
    },
  },
  privacy: {
    resetProxyIdentity: () =>
      ipcRenderer.invoke('privacy:resetProxyIdentity') as Promise<{
        ok: boolean;
        reloadedTabs: number;
        error?: string;
      }>,
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check') as Promise<UpdateNotice | null>,
    openReleasePage: (url) =>
      ipcRenderer.invoke('updates:openReleasePage', { url }) as Promise<boolean>,
    onAvailable: (listener) => {
      const handler = (_e: IpcRendererEvent, info: UpdateNotice) => listener(info);
      ipcRenderer.on('updates:available', handler);
      return () => ipcRenderer.removeListener('updates:available', handler);
    },
  },
  proxy: {
    diagnostics: () =>
      ipcRenderer.invoke('proxy:diagnostics') as Promise<ProxyDiagnosticsSnapshot | null>,
    checkEgress: () =>
      ipcRenderer.invoke('proxy:checkEgress') as Promise<ProxyDiagnosticsSnapshot | null>,
    retry: () =>
      ipcRenderer.invoke('proxy:retry') as Promise<ProxyDiagnosticsSnapshot | null>,
  },
  activation: {
    getState: () => ipcRenderer.invoke('activation:getState') as Promise<ActivationState | null>,
    register: (email) => ipcRenderer.invoke('activation:register', { email }) as Promise<ActivationState | null>,
    activate: (email, code) =>
      ipcRenderer.invoke('activation:activate', { email, code }) as Promise<ActivationState | null>,
    checkStatus: () => ipcRenderer.invoke('activation:checkStatus') as Promise<ActivationState | null>,
    getDetails: () => ipcRenderer.invoke('activation:getDetails') as Promise<AccessDetails | null>,
  },
  passwords: {
    isAvailable: () => ipcRenderer.invoke('passwords:isAvailable') as Promise<boolean>,
    listMetadata: () => ipcRenderer.invoke('passwords:listMetadata') as Promise<PasswordEntryMetadata[]>,
    reveal: (id) => ipcRenderer.invoke('passwords:reveal', { id }) as Promise<string | null>,
    update: (id, payload) =>
      ipcRenderer.invoke('passwords:update', { id, ...payload }) as Promise<boolean>,
    delete: (id) => ipcRenderer.invoke('passwords:delete', { id }) as Promise<boolean>,
    setNeverSave: (origin, never) => ipcRenderer.invoke('passwords:setNeverSave', { origin, never }) as Promise<boolean>,
    promptAction: (id, action) => ipcRenderer.invoke('passwords:promptAction', { id, action }) as Promise<boolean>,
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('passwords:changed', handler);
      return () => ipcRenderer.removeListener('passwords:changed', handler);
    },
  },
  shortcuts: {
    list: () => ipcRenderer.invoke('shortcuts:list') as Promise<ShortcutLink[]>,
    upsert: (payload) => ipcRenderer.invoke('shortcuts:upsert', payload) as Promise<ShortcutLink | null>,
    remove: (id) => ipcRenderer.invoke('shortcuts:remove', { id }) as Promise<boolean>,
    reorder: (ids) => ipcRenderer.invoke('shortcuts:reorder', { ids }) as Promise<ShortcutLink[]>,
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('shortcuts:changed', handler);
      return () => ipcRenderer.removeListener('shortcuts:changed', handler);
    },
  },
  omnibox: {
    query: (input, limit) =>
      ipcRenderer.invoke('omnibox:query', { input, limit }) as Promise<OmniboxSuggestion[]>,
    overlaySync: (payload) =>
      ipcRenderer.invoke('omnibox:overlaySync', payload) as Promise<void>,
    overlayHide: () => ipcRenderer.invoke('omnibox:overlayHide') as Promise<void>,
    overlayPick: (index) =>
      ipcRenderer.invoke('omnibox:overlayPick', { index }) as Promise<void>,
    overlayHover: (index) =>
      ipcRenderer.invoke('omnibox:overlayHover', { index }) as Promise<void>,
    onPicked: (listener) => {
      const handler = (_event: IpcRendererEvent, index: number) => listener(index);
      ipcRenderer.on('omnibox:picked', handler);
      return () => ipcRenderer.removeListener('omnibox:picked', handler);
    },
    onHovered: (listener) => {
      const handler = (_event: IpcRendererEvent, index: number) => listener(index);
      ipcRenderer.on('omnibox:hovered', handler);
      return () => ipcRenderer.removeListener('omnibox:hovered', handler);
    },
  },
  // Debug flags read from the main process env at preload time (renderer can't
  // read process.env directly). Used to gate verbose omnibox/adblock logging.
  debug: {
    omnibox: process.env.ALPHA_DEBUG_OMNIBOX === '1',
    adblock: process.env.ALPHA_DEBUG_ADBLOCK === '1',
  },
};

contextBridge.exposeInMainWorld('alpha', alphaApi);
