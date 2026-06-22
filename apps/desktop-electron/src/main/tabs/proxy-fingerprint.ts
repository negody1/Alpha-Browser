import { BrowserWindow, type WebContents } from 'electron';
import type { RoutePartition } from '@alpha/shared-types';
import { devToolsAllowed } from '../dev-flags';

/** PROXY fingerprint target timezone (matches NL egress IP geography). */
export const PROXY_TIMEZONE = 'Europe/Amsterdam';

const PROXY_WEBRTC_POLICY = 'disable_non_proxied_udp' as const;
const DIRECT_WEBRTC_POLICY = 'default' as const;

/**
 * P4.2: Apply or reset PROXY-only fingerprint overrides on a guest WebContents.
 * DIRECT tabs always get Chromium defaults (system timezone, default WebRTC policy).
 */
export function applyProxyFingerprint(wc: WebContents, partition: RoutePartition): void {
  if (wc.isDestroyed()) return;

  try {
    wc.setWebRTCIPHandlingPolicy(
      partition === 'PROXY' ? PROXY_WEBRTC_POLICY : DIRECT_WEBRTC_POLICY,
    );
  } catch (e) {
    console.warn('[alpha][fingerprint] setWebRTCIPHandlingPolicy failed', { err: String(e) });
  }

  if (partition === 'PROXY') {
    void applyTimezoneOverride(wc);
  } else {
    void clearTimezoneOverride(wc);
  }
}

/** Tear down CDP overrides before destroying a guest WebContents. */
export function releaseProxyFingerprint(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  void clearTimezoneOverride(wc);
}

/**
 * P4.3: Re-apply the PROXY timezone override after a *real* navigation.
 *
 * The initial override set in `applyProxyFingerprint` (createWebView, before the
 * first load) does not survive the first document commit / renderer process swap,
 * so TabManager calls this on `did-navigate` and `did-finish-load` for the tab's
 * WebContents. It only touches PROXY tabs; DIRECT clears any stale override.
 *
 * No-op while DevTools is open: the CDP debugger is mutually exclusive with
 * DevTools, so the override is intentionally suspended there and restored by the
 * `devtools-closed` hook in {@link wireDetachedDevTools}.
 */
export function reapplyProxyFingerprint(wc: WebContents, partition: RoutePartition): void {
  if (wc.isDestroyed()) return;
  if (partition !== 'PROXY') {
    void clearTimezoneOverride(wc);
    return;
  }
  if (wc.isDevToolsOpened()) return;
  void applyTimezoneOverride(wc);
}

async function applyTimezoneOverride(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }
    await wc.debugger.sendCommand('Emulation.setTimezoneOverride', {
      timezoneId: PROXY_TIMEZONE,
    });
  } catch (e) {
    console.warn('[alpha][fingerprint] timezone override failed', { err: String(e) });
  }
}

async function clearTimezoneOverride(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  try {
    if (wc.debugger.isAttached()) {
      // Empty timezoneId cancels the override (CDP).
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: '' });
      wc.debugger.detach();
    }
  } catch (e) {
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      // ignore secondary detach failure
    }
  }
}

function isDockedDevTools(wc: WebContents): boolean {
  const dt = wc.devToolsWebContents;
  if (!dt || dt.isDestroyed()) return false;
  const devtoolsWin = BrowserWindow.fromWebContents(dt);
  const pageWin = BrowserWindow.fromWebContents(wc);
  if (!devtoolsWin || !pageWin) return false;
  return devtoolsWin.id === pageWin.id;
}

/**
 * P4.2: Guest/page DevTools must open detached — WebContentsView native layer
 * occludes docked DevTools in the same BrowserWindow.
 */
export function wireDetachedDevTools(
  wc: WebContents,
  isProxyPartition: () => boolean,
): void {
  const allowed = devToolsAllowed();

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    const inspect =
      input.key === 'F12' ||
      (input.control && input.shift && (k === 'i' || k === 'j' || k === 'c')) ||
      (input.meta && input.alt && k === 'i');
    const viewSource = input.control && !input.shift && k === 'u';
    if (!inspect && !viewSource) return;
    // P0: in production these are swallowed so the inspector can never open.
    event.preventDefault();
    if (!allowed || viewSource) return;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools({ mode: 'detach', activate: true });
    }
  });

  // Production: if anything (e.g. a stray API call) opens DevTools, slam it shut.
  if (!allowed) {
    wc.on('devtools-opened', () => {
      if (!wc.isDestroyed() && wc.isDevToolsOpened()) wc.closeDevTools();
    });
    return;
  }

  // Context-menu "Inspect" opens docked DevTools by default — reopen detached.
  wc.on('devtools-opened', () => {
    setImmediate(() => {
      if (wc.isDestroyed() || !wc.isDevToolsOpened()) return;
      if (!isDockedDevTools(wc)) return;
      wc.closeDevTools();
      wc.openDevTools({ mode: 'detach', activate: true });
    });
  });

  // CDP debugger conflicts with DevTools — release while inspecting, restore after.
  wc.on('devtools-opened', () => {
    if (wc.isDestroyed()) return;
    if (wc.debugger.isAttached()) {
      void clearTimezoneOverride(wc);
    }
  });

  wc.on('devtools-closed', () => {
    if (wc.isDestroyed()) return;
    if (isProxyPartition()) {
      void applyTimezoneOverride(wc);
    }
  });
}
