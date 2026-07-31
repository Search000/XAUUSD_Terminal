/**
 * Base URL for all direct /api/ fetch calls in xauusd components.
 * On Render, the static journal and the API server are on different domains,
 * so we must prefix every manual fetch with this value.
 * The @workspace/api-client-react hooks use setBaseUrl() in main.tsx instead.
 */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  'https://xauusd-terminal-api-uq6u.onrender.com';
