import { useEffect } from 'react';
import { useBrowserStore } from '../store/tabsStore';

export function useBrowserSync(): void {
  const setFromMain = useBrowserStore((s) => s.setFromMain);
  const setSavedGroups = useBrowserStore((s) => s.setSavedGroups);
  const setBookmarks = useBrowserStore((s) => s.setBookmarks);
  const setHistory = useBrowserStore((s) => s.setHistory);
  const setDownloads = useBrowserStore((s) => s.setDownloads);
  const setShortcuts = useBrowserStore((s) => s.setShortcuts);
  const setDownloadsShelfOpen = useBrowserStore((s) => s.setDownloadsShelfOpen);

  useEffect(() => {
    void window.alpha.tabs.getState().then(setFromMain);
    void window.alpha.savedGroups.list().then(setSavedGroups);
    void window.alpha.bookmarks.list().then(setBookmarks);
    void window.alpha.history.list().then(setHistory);
    void window.alpha.downloads.list().then(setDownloads);
    void window.alpha.shortcuts.list().then(setShortcuts);
    const unsubTabs = window.alpha.tabs.onStateChanged(setFromMain);
    const unsubGroups = window.alpha.savedGroups.onChanged(setSavedGroups);
    const unsubBookmarks = window.alpha.bookmarks.onChanged(() => {
      void window.alpha.bookmarks.list().then(setBookmarks);
    });
    const unsubHistory = window.alpha.history.onChanged(() => {
      void window.alpha.history.list().then(setHistory);
    });
    const unsubDownloads = window.alpha.downloads.onChanged(() => {
      void window.alpha.downloads.list().then((items) => {
        const prev = useBrowserStore.getState().downloads;
        setDownloads(items);
        // auto-open shelf when a new download appears or any is active
        if (items.length > prev.length || items.some((d) => d.status === 'downloading' || d.status === 'pending')) {
          setDownloadsShelfOpen(true);
        }
      });
    });
    const unsubAdblock = window.alpha.adblock.onChanged(() => {
      void window.alpha.adblock.getState().then(() => {
        // adblock state is included in tabs:getState snapshots; rely on setFromMain from main broadcasts.
      });
    });
    const unsubShortcuts = window.alpha.shortcuts.onChanged(() => {
      void window.alpha.shortcuts.list().then(setShortcuts);
    });
    return () => {
      unsubTabs();
      unsubGroups();
      unsubBookmarks();
      unsubHistory();
      unsubDownloads();
      unsubAdblock();
      unsubShortcuts();
    };
  }, [setFromMain, setSavedGroups, setBookmarks, setHistory, setDownloads, setShortcuts, setDownloadsShelfOpen]);
}

/** @deprecated */
export const useTabsSync = useBrowserSync;
