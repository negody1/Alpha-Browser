export type RouteMode = 'AUTO' | 'DIRECT' | 'PROXY';

/**
 * Per-tab routing intent (P1 Route Partitions). What the user wants for a tab.
 * AUTO is a policy that resolves to a concrete partition (DIRECT in P1).
 */
export type RouteClass = 'AUTO' | 'DIRECT' | 'PROXY';

/**
 * Concrete Electron session a tab's view is attached to (effective transport).
 * AUTO never appears here — it resolves to DIRECT or PROXY.
 */
export type RoutePartition = 'DIRECT' | 'PROXY';

/** Badge display mode (includes ERROR when proxy unavailable). */
export type RouteBadgeMode = RouteMode | 'ERROR';

export type RouteSource =
  | 'default'
  | 'saved-rule'
  | 'session-hint'
  | 'temporary-override'
  | 'fallback';

export type EffectiveRoute = 'DIRECT' | 'PROXY';

export interface RouteRule {
  domain: string;
  route: RouteMode;
  createdAt: string;
  updatedAt: string;
}

export interface RoutesConfig {
  version: number;
  defaultRoute: RouteMode;
  proxyEndpoints: Record<string, string>;
  rules: RouteRule[];
}

export interface ResolvedRoute {
  mode: RouteBadgeMode;
  effective: EffectiveRoute;
  proxyKey: string;
  source: RouteSource;
  domain: string;
  error: string | null;
}

export interface RoutingStateSnapshot {
  defaultRoute: RouteMode;
  proxyEndpoints: Record<string, string>;
  rules: RouteRule[];
  temporaryOverrides: Record<string, RouteMode>;
  sessionHints: Record<string, EffectiveRoute>;
  proxyAvailable: boolean;
  pendingRememberDomain: string | null;
  pendingReloadTabId: string | null;
}

export type ProxyConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export type ProxyRuntimeMode = 'IN_PROCESS_TEST' | 'SING_BOX_LOCAL_TEST' | 'SING_BOX_REMOTE';

export type ProxyErrorReason =
  | 'BINARY_MISSING'
  | 'CONFIG_WRITE_FAILED'
  | 'PORT_BIND_FAILED'
  | 'PROCESS_EXITED'
  | 'HEALTHCHECK_FAILED'
  | 'RESTART_BUDGET_EXCEEDED'
  | 'REMOTE_PROFILE_MISSING'
  | 'UNKNOWN';

export interface ProxyClientSnapshot {
  status: ProxyConnectionStatus;
  runtimeMode: ProxyRuntimeMode;
  /** Always loopback-only. Example: `SOCKS5 127.0.0.1:1080` */
  localSocksEndpoint: string | null;
  /**
   * Structured loopback SOCKS endpoint for programmatic consumers.
   * This is the single shared transport endpoint; in P1 it will be attached
   * to the PROXY Electron Session via `session.setProxy` (Route Partitions),
   * independent of the temporary PAC/defaultSession wiring used today.
   */
  localSocks: { host: string; port: number } | null;
  errorReason: ProxyErrorReason | null;
  lastError: string | null;
  lastChangedAt: string;
  restartAttempt: number;
}

/** PHASE 4: end-to-end proxy reachability (SOCKS handshake + HTTP egress). */
export interface ProxyEgressDiagnostics {
  /** Local sing-box SOCKS answered a SOCKS5 greeting. */
  localSocksOk: boolean;
  /** A full HTTP request through the tunnel returned an egress IP. */
  remoteEgressOk: boolean;
  /** Public IP observed at the far end (null on failure). No secrets. */
  egressIp: string | null;
  /** Expected egress (the remote VLESS server host) for comparison. */
  expectedEgressIp: string | null;
  lastCheckedAt: string;
  error: string | null;
}

/** PHASE 4: sanitized proxy diagnostics surfaced to the renderer (no secrets). */
export interface ProxyDiagnosticsSnapshot {
  status: ProxyConnectionStatus;
  runtimeMode: ProxyRuntimeMode;
  errorReason: ProxyErrorReason | null;
  socksPort: number | null;
  remoteServer: string | null;
  remotePort: number | null;
  egress: ProxyEgressDiagnostics | null;
}

export const DEFAULT_SEARCH_URL = 'https://www.google.com/search?q=';

export const APP_NAME = 'Alpha Browser';

export const NTP_URL = 'alpha://newtab';

/** Internal full-tab settings page (rendered by the shell, never loaded as a URL). */
export const SETTINGS_URL = 'alpha://settings';

export const DEFAULT_PROXY_KEY = 'PROXY_MAIN';

export const DEFAULT_PROXY_ENDPOINT = 'SOCKS5 127.0.0.1:1080';

