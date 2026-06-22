import type { WebContentsView } from 'electron';
import type { RouteClass, RoutePartition, TabKind } from '@alpha/shared-types';

export interface TabEntry {
  id: string;
  kind: TabKind;
  title: string;
  url: string;
  favicon: string | null;
  view: WebContentsView | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crashed: boolean;
  /** Renderer is hung (Electron 'unresponsive'); cleared on 'responsive'. */
  unresponsive?: boolean;
  sessionGroupId: string | null;
  loadFailed: boolean;
  /** P3-B Tab Audio: the page is currently emitting audio. */
  audible: boolean;
  /** P3-B Tab Audio: user muted this tab. Re-applied to new views on migrate/restore. */
  muted: boolean;
  /** Per-tab routing intent (P1). Default 'AUTO'. */
  routeClass: RouteClass;
  /** Effective session the current view lives in (P1). Default 'DIRECT'. */
  partition: RoutePartition;
}

export interface SessionGroupEntry {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  tabIds: string[];
  /** Remembered web-tab URLs so a closed (dormant) group can be reopened. */
  urls: string[];
  sourceSavedGroupId: string | null;
}
