import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * P0-D remote transport profile (VLESS + Reality).
 *
 * SECURITY MODEL (P0/P1 stabilization):
 * - NO real credentials are committed to source. This module resolves the
 *   profile at runtime from, in priority order:
 *     1. Environment variables `ALPHA_REMOTE_*`.
 *     2. A git-ignored JSON file (see {@link localProfilePaths}).
 *   If neither yields a complete profile, it returns `null` and the remote
 *   transport stays disabled (ProxyClientService reports
 *   `REMOTE_PROFILE_MISSING` instead of starting).
 * - `uuid` is an auth credential and `server` is sensitive: both live only in
 *   env or the local ignored file, never in VCS.
 * - `public_key` / `short_id` are public Reality parameters; the Reality
 *   PRIVATE key never exists on the client.
 *
 * A committed `alpha-remote-profile.example.json` documents the shape with
 * placeholder values only.
 */
export interface RemoteProfile {
  server: string;
  port: number;
  uuid: string;
  publicKey: string;
  shortId: string;
  serverName: string;
  flow: string;
}

const PROFILE_FILE = 'alpha-remote-profile.local.json';

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Candidate paths for the git-ignored local profile, highest priority first. */
function localProfilePaths(): string[] {
  const paths: string[] = [];
  const explicit = env('ALPHA_REMOTE_PROFILE');
  if (explicit) paths.push(explicit);
  try {
    paths.push(join(app.getPath('userData'), 'alpha-proxy', PROFILE_FILE));
  } catch {
    // app may be unavailable in non-Electron contexts; ignore.
  }
  try {
    // Dev convenience: project-local file next to the app package.
    paths.push(join(app.getAppPath(), PROFILE_FILE));
  } catch {
    // ignore
  }
  return paths;
}

function coerceProfile(raw: unknown): RemoteProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const server = typeof r.server === 'string' ? r.server.trim() : '';
  const uuid = typeof r.uuid === 'string' ? r.uuid.trim() : '';
  const publicKey = typeof r.publicKey === 'string' ? r.publicKey.trim() : '';
  const shortId = typeof r.shortId === 'string' ? r.shortId.trim() : '';
  const portNum =
    typeof r.port === 'number' ? r.port : Number(typeof r.port === 'string' ? r.port : NaN);
  const serverName =
    typeof r.serverName === 'string' && r.serverName.trim() ? r.serverName.trim() : 'www.cloudflare.com';
  const flow =
    typeof r.flow === 'string' && r.flow.trim() ? r.flow.trim() : 'xtls-rprx-vision';
  // Required: server, port, uuid, publicKey. short_id may legitimately be "".
  if (!server || !uuid || !publicKey || !Number.isInteger(portNum) || portNum <= 0) {
    return null;
  }
  return { server, port: portNum, uuid, publicKey, shortId, serverName, flow };
}

function fromEnv(): RemoteProfile | null {
  const portRaw = env('ALPHA_REMOTE_PORT');
  return coerceProfile({
    server: env('ALPHA_REMOTE_SERVER'),
    port: portRaw ? Number(portRaw) : undefined,
    uuid: env('ALPHA_REMOTE_UUID'),
    publicKey: env('ALPHA_REMOTE_PUBKEY'),
    shortId: env('ALPHA_REMOTE_SHORTID') ?? '',
    serverName: env('ALPHA_REMOTE_SNI'),
    flow: env('ALPHA_REMOTE_FLOW'),
  });
}

function fromFile(): RemoteProfile | null {
  for (const p of localProfilePaths()) {
    try {
      if (p && existsSync(p)) {
        return coerceProfile(JSON.parse(readFileSync(p, 'utf8')));
      }
    } catch {
      // malformed file → skip, try next candidate
    }
  }
  return null;
}

/**
 * Resolve the remote profile, or `null` if none is configured.
 * No credentials are baked into source.
 */
export function getRemoteProfile(): RemoteProfile | null {
  return fromEnv() ?? fromFile();
}

/** Non-secret summary for diagnostics/logging (no uuid, no keys). */
export function describeRemoteProfile(p: RemoteProfile): {
  server: string;
  port: number;
  serverName: string;
  flow: string;
} {
  return { server: p.server, port: p.port, serverName: p.serverName, flow: p.flow };
}
