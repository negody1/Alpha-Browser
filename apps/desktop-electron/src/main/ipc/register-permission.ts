import { ipcMain } from 'electron';
import type { PermissionCapability, PermissionSiteEntry } from '@alpha/shared-types';
import type { PermissionService } from '../permissions/PermissionService';

const MANAGED = new Set<PermissionCapability>(['camera', 'microphone', 'notifications']);

export function registerPermissionIpc(getService: () => PermissionService | null): void {
  ipcMain.handle('permission:resolve', (_event, payload: unknown) => {
    const data = payload as { requestId?: unknown; allow?: unknown } | null;
    if (!data || typeof data.requestId !== 'string' || typeof data.allow !== 'boolean') return;
    getService()?.resolve(data.requestId, data.allow);
  });

  // P3-D Permission Settings: list/revoke stored decisions.
  ipcMain.handle('permission:list', (): PermissionSiteEntry[] => {
    return getService()?.getPermissions() ?? [];
  });

  ipcMain.handle('permission:remove', (_event, payload: unknown): PermissionSiteEntry[] => {
    const data = payload as { host?: unknown; capability?: unknown } | null;
    const service = getService();
    if (
      service &&
      data &&
      typeof data.host === 'string' &&
      typeof data.capability === 'string' &&
      MANAGED.has(data.capability as PermissionCapability)
    ) {
      service.removePermission(data.host, data.capability as PermissionCapability);
    }
    return service?.getPermissions() ?? [];
  });

  ipcMain.handle('permission:removeSite', (_event, payload: unknown): PermissionSiteEntry[] => {
    const data = payload as { host?: unknown } | null;
    const service = getService();
    if (service && data && typeof data.host === 'string') {
      service.removeSitePermissions(data.host);
    }
    return service?.getPermissions() ?? [];
  });

  ipcMain.handle('permission:clearAll', (): PermissionSiteEntry[] => {
    const service = getService();
    service?.clearAllPermissions();
    return service?.getPermissions() ?? [];
  });
}
