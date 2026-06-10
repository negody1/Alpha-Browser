import { ipcMain } from 'electron';
import type { ProxyDiagnosticsSnapshot } from '@alpha/shared-types';
import type { ProxyClientService } from '../proxy/ProxyClientService';

/**
 * PHASE 4 proxy diagnostics IPC. Read-only, sanitized (no uuid/keys). Exposes
 * the cached snapshot and a manual end-to-end egress re-check.
 */
export function registerProxyIpc(getService: () => ProxyClientService | null): void {
  function snapshot(svc: ProxyClientService): ProxyDiagnosticsSnapshot {
    const d = svc.getDiagnostics();
    const s = svc.getState();
    return {
      status: d.status,
      runtimeMode: d.runtimeMode,
      errorReason: s.errorReason,
      socksPort: d.socksPort,
      remoteServer: d.remoteServer,
      remotePort: d.remotePort,
      egress: d.egress,
    };
  }

  ipcMain.handle('proxy:diagnostics', (): ProxyDiagnosticsSnapshot | null => {
    const svc = getService();
    return svc ? snapshot(svc) : null;
  });

  ipcMain.handle('proxy:checkEgress', async (): Promise<ProxyDiagnosticsSnapshot | null> => {
    const svc = getService();
    if (!svc) return null;
    await svc.checkEgress(true);
    return snapshot(svc);
  });

  // Manual recovery: restart the local transport then re-probe egress. Used by
  // the onboarding error state ("Проверить снова") since a re-check with an
  // unchanged profile won't restart the proxy on its own.
  ipcMain.handle('proxy:retry', async (): Promise<ProxyDiagnosticsSnapshot | null> => {
    const svc = getService();
    if (!svc) return null;
    await svc.restart();
    await svc.checkEgress(true);
    return snapshot(svc);
  });
}
