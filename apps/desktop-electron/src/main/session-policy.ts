import type { Session } from 'electron';

// HTML5 Fullscreen API is gated by Electron's 'fullscreen' permission. Allowing
// it is required for video players (YouTube etc.) to enter fullscreen. Media,
// geolocation, etc. remain denied (handled per-request in a later phase).
const ALLOWED_PERMISSIONS = new Set<string>(['fullscreen']);

/** Default deny; only fullscreen is whitelisted for MVP. */
export function applySessionSecurityPolicy(session: Session): void {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });

  session.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission);
  });
}
