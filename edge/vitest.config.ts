import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'agents': path.resolve(__dirname, './test/agents-mock.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.ts'],
  },
});
