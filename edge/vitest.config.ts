import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'agents': new URL('./test/agents-mock.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.ts'],
  },
});
