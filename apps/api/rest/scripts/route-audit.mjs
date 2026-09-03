#!/usr/bin/env node
/**
 * Auditor de rutas HTTP de apps/api/rest (US-23, design.md Decisión F).
 *
 * Parser estructural por bloque `@Controller(prefix) export class X` —
 * soporta varios bloques por archivo (p. ej. `shops.controller.ts` declara
 * 7) — que enumera los handlers `@Get/@Post/@Put/@Patch/@Delete` y resuelve
 * la clasificación EFECTIVA de cada ruta mirando primero los decoradores
 * del handler y, si no hay, los de la clase (mismo orden que
 * `Reflector.getAllAndOverride`). Node puro: `jq` no está instalado en esta
 * máquina.
 *
 * Los decoradores NO tienen que estar en la línea inmediatamente anterior:
 * el parser sube por todo el bloque de decoradores (saltando comentarios y
 * líneas en blanco, y respetando decoradores multilínea por balance de
 * paréntesis). Además, `--check` asevera un invariante de atribución: cada
 * `@Public()`/`@Permissions(...)` que aparece en un `*.controller.ts` tiene
 * que haber sido atribuido a una clase o a un handler. Si el parser no ve
 * uno que sí existe en el archivo, FALLA en vez de dar un verde silencioso.
 *
 * Historia (US-23, hallazgos H-1/H-2 de `verify-report.md`): la primera
 * versión solo diffeaba el set público y solo miraba la línea anterior. Con
 * eso, borrar un `@Permissions()` de clase de `UsersController` —8 rutas que
 * pasaban a "cualquier logueado"— seguía dando exit 0, y un `@Public()` no
 * adyacente era invisible al parser pero efectivo en runtime. Ambos casos
 * son ahora fallos ruidosos; hay un test de mutación en
 * `scripts/route-audit.test.mjs`.
 *
 * Uso:
 *   node scripts/route-audit.mjs            # tabla completa
 *   node scripts/route-audit.mjs --check     # exit 1 si difiere de la línea base
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(SCRIPT_DIR, '..');
/** `ROUTE_AUDIT_SRC` permite auditar un árbol copiado — lo usa el test de mutación. */
const SRC_ROOT = process.env.ROUTE_AUDIT_SRC
  ? resolve(process.env.ROUTE_AUDIT_SRC)
  : join(API_ROOT, 'src');

const HTTP_METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

/**
 * Controladores cuyas rutas quedan deliberadamente sin anotar (D-9): stubs
 * muertos (`ProfilesController`, `console.log`, no llaman al service) que
 * caen en el deny-by-default. El parser no puede distinguirlos
 * mecánicamente de una ruta "autenticada" común — ambas carecen de
 * decorador — así que se declaran a mano para que la tabla de conteos
 * separe "esp" de "auth".
 */
const SPECIAL_UNANNOTATED_CLASSES = new Set(['ProfilesController']);

/**
 * Las 67 rutas anónimas EFECTIVAS en runtime: las 64 `@Public()` del
 * inventario (proposal.md, CA-1) + los 3 GET de `web-hook` (D-7). El
 * `--check` diffea en las DOS direcciones contra este set:
 *   - falta una esperada  → R-1 materializado (esa ruta será 401 al activar)
 *   - sobra una no esperada → una ruta quedó abierta por error (silenciosa)
 * Formato: "METODO /ruta", tal como Nest la registra dentro del módulo
 * (sin el global prefix `/api`, que agrega `main.ts` fuera de este parser).
 */
