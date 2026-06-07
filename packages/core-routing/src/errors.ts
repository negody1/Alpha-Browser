/** Chromium network error codes that trigger AUTO → PROXY fallback (once). */
const RETRYABLE_ERROR_CODES = new Set([
  -101, // ERR_CONNECTION_RESET
  -102, // ERR_CONNECTION_REFUSED
  -105, // ERR_NAME_NOT_RESOLVED
  -111, // ERR_TUNNEL_CONNECTION_FAILED
  -118, // ERR_CONNECTION_TIMED_OUT
  -130, // ERR_PROXY_CONNECTION_FAILED
]);

export function isRetryableNetworkError(errorCode: number): boolean {
  return RETRYABLE_ERROR_CODES.has(errorCode);
}
