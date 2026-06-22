import { ipcMain } from 'electron';
import type { z } from 'zod';
import type { OmniboxSuggestion } from '@alpha/shared-types';
import type { OmniboxService } from '../omnibox/OmniboxService';
import { omniboxQueryPayload } from './schemas-omnibox';

function parsePayload<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null {
  const result = schema.safeParse(value ?? {});
  return result.success ? result.data : null;
}

export function registerOmniboxIpc(getService: () => OmniboxService | null): void {
  ipcMain.handle('omnibox:query', (_e, payload: unknown): OmniboxSuggestion[] => {
    const data = parsePayload(omniboxQueryPayload, payload);
    const service = getService();
    if (!data || !service) return [];
    const results = service.query(data.input, data.limit);
    if (process.env.ALPHA_DEBUG_OMNIBOX === '1') {
      // P0 diagnostics: the exact rendered list (index / kind / title / url).
      console.log(
        `[alpha][omnibox-dbg] query "${data.input}" ->`,
        results.map((s, i) => `#${i} ${s.kind} | ${s.title} | ${s.url}`),
      );
    }
    return results;
  });
}
