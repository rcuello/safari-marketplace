#!/usr/bin/env node
// Hook: PreToolUse (matcher: Edit|Write|MultiEdit|NotebookEdit)
//
// Niega las ESCRITURAS a mano en cualquier ruta bajo un directorio
// node_modules/. Un cambio ahí se pierde en el próximo `yarn install` o
// `npm install`, git no lo ve y ninguna otra máquina lo tiene (US-72).
//
// Adaptado de bingo-flow (`.claude/hooks/pre-tool-use/block-node-modules-writes.cjs`).
// safari no usa pnpm: `apps/` y `apps/api/rest` usan yarn 1 y `packages/db`
// usa npm, así que el mensaje propone `patch-package` en una US (DA-4), sin
// instalarlo de antemano.
//
// Decisiones de alcance (deliberadas, como en el original):
//   - Solo herramientas de edición. Read/Glob/Grep siguen permitidos: leer
//     node_modules es legítimo y frecuente (inspeccionar el código de un paquete).
//   - Bash/PowerShell NO se inspeccionan: distinguir "una escritura en
//     node_modules" dentro de un comando da falsos positivos (los comandos de
//     instalación lo mencionan todo el tiempo). Se acepta ese riesgo residual.
//
// Niega con el esquema de PreToolUse (permissionDecision: "deny") y exit 0.
// Ante cualquier error de parseo o interno falla ABIERTO.

const DENY_REASON =
  'Bloqueado (US-72): escribir a mano bajo node_modules/. El cambio se pierde ' +
  'en el próximo `yarn install`/`npm install`, git no lo ve y nadie más lo ' +
  'tendrá. No se parchea a mano: si de verdad hace falta, se usa ' +
  '`patch-package` en el paquete afectado, y eso se propone en una US.';

// --- helpers ---------------------------------------------------------------

function isUnderNodeModules(p) {
  if (!p) return false;
  const segments = String(p)
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .split('/');
  return segments.includes('node_modules');
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
    if (tool === 'Edit' || tool === 'Write') {
      if (isUnderNodeModules(ti.file_path)) deny(DENY_REASON);
    } else if (tool === 'MultiEdit') {
      const paths = [ti.file_path];
      if (Array.isArray(ti.edits)) {
        for (const e of ti.edits) {
          if (e && typeof e === 'object') paths.push(e.file_path);
        }
      }
      for (const p of paths) {
        if (isUnderNodeModules(p)) deny(DENY_REASON);
      }
    } else if (tool === 'NotebookEdit') {
      if (isUnderNodeModules(ti.notebook_path)) deny(DENY_REASON);
    }
  } catch {
    process.exit(0); // error interno: falla abierto
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
