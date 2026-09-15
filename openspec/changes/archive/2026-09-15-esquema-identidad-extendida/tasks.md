# Tasks: US-41 — Esquema y capa de datos de identidad extendida

## Review Workload Forecast

| Área | Adds | Dels | Total | Base del cálculo |
|---|---|---|---|---|
| DDL (`db/schema.sql`, bloque + índice tras `:435`/`:474`) | 61 | 0 | 61 | bloque SQL exacto del design (comentarios + 2 `CREATE TABLE`) + índice |
| `db/generate-seed.mjs` (6 cambios) | 41 | 5 | 46 | const+comentario(3) + validaciones(15) + emisión become_seller(9) + emisión shop_staff(10) + resumen(4/5) |
| `db/seed.sql` (regenerado, no editado a mano) | 10 | 0 | 10 | 2 bloques `INSERT`; los literales `jsonb` son largos pero cuentan 1 línea de diff cada uno |
| `db/README.md` (subsección tras `:83`) | 18 | 0 | 18 | modelo nuevo, calco de la subsección de "Identidad" existente |
| `packages/db/prisma/schema.prisma` (re-introspección) | 30 | 0 | 30 | 2 modelos nuevos (~12 líneas c/u) + 2 back-relations; el resto se reaplica contra la copia `.pre`, sin shortcut de `git checkout --` (D-1 del design lo prohíbe aquí) |
| `packages/db/src/records.ts` (2 imports, 2 interfaces, 2 mappers) | 32 | 0 | 32 | interfaces ~7 líneas c/u, mappers ~7 líneas c/u, imports 2 |
| `packages/db/index.ts` (barrel) | 2 | 0 | 2 | 2 tipos en el bloque alfabetizado, cero `export {` nuevo |
| Citas (`manufacturers.repository.ts:196`, `tags.repository.ts:170`) | 2 | 2 | 4 | recita de comentario, 1 línea cada archivo |
| Tests (2 archivos NUEVOS, no ampliación de existentes) | 270 | 0 | 270 | boilerplate completo por archivo (imports, fixtures, sentinelas, `beforeAll`/`afterAll`) ~45-50 líneas c/u + 13 tests (~12-20 líneas c/u según complejidad del assert) |
| **Total ingenuo (bottom-up)** | **~466** | **~7** | **~473** | ya por encima del budget de 400 sin aplicar sesgo |

**Ajuste por sesgo medido del repo**: Épico 26 sobrepasó ×2.0–×4.6 su estimación
inicial; US-32 forecast 241 y aterrizó en 422 (×1.75). Aplicando ese rango al
cálculo ingenuo de ~473 líneas, el aterrizaje realista cae en **700-950**,
consistente con el piso del forecast del design (700-1400). El extremo alto
(1400) es alcanzable si la re-introspección de Prisma reformatea más campos de
los 15 modelos existentes de lo asumido aquí (D-1 del design prohíbe el atajo
`git checkout --` para este paso, así que cualquier reformateo real del pull
se vuelve diff commiteado en vez de descartarse). No se recorta esta cifra
para caber bajo 400, ni se infla más allá de lo que el design ya declaró.

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

El design señala una costura natural (DDL+seed+rebuild+introspección vs.
capa de datos+tests) y pide evaluar si es realmente entregable por separado.
Lo es: la Fase 1-4+6 deja tablas creadas, sembradas, introspeccionadas
—con 11 de los 13 tests de esquema ya verificándolas vía Prisma directo, sin
necesitar `records.ts`— y es revertible sola (`git checkout -- db/
packages/db/prisma/schema.prisma` + `just db-reset`). Es el mismo patrón
"schema primero, capa de datos después" que ya nombran las capabilities
espejo `identity-schema`/`identity-data-layer` citadas en `proposal.md`. La
mitad de datos (Fase 5+7+8) no puede existir sin la primera, pero eso es
dependencia de orden, no acoplamiento que impida el split.

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DDL + seed generator + rebuild + re-introspección + mantenimiento de citas + tests 1-6,7-11 (esquema, sin mappers) | PR 1 | Base = tracker/feature branch o `main` según la estrategia elegida; entregable y verificable solo (psql + `just db-check` con las 2 suites en modo "solo Prisma") |
| 2 | `records.ts` + mappers + barrel + tests 12-13 (mappers) + verificación final completa (`just db-check`, `npx jest`, `just build-api`, `just verify`) | PR 2 | Base = PR 1 (feature-branch-chain) o `main` tras merge de PR 1 (stacked-to-main); depende por completo de que PR 1 ya exista |

