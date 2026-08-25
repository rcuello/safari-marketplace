import { defineConfig } from 'tsup';

// Build de @safari/db.
//
// El paquete existe para ser consumido por la API NestJS, y esa API compila
// con `tsc` a secas (Nest 9, TypeScript 4.9). `tsc` NO transpila archivos que
// resuelve dentro de node_modules: los typechequea y los deja intactos. Sin un
// build aquí, el `require('@safari/db')` del dist de la API acaba cargando
// `index.ts` en tiempo de ejecución y Node revienta con
// `SyntaxError: Unexpected token 'export'`.
//
// Por eso este paquete SÍ necesita build, aunque el proyecto de referencia
// (agenthub-platform) no lo tenga: allí los consumidores son apps Next.js, que
// bundlean con SWC y sí transpilan dependencias.
export default defineConfig({
  entry: ['index.ts'],
  outDir: 'dist',

  // Solo CJS, a propósito.
  //
  // El único consumidor conocido es Nest, que es CommonJS. Y este paquete
  // exporta un singleton con estado (el cliente de Prisma en src/client.ts):
  // emitir CJS y ESM a la vez abre la puerta al "dual package hazard", donde
  // un consumidor carga la copia ESM y otro la CJS y acabas con DOS clientes
  // de Prisma y dos pools de conexiones.
  //
  // Añadir 'esm' es cambiar este array si algún día Next.js consume el
  // paquete directamente. Hoy no hace falta: la tienda habla con la API.
  format: ['cjs'],

  // Node 22 en local; node18 cubre cualquier runtime razonable en la nube.
  target: 'node18',
  platform: 'node',

  // Declaraciones de tipos. Sin esto el consumidor pierde el tipado, que es
  // la mitad del valor de la capa.
  dts: true,

  // OBLIGATORIO, no cosmético. El cliente generado por Prisma 7 hace, en su
  // primera línea ejecutable:
  //
  //     globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))
  //
  // `import.meta` no existe en CommonJS, así que esbuild lo reemplaza por un
  // objeto vacío: `fileURLToPath(undefined)` lanza un TypeError al CARGAR el
  // módulo. El build sale en verde y el artefacto no arranca.
  //
  // `shims: true` inyecta el equivalente de import.meta.url para CJS.
  shims: true,

  sourcemap: true,
  clean: true,

  // Dependencias reales, que el consumidor instala por su cuenta. El cliente
  // generado por Prisma (generated/) NO va aquí: se importa con ruta relativa
  // y se bundlea dentro, que es justo lo que evita tener que compilar sus 17
  // archivos .ts por separado.
  external: ['@prisma/client', '@prisma/adapter-pg', 'prisma', 'pg', 'dotenv'],
});
