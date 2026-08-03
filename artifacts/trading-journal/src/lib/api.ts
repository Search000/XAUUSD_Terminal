/**
 * Base URL for all direct /api/ fetch calls in xauusd components.
 * On Render, the static journal and the API server are on different domains,
 * so we must prefix every manual fetch with this value.
 * The @workspace/api-client-react hooks use setBaseUrl() in main.tsx instead.
 *
 * Sourced from the single shared config in ./apiConfig — do not hardcode a
 * fallback URL here (see apiConfig.ts for why).
 */
export { API_BASE_URL as API_BASE } from './apiConfig';
