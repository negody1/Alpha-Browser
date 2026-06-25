/**
 * In-memory navigation debug ring buffer. Every tab navigation records here with
 * its source component, handler, raw input, final (post-guard) target and the
 * renderer call stack — so the EXACT handler that produces a bad target (e.g.
 * google.com/webhp) is captured without a terminal. Surfaced to the in-app debug
 * overlay via IPC and copyable by the user.
 */
export interface NavDebugEntry {
  ts: number;
  source: string;
  suggestionKind: string;
  handler: string;
  rawInput: string;
  finalTarget: string;
  guard: string; // 'none' | 'rewrote' | 'blocked'
  isQuerylessGoogle: boolean;
  stack: string;
}

const BUFFER: NavDebugEntry[] = [];
const MAX = 100;

export function recordNav(entry: NavDebugEntry): void {
  BUFFER.push(entry);
  if (BUFFER.length > MAX) BUFFER.splice(0, BUFFER.length - MAX);
  // Always echo to the main console too (visible with a terminal / DevTools).
  const tag = entry.isQuerylessGoogle ? '[alpha][omnibox-dbg][!!! QUERYLESS-GOOGLE]' : '[alpha][omnibox-dbg]';
  // eslint-disable-next-line no-console
  console.log(tag, {
    source: entry.source,
    handler: entry.handler,
    kind: entry.suggestionKind,
    input: entry.rawInput,
    finalTarget: entry.finalTarget,
    guard: entry.guard,
  });
}

export function getNavLog(): NavDebugEntry[] {
  return [...BUFFER].reverse(); // newest first
}

export function clearNavLog(): void {
  BUFFER.length = 0;
}
