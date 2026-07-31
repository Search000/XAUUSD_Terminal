import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry up to 3 times with exponential backoff.
      // This handles ERR_HTTP2_SERVER_REFUSED_STREAM on Render cold-start:
      // multiple simultaneous requests can overwhelm the HTTP/2 connection
      // during wake-up; retrying after a short delay succeeds once the server
      // is fully up.
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      refetchOnWindowFocus: false,
    },
  },
});
