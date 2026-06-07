import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LoadResult<T> {
  data: T;
  /** Data was restored from the `.bak` sibling because the primary file was missing/corrupt. */
  recovered: boolean;
  /** Primary file existed but could not be parsed; it was quarantined to `.corrupt-<ts>`. */
  corrupted: boolean;
}

function tryParse<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Read a JSON file with crash-safe recovery:
 * - valid primary file        -> use it
 * - missing primary           -> try `.bak`, else fallback
 * - corrupt primary           -> try `.bak`; if that also fails, quarantine the
 *                                primary to `.corrupt-<ts>` (never silently deleted)
 */
export function loadJsonFile<T>(filePath: string, fallback: T): LoadResult<T> {
  const primary = tryParse<T>(filePath);
  if (primary !== null) {
    return { data: primary, recovered: false, corrupted: false };
  }

  if (existsSync(filePath)) {
    // Primary exists but is unparseable -> attempt backup.
    const bak = tryParse<T>(`${filePath}.bak`);
    if (bak !== null) {
      return { data: bak, recovered: true, corrupted: false };
    }
    // Both unreadable -> quarantine the corrupt primary, never delete it.
    try {
      renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch {
      // best effort
    }
    return { data: fallback, recovered: false, corrupted: true };
  }

  // Primary missing -> backup may still hold last-known-good.
  const bak = tryParse<T>(`${filePath}.bak`);
  if (bak !== null) {
    return { data: bak, recovered: true, corrupted: false };
  }
  return { data: fallback, recovered: false, corrupted: false };
}

/**
 * Write JSON atomically:
 * 1. write to `<file>.tmp`
 * 2. copy current `<file>` -> `<file>.bak` (preserve last-known-good)
 * 3. atomic rename `.tmp` -> `<file>`
 */
export function saveJsonFile<T>(filePath: string, data: T): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8' });
  if (existsSync(filePath)) {
    try {
      copyFileSync(filePath, `${filePath}.bak`);
    } catch {
      // best effort — a missing backup must not block the write
    }
  }
  renameSync(tmp, filePath);
}
