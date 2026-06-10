import { app, BrowserWindow, Notification, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME } from '@alpha/shared-types';
import { isSafeExternalUrl } from './navigation';
import { registerGroupsIpc } from './ipc/register-groups';
import { registerBookmarksIpc } from './ipc/register-bookmarks';
import { registerHistoryIpc } from './ipc/register-history';
import { registerDownloadsIpc } from './ipc/register-downloads';
import { registerRoutingIpc } from './ipc/register-routing';
import { registerTabsIpc } from './ipc/register-tabs';
import { registerShellIpc } from './ipc/register-shell';
import { registerOverlayIpc, registerShellOverlayHandlers, registerShellRenameIpc } from './ipc/register-overlay';
import { registerAdblockIpc } from './ipc/register-adblock';
import { registerPasswordsIpc } from './ipc/register-passwords';
import { registerPasswordsGuestIpc } from './ipc/register-passwords-guest';
import { registerShortcutsIpc } from './ipc/register-shortcuts';
import { registerOmniboxIpc } from './ipc/register-omnibox';
import { registerPermissionIpc } from './ipc/register-permission';
import { registerScreenShareIpc } from './ipc/register-screenshare';
import { registerPrivacyIpc } from './ipc/register-privacy';
import { registerUpdatesIpc, runStartupUpdateCheck } from './ipc/register-updates';
import { registerProxyIpc } from './ipc/register-proxy';
import { registerActivationIpc } from './ipc/register-activation';
import { ActivationService } from './activation/ActivationService';
import { UpdateCheckService } from './updates/UpdateCheckService';
import { OmniboxService } from './omnibox/OmniboxService';
import { PermissionService } from './permissions/PermissionService';
import { ScreenShareService } from './screenshare/ScreenShareService';
import { SessionRegistry } from './sessions/SessionRegistry';
import { ProxyClientService } from './proxy/ProxyClientService';
import { RoutingService } from './routing/RoutingService';
import { BookmarksStore } from './storage/BookmarksStore';
import { HistoryStore } from './storage/HistoryStore';
import { HistoryUrlStatStore } from './storage/HistoryUrlStatStore';
import { DownloadsStore } from './storage/DownloadsStore';
import { RoutesStore } from './storage/RoutesStore';
import { SavedGroupsStore } from './storage/SavedGroupsStore';
import { SessionStore } from './storage/SessionStore';
import { TabManager } from './tabs/TabManager';
import { OverlayWindowManager } from './shell/OverlayWindowManager';
import { DownloadsService } from './downloads/DownloadsService';
import { AdblockStore } from './storage/AdblockStore';
import { AdblockService } from './adblock/AdblockService';
import { PasswordsMetaStore } from './storage/PasswordsMetaStore';
import { PasswordsSecretsStore } from './storage/PasswordsSecretsStore';
import { PasswordService } from './passwords/PasswordService';
import { SafeStorageProvider } from './passwords/SafeStorageProvider';
import { ShortcutsStore } from './storage/ShortcutsStore';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let sessionRegistry: SessionRegistry | null = null;
let updateCheckService: UpdateCheckService | null = null;
let activationService: ActivationService | null = null;
let savedGroupsStore: SavedGroupsStore | null = null;
let sessionStore: SessionStore | null = null;
let routesStore: RoutesStore | null = null;
let routingService: RoutingService | null = null;
let proxyClient: ProxyClientService | null = null;
let bookmarksStore: BookmarksStore | null = null;
let historyStore: HistoryStore | null = null;
let historyUrlStats: HistoryUrlStatStore | null = null;
let downloadsStore: DownloadsStore | null = null;
let downloadsService: DownloadsService | null = null;
let adblockStore: AdblockStore | null = null;
let adblockService: AdblockService | null = null;
let passwordsMeta: PasswordsMetaStore | null = null;
let passwordsSecrets: PasswordsSecretsStore | null = null;
let passwordService: PasswordService | null = null;
let shortcutsStore: ShortcutsStore | null = null;
let omniboxService: OmniboxService | null = null;
let overlayManager: OverlayWindowManager | null = null;
let permissionService: PermissionService | null = null;
let screenShareService: ScreenShareService | null = null;

