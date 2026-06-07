import { z } from 'zod';

export const shortcutUpsertPayload = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(64),
  url: z.string().min(1).max(2048),
  iconUrl: z.string().min(1).max(2048).nullable().optional(),
});

export const shortcutRemovePayload = z.object({
  id: z.string().uuid(),
});

export const shortcutReorderPayload = z.object({
  ids: z.array(z.string().uuid()).min(1).max(32),
});

