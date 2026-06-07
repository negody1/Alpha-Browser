#!/usr/bin/env node
/**
 * B1 release-blocker fix: guarantee the bundled AdBlock filter list ships with
 * every packaged build.
 *
 * Canonical source : packages/core-adblock/assets/default-ads.txt
 * Generated copy    : apps/desktop-electron/resources/adblock/default-ads.txt
 *
 * The generated copy lands inside the app (apps/desktop-electron/resources) so
 * it is included BOTH:
 *   - in the asar via electron-builder `files: resources/**` , and
 *   - at <resourcesPath>/adblock via electron-builder `extraResources`.
 *
 * That gives AdblockService two independent packaged copies to load, so a
 * release can never start with empty filters. This script runs before
 * `electron-vite build` in `dist:win`.
 *
 * Exit codes: 0 ok · 1 canonical source missing.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const src = join(repoRoot, 'packages', 'core-adblock', 'assets', 'default-ads.txt');
const destDir = join(repoRoot, 'apps', 'desktop-electron', 'resources', 'adblock');
const dest = join(destDir, 'default-ads.txt');

if (!existsSync(src)) {
  console.error('[sync-adblock] FAIL: canonical filter list not found:');
  console.error('  ' + src);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('[sync-adblock] OK: copied filter list');
console.log('  from ' + src);
console.log('  to   ' + dest);
process.exit(0);