`ask-on-risk` es la delivery_strategy recibida ⇒ el orquestador debe preguntar
al dueño qué `chain_strategy` usar (`stacked-to-main` | `feature-branch-chain`
| `size:exception`) antes de `sdd-apply`.

## Phase 1: DDL (`db/schema.sql`)

- [x] 1.1 Insertar el bloque de dos tablas (texto exacto de `design.md`
  "Texto exacto del bloque") entre `:435` (el `);` de `product_tag`) y `:438`
  (banner de Índices), con las dos líneas en blanco de separación del archivo.
  Traces: `extended-identity-schema` "Pivote `shop_staff` bare, sin columna de
  rol" (CA-1) y "Singleton `become_seller` con dos columnas jsonb" (CA-2).
- [x] 1.2 Insertar `shop_staff_tienda_idx ON shop_staff (shop_id)` tras `:474`
  (fin del bloque de índices, antes del comentario de política `:477-487`).
  NO tocar `:13-16` ni `:477-487`. Traces: mismo requirement (CA-1) +
  "Sin trigger de `updated_at`" (CA-3, ninguna tabla lleva trigger).
  Falla ⇒ `git checkout -- db/schema.sql`.

## Phase 2: Seed generator (`db/generate-seed.mjs`, 6 cambios)

- [x] 2.1 Tras `:34`: `const becomeSeller = leer('become-seller');`.
- [x] 2.2 Tras `:81`: `const staffAsignaciones = [{user_id:2,shop_id:1},
  {user_id:2,shop_id:2},{user_id:3,shop_id:1}]` + comentario de por qué esas
  3 (usuario 1 excluido, dueño de las 12 tiendas).
- [x] 2.3 Tras `:133`: las 4 validaciones del design (FK de `user_id`/
  `shop_id`, dueño-vs-staff, par duplicado, forma de `become-seller`) en el
  estilo de `:123-133`, empujando a `problemas`.
- [x] 2.4 **[la trampa de anidamiento]** Tras `:181` (cierre del `L.push` de
  `settings`): emitir `become_seller` con `json(becomeSeller.page_options.
  page_options)` — **DOS niveles**, NO `becomeSeller.page_options` a secas
  (eso fosilizaría `created_at` del mock en el `jsonb`). `commissions` sale de
  `becomeSeller.commissions`; `language` de
  `becomeSeller.page_options.language ?? 'en'`. `ON CONFLICT (id) DO UPDATE
  SET` de las 3 columnas. Traces: "Singleton `become_seller`..." (CA-2).
- [x] 2.5 Tras `:279` (cierre del `L.push` de `shops` — orden obligatorio,
  `shop_staff` referencia `shops`): emitir `shop_staff` desde
  `staffAsignaciones`, calco de `permission_user` (`:249-258`), `ON CONFLICT
  (user_id, shop_id) DO NOTHING;`.
- [x] 2.6 Actualizar el resumen en `:165-167` y `:426-430`: `+1 become_seller`,
  `+3 shop_staff`. Traces: "Seed determinista de staff..." (CA-5).
  Falla ⇒ el script aborta listando `problemas`; corregir y repetir.

## Phase 3: Rebuild + verificación de conteos

- [x] 3.1 `just db-seed-generate` (regenera `db/seed.sql`; NO editarlo a
  mano).