const EXPECTED_PUBLIC = new Set([
  // auth — 10
  'POST /register',
  'POST /token',
  'POST /social-login-token',
  'POST /otp-login',
  'POST /send-otp-code',
  'POST /verify-otp-code',
  'POST /forget-password',
  'POST /reset-password',
  'POST /verify-forget-password-token',
  'POST /contact-us',
  // catálogo de lectura — 22
  'GET /products',
  'GET /products/:slug',
  'GET /popular-products',
  'GET /best-selling-products',
  'GET /products-by-flash-sale',
  'GET /categories',
  'GET /categories/:param',
  'GET /types',
  'GET /types/:slug',
  'GET /tags',
  'GET /tags/:param',
  'GET /shops',
  'GET /shops/:slug',
  'GET /near-by-shop/:lat/:lng',
  'GET /authors',
  'GET /authors/:slug',
  'GET /top-authors',
  'GET /manufacturers',
  'GET /manufacturers/:slug',
  'GET /top-manufacturers',
  'GET /flash-sale',
  'GET /flash-sale/:param',
  // contenido / referencia — 15
  'GET /settings',
  'GET /faqs',
  'GET /faqs/:param',
  'GET /terms-and-conditions',
  'GET /terms-and-conditions/:param',
  'GET /refund-policies',
  'GET /refund-policies/:param',
  'GET /refund-reasons',
  'GET /refund-reasons/:param',
  'GET /order-status',
  'GET /order-status/:param',
  'GET /shippings',
  'GET /shippings/:id',
  'GET /taxes',
  'GET /taxes/:id',
  // UGC de lectura — 6
  'GET /reviews',
  'GET /reviews/:id',
  'GET /questions',
  'GET /questions/:id',
  'GET /feedbacks',
  'GET /feedbacks/:id',
  // coupons — 4
  'GET /coupons',
  'GET /coupons/:param',
  'GET /coupons/:id/verify',
  'POST /coupons/verify',
  // creación de pedido (D-10) — 2
  'POST /orders',
  'POST /orders/checkout/verify',
  // notify-logs GET — 2
  'GET /notify-logs',
  'GET /notify-logs/:param',
  // became-seller — 2
  'POST /became-seller',
  'GET /became-seller',
  // subscribe-to-newsletter — 1
  'POST /subscribe-to-newsletter',
  // web-hook (D-7) — 3, especial pero efectivamente público
  'GET /web-hook/razorpay',
  'GET /web-hook/stripe',
  'GET /web-hook/paypal',
]);

/**
 * Las 117 rutas con permiso EFECTIVO (bucket `perm`), tal como quedaron tras
 * la Fase 2 y como las verificó `sdd-verify` en runtime. Sirven de línea
 * base: si alguien borra o afloja un `@Permissions()`, esas rutas caen al
 * bucket `auth` ("cualquier logueado basta") y el diff de abajo lo detecta.
 * Sin esto, el `--check` solo miraba el set público y el aflojamiento era
 * invisible (H-1).
 */
