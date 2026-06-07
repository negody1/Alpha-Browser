import { z } from 'zod';
import { OMNIBOX_MAX_LIMIT } from '../omnibox/OmniboxService';

export const omniboxQueryPayload = z.object({
  input: z.string().max(2048),
  limit: z.number().int().positive().max(OMNIBOX_MAX_LIMIT).optional(),
});
