import { z } from 'zod';

export const adblockEnabledPayload = z.object({
  enabled: z.boolean(),
});

export const adblockDomainPayload = z.object({
  domain: z.string().min(1).max(253),
  disabled: z.boolean(),
});

