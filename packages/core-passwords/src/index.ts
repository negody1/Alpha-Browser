export interface PasswordEntry {
  id: string;
  origin: string;
  username: string;
  createdAt: number;
  updatedAt: number;
}

/** OS-backed secret storage — single integration point for native modules. */
export interface SecretStorageProvider {
  isAvailable(): Promise<boolean>;
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
  /** List stored account keys (used for orphan reconciliation). */
  list(service: string): Promise<string[]>;
}

export interface PasswordService {
  isAvailable(): Promise<boolean>;
  saveCredential(origin: string, username: string, password: string): Promise<void>;
  getCredentialsForOrigin(origin: string): Promise<Array<PasswordEntry & { password: string }>>;
  updateCredential(
    id: string,
    payload: Partial<{ username: string; password: string }>,
  ): Promise<void>;
  deleteCredential(id: string): Promise<void>;
}

export class UnavailableSecretStorageProvider implements SecretStorageProvider {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {
    throw new Error('Secret storage is not available on this platform');
  }

  async delete(): Promise<void> {
    throw new Error('Secret storage is not available on this platform');
  }

  async list(): Promise<string[]> {
    return [];
  }
}
