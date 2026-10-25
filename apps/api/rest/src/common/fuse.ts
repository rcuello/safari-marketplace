import { createRequire } from 'node:module';

/**
 * Interop de `fuse.js` 6 desde ESM (US-90).
 *
 * El paquete es CommonJS (`module.exports = Fuse`), pero sus tipos declaran
 * `export default Fuse`. Desde ESM, `import Fuse from 'fuse.js'` da en runtime
 * la clase (el `module.exports`), mientras que TypeScript (`nodenext`) tipa
 * ese default como el módulo entero (`{ default: Fuse }`) y `new Fuse(…)`
 * no compila (TS2351). Con `require` el valor es el mismo `module.exports`, y
 * el tipo se toma de la vista CommonJS del paquete, donde `default` sí es la
 * clase.
 */
const require = createRequire(import.meta.url);

const Fuse: typeof import('fuse.js', {
  with: { 'resolution-mode': 'require' },
}).default = require('fuse.js');

export default Fuse;