/**
 * 'internal' tabs render an in-shell React page (like NTP) and have no
 * WebContentsView. The concrete page is derived from `url` (e.g. alpha://settings).
 */
export type TabKind = 'ntp' | 'web' | 'internal';

export interface TabSnapshot {
  id: string;
  kind: TabKind;
  title: string;
  url: string;
  favicon: string | null;
  isActive: boolean;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crashed?: boolean;
  sessionGroupId: string | null;
  /** P3-B Tab Audio: page is currently emitting audio. */
  audible: boolean;
  /** P3-B Tab Audio: tab is muted by the user. */
  muted: boolean;
  routeMode: RouteBadgeMode;
  routeSource: RouteSource;
  routeError: string | null;
  domain: string | null;
  /** Per-tab routing intent (P1). */
  routeClass: RouteClass;
  /** Effective Electron session the tab's view is attached to (P1). */
  partition: RoutePartition;
}

export interface SessionGroup {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  /** Currently-open tab ids (empty when the group is dormant/closed). */
  tabIds: string[];
  /** Remembered web-tab URLs; lets a dormant group be reopened. */
  urls: string[];
  sourceSavedGroupId: string | null;
}

export interface SavedGroup {
  id: string;
  title: string;
  color: string;
  urls: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkFolder {
  id: string;
  title: string;
  parentId: string | null;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  createdAt: string;
  folderId: string | null;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  visitedAt: string;
  routeMode: RouteMode;
}

/**
 * Per-URL aggregate used for frecency ranking (omnibox / frequently-visited).
 * Stored separately from the chronological history journal (HistoryEntry[]);
 * it is NOT a derived index — it is updated incrementally on each visit and
 * backfilled once from the journal on first run.
 */
export interface HistoryUrlStat {
  /** Canonical normalized URL — primary key. */
  url: string;
  host: string;
  title: string;
  favicon: string | null;
  /** Total recorded visits. */
  visitCount: number;
  /** Visits that originated from a typed address-bar navigation. */
  typedCount: number;
  firstVisitAt: string;
  lastVisitAt: string;
  /** Reserved for omnibox phase 2 (pinned suggestions). */
  isPinned: boolean;
  /** Reserved for omnibox phase 2 (hidden from suggestions). */
  isHidden: boolean;
}

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadItemSnapshot {
  id: string;
  url: string;
  filename: string;
  mimeType: string | null;
  totalBytes: number | null;
  receivedBytes: number;
  progress: number; // 0..1
  status: DownloadStatus;
  canResume: boolean;
  savePath: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  routeMode: RouteMode;
  domain: string | null;
}

export interface AdblockStateSnapshot {
  enabled: boolean;
  disabledDomains: string[];
  blockedTotal: number;
  blockedByTabId: Record<string, number>;
}

export interface PasswordEntryMetadata {
  id: string;
  origin: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of last autofill/save use; drives ordering of multiple accounts. */
  lastUsedAt: string;
}

export interface PasswordPromptSnapshot {
  id: string;
  kind: 'save' | 'update';
  origin: string;
  username: string;
  tabId: string;
}

export interface PasswordStateSnapshot {
  available: boolean;
  neverSaveOrigins: string[];
  pendingPrompt: PasswordPromptSnapshot | null;
}

export interface ShortcutLink {
  id: string;
  title: string;
  url: string;
  iconUrl?: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Omnibox / address-bar autocomplete (P2-C). A ranked suggestion produced by the
 * UI-independent OmniboxService from local sources only (history frecency, open
 * tabs, shortcuts, URL/search resolution). No network or remote suggestions.
 */
export type OmniboxSuggestionKind = 'open-tab' | 'history' | 'shortcut' | 'search' | 'url';

export interface OmniboxSuggestion {
  kind: OmniboxSuggestionKind;
  /** Display title (falls back to host/url when unknown). */
  title: string;
  /** Resolved navigation target. Always set for MVP kinds. */
  url: string;
  /** Registrable-ish host (www stripped) when applicable. */
  host: string | null;
  favicon: string | null;
  /** For kind==='open-tab': switch to this tab instead of navigating. */
  tabId?: string;
  /**
   * Inline host autocompletion tail. When set, the UI may append it to the
   * current input (highlighted) so Tab/Right accepts it. Never auto-navigated.
   */
  inlineCompletion?: string;
  /** Ranking score (higher = more relevant). Exposed for diagnostics/UI ordering. */
  score: number;
}

/**
 * PHASE 6 — passive GitHub version-check result (notify only; never used to
 * auto-download or install). Surfaced once at startup if a newer release exists.
 */
export interface UpdateNotice {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** GitHub release notes (markdown body). */
  notes: string | null;
  /** Human release page URL to open externally. */
  releaseUrl: string | null;
}

/**
 * Permission Service MVP (P3-A). Interactive capabilities surfaced to the user
 * via a popup. Default-deny; a decision is stored per host in memory only.
 */
export type PermissionCapability = 'camera' | 'microphone' | 'notifications';

export interface PermissionPromptPayload {
  /** Correlates the popup choice back to the pending Electron permission callback. */
  requestId: string;
  /** Origin host (www stripped) requesting the capability. */
  host: string;
  /** Capabilities requested in this prompt (e.g. camera + microphone for getUserMedia). */
  capabilities: PermissionCapability[];
}

/**
 * P3-D Permission Settings: one row per host with the stored decision for each
 * managed capability ('allow' | 'deny' | null when never decided).
 */
export interface PermissionSiteEntry {
  host: string;
  camera: 'allow' | 'deny' | null;
  microphone: 'allow' | 'deny' | null;
  notifications: 'allow' | 'deny' | null;
}

/**
 * Screen Sharing MVP (P3-C). A capturable desktop source presented to the user
 * when a site calls getDisplayMedia(). Nothing is shared until an explicit pick.
 */
export interface ScreenShareSource {
  /** Electron DesktopCapturerSource id (e.g. "screen:0:0" / "window:123:0"). */
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** Data URL preview thumbnail (may be empty for off-screen windows). */
  thumbnail: string;
  /** Data URL of the owning app icon, when available (windows only). */
  appIcon: string | null;
}

export interface ScreenSharePromptPayload {
  /** Correlates the popup choice back to the pending Electron callback. */
  requestId: string;
  /** Requesting origin host (www stripped), or null if unknown. */
  host: string | null;
  sources: ScreenShareSource[];
}

export interface BrowserStateSnapshot {
  tabs: TabSnapshot[];
  sessionGroups: SessionGroup[];
  activeTabId: string;
  routing: RoutingStateSnapshot;
  proxy: ProxyClientSnapshot;
  adblock: AdblockStateSnapshot;
  passwords: PasswordStateSnapshot;
}

/**
 * Single source of truth for shell geometry.
 * Renderer CSS reads sidebar/tab-bar/toolbar via injected CSS vars (see applyChromeLayoutVars);
 * main process derives WebContentsView + overlay bounds via getWebContentBounds().
 * No literal duplicates of these values anywhere else.
 */
export const CHROME_LAYOUT = {
  sidebarWidth: 56,
  tabBarHeight: 40,
  toolbarHeight: 50,
  sidePanelWidth: 360,
  downloadsPanelWidth: 400,
} as const;

/** Minimum chrome top height (tab bar + toolbar) — derived, never a separate literal. */
export function chromeBaselineTopHeightPx(): number {
  return CHROME_LAYOUT.tabBarHeight + CHROME_LAYOUT.toolbarHeight;
}
// Generic favicon fallback for external sites with no icon. Inline SVG data-URI
// so it has NO path dependency — renders identically in the main renderer, the
// overlay window, dev (http) and packaged (file://). The old '/branding/...'
// path resolved to the filesystem root under file:// and showed a broken image.
export const FAVICON_FALLBACK_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6.4' fill='none' stroke='%239aa0aa' stroke-width='1.2'/%3E%3Cpath d='M1.6 8h12.8M8 1.6c2.2 2 2.2 10.8 0 12.8M8 1.6c-2.2 2-2.2 10.8 0 12.8' fill='none' stroke='%239aa0aa' stroke-width='1'/%3E%3C/svg%3E";

export function getWebContentBounds(
  windowWidth: number,
  windowHeight: number,
  chromeTopHeightPx?: number,
): { x: number; y: number; width: number; height: number } {
  const x = CHROME_LAYOUT.sidebarWidth;
  const baseline = chromeBaselineTopHeightPx();
  const y = Math.max(baseline, Math.round(chromeTopHeightPx ?? baseline));
  return {
    x,
    y,
    width: Math.max(0, windowWidth - x),
    height: Math.max(0, windowHeight - y),
  };
}

export interface GroupColorPreset {
  value: string;
  label: string;
}

/** Visual group/workspace palette (no HEX shown in UI). */
export const GROUP_COLOR_PALETTE: readonly GroupColorPreset[] = [
  { value: '#7A4DFF', label: 'Фиолетовый' },
  { value: '#229ED9', label: 'Синий' },
  { value: '#2EC4E6', label: 'Голубой' },
  { value: '#31D67B', label: 'Зелёный' },
  { value: '#FFB648', label: 'Жёлтый' },
  { value: '#FF8F3D', label: 'Оранжевый' },
  { value: '#FF5C5C', label: 'Красный' },
  { value: '#FF6BB5', label: 'Розовый' },
  { value: '#8B93A7', label: 'Серый' },
] as const;

export const GROUP_COLOR_PRESETS = GROUP_COLOR_PALETTE.map((c) => c.value);
