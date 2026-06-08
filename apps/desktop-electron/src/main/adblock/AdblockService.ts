import { type Session, type WebRequestFilter } from 'electron';
import { normalizeDomain } from '@alpha/core-routing';
import {
  AdblockEngine,
  mergeRuleSets,
  parseBundledList,
  type AdblockResourceType,
  type AdblockRuleSetInput,
} from '@alpha/core-adblock';
import type { AdblockStateSnapshot } from '@alpha/shared-types';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { AdblockStore } from '../storage/AdblockStore';
import type { TabManager } from '../tabs/TabManager';
import { adblockAdd, timingsEnabled } from '../nav-timings';

function mapResourceType(input: string): AdblockResourceType {
  // Electron: mainFrame, subFrame, stylesheet, script, image, font, object, xhr, ping, cspReport, media, websocket, other
  if (input === 'mainFrame') return 'mainFrame';
  if (input === 'subFrame') return 'subFrame';
  if (input === 'stylesheet') return 'stylesheet';
  if (input === 'script') return 'script';
  if (input === 'image') return 'image';
  if (input === 'font') return 'font';
  if (input === 'object') return 'object';
  if (input === 'xhr') return 'xhr';
  if (input === 'media') return 'media';
  if (input === 'websocket') return 'websocket';
  return 'other';
}

