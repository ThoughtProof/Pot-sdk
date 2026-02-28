import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
  optimizeDeps: {
    exclude: ['node:sqlite', 'node:fs', 'node:path'],
  },
  ssr: {
    external: ['node:sqlite'],
  },
  resolve: {
    alias: {
      // Ensure node: protocol modules stay as-is
      'node:sqlite': 'node:sqlite',
    },
  },
});
