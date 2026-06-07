import { z } from 'zod';

const routeModeSchema = z.enum(['AUTO', 'DIRECT', 'PROXY']);

export const domainPayload = z.object({
  domain: z.string().min(1).max(253),
});

export const setDefaultRoutePayload = z.object({
  route: routeModeSchema,
});

export const setProxyEndpointPayload = z.object({
  endpoint: z.string().min(3).max(256),
});

export const addRulePayload = z.object({
  domain: z.string().min(1).max(253),
  route: routeModeSchema,
});

export const updateRulePayload = z.object({
  domain: z.string().min(1).max(253),
  route: routeModeSchema,
});

export const setTemporaryOverridePayload = z.object({
  domain: z.string().min(1).max(253),
  mode: routeModeSchema,
});

export const saveRouteRulePayload = z.object({
  domain: z.string().min(1).max(253),
  route: routeModeSchema,
});

export const reloadTabPayload = z.object({
  tabId: z.string().uuid(),
});