const EXPECTED_PERM = new Set([
  'DELETE /abusive_reports/:id',
  'DELETE /attributes/:id',
  'DELETE /authors/:id',
  'DELETE /categories/:id',
  'DELETE /coupons/:id',
  'DELETE /faqs/:id',
  'DELETE /flash-sale/:id',
  'DELETE /manufacturers/:id',
  'DELETE /orders/:id',
  'DELETE /order-status/:id',
  'DELETE /ownership-transfer/:id',
  'DELETE /products/:id',
  'DELETE /refund-policies/:id',
  'DELETE /refund-reasons/:id',
  'DELETE /refunds/:id',
  'DELETE /shippings/:id',
  'DELETE /shops/:id',
  'DELETE /staffs/:id',
  'DELETE /store-notices/:id',
  'DELETE /tags/:id',
  'DELETE /taxes/:id',
  'DELETE /terms-and-conditions/:id',
  'DELETE /types/:id',
  'DELETE /users/:id',
  'DELETE /withdraws/:id',
  'GET /abusive_reports',
  'GET /abusive_reports/:id',
  'GET /admin/list',
  'GET /all-staffs',
  'GET /analytics',
  'GET /attributes',
  'GET /attributes/:param',
  'GET /category-wise-product',
  'GET /customers/list',
  'GET /draft-products',
  'GET /export-order-url',
  'GET /low-stock-products',
  'GET /my-staffs',
  'GET /new-shops',
  'GET /ownership-transfer',
  'GET /ownership-transfer/:param',
  'GET /products-stock',
  'GET /staffs',
  'GET /staffs/:slug',
  'GET /store-notices',
  'GET /store-notices/:param',
  'GET /store-notices/getUsersToNotify',
  'GET /top-rate-product',
  'GET /users',
  'GET /users/:id',
  'GET /vendors/list',
  'GET /withdraws',
  'GET /withdraws/:id',
  'PATCH /refunds/:id',
  'POST /approve-coupon',
  'POST /approve-shop',
  'POST /approve-terms-and-conditions',
  'POST /attributes',
  'POST /authors',
  'POST /categories',
  'POST /coupons',
  'POST /disapprove-coupon',
  'POST /disapprove-shop',
  'POST /disapprove-terms-and-conditions',
  'POST /download-invoice-url',
  'POST /faqs',
  'POST /flash-sale',
  'POST /generate-descriptions',
  'POST /import-attributes',
  'POST /import-products',
  'POST /import-variation-options',
  'POST /manufacturers',
  'POST /order-status',
  'POST /ownership-transfer',
  'POST /products',
  'POST /refund-policies',
  'POST /refund-reasons',
  'POST /settings',
  'POST /shippings',
  'POST /shops',
  'POST /shops/approve',
  'POST /shops/disapprove',
  'POST /staffs',
  'POST /store-notices',
  'POST /tags',
  'POST /taxes',
  'POST /terms-and-conditions',
  'POST /types',
  'POST /users',
  'POST /users/block-user',
  'POST /users/make-admin',
  'POST /users/unblock-user',
  'POST /withdraws',
  'POST /withdraws/:id/approve',
  'PUT /abusive_reports/:id',
  'PUT /attributes/:id',
  'PUT /authors/:id',
  'PUT /categories/:id',
  'PUT /coupons/:id',
  'PUT /faqs/:id',
  'PUT /flash-sale/:id',
  'PUT /manufacturers/:id',
  'PUT /orders/:id',
  'PUT /order-status/:id',
  'PUT /ownership-transfer/:id',
  'PUT /products/:id',
  'PUT /refund-policies/:id',
  'PUT /refund-reasons/:id',
  'PUT /shippings/:id',
  'PUT /shops/:id',
  'PUT /staffs/:id',
  'PUT /store-notices/:id',
  'PUT /tags/:id',
  'PUT /taxes/:id',
  'PUT /terms-and-conditions/:id',
  'PUT /types/:id',
  'PUT /users/:id',
]);

/** Rutas sin anotar a propósito (D-9). Ver SPECIAL_UNANNOTATED_CLASSES. */
const EXPECTED_SPECIAL_COUNT = 3;

/** Total de rutas HTTP registradas. Cambiarlo exige actualizar el inventario. */
const EXPECTED_TOTAL = 250;

function findControllerFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findControllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

function stripQuotes(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^['"](.*)['"]$/);
  return match ? match[1] : trimmed;
}

function joinPath(prefix, sub) {
  const parts = [prefix, sub]
    .filter((p) => p && p.length > 0)
    .map((p) => p.replace(/^\/+|\/+$/g, ''));
  return '/' + parts.join('/');
}

function classify(handlerPublic, handlerPerm, classPublic, classPerm, className) {
  if (handlerPublic) return { bucket: 'public', permLabel: null };
  if (handlerPerm !== null) return { bucket: 'perm', permLabel: handlerPerm };
  if (classPublic) return { bucket: 'public', permLabel: null };
  if (classPerm !== null) return { bucket: 'perm', permLabel: classPerm };
  if (SPECIAL_UNANNOTATED_CLASSES.has(className)) {
    return { bucket: 'special', permLabel: null };
  }
  return { bucket: 'auth', permLabel: null };
}

/**
 * Sube desde `idx - 1` recogiendo el bloque de decoradores que precede a esa
 * línea. Salta comentarios y líneas en blanco, y respeta decoradores
 * multilínea cerrando por balance de paréntesis. Se detiene en cuanto
 * encuentra código que no forma parte del bloque.
 *
 * Antes esto miraba SOLO `lines[idx - 1]`, así que un `@Public()` separado
 * del decorador HTTP por otro decorador o por un comentario era invisible al
 * parser pero efectivo en runtime (H-2): un falso verde en la dirección
 * peligrosa.
 */
function decoratorBlockAbove(lines, idx) {
  const collected = [];
  let depth = 0;
  for (let j = idx - 1; j >= 0; j--) {
    const line = lines[j].trim();
    if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
      continue;
    }
    const opens = (line.match(/\(/g) || []).length;
    const closes = (line.match(/\)/g) || []).length;
    const isDecorator = line.startsWith('@');
    const isMultilineTail = closes > opens;

    if (depth > 0 || isDecorator || isMultilineTail) {
      collected.unshift(line);
      depth = Math.max(0, depth + closes - opens);
      continue;
    }
    break;
  }
  return collected.join('\n');
}

