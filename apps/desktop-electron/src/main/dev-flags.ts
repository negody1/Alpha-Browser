import { app } from 'electron';

/**
 * DevTools are available ONLY in development or behind the hidden
 * `ALPHA_DEVTOOLS=1` flag. In production builds, F12 / Ctrl+Shift+I/J / Ctrl+U
 * are blocked so normal users can't accidentally open the (white, blinking)
 * inspector and mistake it for instability.
 */
export function devToolsAllowed(): boolean {
  try {
    if (!app.isPackaged) return true;
  } catch {
    return true; // non-Electron context (tests)
  }
  return process.env.NODE_ENV === 'development' || process.env.ALPHA_DEVTOOLS === '1';
}
