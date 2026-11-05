import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/api/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
