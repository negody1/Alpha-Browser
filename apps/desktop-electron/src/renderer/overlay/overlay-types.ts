import {
  CHROME_LAYOUT,
  type OmniboxSuggestion,
  type PermissionPromptPayload,
  type ScreenSharePromptPayload,
} from '@alpha/shared-types';

export type { PermissionPromptPayload, ScreenSharePromptPayload };

export const OVERLAY_PANEL_WIDTH = CHROME_LAYOUT.sidePanelWidth;

export type OverlayPanelPlacement = 'left' | 'right';

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

export interface OverlayStateMessage {
  kind: OverlayKind;
  payload?: Record<string, unknown> | null;
  placement?: OverlayPanelPlacement;
}

export interface TabMenuPayload {
  tabId: string;
  tabKind: 'ntp' | 'web';
  inGroup: boolean;
  otherGroups: Array<{ id: string; title: string; collapsed: boolean }>;
  hasGroups: boolean;
  groups: Array<{ id: string; title: string; collapsed: boolean }>;
}

export interface GroupMenuPayload {
  groupId: string;
  collapsed: boolean;
  tabCount: number;
  groupColor: string;
}

export interface RouteMenuPayload {
  domain: string | null;
  hasDomain: boolean;
  current: string;
  routeSource: string;
  /** P2-A.3 Route Memory: saved route class for this domain, or null if none. */
  remembered: 'DIRECT' | 'PROXY' | null;
}

export interface OmniboxPopupPayload {
  suggestions: OmniboxSuggestion[];
  selectedIndex: number;
}

export interface AdblockMenuPayload {
  domain: string | null;
  hasDomain: boolean;
  adblockOn: boolean;
  siteDisabled: boolean;
  blockedOnTab: number;
  blockedTotal: number;
  hasAdblock: boolean;
}

export function parseOverlayPayload<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function isOverlayPanelKind(kind: string | null): kind is OverlayPanelKind {
  return (
    kind === 'groups-panel' ||
    kind === 'bookmarks-panel' ||
    kind === 'history-panel' ||
    kind === 'routing-panel' ||
    kind === 'downloads-panel'
  );
}
