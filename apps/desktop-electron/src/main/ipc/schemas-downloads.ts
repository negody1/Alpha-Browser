import { z } from 'zod';

export const downloadIdPayload = z.object({
  id: z.string().uuid(),
});

