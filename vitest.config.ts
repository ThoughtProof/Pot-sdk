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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  globals: vitestGlobals,
});
