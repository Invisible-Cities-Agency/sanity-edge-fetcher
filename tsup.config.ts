import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    config: 'config.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  minify: true,
  splitting: false,
  sourcemap: true,
  target: 'es2020',
  external: [
    'next',
    'next/cache',
    '@upstash/redis',
    'p-retry'
  ],
  esbuildOptions(options) {
    options.platform = 'neutral';
  },
});