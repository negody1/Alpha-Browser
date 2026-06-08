import { ipcMain } from 'electron';
import type { ActivationState } from '@alpha/shared-types';
import type { ActivationService } from '../activation/ActivationService';

/**
 * Alpha Proxy onboarding IPC (email registration + activation code). Never
 * returns or logs the proxy profile — only user-facing state.
 */
export function registerActivationIpc(getService: () => ActivationService | null): void {
  ipcMain.handle('activation:getState', (): ActivationState | null => getService()?.getState() ?? null);

  ipcMain.handle('activation:register', async (_e, payload: unknown): Promise<ActivationState | null> => {
    const email = (payload as { email?: unknown } | null)?.email;
    if (typeof email !== 'string') return getService()?.getState() ?? null;
    return (await getService()?.register(email)) ?? null;
  });

  ipcMain.handle('activation:activate', async (_e, payload: unknown): Promise<ActivationState | null> => {
    const data = payload as { email?: unknown; code?: unknown } | null;
    const email = typeof data?.email === 'string' ? data.email : '';
    const code = typeof data?.code === 'string' ? data.code : '';
    return (await getService()?.activate(email, code)) ?? null;
  });

  ipcMain.handle('activation:checkStatus', async (): Promise<ActivationState | null> => {
    return (await getService()?.checkStatus()) ?? null;
  });
}
