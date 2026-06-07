import { randomUUID } from 'node:crypto';
import type { PasswordEntry, PasswordService as CorePasswordService, SecretStorageProvider } from '@alpha/core-passwords';
import { UnavailableSecretStorageProvider } from '@alpha/core-passwords';
import type { PasswordEntryMetadata, PasswordPromptSnapshot, PasswordStateSnapshot } from '@alpha/shared-types';
import { PasswordsMetaStore } from '../storage/PasswordsMetaStore';

const SERVICE_NAME = 'Alpha Browser';

export class PasswordService implements CorePasswordService {
  private provider: SecretStorageProvider;
  private pendingPrompt: PasswordPromptSnapshot | null = null;
  private pendingSecret:
    | { kind: 'save'; origin: string; username: string; password: string }
    | { kind: 'update'; origin: string; username: string; password: string; existingId: string }
    | null = null;
  private pendingByTabId = new Map<
    string,
    { origin: string; username: string; password: string; formSig: string; ts: number; expiresAt: number }
  >();

  constructor(
    private readonly meta: PasswordsMetaStore,
    provider?: SecretStorageProvider,
  ) {
    this.provider = provider ?? new UnavailableSecretStorageProvider();
  }

  setProvider(provider: SecretStorageProvider): void {
    this.provider = provider;
  }

  getStateSnapshot(available: boolean): PasswordStateSnapshot {
    return {
      available,
      neverSaveOrigins: this.meta.listNeverSaveOrigins(),
      pendingPrompt: this.pendingPrompt,
    };
  }

  setPendingPrompt(prompt: PasswordPromptSnapshot | null): void {
    this.pendingPrompt = prompt;
    if (!prompt) {
      this.pendingSecret = null;
    }
  }

  async confirmPendingSave(): Promise<boolean> {
    if (!this.pendingPrompt || !this.pendingSecret) return false;
    const secret = this.pendingSecret;
    try {
      if (secret.kind === 'save') {
        await this.saveCredential(secret.origin, secret.username, secret.password);
      } else {
        await this.updateCredential(secret.existingId, { password: secret.password });
      }
    } catch (e) {
      // Never swallow a storage failure silently: clear the prompt and report
      // failure so the IPC layer can surface it. No secret/metadata is written
      // on failure (saveCredential encrypts before touching metadata).
      console.warn('[alpha][passwords] save failed', { err: String(e) });
      this.pendingPrompt = null;
      this.pendingSecret = null;
      return false;
    }
    this.pendingPrompt = null;
    this.pendingSecret = null;
    return true;
  }

  dismissPrompt(): void {
    this.setPendingPrompt(null);
  }

  setNeverSave(origin: string, never: boolean): void {
    const o = normalizeOrigin(origin);
    if (!o) return;
    this.meta.setNeverSave(o, never);
    if (never && this.pendingPrompt?.origin === o) {
      this.pendingPrompt = null;
      this.pendingSecret = null;
    }
  }

  /**
   * Called by guest preload via ipcMain (tab is inferred by WebContents id).
   * Stores candidate secret only in memory until navigation indicates success.
   */
  onLoginSubmitted(tabId: string, payload: { origin: string; username: string; password: string; formSig: string; ts: number }) {
    const origin = normalizeOrigin(payload.origin);
    if (!origin) return;
    if (this.meta.listNeverSaveOrigins().includes(origin)) return;
    if (!payload.password) return;
    const now = Date.now();
    this.pendingByTabId.set(tabId, {
      origin,
      username: payload.username.trim().slice(0, 512),
      password: payload.password.slice(0, 2048),
      formSig: payload.formSig,
      ts: payload.ts,
      expiresAt: now + 2 * 60_000,
    });
  }

