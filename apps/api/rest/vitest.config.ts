import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Batería unitaria de la API (US-88). Sigue la receta de Vitest de la
 * documentación de Nest (recipes/swc):
 *
 * - `unplugin-swc` transpila los specs y el código que importan. esbuild, el
 *   transformador por defecto de Vitest, no emite `emitDecoratorMetadata`, y
 *   Nest resuelve la inyección de `Test.createTestingModule` con esos
 *   metadatos. SWC lee `experimentalDecorators`/`emitDecoratorMetadata` del
 *   `tsconfig.json`.
 * - `globals: true`: `describe`/`it`/`expect`/`vi` sin import (DA-2 a). Los
 *   tipos los da el `/// <reference types="vitest/globals" />` de cada spec,
 *   porque `tsconfig.json` fija `types` y no se toca.
 *
 * Los alias reproducen el `moduleNameMapper` del bloque `jest` que había en
 * `package.json`.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      // Explícito para no heredar el `module` de un `.swcrc` (receta de Nest).
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@db\/(.*)$/,
        replacement: resolve(__dirname, 'src/db/pickbazar/$1'),
      },
      { find: /^src\/(.*)$/, replacement: resolve(__dirname, 'src/$1') },
    ],
  },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reportsDirectory: './coverage',
    },
  },
});