- [x] 3.2 `just db-reset` — **un solo comando** (ya invoca `db-up`,
  `justfile:322-324`). Destructivo, autorizado por el dueño 2026-09-15 solo
  para esta US.
- [x] 3.3 `psql`: conteos vivos intactos — categories 198 (83 raíces), shops
  12, users 3, products 1200. Traces: "Los conteos vivos no cambian".
- [x] 3.4 `psql`: `shop_staff` = 3 filas, pares exactos `(2,1),(2,2),(3,1)`,
  ninguna con `user_id=1`; `become_seller` = 1 fila,
  `jsonb_array_length(commissions) = 2`.
- [x] 3.5 `psql`: `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal` =
  0 (CA-3).
  **STOP**: cualquier conteo que no cuadre — no continuar; repetir o revertir
  las Fases 1-2.

## Phase 4: Re-introspección

- [x] 4.1 Precondición: `git status --porcelain
  packages/db/prisma/schema.prisma` vacío (commit/stash si no); copiar el
  archivo a `<scratchpad>/schema.prisma.pre`.
- [x] 4.2 `cd packages/db && npx prisma db pull`.
- [x] 4.3 Capturar el `git diff packages/db/prisma/schema.prisma` completo
  (17 modelos esperados: 15 existentes + 2 nuevos).
- [x] 4.4 Clasificar el diff: **cosmético** (cabecera `:1-29`, banner
  `:225-231`, snake_case sin `@@map`, campos sin `@map`, `previewFeatures`
  ausente, `datasource` con `url` re-añadida) → re-aplicar; **esperado en
  este change** (`model ShopStaff`, `model BecomeSeller`, 2 back-relations en
  `User` `:243-246` y `Shop` `:84-85`) → conservar; **semántico → STOP**
  (tipo de campo distinto en cualquiera de los 15 modelos, `@@map`/`@map`
  irrestaurable, `@unique` nuevo en `User.email`, índice parcial de
  `products` degradado a total, modelo distinto de los 2 esperados
  apareciendo/desapareciendo) → no aceptar el archivo, reportar como
  bloqueante. **El atajo `git checkout --` de US-32 NO aplica aquí**: lo que
  se perdería es la evidencia del pull ya clasificada, no solo
  reformateo — la restitución es la copia `.pre`.
- [x] 4.5 Reaplicar contra la copia `.pre`: cabecera, `previewFeatures`,
  `datasource` sin `url`, PascalCase + `@@map` en los 15 modelos, camelCase +
  `@map` en los campos, `User.email` sin `@unique`, banner `:225-231`.
- [x] 4.6 Escribir a mano los 2 modelos nuevos tras `OtpCode` (`:309-319`)
  bajo banner `// Identidad extendida (US-41)`: `ShopStaff` (`@@id([userId,
  shopId])`, `@@index([shopId], map: "shop_staff_tienda_idx")`,
  `@@map("shop_staff")`) y `BecomeSeller` (`@id @default(1) @db.SmallInt`,
  `@@map("become_seller")`), texto exacto del design; añadir las 2
  back-relations (`staffShops ShopStaff[]` en `User`, `staff ShopStaff[]` en
  `Shop`). Traces: `extended-identity-data-layer` "Modelos introspectados con
  los renombres manuales del par nuevo" (CA-4), ambos scenarios.
- [x] 4.7 Pegar el diff clasificado como evidencia en el reporte de verify.
- [x] 4.8 `just db-build`.
  Falla ⇒ `git checkout --` solo de `schema.prisma`, restaurar desde `.pre`,
  repetir.

## Phase 5: Data layer (`packages/db/src/records.ts`, `packages/db/index.ts`)

- [x] 5.1 Imports de tipo en `:20-31` (orden alfabético, `organizeImports` de
  biome): `BecomeSeller` antes de `Category`, `ShopStaff` entre `Shop` y
  `Tag`.
