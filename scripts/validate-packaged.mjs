#!/usr/bin/env node
/**
 * P0-B / P4.1 packaged build validation.
 *
 * Asserts that the packaged Windows build actually contains everything a
 * release needs:
 *   - the proxy binary at <resourcesPath>/bin/sing-box.exe (and that it
 *     launches via `sing-box version`)                                  [B3]
 *   - the AdBlock filter list at <resourcesPath>/adblock/default-ads.txt [B1]
 *   - the branding images in the built renderer output                  [B2]
 *
 * Run AFTER `pnpm run dist:win` (which produces apps/desktop-electron/release/
 * and apps/desktop-electron/out/). The binary launch check requires Windows.
 *
 *   pnpm run validate:packaged
 *
 * Exit codes:
 *   0  all required resources present (and sing-box launched on Windows)
 *   1  a required resource is missing
 *   2  binary present but failed to launch / non-zero exit
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const appDir = join(repoRoot, 'apps', 'desktop-electron');
// In a packaged build, <resourcesPath> is win-unpacked/resources.
const releaseResources = join(appDir, 'release', 'win-unpacked', 'resources');
const binName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const binPath = join(releaseResources, 'bin', binName);

// B1: AdBlock filter list shipped via extraResources.
const adblockPath = join(releaseResources, 'adblock', 'default-ads.txt');
// B2: branding images emitted by Vite (publicDir resources/public → out/renderer root).
const brandingDir = join(appDir, 'out', 'renderer', 'branding');
const brandingFiles = ['app-logo.png', 'logo-ntp.png'].map((f) => join(brandingDir, f));

let hardFail = false;

console.log('[validate:packaged] checking AdBlock filter list (B1):');
console.log('  ' + adblockPath);
if (!existsSync(adblockPath)) {
  console.error('[validate:packaged] FAIL: AdBlock filter list not found in packaged resources.');
  console.error('  - Did `dist:win` run scripts/sync-adblock-assets.mjs before electron-builder?');
  hardFail = true;
} else {
  console.log('[validate:packaged] OK: AdBlock filter list present.');
}

console.log('[validate:packaged] checking branding images (B2):');
for (const f of brandingFiles) {
  console.log('  ' + f);
  if (!existsSync(f)) {
    console.error('[validate:packaged] FAIL: branding image missing from built renderer: ' + f);
    hardFail = true;
  }
}
if (!hardFail) {
  console.log('[validate:packaged] OK: branding images present.');
}

console.log('[validate:packaged] expecting binary at:');
console.log('  ' + binPath);

if (!existsSync(binPath)) {
  console.error('[validate:packaged] FAIL: binary not found.');
  console.error('  - Did you run `pnpm run proxy:fetch-bin` (with a pinned SHA256) before `pnpm run dist:win`?');
  console.error('  - Did `pnpm run dist:win` complete and produce release/win-unpacked/?');
  process.exit(1);
}

if (hardFail) {
  console.error('[validate:packaged] FAIL: one or more required resources are missing (see above).');
  process.exit(1);
}

console.log('[validate:packaged] binary found. Running: sing-box version');
console.log('----------------------------------------');
const res = spawnSync(binPath, ['version'], { stdio: 'inherit' });
console.log('----------------------------------------');

if (res.error) {
  console.error('[validate:packaged] FAIL: could not launch binary:', res.error.message);
  process.exit(2);
}
if (res.status !== 0) {
  console.error(`[validate:packaged] FAIL: sing-box version exited with code ${res.status}.`);
  process.exit(2);
}

console.log('[validate:packaged] OK: packaged sing-box launches and reports its version.');
process.exit(0);
