import { app, ipcMain, webContents as webContentsModule, type Session, type WebContents } from 'electron';
import type { OnBeforeRequestListenerDetails } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ElectronBlocker, fromElectronDetails, Request } from '@ghostery/adblocker-electron';

/** ALPHA_DEBUG_ADBLOCK=1 — verbose adblock diagnostics. */
const ADBLOCK_DBG = (): boolean => process.env.ALPHA_DEBUG_ADBLOCK === '1';
const shortUrl = (u: unknown): string => (typeof u === 'string' ? u.slice(0, 80) : String(u));

/** Gate callbacks injected by AdblockService so cosmetics respect global + per-site state. */
export interface CosmeticGate {
  /** Global adblock enabled? */
  isEnabled: () => boolean;
  /** Is this host on the per-site disable list? */
  isDomainDisabled: (host: string) => boolean;
}

export interface GhosteryDecision {
  /** Cancel the request entirely. */
  block: boolean;
  /** If set, redirect the request here instead (Ghostery resource replacement or $removeparam rewrite). */
  redirectUrl?: string;
}

/**
 * Phase 0.1.3-A — ABP-compatible network engine backed by @ghostery/adblocker.
 *
 * Loads a SERIALIZED engine (built by scripts/build-adblock-engine.mjs) so there
 * is no list parsing and no network on startup. Used for NETWORK matching only,
 * called from inside AdblockService's single onBeforeRequest (so per-site
 * disable, URL cleanup, stats and mainFrame protection are all preserved and the
 * DIRECT/PROXY session separation is untouched).
 *
 * Safe by construction: if the serialized engine is missing or corrupt, load()
 * returns false and AdblockService falls back to the legacy domain engine.
 */
export class GhosteryEngine {
  private blocker: ElectronBlocker | null = null;
  private loadedFrom: string | null = null;
  private cosmeticEnabled = false;
  private injectCount = 0;
  private cssApplied = 0;
  private cssBytesTotal = 0;
  private wcHookInstalled = false;
  private readonly cosmeticSessions = new WeakSet<Session>();

  isReady(): boolean {
    return this.blocker !== null;
  }

  cosmeticsActive(): boolean {
    return this.cosmeticEnabled;
  }

  /** Number of cosmetic-inject IPC calls served by the preload pipeline. */
  getInjectCount(): number {
    return this.injectCount;
  }

  /** Times the base cosmetic stylesheet was applied directly (main-side insertCSS). */
  getCssAppliedCount(): number {
    return this.cssApplied;
  }

  getCssBytesTotal(): number {
    return this.cssBytesTotal;
  }

  /** Naive registrable domain (good enough for cosmetic domain-scoped matching). */
  private registrableDomain(hostname: string): string {
    const p = hostname.split('.');
    return p.length <= 2 ? hostname : p.slice(-2).join('.');
  }

