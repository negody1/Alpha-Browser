import { ipcMain } from 'electron';
import { z } from 'zod';
import type { TabManager } from '../tabs/TabManager';
import type { PasswordService } from '../passwords/PasswordService';

const loginSubmittedPayload = z.object({
  origin: z.string().min(1).max(2048),
  username: z.string().max(512).optional().default(''),
  password: z.string().min(1).max(2048),
  formSig: z.string().min(1).max(128),
  ts: z.number().int().nonnegative(),
});

const originOnlyPayload = z.object({
  origin: z.string().min(1).max(2048),
});

const fillForUsernamePayload = z.object({
  origin: z.string().min(1).max(2048),
  username: z.string().min(1).max(512),
});

function senderOrigin(frameUrl: string | undefined | null): string | null {
  try {
    if (!frameUrl) return null;
    const u = new URL(frameUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Only the top-level frame may save or autofill credentials. This blocks
 * cross-origin (and same-origin) iframes from harvesting or triggering fills,
 * the standard clickjacking/credential-leak guard.
 */
function isTopFrame(event: { senderFrame?: { parent: unknown } | null }): boolean {
  const frame = event.senderFrame;
  return !!frame && frame.parent === null;
}

export function registerPasswordsGuestIpc(
  getTabs: () => TabManager | null,
  getPasswords: () => PasswordService | null,
  broadcastState: () => void,
): void {
  ipcMain.on('guest:loginSubmitted', (event, raw) => {
    const parsed = loginSubmittedPayload.safeParse(raw ?? {});
    const tabs = getTabs();
    const svc = getPasswords();
    if (!parsed.success || !tabs || !svc) return;
    if (!isTopFrame(event)) return;
    const origin = senderOrigin(event.senderFrame?.url);
    const payloadOrigin = senderOrigin(parsed.data.origin);
    if (!origin || !payloadOrigin || origin !== payloadOrigin) return;
    const tab = tabs.findTabByWebContentsId(event.sender.id);
    if (!tab) return;
    svc.onLoginSubmitted(tab.id, parsed.data);
  });

  ipcMain.on('guest:fieldFocus', () => {
    // For MVP we don't need to react in main; suggestions are handled via invoke endpoints below.
  });

  ipcMain.handle('guest:getUsernamesForOrigin', async (event, raw) => {
    const parsed = originOnlyPayload.safeParse(raw ?? {});
    const svc = getPasswords();
    if (!parsed.success || !svc) return null;
    if (!isTopFrame(event)) return null;
    const origin = senderOrigin(event.senderFrame?.url);
    const payloadOrigin = senderOrigin(parsed.data.origin);
    if (!origin || !payloadOrigin || origin !== payloadOrigin) return null;
    // Ordered most-recently-used first.
    return svc
      .listMetadataForOrigin(origin)
      .map((e) => e.username)
      .filter((u) => !!u);
  });

  ipcMain.handle('guest:fillForUsername', async (event, raw) => {
    const parsed = fillForUsernamePayload.safeParse(raw ?? {});
    const svc = getPasswords();
    if (!parsed.success || !svc) return null;
    if (!isTopFrame(event)) return null;
    const origin = senderOrigin(event.senderFrame?.url);
    const payloadOrigin = senderOrigin(parsed.data.origin);
    if (!origin || !payloadOrigin || origin !== payloadOrigin) return null;
    const creds = await svc.getCredentialsForOrigin(origin);
    const selected = creds.find((c) => c.username === parsed.data.username);
    if (!selected) return null;
    svc.markCredentialUsed(selected.id);
    // password goes only to guest preload
    return { username: selected.username, password: selected.password };
  });
}