/** Cuenta `@Public(` / `@Permissions(` en un texto, ignorando comentarios. */
function countAnnotations(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n')
    .match(/@(?:Public|Permissions)\(/g)?.length ?? 0;
}

function parseFile(file) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const routes = [];
  /** Bloques de decoradores que este parser SÍ atribuyó (invariante H-2). */
  const attributedBlocks = [];

  const controllerLineIdx = [];
  lines.forEach((line, idx) => {
    if (/@Controller\(/.test(line)) controllerLineIdx.push(idx);
  });

  controllerLineIdx.forEach((startIdx, i) => {
    const endIdx =
      i + 1 < controllerLineIdx.length ? controllerLineIdx[i + 1] : lines.length;
    const controllerLine = lines[startIdx];
    const argMatch = controllerLine.match(/@Controller\(([^)]*)\)/);
    const prefix = argMatch && argMatch[1].trim() ? stripQuotes(argMatch[1]) : '';

    let className = null;
    for (let j = startIdx; j < endIdx; j++) {
      const m = lines[j].match(/export class (\w+)/);
      if (m) {
        className = m[1];
        break;
      }
    }

    const classBlock = decoratorBlockAbove(lines, startIdx);
    attributedBlocks.push(classBlock);
    const classPublic = /@Public\(\)/.test(classBlock);
    const classPermMatch = classBlock.match(/@Permissions\(([\s\S]*?)\)/);
    const classPerm = classPermMatch ? classPermMatch[1].replace(/\s+/g, ' ').trim() : null;

    for (let j = startIdx; j < endIdx; j++) {
      for (const method of HTTP_METHODS) {
        const re = new RegExp(`@${method}\\(([^)]*)\\)`);
        const m = lines[j].match(re);
        if (!m) continue;
        const sub = m[1].trim() ? stripQuotes(m[1]) : '';
        const fullPath = joinPath(prefix, sub);

        const handlerBlock = decoratorBlockAbove(lines, j);
        attributedBlocks.push(handlerBlock);
        const handlerPublic = /@Public\(\)/.test(handlerBlock);
        const handlerPermMatch = handlerBlock.match(/@Permissions\(([\s\S]*?)\)/);
        const handlerPerm = handlerPermMatch
          ? handlerPermMatch[1].replace(/\s+/g, ' ').trim()
          : null;

        const { bucket, permLabel } = classify(
          handlerPublic,
          handlerPerm,
          classPublic,
          classPerm,
          className,
        );

        routes.push({
          method: method.toUpperCase(),
          path: fullPath,
          location: `${relative(API_ROOT, file)}:${j + 1}`,
          className,
          bucket,
          permLabel,
        });
      }
    }
  });

  const inFile = countAnnotations(content);
  const attributed = attributedBlocks.reduce((n, b) => n + countAnnotations(b), 0);

  return { routes, unattributed: inFile - attributed, file: relative(API_ROOT, file) };
}

function collectRoutes() {
  const files = findControllerFiles(SRC_ROOT).sort();
  const parsed = files.map(parseFile);
  return {
    routes: parsed.flatMap((p) => p.routes),
    orphans: parsed.filter((p) => p.unattributed > 0),
  };
}

function printTable(routes) {
  const sorted = [...routes].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
  for (const r of sorted) {
    const label =
      r.bucket === 'perm' && r.permLabel ? `perm(${r.permLabel})` : r.bucket;
    console.log(`${r.method.padEnd(6)} ${r.path.padEnd(45)} ${r.location.padEnd(55)} ${label}`);
  }
}

