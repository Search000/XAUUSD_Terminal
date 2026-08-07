import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy, page-specific vendor libs into their own chunks.
        // Combined with the route-level React.lazy() splitting in App.tsx,
        // this means e.g. the PDF-export library only downloads when a
        // page that uses it is opened, instead of shipping on every load.
        manualChunks(id) {
          // Vite's internal dynamic-import helpers (used by every React.lazy()
          // call, virtual modules — not under node_modules) aren't matched by
          // any branch below, so Rollup's default algorithm decides where to
          // put them. It was co-locating them inside the 'vendor-pdf' chunk,
          // which forced that 338KB jsPDF bundle to be eagerly
          // modulepreloaded on EVERY page (landing, sign-in, etc.) since the
          // entry chunk needs the helper to run any lazy() import at all —
          // completely defeating the point of splitting jsPDF out to begin
          // with. Pin them to 'vendor' (already always eagerly loaded) so no
          // route-specific vendor chunk is forced to load early.
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) {
            return 'vendor';
          }
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('jspdf')) return 'vendor-pdf';
          if (id.includes('@clerk')) return 'vendor-clerk';
          if (id.includes('framer-motion')) return 'vendor-motion';
          // NOTE: react/react-dom/scheduler must NOT be split into their own
          // chunk. Dozens of other deps (@radix-ui/*, @tanstack/react-query,
          // react-hook-form, etc.) call React.createContext() at module
          // init time, and they land in the generic 'vendor' chunk. If React
          // itself is isolated in a separate 'vendor-react' chunk, load
          // order between the two chunks is not guaranteed, so 'vendor' can
          // execute before 'vendor-react' and crash with
          // "Cannot read properties of undefined (reading 'createContext')".
          // Keeping React in the same chunk as its consumers avoids this.
          return 'vendor';
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
