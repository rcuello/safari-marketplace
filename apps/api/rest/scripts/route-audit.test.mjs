#!/usr/bin/env node
/**
 * Test de mutación de `route-audit.mjs` (US-23, hallazgos H-1/H-2 de
 * `verify-report.md`).
 *
 * Un auditor solo sirve si FALLA cuando debe. Que dé verde sobre el árbol
 * bueno no prueba nada: la primera versión de este script también daba verde
 * borrando un `@Permissions()` de clase. Así que aquí se rompe el árbol a
 * propósito, sobre una COPIA desechable, y se exige exit 1 en cada caso.
 *
 * Uso:  node scripts/route-audit.test.mjs
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(SCRIPT_DIR, '..');
const SRC = join(API_ROOT, 'src');
const AUDITOR = join(SCRIPT_DIR, 'route-audit.mjs');

/** Corre el auditor contra `srcDir` y devuelve su exit code. */
function check(srcDir) {
  const res = spawnSync(process.execPath, [AUDITOR, '--check'], {
    env: { ...process.env, ROUTE_AUDIT_SRC: srcDir },
    encoding: 'utf8',
  });
  return res.status;
}

function withCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'route-audit-'));
  const copy = join(dir, 'src');
  try {
    cpSync(SRC, copy, { recursive: true });
    return fn(copy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function patch(file, from, to) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    throw new Error(`patrón no encontrado en ${file}: ${JSON.stringify(from.slice(0, 60))}`);
  }
  writeFileSync(file, before.replace(from, to), 'utf8');
}

const CASES = [
  {
    name: 'árbol intacto → exit 0',
    expect: 0,
    mutate: () => {},
  },
  {
    name: 'H-1: se borra el @Permissions() de clase de UsersController (8 rutas se aflojan a "cualquier logueado")',
    expect: 1,
    mutate: (src) => {
      const f = join(src, 'users', 'users.controller.ts');
      const txt = readFileSync(f, 'utf8');
      const m = txt.match(/^@Permissions\([^)]*\)\r?\n(?=@Controller)/m);
      if (!m) throw new Error('no se encontró un @Permissions() de clase en users.controller.ts');
      writeFileSync(f, txt.replace(m[0], ''), 'utf8');
    },
  },
  {
    name: 'falta una pública esperada: se borra el @Public() de GET /settings',
    expect: 1,
    mutate: (src) => {
      const f = join(src, 'settings', 'settings.controller.ts');
      const txt = readFileSync(f, 'utf8');
      writeFileSync(f, txt.replace(/^\s*@Public\(\)\r?\n/m, ''), 'utf8');
    },
  },
  {
    name: 'sobra una pública: se anota @Public() en una ruta de admin',
    expect: 1,
    mutate: (src) => {
      const f = join(src, 'users', 'users.controller.ts');
      patch(f, '  @Get()', '  @Public()\n  @Get()');
    },
  },
  {
    name: 'H-2: @Public() no adyacente (separado por otro decorador) sigue siendo visible',
    expect: 0,
    mutate: (src) => {
      // Mueve el @Public() de GET /settings una línea más arriba, detrás de
      // un decorador intermedio. En runtime sigue aplicando; el parser viejo
      // dejaba de verlo y daba un FALSO VERDE por "falta una pública".
      const f = join(src, 'settings', 'settings.controller.ts');
      const txt = readFileSync(f, 'utf8');
      const out = txt.replace(
        /^(\s*)@Public\(\)(\r?\n)(\s*)@Get\(\)/m,
        '$1@Public()$2$1@HttpCode(200)$2$3@Get()',
      );
      if (out === txt) throw new Error('no se pudo insertar el decorador intermedio');
      writeFileSync(f, out, 'utf8');
    },
  },
  {
    name: 'H-2: una anotación que el parser NO puede atribuir hace fallar el check (no verde silencioso)',
    expect: 1,
    mutate: (src) => {
      // Un `@Public()` colgado de un miembro que no es un handler HTTP: no lo
      // reclama ningún bloque de decoradores de ruta. El auditor tiene que
      // delatarlo en vez de ignorarlo.
      const f = join(src, 'settings', 'settings.controller.ts');
      const txt = readFileSync(f, 'utf8');
      const out = txt.replace(
        /export class (\w+) \{/,
        'export class $1 {\n  @Public()\n  private readonly _huerfano = 1;\n',
      );
      if (out === txt) throw new Error('no se pudo insertar la anotación huérfana');
      writeFileSync(f, out, 'utf8');
    },
  },
];

let failed = 0;
for (const c of CASES) {
  const got = withCopy((src) => {
    c.mutate(src);
    return check(src);
  });
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  (exit ${got}, esperado ${c.expect})  ${c.name}`);
}

if (failed > 0) {
  console.error(`\n${failed} caso(s) fallaron: el auditor NO detecta lo que promete.`);
  process.exitCode = 1;
} else {
  console.log(`\n${CASES.length}/${CASES.length} OK — el auditor falla cuando debe fallar.`);
}
