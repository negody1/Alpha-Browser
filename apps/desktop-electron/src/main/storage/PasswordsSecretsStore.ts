import { app } from 'electron';
import { join } from 'node:path';
import { loadJsonFile, saveJsonFile } from './atomic-json';

interface SecretsData {
  schemaVersion: 1;
  /** key (`credential:<id>`) -> base64 of safeStorage-encrypted password */
  secrets: Record<string, string>;
}

function emptyData(): SecretsData {
  return { schemaVersion: 1, secrets: {} };
}

/**
 * Stores ONLY encrypted secrets (DPAPI ciphertext as base64). No origin,
 * username or plaintext password is ever written here. Crash-safe via
 * atomic write + `.bak` + `.corrupt` quarantine.
 */
export class PasswordsSecretsStore {
  private readonly filePath = join(app.getPath('userData'), 'passwords-secrets.json');
  private data: SecretsData;
  private lastLoadCorrupted = false;

  constructor() {
    const res = loadJsonFile<SecretsData>(this.filePath, emptyData());
    this.data =
      res.data && typeof res.data === 'object' && res.data.secrets
        ? { schemaVersion: 1, secrets: { ...res.data.secrets } }
        : emptyData();
    this.lastLoadCorrupted = res.corrupted;
  }

  /** True if the primary file was corrupt on load and had to be quarantined. */
  wasCorruptOnLoad(): boolean {
    return this.lastLoadCorrupted;
  }

  getRaw(key: string): string | null {
    return this.data.secrets[key] ?? null;
  }

  setRaw(key: string, base64: string): void {
    this.data.secrets[key] = base64;
    this.flush();
  }

  deleteRaw(key: string): void {
    if (key in this.data.secrets) {
      delete this.data.secrets[key];
      this.flush();
    }
  }

  keys(): string[] {
    return Object.keys(this.data.secrets);
  }

  private flush(): void {
    saveJsonFile(this.filePath, this.data);
  }
}
