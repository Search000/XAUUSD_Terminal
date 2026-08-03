/**
 * Single source of truth for the API server's base URL.
 *
 * The trading journal (static site) and the API server are deployed as
 * separate Render services with independent hostnames (see render.yaml).
 * VITE_API_URL must be injected at build time so this deployment points at
 * the correct API host.
 *
 * We intentionally do NOT fall back to a hardcoded production URL here:
 * a stale/incorrect hardcoded fallback silently sends requests to the wrong
 * host (config drift) instead of failing loudly. A fallback is kept only
 * for local development, where the API server normally runs on localhost.
 */
const DEV_FALLBACK = "http://localhost:10000";

const envUrl = import.meta.env.VITE_API_URL as string | undefined;

if (import.meta.env.PROD && !envUrl) {
  throw new Error(
    "VITE_API_URL is not set. It is required in production builds — " +
      "set it in the Render dashboard for the xauusd-terminal-journal " +
      "service to point at the deployed API server's URL."
  );
}

export const API_BASE_URL = envUrl || DEV_FALLBACK;

/** Convert an http(s) API base URL into its ws(s) equivalent. */
export function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}
