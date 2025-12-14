import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.reference-repos/**',
      '**/playgrounds/**',
      '**/.local-fs-data/**',
      '**/.config-local/**',
    ],
  },
});

