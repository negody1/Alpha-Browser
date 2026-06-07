import type { SecretStorageProvider } from '@alpha/core-passwords';

/**
 * Runtime-loaded keytar provider.
 * - Dynamic import so dev environments without keytar still work.
 * - Secrets never leave main process.
 */
export class KeytarProvider implements SecretStorageProvider {
  private keytar: any | null = null;

  private async load(): Promise<any | null> {
    if (this.keytar) return this.keytar;
    try {
      // Avoid bundlers trying to resolve 'keytar' at build time.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
      const mod = await importer('keytar');
      this.keytar = (mod as any).default ?? mod;
      return this.keytar;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    return (await this.load()) != null;
  }

  async get(service: string, account: string): Promise<string | null> {
    const kt = await this.load();
    if (!kt) return null;
    return (await kt.getPassword(service, account)) ?? null;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    const kt = await this.load();
    if (!kt) throw new Error('keytar not available');
    await kt.setPassword(service, account, secret);
  }

  async delete(service: string, account: string): Promise<void> {
    const kt = await this.load();
    if (!kt) throw new Error('keytar not available');
    await kt.deletePassword(service, account);
  }

  async list(service: string): Promise<string[]> {
    const kt = await this.load();
    if (!kt || typeof kt.findCredentials !== 'function') return [];
    const creds = (await kt.findCredentials(service)) as Array<{ account: string }>;
    return creds.map((c) => c.account);
  }
}

