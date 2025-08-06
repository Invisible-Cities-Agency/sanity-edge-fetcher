import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts,mjs,mts}'],
    isolate: true,
    clearMocks: true,
    restoreMocks: true,
    css: false
  },
  resolve: {
    conditions: ['node', 'import', 'module', 'default']
  },
  css: {
    modules: {
      localsConvention: 'camelCase'
    },
    postcss: {}
  }
});