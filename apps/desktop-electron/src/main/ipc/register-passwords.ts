import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { PasswordService } from '../passwords/PasswordService';
import {
  passwordIdPayload,
  passwordNeverSavePayload,
  passwordOriginPayload,
  passwordPromptActionPayload,
  passwordUpdatePayload,
} from './schemas-passwords';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerPasswordsIpc(
  getService: () => PasswordService | null,
  broadcastState: () => void,
): void {
  ipcMain.handle('passwords:isAvailable', async () => (await getService()?.isAvailable()) ?? false);
  ipcMain.handle('passwords:listMetadata', () => getService()?.exportMetadataOnly() ?? []);

  ipcMain.handle('passwords:getForOrigin', async (_e, payload: unknown) => {
    const data = parsePayload(passwordOriginPayload, payload);
    const svc = getService();
    if (!data || !svc) return [];
    return await svc.getCredentialsForOrigin(data.origin);
  });

  ipcMain.handle('passwords:reveal', async (_e, payload: unknown) => {
    const data = parsePayload(passwordIdPayload, payload);
    const svc = getService();
    if (!data || !svc) return null;
    return await svc.revealPassword(data.id);
  });

  ipcMain.handle('passwords:update', async (_e, payload: unknown) => {
    const data = parsePayload(passwordUpdatePayload, payload);
    const svc = getService();
    if (!data || !svc) return false;
    await svc.updateCredential(data.id, {
      ...(data.username != null ? { username: data.username } : {}),
      ...(data.password != null ? { password: data.password } : {}),
    });
    broadcastState();
    return true;
  });

  ipcMain.handle('passwords:delete', async (_e, payload: unknown) => {
    const data = parsePayload(passwordIdPayload, payload);
    const svc = getService();
    if (!data || !svc) return false;
    await svc.deleteCredential(data.id);
    broadcastState();
    return true;
  });

  ipcMain.handle('passwords:setNeverSave', (_e, payload: unknown) => {
    const data = parsePayload(passwordNeverSavePayload, payload);
    const svc = getService();
    if (!data || !svc) return false;
    svc.setNeverSave(data.origin, data.never);
    broadcastState();
    return true;
  });

  ipcMain.handle('passwords:promptAction', async (_e, payload: unknown) => {
    const data = parsePayload(passwordPromptActionPayload, payload);
    const svc = getService();
    if (!data || !svc) return false;
    const prompt = svc.getStateSnapshot(true).pendingPrompt;
    if (!prompt || prompt.id !== data.id) return false;

    if (data.action === 'dismiss') {
      svc.dismissPrompt();
      broadcastState();
      return true;
    }
    if (data.action === 'never') {
      svc.setNeverSave(prompt.origin, true);
      svc.dismissPrompt();
      broadcastState();
      return true;
    }

    // save: confirm pending secret stored in main memory only.
    // Await the real result so a storage failure is reported, not swallowed.
    const ok = await svc.confirmPendingSave();
    broadcastState();
    return ok;
  });
}

