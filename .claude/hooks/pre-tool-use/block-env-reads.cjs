#!/usr/bin/env node
// Hook: PreToolUse (matcher: Bash|PowerShell|Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep)
//
// Niega leer, editar, escribir, copiar o cargar un archivo de secretos real
// (`.env`, `.env.local`…: credenciales de Postgres, SECRET de next-auth,
// claves de API). Deja pasar las plantillas (.example, .sample, .template,
// .dist, .defaults) para que el andamiaje siga funcionando (US-72).
//
// Adaptado de bingo-flow (`.claude/hooks/pre-tool-use/block-env-reads.cjs`).
// Diferencia deliberada (US-72, DA-1): en el texto de un comando, el token
// `.env` no cuenta si va pegado a un identificador, así que
// `grep -rn "process.env"` o `node -e "process.env.X"` pasan, y
// `cat apps/shop/.env` sigue negado.
//
// Vectores cubiertos:
//   - Read / Edit / Write / MultiEdit / NotebookEdit (file_path)
//   - Bash / PowerShell (cat, type, Get-Content, sed, base64, source,
//     `. archivo`, cp…, y globs ofuscados como `.e*` o `.??v`)
//   - Glob / Grep: el destino (pattern / path / glob), no el regex de contenido
//
// Niega con el esquema de decisión de PreToolUse (permissionDecision: "deny")
// y exit 0, para que el agente reciba el motivo. Ante cualquier error de
// parseo o interno falla ABIERTO (exit 0): un evento malformado no debe
// bloquear la sesión.

// --- Plantillas sin secretos: siguen legibles y editables.
const ALLOWED = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.defaults',
]);

// Una referencia a un archivo de secretos en texto libre: ".env" y ".env.local".
// No cuenta si va precedida de un carácter de identificador (`process.env`,
// `$X.env`); el grupo opcional toma un único ".sufijo".
const TOKEN_RE = /(?<![\w$])\.env(?:\.[\w-]+)?/gi;

// Globs ofuscados que casi seguro apuntan a un archivo de secretos.
const GLOB_RE = /\.e(?:nv)?[*?]|\.\?\?v|\*\.env\b/i;

const HINT =
  'El hook de seguridad del proyecto (US-72) bloquea leer, editar, copiar o ' +
  'cargar un .env real. Para configuración sin secretos usa la plantilla ' +
  '(.env.example o .env.template); si hace falta un valor real, pídeselo al dueño.';

// --- helpers ---------------------------------------------------------------

function clean(token) {
  return String(token || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

function basename(p) {
  const s = clean(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = s.lastIndexOf('/');
  return idx === -1 ? s : s.slice(idx + 1);
}

function isProtectedName(name) {
  const lower = String(name || '').toLowerCase();
  if (ALLOWED.has(lower)) return false;
  return lower === '.env' || lower.startsWith('.env.');
}

function pathIsProtected(p) {
  return !!p && isProtectedName(basename(p));
}

function textTouchesProtected(text) {
  if (!text) return false;
  if (GLOB_RE.test(text)) return true;
  const matches = String(text).match(TOKEN_RE) || [];
  for (const m of matches) {
    if (!ALLOWED.has(m.toLowerCase())) return true;
  }
  return false;
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
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

  try {
    if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
      if (pathIsProtected(ti.file_path)) {
        deny(`Bloqueado: '${ti.file_path}' es un archivo de secretos protegido. ${HINT}`);
      }
    } else if (tool === 'MultiEdit') {
      const paths = [ti.file_path];
      if (Array.isArray(ti.edits)) {
        for (const e of ti.edits) {
          if (e && typeof e === 'object') paths.push(e.file_path);
        }
      }
      for (const p of paths) {
        if (pathIsProtected(p)) {
          deny(`Bloqueado: '${p}' es un archivo de secretos protegido. ${HINT}`);
        }
      }
    } else if (tool === 'NotebookEdit') {
      if (pathIsProtected(ti.notebook_path)) {
        deny(`Bloqueado: editar un archivo de secretos protegido. ${HINT}`);
      }
    } else if (tool === 'Glob') {
      for (const c of [ti.pattern, ti.path]) {
        if (textTouchesProtected(c) || pathIsProtected(c)) {
          deny(`Bloqueado: buscar archivos de secretos protegidos. ${HINT}`);
        }
      }
    } else if (tool === 'Grep') {
      // `pattern` es el regex de contenido (no se inspecciona); se vigilan los destinos.
      for (const c of [ti.path, ti.glob]) {
        if (textTouchesProtected(c) || pathIsProtected(c)) {
          deny(`Bloqueado: buscar dentro de un archivo de secretos expone su contenido. ${HINT}`);
        }
      }
    } else if (tool === 'Bash' || tool === 'PowerShell') {
      const cmd = ti.command || '';
      if (textTouchesProtected(cmd)) {
        deny(
          'Bloqueado: el comando menciona un archivo de secretos protegido ' +
            '(un `.env` que no va pegado a un identificador, como en `process.env`). ' +
            `Si solo buscabas el texto ".env", reformula el patrón. ${HINT}`,
        );
      }
    }
  } catch {
    process.exit(0); // error interno: falla abierto
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
