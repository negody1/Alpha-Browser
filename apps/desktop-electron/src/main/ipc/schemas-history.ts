import { z } from 'zod';

export const historyIdPayload = z.object({
  id: z.string().uuid(),
});

