import { z } from 'zod';

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const savedGroupIdPayload = z.object({
  id: z.string().uuid(),
});

export const savedGroupCreatePayload = z.object({
  title: z.string().min(1).max(120),
  color: colorSchema,
  urls: z.array(z.string().max(2048)).optional(),
});

export const savedGroupUpdatePayload = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  color: colorSchema.optional(),
  urls: z.array(z.string().max(2048)).optional(),
});

export const savedGroupUrlPayload = z.object({
  id: z.string().uuid(),
  url: z.string().max(2048),
});

export const sessionGroupIdPayload = z.object({
  groupId: z.string().uuid(),
});

export const sessionGroupCreatePayload = z.object({
  title: z.string().min(1).max(120),
  color: colorSchema,
  tabIds: z.array(z.string().uuid()).optional(),
});

export const sessionGroupRenamePayload = z.object({
  groupId: z.string().uuid(),
  title: z.string().min(1).max(120),
});

export const sessionGroupColorPayload = z.object({
  groupId: z.string().uuid(),
  color: colorSchema,
});

export const sessionGroupTabPayload = z.object({
  groupId: z.string().uuid(),
  tabId: z.string().uuid(),
});

export const sessionGroupTabOnlyPayload = z.object({
  tabId: z.string().uuid(),
});

export const sessionGroupReorderTabsPayload = z.object({
  groupId: z.string().uuid(),
  tabIds: z.array(z.string().uuid()).min(1).max(256),
});
