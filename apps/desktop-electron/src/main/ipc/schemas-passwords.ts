import { z } from 'zod';

export const passwordSavePayload = z.object({
  origin: z.string().min(1).max(2048),
  username: z.string().min(1).max(512),
  password: z.string().min(1).max(2048),
  tabId: z.string().min(1),
});

export const passwordIdPayload = z.object({
  id: z.string().uuid(),
});

export const passwordOriginPayload = z.object({
  origin: z.string().min(1).max(2048),
});

export const passwordNeverSavePayload = z.object({
  origin: z.string().min(1).max(2048),
  never: z.boolean(),
});

export const passwordPromptActionPayload = z.object({
  id: z.string().uuid(),
  action: z.enum(['save', 'dismiss', 'never']),
});

export const passwordUpdatePayload = z
  .object({
    id: z.string().uuid(),
    username: z.string().max(512).optional(),
    password: z.string().min(1).max(2048).optional(),
  })
  .refine((v) => v.username != null || v.password != null, {
    message: 'username or password required',
  });

