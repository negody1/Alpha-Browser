import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { AdblockService } from '../adblock/AdblockService';
import { normalizeDomain } from '@alpha/core-routing';
import { adblockDomainPayload, adblockEnabledPayload } from './schemas-adblock';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerAdblockIpc(getService: () => AdblockService | null): void {
  ipcMain.handle('adblock:getState', () => getService()?.getState() ?? null);

  ipcMain.handle('adblock:setEnabled', (_e, payload: unknown) => {
    const data = parsePayload(adblockEnabledPayload, payload);
    const svc = getService();
    if (!data || !svc) return false;
    svc.setEnabled(data.enabled);
    return true;
  });

  ipcMain.handle('adblock:setSiteDisabled', (_e, payload: unknown) => {
    const data = parsePayload(adblockDomainPayload, payload);
    const svc = getService();
    if (!data || !svc) return false;
    svc.toggleSite(normalizeDomain(data.domain), data.disabled);
    return true;
  });
}

