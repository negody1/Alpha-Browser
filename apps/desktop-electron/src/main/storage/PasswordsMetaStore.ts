import { app } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PasswordEntryMetadata } from '@alpha/shared-types';
import { loadJsonFile, saveJsonFile } from './atomic-json';

interface PasswordsMetaData {
  schemaVersion: 1;
  entries: PasswordEntryMetadata[];
  neverSaveOrigins: string[];
}

function emptyData(): PasswordsMetaData {
  return { schemaVersion: 1, entries: [], neverSaveOrigins: [] };
}

/** Accept legacy electron-store shape ({ version, entries, neverSaveOrigins }) and
 *  fill in fields added by newer schema versions (lastUsedAt). */
function normalize(raw: unknown): PasswordsMetaData {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawEntries = Array.isArray(obj.entries) ? (obj.entries as Record<string, unknown>[]) : [];
  const entries: PasswordEntryMetadata[] = rawEntries
    .filter((e) => e && typeof e.id === 'string' && typeof e.origin === 'string')
    .map((e) => {
      const updatedAt = typeof e.updatedAt === 'string' ? e.updatedAt : new Date().toISOString();
      return {
        id: String(e.id),
        origin: String(e.origin),
        username: typeof e.username === 'string' ? e.username : '',
        createdAt: typeof e.createdAt === 'string' ? e.createdAt : updatedAt,
        updatedAt,
        lastUsedAt: typeof e.lastUsedAt === 'string' ? e.lastUsedAt : updatedAt,
      };
    });
  const neverSaveOrigins = Array.isArray(obj.neverSaveOrigins)
    ? (obj.neverSaveOrigins as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return { schemaVersion: 1, entries, neverSaveOrigins };
}

/**
 * Plaintext metadata only (id/origin/username/dates). NO passwords. Crash-safe
 * via atomic write + `.bak` + `.corrupt` quarantine.
 */
export class PasswordsMetaStore {
  private readonly filePath = join(app.getPath('userData'), 'passwords-meta.json');
  private data: PasswordsMetaData;
  private lastLoadCorrupted = false;

  constructor() {
    const res = loadJsonFile<unknown>(this.filePath, emptyData());
    this.data = normalize(res.data);
    this.lastLoadCorrupted = res.corrupted;
  }

  wasCorruptOnLoad(): boolean {
    return this.lastLoadCorrupted;
  }

  list(): PasswordEntryMetadata[] {
    return [...this.data.entries];
  }

  findEntryId(origin: string, username: string): string | null {
    const o = origin.trim().toLowerCase();
    const u = username.trim();
    const entry = this.data.entries.find((e) => e.origin === o && e.username === u);
    return entry?.id ?? null;
  }

  listNeverSaveOrigins(): string[] {
    return [...this.data.neverSaveOrigins];
  }

  setNeverSave(origin: string, never: boolean): void {
    const o = origin.trim().toLowerCase();
    const list = this.data.neverSaveOrigins;
    const has = list.includes(o);
    this.data.neverSaveOrigins = never
      ? has
        ? list
        : [...list, o]
      : list.filter((x) => x !== o);
    this.flush();
  }

  upsertEntry(payload: { origin: string; username: string }, id?: string): PasswordEntryMetadata {
    const now = new Date().toISOString();
    const origin = payload.origin.trim().toLowerCase();
    const username = payload.username.trim();
    const entries = this.data.entries;
    const existingIdx = entries.findIndex((e) => e.origin === origin && e.username === username);
    if (existingIdx >= 0) {
      const updated: PasswordEntryMetadata = {
        ...entries[existingIdx],
        updatedAt: now,
        lastUsedAt: now,
      };
      entries[existingIdx] = updated;
      this.flush();
      return updated;
    }
    const entry: PasswordEntryMetadata = {
      id: id ?? randomUUID(),
      origin,
      username,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    };
    entries.unshift(entry);
    if (entries.length > 2000) entries.length = 2000;
    this.flush();
    return entry;
  }

  /**
   * Rename the username of an existing entry in place (keeps the same id, so
   * the encrypted secret stays linked). If the new (origin, username) pair
   * already exists on another entry, that duplicate is removed and the
   * renamed entry wins. Returns the updated entry, or null if id is unknown.
   */
  renameUsername(id: string, username: string): PasswordEntryMetadata | null {
    const u = username.trim();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return null;
    if (entry.username === u) return entry;
    this.data.entries = this.data.entries.filter(
      (e) => e.id === id || !(e.origin === entry.origin && e.username === u),
    );
    entry.username = u;
    entry.updatedAt = new Date().toISOString();
    this.flush();
    return entry;
  }

  /** Bump lastUsedAt for an entry (autofill use). */
  markUsed(id: string): void {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.lastUsedAt = new Date().toISOString();
    this.flush();
  }

  /** Bump updatedAt for an entry (e.g. password changed in place). */
  markUpdated(id: string): void {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.updatedAt = new Date().toISOString();
    this.flush();
  }

  deleteEntry(id: string): boolean {
    const before = this.data.entries.length;
    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    if (this.data.entries.length === before) return false;
    this.flush();
    return true;
  }

  private flush(): void {
    saveJsonFile(this.filePath, this.data);
  }
}
