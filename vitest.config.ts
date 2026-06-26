import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@workers': path.resolve(__dirname, 'workers'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist', 'tests/_fixtures/**', 'tests/_mocks/**'],
    setupFiles: ['tests/setup.ts'],
  },
});