- [x] 5.2 `ShopStaffRecord` tras `PermissionRecord` (`:166-172`): `userId`,
  `shopId`, `createdAt` — sin `updatedAt`. Traces: `extended-identity-schema`
  CA-1 + `extended-identity-data-layer` scenario "ShopStaffRecord no declara
  updatedAt".
- [x] 5.3 `BecomeSellerRecord`, justo después: `id`, `pageOptions`/
  `commissions` como `Prisma.JsonValue`, `language`, `createdAt`,
  `updatedAt`.
- [x] 5.4 `_toShopStaffRecord` tras `_toPermissionRecord` (`:295-303`):
  `userId`/`shopId` vía `_id()`, `createdAt` directo. Traces: scenario "Los
  ids del pivote cruzan como number".
- [x] 5.5 `_toBecomeSellerRecord`: `id` **copiado directo, sin `_id()`**
  (smallint → Int; precedente `_toSettingRecord`, `:180`), resto directo.
  Traces: scenario "BecomeSellerRecord conserva ambas colecciones jsonb sin
  fusionarlas".
- [x] 5.6 `packages/db/index.ts`: añadir `ShopStaffRecord` y
  `BecomeSellerRecord` al bloque alfabetizado `export type { … } from
  './src/records'` (`:30-40`) — `BecomeSellerRecord` antes de
  `CategoryRecord`, `ShopStaffRecord` entre `ShopRecord` y `TagRecord`.
  Ninguna línea `export {` nueva. Traces: "Exportación por el barrel del
  paquete" (CA-4), ambos scenarios.
- [x] 5.7 `just db-build`.
  Falla ⇒ `git checkout --` de ambos archivos.

## Phase 6: Mantenimiento de citas

- [x] 6.1 `apps/api/rest/src/manufacturers/manufacturers.repository.ts:196`:
  re-citar `db/schema.sql:477-487` (verificar el número de línea real tras
  las Fases 1-2 antes de editar). Comment-only.
- [x] 6.2 `apps/api/rest/src/tags/tags.repository.ts:170`: mismo cambio.
  Sin esto el diff embarca dos citas colgantes (consecuencia declarada de
  D-1).

## Phase 7: Tests

- [x] 7.1 Crear `packages/db/src/repositories/shop-staff.integration.test.ts`:
  tiendas centinela prefijo `zz-tiendas-staff-` (barridas por el
  `cleanupSentinel` de `shops.integration.test.ts:38-41`), usuarios en
  dominio `@shop-staff-integration.test`, `ownerId: 3` en las tiendas
  centinela (nunca el usuario centinela — `shops.owner_id` es `ON DELETE
  RESTRICT`, `db/schema.sql:236`).
- [x] 7.2 Test 1 (seed determinista, PRIMERO del archivo): `prisma.shopStaff
  .count()` = 3 antes de crear ninguna fila propia; pares `(2,1),(2,2),(3,1)`,
  ninguno con `userId` 1.
- [x] 7.3 Test 2 (idempotencia): `prisma.shopStaff.upsert({ where:
  { userId_shopId }, create, update: {} })` dos veces → `not.toThrow()`,
  `count` del par = 1 (forma de `grantPermission`,
  `users.repository.ts:368-388`).
- [x] 7.4 Test 3: un usuario, dos tiendas — 2 filas mismo `userId` coexisten.
- [x] 7.5 Test 4: cascada de tienda — `prisma.shop.delete` → pivote a 0,
  usuario vivo.
- [x] 7.6 Test 5: cascada de usuario — `prisma.user.delete` → pivote a 0,
  tienda viva.
- [x] 7.7 Test 6: sin rol/`updated_at`/trigger — `$queryRaw` (tagged
  template) a `information_schema.columns` → exactamente `{user_id,
  shop_id, created_at}`; `pg_trigger WHERE NOT tgisinternal AND tgrelid =
  'shop_staff'::regclass` = 0.
