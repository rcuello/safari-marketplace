# Apply Progress: Guardas de id fuera del rango `bigint` (US-31)

Modo: Standard (strict_tdd: false). Chain strategy: stacked-to-main, 3 PRs.

## PR1 — `us-31-pr1-guardas-catalogo-fk` (Fases 1 y 2)

### Fase 1 — Guardas de FK en `packages/db`

- [x] 1.1 `tags.repository.ts` (`_assertValidTypeId`) y
      `manufacturers.repository.ts` (`_assertValidTypeId`):
      `Number.isInteger` → `Number.isSafeInteger`, sin `<= 0`. Comentario
      local explicando D31-2 (por qué NO `<= 0`), copiado del razonamiento de
      `categories.repository.ts:298-327`.
- [x] 1.2 `tags.integration.test.ts` y `manufacturers.integration.test.ts`:
      +2 tests c/u —
      - `typeId: 1e21` → `InvalidReferenceError` (regresión de
        `Number.isSafeInteger`).
      - `typeId: -5` → `InvalidReferenceError` **por `P2003`, no por la
        guarda**: discriminador `expect(message).not.toContain('-5')` (la
        guarda interpola el valor en el mensaje; la rama `P2003` de
        `translateCatalogWriteError` no pasa el tercer argumento).
- [x] 1.3 `just db-build` y `just db-check` verdes (ver evidencia abajo).

### Fase 2 — Guardas de ruta del catálogo

- [x] 2.1 `types.service.ts:126,151` y `tags.service.ts:170,200`:
      `!Number.isSafeInteger(id) || id <= 0`; doc-comment de `update`
      ampliado con las 2 frases de DD31-C; `remove` recibe la línea
      `/** Misma guarda de id que `update` (US-31). */`.
- [x] 2.1b Cross-ref corregido: los doc-comments de `types.service.ts` y
      `tags.service.ts` citaban *"precedente exacto
      `users.service.ts:94,113,142`"* — doblemente falso (users tenía el
      mismo defecto y esas líneas se desplazan en PR2). Sustituido por
      `categories.service.ts:275-293`.
      Verificación: `grep -rn "users.service.ts:94" apps/api/rest/src/` →
      sin resultados (confirmado, ver evidencia abajo).
- [x] 2.2 `manufacturers.service.ts:218,254`: mismo guard + comentario (sin
      cross-ref, su doc-comment no citaba `users`).
- [x] 2.3 `types.service.spec.ts`, `tags.service.spec.ts`,
      `manufacturers.service.spec.ts`: los 6 `it` de solo `NaN`
      (`update`/`remove` × 3 módulos) reemplazados por `it.each` de 4 casos
      (`NaN`, `0`, `-5`, `1e21`), testigo
      `expect(<mock>).not.toHaveBeenCalled()` por el `update{Type,Tag,Manufacturer}Mock`/
      `delete{Type,Tag,Manufacturer}Mock` respectivo (DD31-D).
- [x] 2.4 `cd apps/api/rest && npx jest` verde (ver evidencia abajo).

### Evidencia real — PR1

**`just db-build`** (recorte; build limpio):

```
> @safari/db@0.1.0 build
> prisma generate && tsup

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 500ms
CJS dist\index.js     165.27 KB
CJS dist\index.js.map 400.26 KB
CJS ⚡️ Build success in 134ms
DTS ⚡️ Build success in 7042ms
DTS dist\index.d.ts 1.40 MB
```

**`cd apps/api/rest && npx jest`**:

```
PASS src/common/errors/domain-error.mapper.spec.ts (57.804 s)
PASS src/users/user-dto.mapper.spec.ts (58.089 s)
PASS src/types/types.service.spec.ts (58.131 s)
PASS src/categories/categories.service.spec.ts (58.073 s)
PASS src/shops/shops.service.spec.ts (58.15 s)
PASS src/products/products.service.spec.ts (57.445 s)
PASS src/tags/tags.service.spec.ts (57.841 s)
PASS src/manufacturers/manufacturers.service.spec.ts (57.629 s)
PASS src/users/users.service.spec.ts (57.853 s)

Test Suites: 9 passed, 9 total
Tests:       257 passed, 257 total
Snapshots:   0 total
Time:        71.266 s
```

Nota: la cifra "hoy 4 suites / 65 tests" de `openspec/config.yaml` y de
`proposal.md` está desactualizada frente al estado real del repo (9 suites,
257 tests: incluye `categories`, `shops`, `products`, `domain-error.mapper`,
`user-dto.mapper` además de los 4 originales). No es una regresión de esta
US ni se corrige aquí — es un dato de contexto para el cierre, fuera del
"NO incluye" congelado de la propuesta.

**`just db-up`** (recorte; contenedor ya existía, se reaplicó
`schema.sql`/`seed.sql` de forma idempotente):

```
NOTICE:  relation "tags" already exists, skipping
...
  * esquema y datos de referencia aplicados
```

**`just db-check`**:

```
npm run typecheck
> tsc --noEmit
  (sin salida — 0 errores)

npm test
> vitest run

 Test Files  10 passed (10)
      Tests  203 passed (203)
   Duration  25.38s
```

**Verificación 2.1b**:

```
$ grep -rn "users.service.ts:94" apps/api/rest/src/
(sin resultados)
```

## PR2 — `us-31-pr2-guardas-users` (Fase 3)

Pendiente al momento de este commit de apply-progress (se actualiza en el
siguiente batch de este mismo apply).

## PR3 — `us-31-pr3-docs` (Fase 5)

Pendiente.

## Fase 4 — Verificación viva

Pendiente (se ejecuta antes de redactar la Fase 5, según instrucción del
orquestador).