function printCounts(routes) {
  const counts = { public: 0, perm: 0, auth: 0, special: 0 };
  for (const r of routes) counts[r.bucket]++;
  console.log(
    `total=${routes.length} public=${counts.public} perm=${counts.perm} auth=${counts.auth} esp=${counts.special}`,
  );
}

function diffSet(actual, expected, label, missingMsg, extraMsg) {
  const missing = [...expected].filter((r) => !actual.has(r)).sort();
  const extra = [...actual].filter((r) => !expected.has(r)).sort();

  if (missing.length > 0) {
    console.error(`\n[route-audit] ${label}: FALTAN ${missing.length} — ${missingMsg}`);
    for (const r of missing) console.error(`  - ${r}`);
  }
  if (extra.length > 0) {
    console.error(`\n[route-audit] ${label}: SOBRAN ${extra.length} — ${extraMsg}`);
    for (const r of extra) console.error(`  - ${r}`);
  }
  return missing.length === 0 && extra.length === 0;
}

function runCheck(routes, orphans) {
  const setOf = (bucket) =>
    new Set(routes.filter((r) => r.bucket === bucket).map((r) => `${r.method} ${r.path}`));

  let ok = true;

  ok =
    diffSet(
      setOf('public'),
      EXPECTED_PUBLIC,
      'PÚBLICAS',
      'esperadas públicas y NO anotadas (serán 401 al activar el guard: R-1)',
      'anotadas @Public() sin estar esperadas (hueco silencioso)',
    ) && ok;

  // H-1: sin este diff, borrar un @Permissions() dejaba la ruta en el bucket
  // `auth` ("cualquier logueado basta") sin alterar el set público — exit 0.
  ok =
    diffSet(
      setOf('perm'),
      EXPECTED_PERM,
      'CON PERMISO',
      'esperadas con @Permissions() y aflojadas a "cualquier logueado"',
      'con @Permissions() sin estar en la línea base (endurecidas sin actualizar el inventario)',
    ) && ok;

  const specialCount = routes.filter((r) => r.bucket === 'special').length;
  if (specialCount !== EXPECTED_SPECIAL_COUNT) {
    ok = false;
    console.error(
      `\n[route-audit] ESPECIALES: ${specialCount}, se esperaban ${EXPECTED_SPECIAL_COUNT} (D-9, sin anotar a propósito).`,
    );
  }

  if (routes.length !== EXPECTED_TOTAL) {
    ok = false;
    console.error(
      `\n[route-audit] TOTAL: ${routes.length} rutas, se esperaban ${EXPECTED_TOTAL}. Si se añadieron o quitaron rutas, hay que actualizar el inventario (CA-1) y esta línea base.`,
    );
  }

  // H-2: una anotación que existe en el archivo pero que el parser no supo
  // atribuir es peor que una ausente — sería efectiva en runtime e invisible
  // aquí. Falla ruidosamente en vez de dar un verde de mentira.
  if (orphans.length > 0) {
    ok = false;
    console.error(
      `\n[route-audit] ANOTACIONES NO ATRIBUIDAS en ${orphans.length} archivo(s): el parser no pudo asociarlas a una clase ni a un handler. Serían efectivas en runtime pero invisibles para este auditor:`,
    );
    for (const o of orphans) console.error(`  - ${o.file} (${o.unattributed})`);
  }

  printCounts(routes);

  if (!ok) {
    console.error('\n[route-audit] --check FALLÓ.');
    process.exitCode = 1;
    return;
  }

  console.log(
    '[route-audit] --check OK: públicas, con permiso, especiales y total coinciden con la línea base; todas las anotaciones fueron atribuidas.',
  );
}

function main() {
  const { routes, orphans } = collectRoutes();
  const checkMode = process.argv.includes('--check');

  if (checkMode) {
    runCheck(routes, orphans);
    return;
  }

  printTable(routes);
  printCounts(routes);
}

main();
