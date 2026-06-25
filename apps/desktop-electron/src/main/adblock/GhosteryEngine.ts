import { app } from 'electron';
import type { OnBeforeRequestListenerDetails } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ElectronBlocker, fromElectronDetails } from '@ghostery/adblocker-electron';

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

  isReady(): boolean {
    return this.blocker !== null;
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
  match(details: OnBeforeRequestListenerDetails): GhosteryDecision {
    if (!this.blocker) return { block: false };
    try {
      const res = this.blocker.match(fromElectronDetails(details));
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
