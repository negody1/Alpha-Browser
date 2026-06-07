import { app } from 'electron';
import { isUpdateRepoConfigured, latestReleaseApiUrl, releasesPageUrl } from '../app-config';

/**
 * PHASE 6 — passive update check (notify only, NEVER auto-download/install).
 *
 * On startup we query the GitHub "latest release" API once, compare its tag to
 * the running app version, and — if newer — surface a one-shot notification in
 * the renderer. The user decides whether to open the release page. No binaries
 * are fetched here. Mirrors the Bambu Studio "new version available" pattern.
 *
 * The repo is centralized in {@link ../app-config}. While it is still the
 * placeholder, the check is skipped (no request, no error).
 */
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** Release notes (GitHub release body, markdown). */
  notes: string | null;
  /** Human release page to open in the browser/OS. */
  releaseUrl: string | null;
}

/** Strip a leading `v` and split into numeric components. */
function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n));
}

/** Returns true when `latest` is strictly newer than `current` (semver-ish). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export class UpdateCheckService {
  private cached: UpdateInfo | null = null;

  currentVersion(): string {
    try {
      return app.getVersion();
    } catch {
      return '0.0.0';
    }
  }

  /** Open the configured release page (or the repo releases list as fallback). */
  releasesPageUrl(): string {
    return this.cached?.releaseUrl ?? releasesPageUrl();
  }

  /**
   * Query GitHub once (best-effort, time-boxed). Never throws; on any error it
   * returns `available: false` so the UI simply shows nothing.
   */
  async check(): Promise<UpdateInfo> {
    const current = this.currentVersion();
    const fallback: UpdateInfo = {
      available: false,
      currentVersion: current,
      latestVersion: null,
      notes: null,
      releaseUrl: null,
    };

    // No real repo configured yet → skip the network call entirely.
    if (!isUpdateRepoConfigured()) return fallback;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(latestReleaseApiUrl(), {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Alpha-Browser' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) return fallback;
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
        draft?: boolean;
        prerelease?: boolean;
      };
      if (data.draft || data.prerelease || !data.tag_name) return fallback;

      const latest = data.tag_name;
      const available = isNewer(latest, current);
      const info: UpdateInfo = {
        available,
        currentVersion: current,
        latestVersion: latest,
        notes: typeof data.body === 'string' ? data.body.slice(0, 4000) : null,
        releaseUrl: typeof data.html_url === 'string' ? data.html_url : null,
      };
      this.cached = info;
      return info;
    } catch {
      return fallback;
    }
  }
}
