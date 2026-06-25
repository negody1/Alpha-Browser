import { z } from 'zod';

export const tabIdPayload = z.object({
  tabId: z.string().uuid(),
});

export const optionalTabIdPayload = z.object({
  tabId: z.string().uuid().optional(),
});

export const createTabPayload = z.object({
  url: z.string().max(2048).optional(),
});

export const navigateTabPayload = z.object({
  tabId: z.string().uuid(),
  input: z.string().max(2048),
  // Optional omnibox provenance — used for the debug overlay + logging.
  source: z.enum(['toolbar', 'home', 'ntp']).optional(),
  suggestionKind: z.string().max(32).optional(),
  handler: z.string().max(64).optional(),
  debugStack: z.string().max(8192).optional(),
});

export const resolveUrlPayload = z.object({
  input: z.string().max(2048),
});

export const tabOrderPayload = z.object({
  tabIds: z.array(z.string().uuid()).min(1).max(256),
});

export const tabDuplicatePayload = z.object({
  tabId: z.string().uuid(),
  preserveGroup: z.boolean().optional().default(true),
});

export const tabSetRoutePayload = z.object({
  tabId: z.string().uuid().optional(),
  routeClass: z.enum(['AUTO', 'DIRECT', 'PROXY']),
});

export const tabSetMutedPayload = z.object({
  tabId: z.string().uuid().optional(),
  muted: z.boolean(),
});
