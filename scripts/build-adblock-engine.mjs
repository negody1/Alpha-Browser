#!/usr/bin/env node
/**
 * Phase 0.1.3 — build a serialized ABP-compatible adblock engine.
 *
 * Uses @ghostery/adblocker FiltersEngine.fromLists() (the pure-JS core — the
 * Electron wrapper can't be imported in plain Node) which fetches the filter
 * lists AND the redirect/scriptlet resources, then SERIALIZES everything to:
 *   apps/desktop-electron/resources/adblock/engine.bin
 *
 * At runtime ElectronBlocker.deserialize(engine.bin) loads it instantly — no
 * list parsing and no network on startup. The bytes are format-compatible with
 * ElectronBlocker (it extends FiltersEngine, adds no serialized state).
 *
 * RESILIENT: a per-URL fetch wrapper turns any failing list/resource fetch into
 * an empty body so one dead mirror can't fail the whole build. If the result is
 * suspiciously small (everything failed, e.g. offline) an EXISTING engine.bin is
 * kept (last-good) and the script still exits 0 — runtime falls back safely.
 */
import { FiltersEngine } from '@ghostery/adblocker';
import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const destDir = join(repoRoot, 'apps', 'desktop-electron', 'resources', 'adblock');
const dest = join(destDir, 'engine.bin');

// Local bundled supplement (committed canonical source). Pulled in via the
// 'local:' marker below so it is parsed by fromLists alongside the remote lists.
const SUPPLEMENT = join(repoRoot, 'packages', 'core-adblock', 'assets', 'alpha-supplement.txt');

/**
 * Full ABP/uBO/AdGuard list set. All are safe for a general browser: ads,
 * trackers, annoyances, privacy, badware. None block document (mainFrame) loads
 * or YouTube playback / Google / Telegram / login / PDF / downloads.
 */
const LISTS = [
  // EasyList family
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://easylist.to/easylist/fanboy-annoyance.txt',
  'https://easylist.to/easylist/fanboy-social.txt',
  // Peter Lowe
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
  // AdGuard (uBO-format mirrors)
  'https://filters.adtidy.org/extension/ublock/filters/3.txt', // Tracking Protection
  'https://filters.adtidy.org/extension/ublock/filters/17.txt', // URL Tracking Protection
  'https://filters.adtidy.org/extension/ublock/filters/11.txt', // Mobile Ads
  // uBlock Origin uAssets
  'https://ublockorigin.github.io/uAssetsCDN/filters/filters.min.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/privacy.min.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/badware.min.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/unbreak.min.txt',
  // (uBlock resource-abuse is merged into filters.min.txt upstream — no separate file.)
  'https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.min.txt',
  // OISD basic (ABP syntax mirror)
  'https://abp.oisd.nl/basic/',
  // Local bundled supplement (read from disk by safeFetch, not the network).
  'local:alpha-supplement',
];

/** Wrap fetch so a single failing URL never rejects the whole build. */
async function safeFetch(url, opts = {}) {
  // Local bundled supplement — read from disk, never the network.
  if (url === 'local:alpha-supplement') {
    try {
      const text = readFileSync(SUPPLEMENT, 'utf8');
      console.log(`[build-adblock] loaded local alpha-supplement (${(text.length / 1024).toFixed(1)} KiB)`);
      return new Response(text, { status: 200 });
    } catch (err) {
      console.warn(`[build-adblock] SKIP local supplement: ${err?.message ?? err}`);
      return new Response('', { status: 200 });
    }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': 'AlphaBrowser/adblock-build' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    console.log(`[build-adblock] fetched ${url.replace(/^https?:\/\//, '').slice(0, 48)} (${(text.length / 1024).toFixed(0)} KiB)`);
    return new Response(text, { status: 200 });
  } catch (err) {
    console.warn(`[build-adblock] SKIP ${url.replace(/^https?:\/\//, '').slice(0, 48)}: ${err?.message ?? err}`);
    return new Response('', { status: 200 });
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const engine = await FiltersEngine.fromLists(safeFetch, LISTS, {
    enableCompression: true,
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
    loadGenericCosmeticsFilters: true, // generichide / genericblock support
    loadCSPFilters: true,
    loadExceptionFilters: true,
    enableMutationObserver: true,
  });

  const serialized = engine.serialize();

  // Sanity: a real engine with these lists serializes to several MB. If it is
  // tiny, the fetches almost certainly all failed — keep the last-good file.
  if (serialized.length < 512 * 1024 && existsSync(dest)) {
    console.warn(`[build-adblock] result too small (${serialized.length} B) — keeping existing engine.bin (last-good).`);
    process.exit(0);
  }

  mkdirSync(destDir, { recursive: true });
  writeFileSync(dest, serialized);
  console.log(`[build-adblock] OK: serialized engine -> ${dest} (${(statSync(dest).size / 1024).toFixed(0)} KiB)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[build-adblock] unexpected error:', err);
  process.exit(0); // never block the build; runtime falls back to bundled/legacy
});
