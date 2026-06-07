/**
 * Centralized release/repository configuration.
 *
 * SINGLE SOURCE OF TRUTH for the GitHub coordinates used by the update check.
 * Resolution order (first non-empty wins):
 *   1. env `ALPHA_UPDATE_REPO`  (e.g. "myorg/alpha-browser")
 *   2. `DEFAULT_UPDATE_REPO` constant below.
 *
 * Until the real public repository exists, `DEFAULT_UPDATE_REPO` stays a
 * placeholder and {@link isUpdateRepoConfigured} returns false, so the update
 * check is skipped entirely (no requests to a non-existent repo, no errors).
 *
 * AFTER creating the GitHub repo, change ONLY this constant (or set the env
 * var). See PRE_RELEASE_TODO at the bottom for the full list of values.
 */

/** Placeholder repo — replace with the real `owner/name` before release. */
export const DEFAULT_UPDATE_REPO = 'alpha-browser/alpha-browser';

/** Owners/names that mean "not configured yet" — the update check is skipped. */
const PLACEHOLDER_REPOS = new Set(['alpha-browser/alpha-browser', 'owner/repo', '']);

/** Resolve the configured `owner/name`. */
export function updateRepo(): string {
  const env = (process.env.ALPHA_UPDATE_REPO ?? '').trim();
  return env || DEFAULT_UPDATE_REPO;
}

/** True once a real (non-placeholder) repo is set via env or the constant. */
export function isUpdateRepoConfigured(): boolean {
  return !PLACEHOLDER_REPOS.has(updateRepo());
}

export function latestReleaseApiUrl(): string {
  return `https://api.github.com/repos/${updateRepo()}/releases/latest`;
}

export function releasesPageUrl(): string {
  return `https://github.com/${updateRepo()}/releases/latest`;
}

/**
 * PRE_RELEASE_TODO — values to replace once the GitHub repo is created:
 *   - app-config.ts  → DEFAULT_UPDATE_REPO            (this file)
 *   - package.json   → "repository.url", "homepage"
 *   - electron-builder.yml → (optional) publish provider, if/when auto-update added
 * No secrets live here; the remote VLESS profile is NEVER committed.
 */
