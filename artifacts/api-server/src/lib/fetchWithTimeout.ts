/**
 * Shared timeout wrapper for external (third-party) HTTP requests.
 *
 * Plain `fetch()` has no timeout by default — a stalled upstream (Yahoo,
 * CFTC, FRED, Telegram, ...) would otherwise hang the request until the
 * hosting platform's own timeout kills it, tying up the event loop and
 * the client connection the whole time. This wraps `fetch` with an
 * AbortController so we fail fast and predictably instead.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
