import { useEffect, useRef, useState } from 'react';
import type { OmniboxSuggestion } from '@alpha/shared-types';

const DEBOUNCE_MS = 120;
const LIMIT = 8;

/**
 * Debounced bridge to the main-process omnibox engine (P2-C.1). Returns ranked
 * suggestions for the current input. Local-only sources; no network. Shared by
 * the Toolbar (P2-C.2) and, later, the NTP search (P2-C.3).
 */
export function useOmnibox(input: string, enabled: boolean): OmniboxSuggestion[] {
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    const trimmed = input.trim();
    if (!enabled || !trimmed) {
      setSuggestions([]);
      return;
    }
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      void window.alpha.omnibox.query(trimmed, LIMIT).then((res) => {
        // Ignore out-of-order responses.
        if (id === reqId.current) setSuggestions(res);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, enabled]);

  return suggestions;
}
