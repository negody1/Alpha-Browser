import type { WebContents } from 'electron';
import type { TabEntry } from './types';

export function applyNavigationFlags(entry: TabEntry, webContents: WebContents): void {
  entry.canGoBack = webContents.canGoBack();
  entry.canGoForward = webContents.canGoForward();
}

export function applyUrl(entry: TabEntry, url: string): void {
  entry.url = url;
}
