import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { ActivationState, ActivationStatus } from '@alpha/shared-types';
import { alphaAccessBaseUrl } from '../app-config';
import type { ProxyClientService } from '../proxy/ProxyClientService';

/**
 * Client side of the email/activation-code flow. Trades email + one-time code +
 * a locally-generated device id for the proxy profile over HTTPS, stores the
 * profile where {@link ../proxy/remote-profile} resolves it, and restarts the
 * proxy. The profile is NEVER logged. No SOCKS/sing-box/file/env terminology
 * leaks to the user — this service is the product-facing onboarding.
 */
export class ActivationService {
  private email: string | null = null;
  private status: ActivationStatus = 'idle';
  private error: string | null = null;
  private lastCheckedAt: string | null = null;

  constructor(private readonly getProxy: () => ProxyClientService | null) {
    const m = this.readMeta();
    this.email = m.email;
    this.status = m.status;
    // If the profile is already present (previously activated), reflect that.
    if (existsSync(this.profilePath()) && this.status === 'idle') this.status = 'connected';
  }

  // ── paths ──
  private dir(): string {
    const d = join(app.getPath('userData'), 'alpha-proxy');
    mkdirSync(d, { recursive: true });
    return d;
  }
  private metaPath() { return join(this.dir(), 'activation.json'); }
  private profilePath() { return join(this.dir(), 'alpha-remote-profile.local.json'); }
  private deviceIdPath() { return join(this.dir(), 'device-id'); }

  private deviceId(): string {
    try {
      if (existsSync(this.deviceIdPath())) {
        const v = readFileSync(this.deviceIdPath(), 'utf8').trim();
        if (v) return v;
      }
    } catch {
      /* regenerate below */
    }
    const id = randomUUID();
    try {
      writeFileSync(this.deviceIdPath(), id, { encoding: 'utf8', mode: 0o600 });
    } catch {
      /* best effort */
    }
    return id;
  }

  private readMeta(): { email: string | null; status: ActivationStatus } {
    try {
      const m = JSON.parse(readFileSync(this.metaPath(), 'utf8')) as { email?: string; status?: ActivationStatus };
      return { email: m.email ?? null, status: m.status ?? 'idle' };
    } catch {
      return { email: null, status: 'idle' };
    }
  }
  private saveMeta(): void {
    try {
      writeFileSync(this.metaPath(), JSON.stringify({ email: this.email, status: this.status }), 'utf8');
    } catch {
      /* best effort */
    }
  }

  getState(): ActivationState {
    return {
      email: this.email,
      status: this.status,
      hasProfile: existsSync(this.profilePath()),
      error: this.error,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  // ── network ──
  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(alphaAccessBaseUrl() + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok && res.status !== 200) return { status: 'error', http: res.status };
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private label(): string {
    try {
      return `${os.hostname()} (${os.platform()})`.slice(0, 80);
    } catch {
      return 'Alpha device';
    }
  }
  private version(): string {
    try {
      return app.getVersion();
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Apply a received profile to disk + restart the proxy. Profile NOT logged.
   * Atomic write (temp + rename) so a crash/disk-full mid-write can never leave
   * a truncated profile that would later parse as missing.
   */
  private applyProfile(profile: unknown): void {
    const p = this.profilePath();
    const tmp = p + '.tmp';
    writeFileSync(tmp, JSON.stringify(profile), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, p);
    void this.getProxy()?.restart();
  }
  private clearProfile(): void {
    try {
      if (existsSync(this.profilePath())) rmSync(this.profilePath());
    } catch {
      /* ignore */
    }
    void this.getProxy()?.restart();
  }

  async register(email: string): Promise<ActivationState> {
    this.error = null;
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      this.error = 'invalid_email';
      return this.getState();
    }
    const r = await this.post('/api/alpha/register', { email: e });
    if (r?.status === 'submitted') {
      this.email = e;
      this.status = 'pending';
      this.saveMeta();
    } else {
      this.error = 'network';
    }
    return this.getState();
  }

  async activate(email: string, code: string): Promise<ActivationState> {
    this.error = null;
    const e = String(email || this.email || '').trim().toLowerCase();
    const c = String(code || '').trim().toUpperCase();
    const r = await this.post('/api/alpha/device/activate', {
      email: e,
      code: c,
      device_id: this.deviceId(),
      device_label: this.label(),
      app_version: this.version(),
    });
    this.lastCheckedAt = new Date().toISOString();
    if (!r) {
      this.error = 'network';
      return this.getState();
    }
    this.email = e;
    this.applyServerStatus(String(r.status), r.profile);
    return this.getState();
  }

  /** Re-check status with the stored device id (no code). Handles revoke. */
  async checkStatus(): Promise<ActivationState> {
    if (!this.email) return this.getState();
    const r = await this.post('/api/alpha/device/activate', {
      email: this.email,
      device_id: this.deviceId(),
      app_version: this.version(),
    });
    this.lastCheckedAt = new Date().toISOString();
    if (!r) {
      this.error = 'network';
      return this.getState();
    }
    this.applyServerStatus(String(r.status), r.profile);
    return this.getState();
  }

  private applyServerStatus(status: string, profile: unknown): void {
    switch (status) {
      case 'connected':
        if (profile) this.applyProfile(profile);
        this.status = 'connected';
        break;
      case 'revoked':
      case 'denied':
        this.clearProfile();
        this.status = status as ActivationStatus;
        break;
      case 'code_used':
      case 'invalid_code':
        this.status = 'enter_code';
        this.error = status;
        break;
      case 'pending':
      default:
        this.status = 'pending';
        break;
    }
    this.saveMeta();
  }
}
