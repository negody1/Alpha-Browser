import { randomUUID } from 'node:crypto';
import { desktopCapturer, type DesktopCapturerSource, type Session, type Streams } from 'electron';
import type { ScreenShareSource } from '@alpha/shared-types';
import type { OverlayWindowManager } from '../shell/OverlayWindowManager';

interface PendingShare {
  callback: (streams: Streams) => void;
  sources: DesktopCapturerSource[];
  audioRequested: boolean;
}

const THUMBNAIL_SIZE = { width: 320, height: 180 };

/**
 * Screen Sharing MVP (P3-C).
 *
 * Owns each session's display-media request handler. When a site calls
 * navigator.mediaDevices.getDisplayMedia(), Electron invokes this handler (it is
 * the sole authority for getDisplayMedia — it does NOT pass through the permission
 * request handler, so the Permission Service is untouched). We enumerate desktop
 * sources, show the picker overlay, and only share after an explicit user choice.
 * Cancelling (or any error) rejects the request via an empty `callback({})`.
 */
export class ScreenShareService {
  private readonly pending = new Map<string, PendingShare>();

  constructor(private readonly getOverlay: () => OverlayWindowManager | null) {}

  /** Install the display-media request handler on a session. */
  attach(session: Session): void {
    session.setDisplayMediaRequestHandler((request, callback) => {
      void this.handleRequest(request, callback);
    });
  }

  private async handleRequest(
    request: { frame: { url: string } | null; audioRequested: boolean },
    callback: (streams: Streams) => void,
  ): Promise<void> {
    const overlay = this.getOverlay();
    if (!overlay) {
      callback({});
      return;
    }

    let sources: DesktopCapturerSource[];
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: THUMBNAIL_SIZE,
        fetchWindowIcons: true,
      });
    } catch (e) {
      console.warn('[alpha][screenshare] getSources failed', { err: String(e) });
      callback({});
      return;
    }

    if (sources.length === 0) {
      callback({});
      return;
    }

    // Only one picker at a time: cancel any previously pending request.
    for (const id of [...this.pending.keys()]) {
      this.cancel(id);
    }

    const requestId = randomUUID();
    this.pending.set(requestId, {
      callback,
      sources,
      audioRequested: !!request.audioRequested,
    });

    overlay.openScreenSharePrompt(requestId, {
      requestId,
      host: this.hostFrom(request.frame?.url ?? null),
      sources: sources.map((s) => this.toShareSource(s)),
    });
  }

  /** User picked a source and pressed "Share". */
  resolve(requestId: string, sourceId: string): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);

    const source = p.sources.find((s) => s.id === sourceId);
    if (!source) {
      p.callback({});
    } else {
      const streams: Streams = { video: source };
      // System audio loopback is currently Windows-only in Electron.
      if (p.audioRequested && process.platform === 'win32') {
        streams.audio = 'loopback';
      }
      p.callback(streams);
    }
    this.getOverlay()?.resolveScreenSharePopup(requestId);
  }

  /** User pressed "Cancel" (explicit). */
  cancel(requestId: string): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    p.callback({});
    this.getOverlay()?.resolveScreenSharePopup(requestId);
  }

  /** Popup dismissed without a choice (blur / Esc / window closed). */
  dismiss(requestId: string): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    p.callback({});
  }

  private toShareSource(s: DesktopCapturerSource): ScreenShareSource {
    return {
      id: s.id,
      name: s.name || (s.id.startsWith('screen:') ? 'Экран' : 'Окно'),
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail?.isEmpty() ? '' : (s.thumbnail?.toDataURL() ?? ''),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    };
  }

  private hostFrom(value: string | null): string | null {
    if (!value) return null;
    try {
      return new URL(value).hostname.replace(/^www\./, '') || null;
    } catch {
      return null;
    }
  }
}
