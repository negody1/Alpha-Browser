/**
 * PHASE A — navigation timing instrumentation (diagnostics only).
 *
 * ACTIVE ONLY when the env var `ALPHA_DEBUG_TIMINGS=1`. When unset, every export
 * is a no-op and nothing is logged — zero behavior change and zero noise by
 * default. Used to find where the "3–5 s to open Google" time goes.
 *
 * No behavior is altered; this module only reads timestamps and logs.
 */
const ENABLED = process.env.ALPHA_DEBUG_TIMINGS === '1';

/** Per-tab navigation start time (ms, monotonic). */
const navStart = new Map<string, number>();
/** Per-webContents AdBlock aggregate for the current page load. */
const adblockAgg = new Map<number, { count: number; ms: number }>();

export function timingsEnabled(): boolean {
  return ENABLED;
}

/** Mark t0 for a tab's navigation (call when the user submits/enters a URL). */
export function navMark(tabId: string): void {
  if (!ENABLED) return;
  navStart.set(tabId, performance.now());
}

/** Log a labelled checkpoint with the delta since {@link navMark}. */
export function navLog(tabId: string, label: string, extra?: Record<string, unknown>): void {
  if (!ENABLED) return;
  const t0 = navStart.get(tabId);
  const dt = t0 != null ? (performance.now() - t0).toFixed(0) : '?';
  const tail = extra ? ' ' + JSON.stringify(extra) : '';
  // eslint-disable-next-line no-console
  console.log(`[alpha][timing] +${dt}ms\t${label}\ttab=${tabId.slice(0, 8)}${tail}`);
}

/** Time a synchronous function and return its result (caller adds the ms). */
export function timeSync<T>(fn: () => T): { result: T; ms: number } {
  if (!ENABLED) return { result: fn(), ms: 0 };
  const s = performance.now();
  const result = fn();
  return { result, ms: performance.now() - s };
}

// ── AdBlock per-page aggregation (keyed by webContents id) ──
export function adblockAdd(wcId: number, ms: number): void {
  if (!ENABLED) return;
  const e = adblockAgg.get(wcId) ?? { count: 0, ms: 0 };
  e.count += 1;
  e.ms += ms;
  adblockAgg.set(wcId, e);
}

export function adblockResetForWc(wcId: number): void {
  if (!ENABLED) return;
  adblockAgg.delete(wcId);
}

/** Returns and clears the AdBlock aggregate for a page load. */
export function adblockTakeForWc(wcId: number): { count: number; ms: number } | null {
  if (!ENABLED) return null;
  const e = adblockAgg.get(wcId) ?? null;
  adblockAgg.delete(wcId);
  return e ? { count: e.count, ms: Math.round(e.ms) } : null;
}
