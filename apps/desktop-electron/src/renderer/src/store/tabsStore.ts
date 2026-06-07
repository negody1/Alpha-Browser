import { create } from 'zustand';
import {
  DEFAULT_PROXY_ENDPOINT,
  DEFAULT_PROXY_KEY,
  type AdblockStateSnapshot,
  type Bookmark,
  type BookmarkFolder,
  type BrowserStateSnapshot,
  type DownloadItemSnapshot,
  type HistoryEntry,
  type PasswordStateSnapshot,
  type ProxyClientSnapshot,
  type RoutingStateSnapshot,
  type SavedGroup,
  type ShortcutLink,
} from '@alpha/shared-types';

const defaultRouting: RoutingStateSnapshot = {
  defaultRoute: 'AUTO',
  proxyEndpoints: { [DEFAULT_PROXY_KEY]: DEFAULT_PROXY_ENDPOINT },
  rules: [],
  temporaryOverrides: {},
  sessionHints: {},
  proxyAvailable: true,
  pendingRememberDomain: null,
  pendingReloadTabId: null,
};

const defaultProxy: ProxyClientSnapshot = {
  status: 'DISCONNECTED',
  runtimeMode: 'IN_PROCESS_TEST',
  localSocksEndpoint: DEFAULT_PROXY_ENDPOINT,
  localSocks: null,
  errorReason: null,
  lastError: null,
  lastChangedAt: new Date().toISOString(),
  restartAttempt: 0,
};

const defaultAdblock: AdblockStateSnapshot = {
  enabled: true,
  disabledDomains: [],
  blockedTotal: 0,
  blockedByTabId: {},
};

const defaultPasswords: PasswordStateSnapshot = {
  available: false,
  neverSaveOrigins: [],
  pendingPrompt: null,
};

interface BrowserStore extends BrowserStateSnapshot {
  savedGroups: SavedGroup[];
  bookmarks: Bookmark[];
  bookmarkFolders: BookmarkFolder[];
  history: HistoryEntry[];
  downloads: DownloadItemSnapshot[];
  shortcuts: ShortcutLink[];
  groupsPanelOpen: boolean;
  bookmarksPanelOpen: boolean;
  historyPanelOpen: boolean;
  downloadsPanelOpen: boolean;
  downloadsShelfOpen: boolean;
  routingSettingsOpen: boolean;
  setFromMain: (state: BrowserStateSnapshot) => void;
  setSavedGroups: (groups: SavedGroup[]) => void;
  setBookmarks: (payload: { bookmarks: Bookmark[]; folders: BookmarkFolder[] }) => void;
  setHistory: (items: HistoryEntry[]) => void;
  setDownloads: (items: DownloadItemSnapshot[]) => void;
  setShortcuts: (items: ShortcutLink[]) => void;
  setGroupsPanelOpen: (open: boolean) => void;
  setBookmarksPanelOpen: (open: boolean) => void;
  setHistoryPanelOpen: (open: boolean) => void;
  setDownloadsPanelOpen: (open: boolean) => void;
  setDownloadsShelfOpen: (open: boolean) => void;
  setRoutingSettingsOpen: (open: boolean) => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  tabs: [],
  sessionGroups: [],
  activeTabId: '',
  routing: defaultRouting,
  proxy: defaultProxy,
  adblock: defaultAdblock,
  passwords: defaultPasswords,
  savedGroups: [],
  bookmarks: [],
  bookmarkFolders: [],
  history: [],
  downloads: [],
  shortcuts: [],
  groupsPanelOpen: false,
  bookmarksPanelOpen: false,
  historyPanelOpen: false,
  downloadsPanelOpen: false,
  downloadsShelfOpen: false,
  routingSettingsOpen: false,
  setFromMain: (state) => set(state),
  setSavedGroups: (savedGroups) => set({ savedGroups }),
  setBookmarks: ({ bookmarks, folders }) => set({ bookmarks, bookmarkFolders: folders }),
  setHistory: (history) => set({ history }),
  setDownloads: (downloads) => set({ downloads }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
  setGroupsPanelOpen: (groupsPanelOpen) => set({ groupsPanelOpen }),
  setBookmarksPanelOpen: (bookmarksPanelOpen) => set({ bookmarksPanelOpen }),
  setHistoryPanelOpen: (historyPanelOpen) => set({ historyPanelOpen }),
  setDownloadsPanelOpen: (downloadsPanelOpen) => set({ downloadsPanelOpen }),
  setDownloadsShelfOpen: (downloadsShelfOpen) => set({ downloadsShelfOpen }),
  setRoutingSettingsOpen: (routingSettingsOpen) => set({ routingSettingsOpen }),
}));

export function selectActiveTab(state: BrowserStore) {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

export const useTabsStore = useBrowserStore;
