import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { OverlayKind } from './OverlayWindowManager';

const isDev = !app.isPackaged;

// P0 FIX: the previous markers only existed in the DEV source HTML
// (`/overlay/main.tsx`) or at React runtime (`OverlayRoot` / `data-overlay-root`).
// The PRODUCTION build's static HTML is `<div id="root">` + a hashed bundle, so it
// matched NONE of them → verifyOverlayPageUrl() threw on the first overlay open →
// EVERY popup and panel failed in packaged builds (route/adblock/downloads, etc).
// `<title>Alpha Overlay</title>` and the `assets/overlay-*` bundle name are present
// in BOTH dev and prod overlay HTML and absent from the main shell, so they are the
// stable, build-independent markers.
const OVERLAY_HTML_MARKERS = [
  'Alpha Overlay',
  'assets/overlay-',
  'OverlayRoot',
  '/overlay/main.tsx',
  'data-overlay-root',
];
const MAIN_SHELL_MARKERS = ['BrowserShell', 'shell-root', '/src/main.tsx'];

let overlayEntryVerified = false;

export function resolveOverlayPageUrl(kind: OverlayKind, payload?: Record<string, unknown>): string {
  const params = new URLSearchParams({ kind });
  if (payload && Object.keys(payload).length > 0) {
    params.set('payload', JSON.stringify(payload));
  }
  const query = params.toString();

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const root = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '');
    return `${root}/overlay/index.html?${query}`;
  }

  const built = join(__dirname, '../renderer/overlay/index.html');
  if (existsSync(built)) {
    return `file://${built.replace(/\\/g, '/')}?${query}`;
  }

  throw new Error(`[alpha][overlay] overlay index missing: ${built}`);
}

function looksLikeMainShell(html: string): boolean {
  return MAIN_SHELL_MARKERS.some((m) => html.includes(m));
}

function looksLikeOverlayEntry(html: string): boolean {
  return OVERLAY_HTML_MARKERS.some((m) => html.includes(m));
}

export async function verifyOverlayPageUrl(url: string): Promise<void> {
  if (overlayEntryVerified) {
    return;
  }

  let html: string;

  if (url.startsWith('file://')) {
    const path = decodeURIComponent(url.replace(/^file:\/\//, '').split('?')[0]);
    if (!existsSync(path)) {
      throw new Error(`[alpha][overlay] overlay file missing: ${path}`);
    }
    html = readFileSync(path, 'utf-8');
  } else {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url.split('?')[0], { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`[alpha][overlay] overlay HTTP ${res.status} for ${url}`);
      }
      html = await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  if (looksLikeMainShell(html) && !looksLikeOverlayEntry(html)) {
    throw new Error(
      `[alpha][overlay] URL resolves to main BrowserShell, not overlay entry: ${url}`,
    );
  }
  if (!looksLikeOverlayEntry(html)) {
    throw new Error(`[alpha][overlay] URL is not overlay entry (missing markers): ${url}`);
  }

  overlayEntryVerified = true;
}