  /**
   * Apply the base + hostname cosmetic stylesheet to a page DIRECTLY from main
   * (insertCSS), independent of the Ghostery preload pipeline. This is the
   * reliable path that hides empty ad containers / iframe-plugin placeholders /
   * static banner slots: the generic + hostname hiding rules don't need page DOM
   * info, so they can be injected on dom-ready without any renderer round-trip.
   * Scriptlets are intentionally left to the preload path (timing-sensitive).
   */
  injectBaseCosmetics(wc: WebContents, url: string): void {
    if (!this.blocker || wc.isDestroyed()) return;
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const { active, styles } = this.blocker.getCosmeticsFilters({
        url,
        hostname,
        domain: this.registrableDomain(hostname),
        getBaseRules: true,
        getInjectionRules: true,
        getRulesFromHostname: true,
      }) as { active?: boolean; styles?: string };
      if (active === false) return;
      if (styles && styles.length > 0) {
        void wc.insertCSS(styles, { cssOrigin: 'user' });
        this.cssApplied += 1;
        this.cssBytesTotal += styles.length;
        if (ADBLOCK_DBG()) {
          console.log('[alpha][adblock-dbg] base cosmetics applied (insertCSS)', {
            url: shortUrl(url),
            cssBytes: styles.length,
            cssApplied: this.cssApplied,
          });
        }
      } else if (ADBLOCK_DBG()) {
        console.log('[alpha][adblock-dbg] base cosmetics: no styles for', { url: shortUrl(url) });
      }
    } catch (err) {
      if (ADBLOCK_DBG()) console.log('[alpha][adblock-dbg] base cosmetics error', { err: String(err) });
    }
  }

  /** Cosmetic rules AVAILABLE for a page (generic + hostname), for the debug overlay. */
  getCosmeticStatsForUrl(url: string): { cssBytes: number; selectors: number; scriptlets: number; extended: number } | null {
    if (!this.blocker) return null;
    try {
      const hostname = new URL(url).hostname;
      const r = this.blocker.getCosmeticsFilters({
        url,
        hostname,
        domain: hostname,
        getBaseRules: true,
        getInjectionRules: true,
      }) as { styles?: string; scripts?: string[]; extended?: unknown[] };
      const styles = r.styles ?? '';
      // Selectors ≈ comma-separated groups in the hiding stylesheet.
      const selectors = styles ? styles.split(',').length : 0;
      return {
        cssBytes: styles.length,
        selectors,
        scriptlets: (r.scripts ?? []).length,
        extended: (r.extended ?? []).length,
      };
    } catch {
      return null;
    }
  }

  /**
   * Enable cosmetic filtering + scriptlet injection + CSP rules on the given
   * sessions WITHOUT taking over onBeforeRequest (AdblockService keeps that for
   * per-site disable, stats, URL cleanup and the mainFrame guard).
   *
   * Electron 33 has no registerPreloadScript, so we use setPreloads. Every hook
   * is bulletproof: it only ever injects into http(s) pages that are not
   * per-site-disabled (so the chrome shell — file:// — PDF viewer and internal
   * pages are never touched), and onHeadersReceived always calls its callback so
   * a response can never hang. Kill switch: ALPHA_ADBLOCK_COSMETIC=0.
   */
  enableCosmetics(sessions: Session[], gate: CosmeticGate): void {
    if (!this.blocker) return;
    if (process.env.ALPHA_ADBLOCK_COSMETIC === '0') {
      console.log('[alpha][adblock] cosmetic filtering disabled by ALPHA_ADBLOCK_COSMETIC=0');
      return;
    }
    const blocker = this.blocker;

    let preloadPath: string;
    try {
      // The preload is a TRANSITIVE dep of adblocker-electron, so resolve it
      // THROUGH that package (which is a direct dep) — mirrors Ghostery's own
      // PRELOAD_PATH and works under pnpm's nested node_modules.
      const req = createRequire(__filename);
      const electronPkg = req.resolve('@ghostery/adblocker-electron');
      preloadPath = createRequire(electronPkg).resolve('@ghostery/adblocker-electron-preload');
    } catch (err) {
      console.warn('[alpha][adblock] cosmetic preload unresolved; cosmetics off', { err: String(err) });
      return;
    }

    const hostOf = (url: string): string => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return '';
      }
    };
    // Only ever inject into real web pages that are adblock-enabled and not
    // per-site-disabled. Non-http (file/alpha/devtools/data/about) → never.
    const allowedPage = (url: unknown): boolean => {
      if (typeof url !== 'string' || !/^https?:/i.test(url)) return false;
      if (!gate.isEnabled()) return false;
      const h = hostOf(url);
      return !(h && gate.isDomainDisabled(h));
    };

    try {
      ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
      ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
        try {
          if (!allowedPage(url)) {
            if (ADBLOCK_DBG()) {
              console.log('[alpha][adblock-dbg] cosmetic SKIP', {
                url: shortUrl(url),
                reason: typeof url === 'string' && /^https?:/i.test(url) ? 'disabled-or-off' : 'non-web-page',
              });
            }
            return Promise.resolve();
          }
          this.injectCount += 1;
          if (ADBLOCK_DBG()) {
            const m = (msg ?? {}) as { ids?: unknown[]; classes?: unknown[]; hrefs?: unknown[]; lifecycle?: string };
            console.log('[alpha][adblock-dbg] cosmetic INJECT', {
              url: shortUrl(url),
              lifecycle: m.lifecycle,
              ids: m.ids?.length ?? 0,
              classes: m.classes?.length ?? 0,
              hrefs: m.hrefs?.length ?? 0,
              injectCount: this.injectCount,
            });
          }
          return blocker.onInjectCosmeticFilters(event, url as string, msg);
        } catch {
          return Promise.resolve();
        }
      });
      ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
      ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
        try {
          // Don't run the DOM mutation observer in the shell / PDF / internal pages.
          const senderUrl = event.sender?.getURL?.() ?? '';
          if (!allowedPage(senderUrl)) return Promise.resolve(false);
          return blocker.onIsMutationObserverEnabled(event);
        } catch {
          return Promise.resolve(false);
        }
      });
    } catch (err) {
      console.warn('[alpha][adblock] cosmetic IPC wiring failed; cosmetics off', { err: String(err) });
      return;
    }

    for (const session of sessions) {
      if (this.cosmeticSessions.has(session)) continue;
      try {
        const existing = session.getPreloads();
        if (!existing.includes(preloadPath)) session.setPreloads([...existing, preloadPath]);
        // CSP / scriptlet header injection. Always calls callback (no hang) and
        // only acts on main/subFrame of allowed pages.
        session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
          try {
            if (!allowedPage(details.url)) {
              cb({});
              return;
            }
            blocker.onHeadersReceived(details as never, cb);
          } catch {
            cb({});
          }
        });
        this.cosmeticSessions.add(session);
      } catch (err) {
        console.warn('[alpha][adblock] cosmetic session wiring failed', { err: String(err) });
      }
    }
    // RELIABLE PATH: inject the base cosmetic stylesheet directly on every guest
    // page load, independent of the preload pipeline. Hooked once, globally.
    if (!this.wcHookInstalled) {
      this.wcHookInstalled = true;
      const hook = (wc: WebContents): void => {
        const apply = (): void => {
          try {
            const u = wc.getURL();
            if (allowedPage(u)) this.injectBaseCosmetics(wc, u);
          } catch {
            /* ignore */
          }
        };
        wc.on('dom-ready', apply);
      };
      app.on('web-contents-created', (_e, wc) => hook(wc));
      try {
        for (const wc of webContentsModule.getAllWebContents()) hook(wc);
      } catch {
        /* ignore */
      }
    }

    this.cosmeticEnabled = true;
    console.log('[alpha][adblock] cosmetic + scriptlet + CSP enabled', {
      sessions: sessions.length,
      preload: preloadPath,
    });
  }

  /** Candidate paths for the serialized engine, freshest (userData) first. */
  private candidates(): string[] {
    const out: string[] = [];
    // 1) 24h-refreshed copy in userData (if a background refresh has run).
    try {
      out.push(join(app.getPath('userData'), 'adblock', 'engine.bin'));
    } catch {
      /* non-electron context */
    }
    // 2) Packaged extraResources copy: <resourcesPath>/adblock/engine.bin.
    try {
      out.push(join(process.resourcesPath, 'adblock', 'engine.bin'));
    } catch {
      /* ignore */
    }
    // 3) asar/files copy + dev path.
    try {
      out.push(join(app.getAppPath(), 'resources', 'adblock', 'engine.bin'));
    } catch {
      /* ignore */
    }
    out.push(join(__dirname, '../../../../apps/desktop-electron/resources/adblock/engine.bin'));
    return out;
  }

  /** Try to load the serialized engine. Returns true on success. */
  load(): boolean {
    for (const p of this.candidates()) {
      try {
        if (!existsSync(p)) continue;
        const buf = readFileSync(p);
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        this.blocker = ElectronBlocker.deserialize(bytes) as unknown as ElectronBlocker;
        this.loadedFrom = p;
        console.log('[alpha][adblock] ghostery engine loaded', { path: p, bytes: buf.length });
        return true;
      } catch (err) {
        console.warn('[alpha][adblock] ghostery deserialize failed', { path: p, err: String(err) });
        this.blocker = null;
      }
    }
    return false;
  }

  /**
   * Network decision for a single request. Never throws (returns no-block on any
   * error). The caller already guarantees mainFrame is excluded.
   */
  /**
   * Recover the request initiator. Electron's onBeforeRequest `referrer` is very
   * often empty, and fromElectronDetails uses ONLY referrer as the source — so
   * without this, $third-party rules (a large part of EasyPrivacy/AdGuard and our
   * supplement) never evaluate as third-party and silently fail to block ON EVERY
   * SITE. We fall back to the initiating frame's URL, then the tab URL.
   */
  private sourceUrlFor(details: OnBeforeRequestListenerDetails): string {
    if (details.referrer) return details.referrer;
    try {
      const frameUrl = details.frame?.url;
      if (frameUrl) return frameUrl;
    } catch {
      /* frame navigated/destroyed */
    }
    try {
      const tabUrl = details.webContents?.getURL();
      if (tabUrl) return tabUrl;
    } catch {
      /* ignore */
    }
    return '';
  }

  match(details: OnBeforeRequestListenerDetails): GhosteryDecision {
    if (!this.blocker) return { block: false };
    try {
      const sourceUrl = this.sourceUrlFor(details);
      const request = sourceUrl
        ? Request.fromRawDetails({
            _originalRequestDetails: details,
            requestId: `${details.id}`,
            sourceUrl,
            tabId: details.webContentsId,
            type: details.resourceType || 'other',
            url: details.url,
          })
        : fromElectronDetails(details);
      const res = this.blocker.match(request);
      if (res.redirect?.dataUrl) return { block: false, redirectUrl: res.redirect.dataUrl };
      if (res.rewrite?.url) return { block: false, redirectUrl: res.rewrite.url };
      return { block: res.match === true };
    } catch {
      return { block: false };
    }
  }

  /**
   * Best-effort background refresh (≤ once / 24h). Never blocks startup and never
   * touches the network on the hot path: callers invoke this AFTER the window is
   * up. On success a fresh engine.bin is written to userData and swapped in; on
   * any failure the currently-loaded engine keeps serving.
   */
  async maybeRefresh(lists: ReadonlyArray<readonly [string, string]>): Promise<void> {
    let target: string;
    try {
      target = join(app.getPath('userData'), 'adblock', 'engine.bin');
    } catch {
      return;
    }
    try {
      if (existsSync(target)) {
        const ageMs = Date.now() - statSync(target).mtimeMs;
        if (ageMs < 24 * 60 * 60 * 1000) return; // fresh enough
      }
    } catch {
      /* ignore stat errors, attempt refresh */
    }

    try {
      const parts: string[] = [];
      for (const [, url] of lists) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 30_000);
          const r = await fetch(url, { signal: ctrl.signal });
          clearTimeout(t);
          if (r.ok) {
            const text = await r.text();
            if (text.length > 100) parts.push(text);
          }
        } catch {
          /* skip this list */
        }
      }
      if (parts.length === 0) return; // offline — keep current engine
      // Re-merge the bundled supplement so it survives the refresh.
      for (const sp of [
        join(process.resourcesPath ?? '', 'adblock', 'alpha-supplement.txt'),
        join(app.getAppPath(), 'resources', 'adblock', 'alpha-supplement.txt'),
        join(__dirname, '../../../../packages/core-adblock/assets/alpha-supplement.txt'),
      ]) {
        try {
          if (existsSync(sp)) {
            parts.push(readFileSync(sp, 'utf8'));
            break;
          }
        } catch {
          /* ignore */
        }
      }
      const fresh = ElectronBlocker.parse(parts.join('\n'), {
        enableCompression: true,
        loadNetworkFilters: true,
        loadCosmeticFilters: true,
        loadCSPFilters: true,
      }) as unknown as ElectronBlocker;
      const serialized = fresh.serialize();
      mkdirSync(join(app.getPath('userData'), 'adblock'), { recursive: true });
      writeFileSync(target, serialized);
      this.blocker = fresh;
      this.loadedFrom = target;
      console.log('[alpha][adblock] ghostery engine refreshed (24h)', { path: target, bytes: serialized.length });
    } catch (err) {
      console.warn('[alpha][adblock] ghostery refresh failed (keeping current)', { err: String(err) });
    }
  }

  describe(): string {
    return this.loadedFrom ? `ghostery(${this.loadedFrom})` : 'ghostery(unloaded)';
  }
}
