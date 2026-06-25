#!/usr/bin/env node
/**
 * Phase 0.1.3-A — build a serialized ABP-compatible adblock engine.
 *
 * Fetches the standard filter lists, parses them once with @ghostery/adblocker
 * (the pure-JS core — the Electron wrapper can't be imported in plain Node), and
 * SERIALIZES the result to:
 *   apps/desktop-electron/resources/adblock/engine.bin
 *
 * At runtime ElectronBlocker.deserialize(engine.bin) loads it instantly — no
 * list parsing on startup, no network needed on startup. The bytes produced by
 * the core FiltersEngine are format-compatible with ElectronBlocker (it extends
 * FiltersEngine and adds no serialized state).
 *
 * SAFE-FAIL: each list is fetched independently; a single failing list is
 * skipped. If EVERY list fails (offline), the script exits 0 WITHOUT touching an
 * existing engine.bin, so the last-good engine (or the legacy default-ads.txt
 * fallback) keeps shipping. This runs in dist:win before electron-vite build.
 */
import { FiltersEngine } from '@ghostery/adblocker';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const destDir = join(repoRoot, 'apps', 'desktop-electron', 'resources', 'adblock');
const dest = join(destDir, 'engine.bin');

/**
 * Standard, well-vetted lists. These are safe for a general browser: they target
 * ads/trackers/annoyances and do NOT block document (mainFrame) loads, Google,
 * YouTube playback, Telegram, login pages, PDF, or downloads.
 */
const LISTS = [
  ['EasyList', 'https://easylist.to/easylist/easylist.txt'],
  ['EasyPrivacy', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['PeterLowe', 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext'],
  ['Fanboy-Annoyance', 'https://easylist.to/easylist/fanboy-annoyance.txt'],
  ['Fanboy-Social', 'https://easylist.to/easylist/fanboy-social.txt'],
  ['AdGuard-Tracking', 'https://filters.adtidy.org/extension/ublock/filters/3.txt'],
];

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'AlphaBrowser/adblock-build' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const parts = [];
  const active = [];
  for (const [name, url] of LISTS) {
    try {
      const text = await fetchText(url);
      if (text && text.length > 100) {
        parts.push('! >>> ' + name + '\n' + text);
        active.push(name);
        console.log(`[build-adblock] fetched ${name} (${(text.length / 1024).toFixed(0)} KiB)`);
      } else {
        console.warn(`[build-adblock] SKIP ${name}: empty/short response`);
      }
    } catch (err) {
      console.warn(`[build-adblock] SKIP ${name}: ${err?.message ?? err}`);
    }
  }

  if (parts.length === 0) {
    if (existsSync(dest)) {
      console.warn('[build-adblock] all lists failed; keeping existing engine.bin (last-good).');
    } else {
      console.warn('[build-adblock] all lists failed and no existing engine.bin; runtime will use legacy default-ads.txt fallback.');
    }
    process.exit(0); // never fail the build over a transient network issue
  }

  const engine = FiltersEngine.parse(parts.join('\n'), {
    enableCompression: true,
    loadNetworkFilters: true,
    loadCosmeticFilters: true, // cosmetics are stored; runtime decides whether to inject
    loadCSPFilters: true,
  });
  const serialized = engine.serialize();

  mkdirSync(destDir, { recursive: true });
  writeFileSync(dest, serialized);
  const kib = (statSync(dest).size / 1024).toFixed(0);
  console.log(`[build-adblock] OK: serialized engine -> ${dest} (${kib} KiB)`);
  console.log(`[build-adblock] lists active: ${active.join(', ')}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[build-adblock] unexpected error:', err);
  // Do not block the build; runtime falls back safely.
  process.exit(0);
});
