import { randomUUID } from 'node:crypto';
import type { Session, WebContents } from 'electron';
import type { PermissionCapability, PermissionSiteEntry } from '@alpha/shared-types';
import type { OverlayWindowManager } from '../shell/OverlayWindowManager';

type Decision = 'allow' | 'deny';

/** Permissions granted statically without ever prompting (non-sensitive UX). */
const STATIC_ALLOW = new Set<string>(['fullscreen']);

/** Loose views over Electron's permission detail unions (v33). */
interface RequestDetails {
  requestingUrl?: string;
  securityOrigin?: string;
  mediaTypes?: Array<'video' | 'audio'>;
}

interface CheckDetails {
  securityOrigin?: string;
  mediaType?: 'video' | 'audio' | 'unknown';
}

interface PendingRequest {
  id: string;
  host: string;
  capabilities: PermissionCapability[];
  resolve: (granted: boolean) => void;
}

/**
 * Permission Service MVP (P3-A).
 *
 * Single owner of the per-session permission handlers. Overrides the default-deny
 * baseline from `session-policy` (last handler wins) WITHOUT touching SessionRegistry
 * transport. Default is still deny: a sensitive capability (camera/microphone/
 * notifications) is granted only after an explicit user choice in the popup.
 *
 * Storage: in-memory, keyed by host → capability → decision. Survives new tabs
 * within the same process; intentionally NOT persisted across restarts (MVP).
 */
export class PermissionService {
  private readonly store = new Map<string, Map<PermissionCapability, Decision>>();
  private current: PendingRequest | null = null;
  private readonly queue: PendingRequest[] = [];

  /**
   * @param getOverlay  resolves the overlay manager used to show the prompt.
   * @param notify      called whenever the stored decisions change, so an open
   *                    Settings page can refresh (P3-D). Optional.
   */
  constructor(
    private readonly getOverlay: () => OverlayWindowManager | null,
    private readonly notify: () => void = () => {},
  ) {}

  /** Install the request/check handlers on a session, overriding the baseline. */
  attach(session: Session): void {
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      this.handleRequest(wc, permission, (details ?? {}) as RequestDetails, callback);
    });
    session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      return this.handleCheck(permission, requestingOrigin, (details ?? {}) as CheckDetails);
    });
  }

  /** Called from IPC when the user clicks Allow/Deny in the popup. */
  resolve(requestId: string, allow: boolean): void {
    const req = this.current;
    if (!req || req.id !== requestId) return;
    for (const cap of req.capabilities) {
      this.setDecision(req.host, cap, allow ? 'allow' : 'deny');
    }
    this.current = null;
    req.resolve(allow);
    this.notify();
    this.getOverlay()?.resolvePermissionPopup(requestId);
    this.showNext();
  }

  // ── Settings management (P3-D) ──────────────────────────────────────────────

  /** Snapshot of all stored per-host decisions, sorted by host. */
  getPermissions(): PermissionSiteEntry[] {
    const entries: PermissionSiteEntry[] = [];
    for (const [host, perHost] of this.store) {
      entries.push({
        host,
        camera: perHost.get('camera') ?? null,
        microphone: perHost.get('microphone') ?? null,
        notifications: perHost.get('notifications') ?? null,
      });
    }
    return entries.sort((a, b) => a.host.localeCompare(b.host));
  }

  /** Remove a single capability decision for a host (site can ask again). */
  removePermission(host: string, capability: PermissionCapability): void {
    const perHost = this.store.get(host);
    if (!perHost || !perHost.has(capability)) return;
    perHost.delete(capability);
    if (perHost.size === 0) this.store.delete(host);
    this.notify();
  }

  /** Remove all decisions for a host. */
  removeSitePermissions(host: string): void {
    if (!this.store.delete(host)) return;
    this.notify();
  }

  /** Reset every stored decision. */
  clearAllPermissions(): void {
    if (this.store.size === 0) return;
    this.store.clear();
    this.notify();
  }

  /**
   * Called when the popup is dismissed without a choice (blur / Esc / replaced).
   * Deny this time but do NOT store a decision, so the site can ask again later.
   */
  dismiss(requestId: string): void {
    const req = this.current;
    if (!req || req.id !== requestId) return;
    this.current = null;
    req.resolve(false);
    this.showNext();
  }

  // ── request / check ─────────────────────────────────────────────────────────

  private handleRequest(
    wc: WebContents | null,
    permission: string,
    details: RequestDetails,
    callback: (granted: boolean) => void,
  ): void {
    if (STATIC_ALLOW.has(permission)) {
      callback(true);
      return;
    }

    const caps = this.capsForRequest(permission, details);
    if (caps.length === 0) {
      callback(false);
      return;
    }

    const host = this.hostFrom(
      details.requestingUrl ?? details.securityOrigin ?? (wc ? wc.getURL() : null),
    );
    if (!host) {
      callback(false);
      return;
    }

    const decisions = caps.map((c) => this.getDecision(host, c));
    if (decisions.some((d) => d === 'deny')) {
      callback(false);
      return;
    }
    if (decisions.every((d) => d === 'allow')) {
      callback(true);
      return;
    }

    this.enqueue({ id: randomUUID(), host, capabilities: caps, resolve: callback });
  }

  private handleCheck(permission: string, origin: string, details: CheckDetails): boolean {
    if (STATIC_ALLOW.has(permission)) return true;
    const caps = this.capsForCheck(permission, details);
    if (caps.length === 0) return false;
    const host = this.hostFrom(origin || details.securityOrigin || null);
    if (!host) return false;
    return caps.every((c) => this.getDecision(host, c) === 'allow');
  }

  private capsForRequest(permission: string, details: RequestDetails): PermissionCapability[] {
    if (permission === 'notifications') return ['notifications'];
    if (permission === 'media') {
      const types = details.mediaTypes;
      if (!types || types.length === 0) return ['microphone', 'camera'];
      const caps = new Set<PermissionCapability>();
      if (types.includes('audio')) caps.add('microphone');
      if (types.includes('video')) caps.add('camera');
      return [...caps];
    }
    return [];
  }

  private capsForCheck(permission: string, details: CheckDetails): PermissionCapability[] {
    if (permission === 'notifications') return ['notifications'];
    if (permission === 'media') {
      if (details.mediaType === 'audio') return ['microphone'];
      if (details.mediaType === 'video') return ['camera'];
      return [];
    }
    return [];
  }

  // ── queue / popup ─────────────────────────────────────────────────────────

  private enqueue(req: PendingRequest): void {
    this.queue.push(req);
    if (!this.current) this.showNext();
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      return;
    }
    this.current = next;
    const overlay = this.getOverlay();
    if (!overlay) {
      this.current = null;
      next.resolve(false);
      this.showNext();
      return;
    }
    overlay.openPermissionPrompt(next.id, {
      requestId: next.id,
      host: next.host,
      capabilities: next.capabilities,
    });
  }

  // ── store ─────────────────────────────────────────────────────────────────

  private getDecision(host: string, cap: PermissionCapability): Decision | undefined {
    return this.store.get(host)?.get(cap);
  }

  private setDecision(host: string, cap: PermissionCapability, decision: Decision): void {
    let perHost = this.store.get(host);
    if (!perHost) {
      perHost = new Map();
      this.store.set(host, perHost);
    }
    perHost.set(cap, decision);
  }

  private hostFrom(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      const u = new URL(value);
      return u.hostname.replace(/^www\./, '') || null;
    } catch {
      return null;
    }
  }
}
