import { defineConfig } from 'vitest/config';

import { readFileSync } from 'fs';

const { dependencies, peerDependencies, devDependencies } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

const vitestGlobals = Object.keys({ ...dependencies, ...peerDependencies, ...devDependencies }).filter((dep) =>
  dep.startsWith('@vitest/') || dep === 'vitest'
);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // friend uses node:test + node:sqlite; run separately via:
      // node --experimental-sqlite --import tsx/esm packages/friend/tests/friend.test.ts
      'packages/friend/tests/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  globals: vitestGlobals,
});
