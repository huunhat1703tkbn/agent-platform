import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    css: false,
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Full component tests (React Query + TanStack Router + MSW) take longer on cold CI
    // runners than vitest's 5s default. 20s gives loaded runners headroom without masking
    // genuine hangs.
    testTimeout: 20_000,
  },
});