  /**
   * Called by TabManager on navigation events.
   * Heuristic: after a submit + a successful navigate/stop-loading on same origin, show prompt.
   *
   * Update/dedup rules (keyed by origin+username via PasswordsMetaStore):
   * - Empty username: a single empty-username entry per origin (matched as '').
   * - Username changed: treated as a new credential; upsert prevents duplicate
   *   (origin, username) pairs, so at most one entry per pair.
   * - Multiple accounts: all (origin, username) pairs coexist; autofill orders
   *   them by lastUsedAt.
   * - Concurrent prompts: a single global pendingPrompt (last navigation wins);
   *   the renderer only shows it for the matching active tab (prompt.tabId).
   */
  async maybeCreatePromptAfterNavigation(tabId: string, url: string): Promise<PasswordPromptSnapshot | null> {
    const pending = this.pendingByTabId.get(tabId);
    if (!pending) return null;
    if (Date.now() > pending.expiresAt) {
      this.pendingByTabId.delete(tabId);
      return null;
    }
    const origin = normalizeOrigin(url);
    if (!origin || origin !== pending.origin) return null;

    // Never offer to save when secret storage is unavailable: otherwise the
    // user would click "Save" and the password would be silently lost.
    const available = await this.provider.isAvailable();
    if (!available) {
      this.pendingByTabId.delete(tabId);
      return null;
    }

    // Already saved?
    const existingId = this.meta.findEntryId(pending.origin, pending.username);
    if (existingId) {
      const existingSecret = await this.provider.get(SERVICE_NAME, keyFor(existingId));
      if (existingSecret && existingSecret === pending.password) {
        this.pendingByTabId.delete(tabId);
        return null;
      }
      const prompt: PasswordPromptSnapshot = {
        id: randomUUID(),
        kind: 'update',
        origin: pending.origin,
        username: pending.username,
        tabId,
      };
      this.pendingSecret = {
        kind: 'update',
        origin: pending.origin,
        username: pending.username,
        password: pending.password,
        existingId,
      };
      this.pendingPrompt = prompt;
      this.pendingByTabId.delete(tabId);
      return prompt;
    }

    const prompt: PasswordPromptSnapshot = {
      id: randomUUID(),
      kind: 'save',
      origin: pending.origin,
      username: pending.username,
      tabId,
    };
    this.pendingSecret = { kind: 'save', origin: pending.origin, username: pending.username, password: pending.password };
    this.pendingPrompt = prompt;
    this.pendingByTabId.delete(tabId);
    return prompt;
  }

  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  async saveCredential(origin: string, username: string, password: string): Promise<void> {
    const o = normalizeOrigin(origin);
    if (!o) return;
    const id = randomUUID();
    await this.provider.set(SERVICE_NAME, keyFor(id), password);
    this.meta.upsertEntry({ origin: o, username }, id);
  }

  async getCredentialsForOrigin(origin: string): Promise<Array<PasswordEntry & { password: string }>> {
    const o = normalizeOrigin(origin);
    if (!o) return [];
    const entries = this.meta.list().filter((e) => e.origin === o);
    const results: Array<PasswordEntry & { password: string }> = [];
    for (const e of entries) {
      const secret = await this.provider.get(SERVICE_NAME, keyFor(e.id));
      if (!secret) continue;
      results.push({
        id: e.id,
        origin: e.origin,
        username: e.username,
        password: secret,
        createdAt: Date.parse(e.createdAt),
        updatedAt: Date.parse(e.updatedAt),
      });
    }
    return results;
  }

  /**
   * Reveal a single stored password by entry id. Returns null when the entry
   * or its secret is missing. Callers (settings UI) gate this behind an
   * explicit user action; the secret is never persisted in the renderer state.
   */
  async revealPassword(id: string): Promise<string | null> {
    const entry = this.meta.list().find((e) => e.id === id);
    if (!entry) return null;
    const secret = await this.provider.get(SERVICE_NAME, keyFor(id));
    return secret ?? null;
  }

  async updateCredential(
    id: string,
    payload: Partial<{ username: string; password: string }>,
  ): Promise<void> {
    const entries = this.meta.list();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (payload.password != null) {
      await this.provider.set(SERVICE_NAME, keyFor(id), payload.password);
      this.meta.markUpdated(entry.id);
    }
    if (payload.username != null) {
      this.meta.renameUsername(entry.id, payload.username);
    }
  }

  async deleteCredential(id: string): Promise<void> {
    try {
      await this.provider.delete(SERVICE_NAME, keyFor(id));
    } catch {
      // ignore
    }
    this.meta.deleteEntry(id);
  }

  exportMetadataOnly(): PasswordEntryMetadata[] {
    return this.meta.list();
  }

  /** Most-recently-used first, for a given origin (drives autofill ordering). */
  listMetadataForOrigin(origin: string): PasswordEntryMetadata[] {
    const o = normalizeOrigin(origin);
    if (!o) return [];
    return this.meta
      .list()
      .filter((e) => e.origin === o)
      .sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  }

  /** Bump lastUsedAt when a credential is actually used for autofill. */
  markCredentialUsed(id: string): void {
    this.meta.markUsed(id);
  }
}

export function normalizeOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.hostname}`.toLowerCase();
  } catch {
    return null;
  }
}

function keyFor(id: string) {
  return `credential:${id}`;
}