- [x] 7.8 Test 12 (mapper): `_toShopStaffRecord(fila)` → `typeof userId`/
  `shopId === 'number'`, sin `updatedAt`, `JSON.stringify(...)` no lanza.
  Añadido en `shop-staff.integration.test.ts`, antes del `describe` de
  tripwire final.
- [x] 7.9 Crear
  `packages/db/src/repositories/become-seller.integration.test.ts`.
- [x] 7.10 Test 7: singleton — `prisma.becomeSeller.count()` = 1, `id` = 1.
- [x] 7.11 Test 8: CHECK — `prisma.$executeRaw` **tagged template, sentencia
  100% literal sin interpolación**: `INSERT INTO become_seller (id,
  page_options, commissions) VALUES (2, '{}'::jsonb, '[]'::jsonb)` →
  `rejects.toThrow(/become_seller_fila_unica/)`.
- [x] 7.12 Test 9: `Object.keys(row.pageOptions as Record<string, unknown>)`
  longitud 24 (incl. `defaultCommissionRate`); `(row.commissions as
  unknown[])` longitud 2; ninguno anidado en el otro.
- [x] 7.13 Test 10: `updatedAt.getTime() === createdAt.getTime()`.
- [x] 7.14 Test 11: `pg_trigger` sobre `become_seller` = 0.
- [x] 7.15 Test 13 (mapper): `_toBecomeSellerRecord(fila)` → `pageOptions` y
  `commissions` como valores sueltos. Añadido en
  `become-seller.integration.test.ts`.
- [x] 7.16 Narrowing explícito (`as Record<string, unknown>` / `as
  unknown[]`, NUNCA `as any`) en los asserts `jsonb` de los tests 9, 12 y 13:
  una columna `Json` requerida genera `runtime.JsonValue`, no asignable a
  `Object.keys(o: object)` con `"strict": true`
  (`packages/db/tsconfig.json:7`); `just db-check` corre el typecheck ANTES
  de vitest (`justfile:343-345`) y pasó en verde (12 archivos / 225 tests).
  Traces: `extended-identity-schema` (CA-1, CA-2, CA-3, CA-5),
  `extended-identity-data-layer` (CA-4, ambos scenarios de mapper),
  `data-layer-clock-policy` (los 2 scenarios de `become_seller` + el
  scenario de exclusión de `shop_staff`).
  Falla ⇒ `git checkout --` de ambos archivos nuevos.

## Phase 8: Verificación

- [x] 8.1 `just db-check` — debe subir de la línea base 210 (esperado ≥ 223);
  pegar salida real. Resultado: 12 archivos / 225 tests.
- [x] 8.2 `cd apps/api/rest && npx jest` — esperado 285 (mockea `@safari/db`,
  impacto cero esperado); pegar salida real. Resultado: 9 suites / 285 tests,
  sin cambio.
- [x] 8.3 `just build-api`.
- [x] 8.4 `just verify` (requiere `api-dev`/`shop-dev`/`admin-dev`
  levantados). Los tres servicios levantados manualmente para esta
  verificación; resultado: API/Shop/Admin los 3 en verde con contenido real.
- [x] 8.5 Evidencia `psql`: cascadas (borrar tienda → pivote 0, usuario vivo;
  borrar usuario → pivote 0, tienda viva), rechazo de la CHECK de
  `become_seller`, y los conteos finales del seed (198/83, 12, 3, 1200, 3
  `shop_staff`, 1 `become_seller`). Cascadas verificadas con fixtures
  desechables dentro de una transacción con `ROLLBACK` final (sin residuo);
  `just db-reset` NO se volvió a correr (instrucción explícita del
  coordinador: el estado ya verificado no debía arriesgarse).
- [x] 8.6 `db/README.md`: subsección nueva tras `:83` (cierre de
  "Identidad") documentando `shop_staff`/`become_seller`.
- [x] 8.7 Pegar esta evidencia en la Definición de Done de
  `docs/product/40-identidad-extendida-postgres/41-esquema-identidad-extendida.md`.
