import { defineConfig } from 'vitest/config';

/**
 * `fileParallelism: false` (DD29-10, US-29). Sin este archivo el default de
 * vitest corre los `*.integration.test.ts` en paralelo contra el MISMO
 * Postgres: cualquier fila centinela viva de un archivo es visible para los
 * conteos absolutos de otro (`categories.integration.test.ts`,
 * `shops.integration.test.ts`, `products.integration.test.ts`). Serializa
 * los archivos de integración, que son E/S contra una sola base y no ganan
 * nada corriendo en paralelo entre sí.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
