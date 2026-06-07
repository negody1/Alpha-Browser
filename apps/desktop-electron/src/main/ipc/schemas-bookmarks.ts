import { z } from 'zod';

export const bookmarkIdPayload = z.object({
  id: z.string().uuid(),
});

export const bookmarkUpsertPayload = z.object({
  url: z.string().min(1).max(2048),
  title: z.string().min(0).max(512),
  favicon: z.string().max(2048).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const bookmarkUpdatePayload = z.object({
  id: z.string().uuid(),
  title: z.string().min(0).max(512).optional(),
  url: z.string().min(1).max(2048).optional(),
  favicon: z.string().max(2048).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const folderCreatePayload = z.object({
  title: z.string().min(1).max(128),
  parentId: z.string().uuid().nullable().optional(),
});

export const folderUpdatePayload = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(128).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export const folderIdPayload = z.object({
  id: z.string().uuid(),
});

