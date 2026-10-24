#!/usr/bin/env node
// Hook: PostToolUse (matcher: Edit|Write|MultiEdit)
//
// Pasa el formateador del paquete sobre el archivo que el agente acaba de
// editar, para que el formato no se acumule como deuda (antes de este hook se
// juntaron 920 errores de prettier en la API y 93 de biome en packages/db).
// Solo formatea; la DoD sigue exigiendo el lint SIN escribir en 0
// (docs/product/README.md, paso 5 del protocolo).
//
// Qué formatea (ruta relativa a la raíz del repo -> herramienta, cwd):
//   - packages/db/**            .ts .js .mjs .cjs .json -> biome `check --write`
//                               (formato + orden de imports), cwd packages/db
//   - apps/api/rest/**          .ts                     -> prettier 2.8 de la API
//   - apps/shop/** y
//     apps/admin/rest/**        .ts .tsx .js .jsx .json .css -> prettier 2.4.0 de
//                               apps/node_modules (el que dejó esas apps en 0;
//                               el 3.3.3 local de cada app marcaría ~265
//                               archivos), cwd la app, con su prettier.config.js
//                               y su .prettierignore
//
// Qué ignora: todo lo demás (md, sql, prisma, Python, yaml), cualquier ruta con
// node_modules/, dist/, generated/, .next/ o __generated__/, los archivos de
// secretos (.env*), las variantes GraphQL (apps/admin/graphql, apps/api/graphql)
// y rutas fuera del repo. Si la propia herramienta dice que el archivo está
// ignorado (biome: «No files were processed»; prettier: sale en silencio), no
// es un error.
//
// Salida: silencioso si no hubo cambios. Si reescribió el archivo, devuelve
// `hookSpecificOutput.additionalContext` para que el agente sepa que el disco
// ya no coincide con lo que escribió (y relea antes del siguiente Edit). Si la
// herramienta falla (p. ej. error de sintaxis), lo avisa por ese mismo canal y
// por stderr, pero NO bloquea: PostToolUse con exit 0 nunca interrumpe.
// Documentado en https://code.claude.com/docs/en/hooks: con exit 0 Claude no
// ve stderr; `additionalContext` se añade junto al resultado de la herramienta.
//
// Falla ABIERTO: cualquier error (JSON ilegible, binario ausente, timeout de
// 20 s, excepción interna) -> exit 0 sin tocar nada.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TIMEOUT_MS = 20_000;

const SKIP_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'generated',
  '__generated__',
  '.next',
]);
const SKIP_PREFIXES = ['apps/admin/graphql/', 'apps/api/graphql/'];

const FRONT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css'];
const APPS_PRETTIER = 'apps/node_modules/prettier/bin-prettier.js';
const prettierArgs = (file) => ['--loglevel', 'warn', '--write', file];

// Orden: el primer prefijo que coincide gana.
const TARGETS = [
  {
    prefix: 'packages/db/',
    exts: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    tool: 'biome',
    bin: 'packages/db/node_modules/@biomejs/biome/bin/biome',
    cwd: 'packages/db',
    args: (file) => ['check', '--write', file],
  },
  {
    prefix: 'apps/api/rest/',
    exts: ['.ts'],
    tool: 'prettier',
    bin: 'apps/api/rest/node_modules/prettier/bin-prettier.js',
    cwd: 'apps/api/rest',
    args: prettierArgs,
  },
  {
    prefix: 'apps/shop/',
    exts: FRONT_EXTS,
    tool: 'prettier',
    bin: APPS_PRETTIER,
    cwd: 'apps/shop',
    args: prettierArgs,
  },
  {
    prefix: 'apps/admin/rest/',
    exts: FRONT_EXTS,
    tool: 'prettier',
    bin: APPS_PRETTIER,
    cwd: 'apps/admin/rest',
    args: prettierArgs,
  },
];

// --- helpers ---------------------------------------------------------------

function clean(p) {
  return String(p || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

// Ruta relativa a la raíz con `/`, o null si está fuera del repo o se ignora.
function relativeInsideRepo(p) {
  const abs = path.resolve(ROOT, clean(p));
  const rel = path.relative(ROOT, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join('/');
  const segments = posix.split('/');
  if (segments.some((s) => SKIP_SEGMENTS.has(s))) return null;
  if (SKIP_PREFIXES.some((pre) => posix.startsWith(pre))) return null;
  const base = segments[segments.length - 1].toLowerCase();
  if (base === '.env' || base.startsWith('.env.')) return null;
  return posix;
}

function targetFor(rel) {
  const ext = path.extname(rel).toLowerCase();
  return (
    TARGETS.find((t) => rel.startsWith(t.prefix) && t.exts.includes(ext)) ||
    null
  );
}

function readOrNull(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function firstLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/Ignored unknown option/.test(l));
  return line ? line.slice(0, 200) : '';
}

// Formatea un archivo. Devuelve una nota para el agente o null si no hay nada
// que decir (sin cambios, ignorado por la herramienta, o herramienta ausente).
function formatOne(rel) {
  const target = targetFor(rel);
  if (!target) return null;

  const bin = path.join(ROOT, target.bin);
  if (!fs.existsSync(bin)) return null; // deps sin instalar: nada que hacer

  const abs = path.join(ROOT, rel);
  const before = readOrNull(abs);
  if (before === null) return null;

  const started = Date.now();
  try {
    execFileSync(process.execPath, [bin, ...target.args(abs)], {
      cwd: path.join(ROOT, target.cwd),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`;
    if (/No files were processed/.test(output)) return null; // ignorado por biome
    if (err.code === 'ETIMEDOUT' || err.signal) {
      process.stderr.write(
        `format-edited-file: ${target.tool} superó ${TIMEOUT_MS / 1000}s sobre ${rel}; se deja como estaba.\n`,
      );
      return null;
    }
    const detail = firstLine(err.stderr) || firstLine(err.stdout) || `exit ${err.status}`;
    process.stderr.write(`format-edited-file: ${target.tool} falló sobre ${rel}: ${detail}\n`);
    return (
      `El formateador (${target.tool}) no pudo formatear ${rel}: ${detail}. ` +
      'El archivo quedó tal como lo escribiste; suele ser un error de sintaxis.'
    );
  }

  const after = readOrNull(abs);
  if (after === null || after === before) return null;
  const ms = Date.now() - started;
  return (
    `El hook de formato reescribió ${rel} con ${target.tool} (${ms} ms). ` +
    'El contenido en disco ya no es exactamente el que escribiste: reléelo antes del siguiente Edit.'
  );
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return null;
  }
}

// --- main ------------------------------------------------------------------

async function main() {
  const data = await readStdin();
  if (!data) process.exit(0); // ilegible: falla abierto

  const tool = data.tool_name || '';
  const ti = data.tool_input || {};
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') process.exit(0);

  try {
    const candidates = [ti.file_path];
    if (Array.isArray(ti.edits)) {
      for (const e of ti.edits) {
        if (e && typeof e === 'object') candidates.push(e.file_path);
      }
    }
    const rels = new Set();
    for (const c of candidates) {
      const rel = c ? relativeInsideRepo(c) : null;
      if (rel) rels.add(rel);
    }

    const notes = [];
    for (const rel of rels) {
      const note = formatOne(rel);
      if (note) notes.push(note);
    }

    if (notes.length > 0) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: notes.join('\n'),
          },
        }),
      );
    }
  } catch {
    process.exit(0); // error interno: falla abierto
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
