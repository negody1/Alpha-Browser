import { safeStorage } from 'electron';
import type { SecretStorageProvider } from '@alpha/core-passwords';
import type { PasswordsSecretsStore } from '../storage/PasswordsSecretsStore';

/**
 * SecretStorageProvider backed by Electron `safeStorage` (DPAPI on Windows).
 *
 * - No native module, no build step — ships with Electron.
 * - Encrypts the password and stores only the base64 ciphertext in
 *   PasswordsSecretsStore (the account key is `credential:<id>`).
 * - Secrets never leave the main process; plaintext is never written to disk.
 *
 * NOTE: `safeStorage.isEncryptionAvailable()` must be called after `app.ready`.
 * This provider is constructed during window creation (post-ready), so that
 * holds.
 */
export class SafeStorageProvider implements SecretStorageProvider {
  constructor(private readonly store: PasswordsSecretsStore) {}

  async isAvailable(): Promise<boolean> {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async get(_service: string, account: string): Promise<string | null> {
    const base64 = this.store.getRaw(account);
    if (!base64) return null;
    try {
      const buffer = Buffer.from(base64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      // Wrong DPAPI context (e.g. different Windows user / machine) or corrupt
      // ciphertext: treat as unreadable rather than throwing.
      return null;
    }
  }

  async set(_service: string, account: string, secret: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available');
    }
    const encrypted = safeStorage.encryptString(secret);
    this.store.setRaw(account, encrypted.toString('base64'));
  }

  async delete(_service: string, account: string): Promise<void> {
    this.store.deleteRaw(account);
  }

  async list(_service: string): Promise<string[]> {
    return this.store.keys();
  }
}
