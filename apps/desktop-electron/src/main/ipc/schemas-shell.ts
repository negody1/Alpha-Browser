import { z } from 'zod';

export const chromeTopHeightPayload = z.object({
  heightPx: z.number().min(80).max(480),
});

export const contextMenuPointPayload = z.object({
  x: z.number().min(0).max(10000),
  y: z.number().min(0).max(10000),
});

export const tabContextMenuPayload = contextMenuPointPayload.extend({
  tabId: z.string().uuid(),
});

export const groupContextMenuPayload = contextMenuPointPayload.extend({
  groupId: z.string().uuid(),
});

export const routeMenuPayload = contextMenuPointPayload;
