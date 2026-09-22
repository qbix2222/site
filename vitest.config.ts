import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/core/**/*.ts',
        'src/catalog/**/*.ts',
        'src/engine/**/*.ts',
        'src/workspace/**/*.ts',
        'server/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
    },
  },
});
