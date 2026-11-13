import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 25000,
    hookTimeout: 60000,
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'wallet-sequential',
          testTimeout: 25000,
          hookTimeout: 60000,
          include: ['apps/api/tests/wallet*.test.js', 'apps/worker/tests/*.test.js'],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'parallel-suites',
          testTimeout: 25000,
          hookTimeout: 60000,
          include: [
            'packages/**/*.test.js',
            'apps/web/**/*.test.js',
            'apps/portal/**/*.test.js',
            'apps/api/tests/!(wallet*).test.js',
          ],
          fileParallelism: false,
        },
      },
    ],
  },
});
