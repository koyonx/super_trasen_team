import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Nest relies on `emitDecoratorMetadata` for dependency injection, which
 * esbuild (Vite's default transformer) does not emit. SWC does, so specs are
 * transformed with it.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
