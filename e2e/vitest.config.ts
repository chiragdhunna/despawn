import { defineConfig } from 'vitest/config';

// Real-browser tests. Build the apps first: `pnpm build`. Needs Chromium:
//   npx playwright-core install chromium      (or set CHROMIUM_PATH to an existing binary)
export default defineConfig({
  test: {
    include: ['*.e2e.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