async function loadRendererDev(window: BrowserWindow, url: string): Promise<void> {
  // electron-vite starts the renderer dev server asynchronously; on Windows it may take a moment.
  const target = url.endsWith('/') ? url : `${url}/`;
  const maxAttempts = 80; // ~20s at 250ms

  async function ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 700);
      const res = await fetch(target, { signal: controller.signal });
      clearTimeout(t);
      return res.ok || (res.status >= 200 && res.status < 500);
    } catch {
      return false;
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ok = await ping();
    if (ok) {
      await window.loadURL(target);
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[alpha][renderer] dev server not reachable, retrying...', { attempt, url: target });
    await new Promise((r) => setTimeout(r, 250));
  }

  // Fallback: load the locally built renderer so the app is usable even if Vite is down.
  const builtHtml = join(__dirname, '../renderer/index.html');
  if (existsSync(builtHtml)) {
    // eslint-disable-next-line no-console
    console.error('[alpha][renderer] dev server unreachable, falling back to built renderer', { builtHtml });
    await window.loadFile(builtHtml);
    return;
  }

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Alpha dev server unreachable</title>
    <style>
      body{margin:0;background:#0b0d12;color:#e6e8ee;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
      .card{width:min(720px,calc(100vw - 32px));border:1px solid rgba(255,255,255,.10);background:rgba(22,27,34,.55);backdrop-filter:blur(10px);border-radius:14px;padding:18px 18px 14px;box-shadow:0 18px 60px rgba(0,0,0,.45)}
      h1{margin:0 0 8px;font-size:16px}
      p{margin:0 0 10px;color:rgba(255,255,255,.7)}
      code{display:block;white-space:pre-wrap;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08);padding:10px;border-radius:12px;color:#cfd3dd}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Dev server недоступен</h1>
      <p>Electron запущен, но renderer (Vite) не отвечает. Проверь, что команда dev действительно подняла сервер.</p>
      <code>${escapeHtml(target)}</code>
      <p>Подсказка: в терминале должно быть “Local: http://localhost:5173/”. Если порт другой — пришли лог.</p>
    </div>
  </body>
</html>
  `.trim();
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function escapeHtml(input: string) {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createWindow(): BrowserWindow {
  // Route Partitions (P1, Commit 1): construct DIRECT (defaultSession) and
  // PROXY (persist:alpha-proxy) sessions and apply the security policy to both.
  // No view uses the PROXY session yet, so behavior is unchanged.
  sessionRegistry = new SessionRegistry();
  sessionRegistry.applySecurityToAll();
  // Commit 5: pin DIRECT (defaultSession) to explicit direct mode. From here on,
  // transport for active tabs is owned solely by SessionRegistry keyed off
  // TabEntry.partition; the legacy RoutingService PAC is advisory only.
  sessionRegistry.applyDirectBaseline();
  // P4.3: PROXY-only locale (Accept-Language + navigator.language(s) = en-US) to
  // match the NL egress. DIRECT keeps the system locale.
  sessionRegistry.applyProxyLocale();

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    // Window/taskbar icon (dev + packaged): resources/** is bundled in the asar,
    // so this path resolves in both. The packaged .exe icon is set separately by
    // electron-builder from resources/icon.png.
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.on('ready-to-show', () => {
    window.show();
    if (isDev) {
      // Make renderer issues visible immediately (white screen debugging).
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (isDev) {
    window.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      // eslint-disable-next-line no-console
      console.error('[alpha][renderer] did-fail-load', { errorCode, errorDescription, validatedURL });
    });
    window.webContents.on('render-process-gone', (_e, details) => {
      // eslint-disable-next-line no-console
      console.error('[alpha][renderer] render-process-gone', details);
    });
    window.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      // eslint-disable-next-line no-console
      console.log('[alpha][renderer][console]', { level, message, line, sourceId });
    });
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    // S1: only hand off vetted schemes (http/https/mailto) to the OS. Reject
    // file:, custom protocols, etc. so the privileged chrome renderer cannot
    // trigger arbitrary protocol launches.
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      console.warn('[alpha][security] blocked openExternal for unsafe url', { url });
    }
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void loadRendererDev(window, process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  savedGroupsStore = new SavedGroupsStore();
  sessionStore = new SessionStore();
  routesStore = new RoutesStore();
  routingService = new RoutingService(routesStore, session.defaultSession);
  proxyClient = new ProxyClientService();
  // PHASE 3: reclaim a sing-box left behind by a previously-crashed Alpha
  // instance (verified by recorded PID + image name; never a kill-by-name).
  proxyClient.reclaimOrphanedProcess();
  bookmarksStore = new BookmarksStore();
  historyUrlStats = new HistoryUrlStatStore();
  historyStore = new HistoryStore(historyUrlStats);
  // One-time backfill of the per-URL aggregate from the existing journal.
  try {
    historyUrlStats.migrateFromJournalOnce(() => historyStore?.list() ?? []);
  } catch (e) {
    console.warn('[alpha][history] url-stat migration failed', { err: String(e) });
  }
  downloadsStore = new DownloadsStore();
  adblockStore = new AdblockStore();
  passwordsMeta = new PasswordsMetaStore();
  passwordsSecrets = new PasswordsSecretsStore();
  passwordService = new PasswordService(passwordsMeta, new SafeStorageProvider(passwordsSecrets));
  shortcutsStore = new ShortcutsStore();
  tabManager = new TabManager(
    window,
    window.webContents,
    savedGroupsStore,
    routingService,
    proxyClient,
    historyStore,
    null,
    passwordService,
    sessionStore,
    sessionRegistry,
  );

  // UI-independent omnibox engine (P2-C.1). Local sources only: history
  // frecency aggregate, open tabs, shortcuts, and URL/search resolution.
  omniboxService = new OmniboxService({
    getUrlStats: () => historyUrlStats?.list() ?? [],
    getShortcuts: () => shortcutsStore?.list() ?? [],
    getOpenTabs: () => tabManager?.getState().tabs ?? [],
  });

  adblockService = new AdblockService(adblockStore, () => tabManager, () => {
    if (tabManager && adblockService) {
      tabManager.setAdblockSnapshot(adblockService.getState());
    }
    tabManager?.broadcastAdblock();
  });
  tabManager.attachAdblock(adblockService);
  adblockService.register(sessionRegistry?.partitions() ?? [session.defaultSession]);
  overlayManager = new OverlayWindowManager(
    () => tabManager,
    () => adblockService,
    join(__dirname, '../preload/index.js'),
  );
  overlayManager.attachToParent(window);

  // Permission Service MVP (P3-A). Owns the per-session permission handlers,
  // overriding the default-deny baseline applied by SessionRegistry. Prompts the
  // user (camera/microphone/notifications) via the overlay popup; decisions are
  // kept in memory per host. SessionRegistry transport is untouched.
  permissionService = new PermissionService(
    () => overlayManager,
    () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('permission:changed');
      }
    },
  );
  overlayManager.setPermissionDismissHandler((requestId) =>
    permissionService?.dismiss(requestId),
  );
  for (const s of sessionRegistry?.partitions() ?? [session.defaultSession]) {
    permissionService.attach(s);
  }

  // Screen Sharing MVP (P3-C). Owns each session's display-media request handler
  // (the sole authority for getDisplayMedia; does not pass through the permission
  // handler). Shows the picker overlay; shares only after an explicit choice.
  screenShareService = new ScreenShareService(() => overlayManager);
  overlayManager.setScreenShareDismissHandler((requestId) =>
    screenShareService?.dismiss(requestId),
  );
  for (const s of sessionRegistry?.partitions() ?? [session.defaultSession]) {
    screenShareService.attach(s);
  }

  // passwords snapshot
  void passwordService.isAvailable().then((available) => {
    if (tabManager && passwordService) {
      tabManager.setPasswordsSnapshot(passwordService.getStateSnapshot(available));
    }
  });

  downloadsService = new DownloadsService(
    downloadsStore,
    () => tabManager,
    () => tabManager?.broadcastDownloads(),
  );
  downloadsService.register(sessionRegistry?.partitions() ?? [session.defaultSession]);

  // Local embedded proxy lifecycle (Phase 4.9: local integration only)
  void proxyClient.start().then((state) => {
    // Commit 3/5: PROXY Route Partition gets the shared local SOCKS endpoint.
    // SessionRegistry is the ONLY thing that applies transport to a session.
    sessionRegistry?.applyProxyEndpoint(state.localSocks);
    // Advisory only (Commit 5): record the endpoint in RoutesStore so the
    // resolver/UI can show proxy availability. Does NOT set any session proxy.
    const endpoint = state.localSocksEndpoint;
    if (endpoint) {
      try {
        routingService?.setProxyEndpoint(endpoint);
      } catch {
        // ignore invalid endpoint
      }
    }
    void tabManager?.refreshRouting();
    // PHASE 4: one best-effort end-to-end egress probe once transport is up.
    if (state.status === 'CONNECTED') {
      void proxyClient?.checkEgress(true).catch(() => {});
    }
  });

  proxyClient.on('state', (state) => {
    // Commit 3/5: keep the PROXY session's proxy config in sync with transport.
    sessionRegistry?.applyProxyEndpoint(state.localSocks);
    // Advisory only (Commit 5): see above — no session.setProxy here.
    const endpoint = state.localSocksEndpoint;
    if (endpoint) {
      try {
        routingService?.setProxyEndpoint(endpoint);
      } catch {
        // ignore invalid endpoint
      }
    }
    void tabManager?.refreshRouting();
  });

  // Advisory only (Commit 5): refreshes proxyAvailable; applies no PAC to any
  // active session. Transport is owned by SessionRegistry.
  void routingService.applyPac();

  window.webContents.once('did-finish-load', () => {
    tabManager?.syncToRenderer();
    tabManager?.broadcastSavedGroups();
    overlayManager?.warmup();
  });

  window.on('closed', () => {
    tabManager = null;
    savedGroupsStore = null;
    routesStore = null;
    routingService = null;
    bookmarksStore = null;
    historyStore = null;
    historyUrlStats = null;
    downloadsStore = null;
    downloadsService = null;
    adblockStore = null;
    adblockService = null;
    passwordsMeta = null;
    passwordsSecrets = null;
    passwordService = null;
    shortcutsStore = null;
    omniboxService = null;
    permissionService = null;
    screenShareService = null;
    overlayManager?.destroyAll();
    overlayManager = null;
    // PART 0 FIX: do NOT stop()+null the proxy here. On Windows, closing the
    // window triggers window-all-closed -> app.quit() -> before-quit, which now
    // AWAITS proxyClient.stop() before exiting. Nulling it here (with an
    // un-awaited stop) raced the quit and orphaned sing-box. before-quit is the
    // single, awaited owner of proxy shutdown.
    sessionRegistry = null;
    mainWindow = null;
  });

  return window;
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.alpha.browser');
  }

  registerTabsIpc(() => tabManager);
  registerShellIpc(() => tabManager);
  registerOverlayIpc(() => overlayManager);
  registerShellOverlayHandlers(() => overlayManager);
  registerShellRenameIpc(() => tabManager);
  registerGroupsIpc(
    () => tabManager,
    () => savedGroupsStore,
  );
  registerRoutingIpc(() => tabManager);
  registerBookmarksIpc(
    () => bookmarksStore,
    () => tabManager?.broadcastBookmarks(),
  );
  registerHistoryIpc(() => historyStore, () => tabManager?.broadcastHistory());
  registerDownloadsIpc(() => downloadsService);
  registerAdblockIpc(() => adblockService);
  registerPasswordsIpc(
    () => passwordService,
    () => {
      void passwordService?.isAvailable().then((available) => {
        if (tabManager && passwordService) {
          tabManager.setPasswordsSnapshot(passwordService.getStateSnapshot(available));
        }
      });
      tabManager?.broadcastPasswords();
    },
  );
  registerPasswordsGuestIpc(
    () => tabManager,
    () => passwordService,
    () => {
      void passwordService?.isAvailable().then((available) => {
        if (tabManager && passwordService) {
          tabManager.setPasswordsSnapshot(passwordService.getStateSnapshot(available));
        }
      });
      tabManager?.broadcastPasswords();
    },
  );

  registerShortcutsIpc(
    () => shortcutsStore,
    () => {
      if (tabManager) {
        tabManager.broadcastShortcuts();
      }
    },
  );

  registerOmniboxIpc(() => omniboxService);
  registerPermissionIpc(() => permissionService);
  registerScreenShareIpc(() => screenShareService);
  // P4.7: PROXY-only identity reset (Settings → Приватность).
  registerPrivacyIpc(() => sessionRegistry, () => tabManager);
  // PHASE 6: passive GitHub version-check (notify only, no auto-update).
  updateCheckService = new UpdateCheckService();
  registerUpdatesIpc(() => updateCheckService);
  // PHASE 4: proxy diagnostics (end-to-end egress check).
  registerProxyIpc(() => proxyClient);
  // Alpha Proxy onboarding (email + activation code → profile delivery).
  activationService = new ActivationService(() => proxyClient);
  registerActivationIpc(() => activationService);
  // PART 4: one-shot revocation check at startup (only if a profile exists).
  // Detects a server-side revoke without the user opening Settings. Not polled.
  void activationService.checkStatusOnStartup();
  // PRIORITY 3: lightweight background revoke check (every 6h, profile-only). On
  // revoke the profile is cleared + proxy stopped (inside checkStatus); here we
  // surface a notification so the user learns even without opening Settings.
  activationService.startBackgroundChecks(() => {
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Alpha Proxy',
          body: 'Доступ к Alpha Proxy отключён администратором.',
        }).show();
      }
    } catch {
      /* notifications unavailable */
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('activation:revoked');
    }
  });

  mainWindow = createWindow();

  // PHASE 6: one-shot startup check; pushes `updates:available` if a newer
  // GitHub release exists. Best-effort, never blocks startup.
  if (updateCheckService) {
    runStartupUpdateCheck(updateCheckService, () => mainWindow?.webContents ?? null);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

// PART 0 FIX: on Windows a child process is NOT killed when its parent exits, so
// a fire-and-forget `stop()` here let the main process die before sing-box was
// terminated — orphaning it (still holding the SOCKS port + an active VLESS
// session with the per-device uuid). On the next launch the new instance
// collided on the port / duplicate-uuid tunnel and PROXY tabs stopped working.
// We now DELAY the quit until sing-box is actually stopped, then hard-exit.
let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting || !proxyClient) return;
  isQuitting = true;
  event.preventDefault();
  void (async () => {
    try {
      await proxyClient?.stop();
    } catch {
      // best effort — never block shutdown on a stop error
    }
    app.exit(0);
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