export class AdblockService {
  private engine: AdblockEngine;
  private blockedTotal = 0;
  private blockedByTab = new Map<string, number>();
  /** Sessions whose webRequest handler is already attached (idempotency). */
  private readonly registeredSessions = new Set<Session>();
  /** Debounce timer so a burst of blocked requests emits at most one update. */
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: AdblockStore,
    private readonly getTabs: () => TabManager | null,
    private readonly broadcast: () => void,
  ) {
    this.engine = new AdblockEngine({ blockedDomains: [], blockedHostnames: [], urlContains: [] });
    this.reloadRules();
  }

  getState(): AdblockStateSnapshot {
    return {
      enabled: this.store.isEnabled(),
      disabledDomains: this.store.listDisabledDomains(),
      blockedTotal: this.blockedTotal,
      blockedByTabId: Object.fromEntries(this.blockedByTab.entries()),
    };
  }

  setEnabled(enabled: boolean): void {
    this.store.setEnabled(enabled);
    this.broadcast();
  }

  toggleSite(domain: string, disabled: boolean): void {
    const d = normalizeDomain(domain);
    if (!d) return;
    this.store.setDomainDisabled(d, disabled);
    this.broadcast();
  }

  isSiteDisabled(domain: string): boolean {
    const d = normalizeDomain(domain);
    if (!d) return false;
    return this.store.listDisabledDomains().includes(d);
  }

  resetCountersForTab(tabId: string): void {
    this.blockedByTab.delete(tabId);
    this.broadcast();
  }

  /** Coalesce frequent block events into at most one broadcast per ~200ms. */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcast();
    }, 200);
  }

  /**
   * Attach the blocking webRequest handler to each provided session (DIRECT +
   * PROXY). Idempotent: a session is wired at most once. Each HTTP request fires
   * onBeforeRequest in exactly one session, so counters are never double-counted
   * across partitions.
   */
  register(sessions: Session[]): void {
    const filter: WebRequestFilter = { urls: ['http://*/*', 'https://*/*'] };
    for (const sess of sessions) {
      if (this.registeredSessions.has(sess)) continue;
      this.registeredSessions.add(sess);
      sess.webRequest.onBeforeRequest(filter, (details, callback) => {
      // Priority: site-disable > global enabled > default enabled
      if (!this.store.isEnabled()) {
        callback({});
        return;
      }

      // Avoid breaking downloads flows: do not block requests that are marked as downloads by Electron,
      // but Electron doesn't expose that here; we instead avoid blocking mainFrame by default in engine.
      let url: URL | null = null;
      try {
        url = new URL(details.url);
      } catch {
        callback({});
        return;
      }

      const host = url.hostname.toLowerCase();
      const domain = normalizeDomain(host);
      const resourceType = mapResourceType(details.resourceType);
      const tabs = this.getTabs();
      const tab =
        typeof details.webContentsId === 'number'
          ? tabs?.findTabByWebContentsId(details.webContentsId)
          : null;

      // New top-level page load: reset this tab's per-page counter so the badge
      // reflects the current page (uBlock-style), not the tab's whole lifetime.
      if (resourceType === 'mainFrame' && tab) {
        if (this.blockedByTab.get(tab.id)) {
          this.blockedByTab.set(tab.id, 0);
          this.scheduleBroadcast();
        }
      }

      if (domain && this.store.listDisabledDomains().includes(domain)) {
        callback({});
        return;
      }

      const matchStart = timingsEnabled() ? performance.now() : 0;
      const decision = this.engine.match({
        url: details.url,
        hostname: host,
        resourceType,
      });
      if (matchStart && typeof details.webContentsId === 'number') {
        adblockAdd(details.webContentsId, performance.now() - matchStart);
      }

      if (!decision.block) {
        callback({});
        return;
      }

      this.blockedTotal += 1;
      if (tab) {
        const next = (this.blockedByTab.get(tab.id) ?? 0) + 1;
        this.blockedByTab.set(tab.id, next);
      }
      this.scheduleBroadcast();
      callback({ cancel: true });
      });
    }
  }

  /**
   * Resolve the bundled filter list path for the current runtime.
   * - Packaged: shipped via electron-builder extraResources to
   *   `<resourcesPath>/adblock/default-ads.txt`.
   * - Dev: read directly from the workspace package assets.
   * Both candidates are tried (packaged first) so the list never silently
   * disappears in production.
   */
  private bundledListCandidates(): string[] {
    const candidates: string[] = [];
    // 1) Packaged extraResources copy: <resourcesPath>/adblock/default-ads.txt.
    try {
      if (app.isPackaged) {
        candidates.push(join(process.resourcesPath, 'adblock', 'default-ads.txt'));
      }
    } catch {
      // app/resourcesPath unavailable in non-Electron contexts; ignore.
    }
    // 2) Packaged asar copy (shipped via electron-builder `files: resources/**`):
    //    <appPath>/resources/adblock/default-ads.txt. Independent of #1, so the
    //    filter list survives even if extraResources mapping ever breaks. In dev
    //    app.getAppPath() === apps/desktop-electron, so this also resolves the
    //    synced local copy.
    try {
      candidates.push(join(app.getAppPath(), 'resources', 'adblock', 'default-ads.txt'));
    } catch {
      // ignore
    }
    // 3) Dev path: canonical workspace asset, repo-relative from out/main.
    candidates.push(join(__dirname, '../../../../packages/core-adblock/assets/default-ads.txt'));
    // 4) Defensive fallback: resourcesPath even if isPackaged was false.
    try {
      candidates.push(join(process.resourcesPath, 'adblock', 'default-ads.txt'));
    } catch {
      // ignore
    }
    return candidates;
  }

  reloadRules(): void {
    let combined: AdblockRuleSetInput = { blockedDomains: [], blockedHostnames: [], urlContains: [] };
    let loaded = false;
    for (const p of this.bundledListCandidates()) {
      try {
        if (!existsSync(p)) continue;
        combined = mergeRuleSets(combined, parseBundledList(readFileSync(p, 'utf8')));
        loaded = true;
        console.log('[alpha][adblock] bundled filter list loaded', { path: p });
        break;
      } catch {
        // try next candidate
      }
    }
    if (!loaded) {
      console.warn('[alpha][adblock] no bundled filter list found; adblock will be near-empty');
    }

    // custom rules (same format, stored as lines)
    const custom = this.store.getCustomRules().join('\n');
    if (custom.trim()) {
      combined = mergeRuleSets(combined, parseBundledList(custom));
    }

    this.engine.setRules(combined);
  }
}

