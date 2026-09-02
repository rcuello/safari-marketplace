# @safari/db — la capa de datos del catálogo

Paquete **autónomo** (fuera del workspace de yarn de `apps/`) que expone el
acceso a Postgres vía Prisma 7 + `@prisma/adapter-pg`: un cliente singleton
y repositorios de **funciones planas** por agregado.

```bash
cd packages/db
npm install           # dependencias propias (NO forma parte de apps/)
npm run build         # prisma generate + tsup → dist/ (CJS + .d.ts)
npm run typecheck     # tsc --noEmit
npm test              # integración contra el Postgres del docker-compose
npm run dev           # tsup --watch, para iterar
```

`dist/` y `generated/` están gitignored, así que tras clonar hay que
construirlos. El script `prepare` los genera en una instalación **limpia** (y
cuando otro paquete instala este por `file:`), pero **npm se salta los
lifecycle scripts si el árbol de dependencias ya está al día**: en un `npm
install` repetido no pasa nada. El comando fiable es siempre explícito:

```bash
npm run build      # o, desde la raíz del repo:  just db-build
```

Requiere la base corriendo y sembrada: `just db-up` en la raíz del repo.
La conexión sale de `DATABASE_URL` (ver `.env.example`).

## Estructura

```
index.ts                        barrel explícito (el único entry point)
prisma/schema.prisma            introspección de la base, revisada a mano
generated/                      cliente Prisma (gitignored; `npm run generate`)
src/
  client.ts                     singleton lazy de PrismaClient (adapter pg)
  clock.ts                      now() inyectable para tests
  errors.ts                     parseo/clasificación de errores de Prisma
  health.ts                     pingDatabase() para /health endpoints
  pagination.ts                 buildPaginator() — el envoltorio del mock
  records.ts                    frontera de serialización (tipos *Record)
  repositories/
    products.repository.ts      listado con filtros, detalle, upsert scraper
    categories.repository.ts    árbol y listado por type.slug
    types|shops|manufacturers|tags.repository.ts
    settings.repository.ts      la fila única
    products.integration.test.ts
```

## Decisiones

### `Decimal` y `BigInt` nunca cruzan la frontera

Los repositorios no devuelven filas crudas de Prisma sino **records**
(`src/records.ts`) que son JSON-safe por construcción:

- **`numeric(12,2)` (precios) → `number`.** El frontend de Pickbazar espera
  `price: 40.5` como número JSON, igual que lo sirve el mock. Con 12 dígitos
  y 2 decimales un double lo representa sin pérdida práctica. Si algún día
  se necesitara aritmética exacta río abajo, el punto único de cambio es
  `_dec()` en `records.ts` (pasar a `string`).
- **`bigserial` (ids) → `number`.** `JSON.stringify` revienta con BigInt y
  los ids reales están lejos de `MAX_SAFE_INTEGER`.
- Las fechas quedan como `Date`; el framework consumidor las serializa a
  ISO-8601 solo.

### Paginación: el contrato del mock, calcado

`buildPaginator()` reproduce **exactamente** la aritmética y las claves de
`apps/api/rest/src/common/pagination/paginate.ts` (`total`, `current_page`,
`count`, `last_page`, `per_page`, `firstItem`, `lastItem`, `*_page_url`) —
incluida su rareza de que `prev_page_url` apunta a la página actual — para
que la API real pueda sustituir el mock sin cambiar su contrato. Los
repositorios devuelven `{ items, total }` y el caller arma el envoltorio:

```ts
const { items, total } = await listProducts({ typeSlug: 'gadget', page, limit });
return buildPaginator({ data: items, total, page, limit, baseUrl });
```

Offset-based, `limit` default 30, como el mock. Las `*_page_url` son `null`
si no se pasa `baseUrl` (APP_URL es configuración de la app, no de la capa
de datos).

### `db/schema.sql` sigue siendo la verdad — Prisma NO migra

La base la crea y la siembra `just db-migrate` aplicando `db/schema.sql` +
`db/seed.sql`. Este paquete **no tiene `prisma/migrations/` a propósito** y
no debe tenerlo mientras ese flujo exista: dos dueños del DDL es una receta
para drift. El `schema.prisma` es un **espejo introspectado** (`prisma db
pull`), luego revisado a mano (modelos PascalCase, campos camelCase con
`@map`, relaciones con nombre). Si `db/schema.sql` cambia:

```bash
just db-reset                  # re-crea la base con el DDL nuevo
cd packages/db
npx prisma db pull             # OJO: pisa los renombres manuales
# re-aplicar renombres/@map revisando el diff, luego:
npm run generate && npm test
```

No usar `prisma migrate dev` ni `prisma db push` contra esta base.

### Lo que Prisma no modela (y cómo se cubre)

- **El índice único parcial** `products_procedencia_key`
  (`(source_store, source_product_id) WHERE source_store IS NOT NULL`) sí
  quedó en el schema, pero solo gracias al preview feature `partialIndexes`
  que la introspección de Prisma 7 activó. No quitar el preview: sin él
  Prisma trataría el unique como total. `upsertScrapedProduct` opera sobre
  esa clave y está cubierto por el test de integración.
- **Los CHECK constraints** (`products_rebaja_valida`,
  `products_simple_con_precio`, `products_procedencia_completa`) no existen
  para Prisma. Los repositorios los validan antes de escribir (tipos +
  guard de `salePrice < price`) y traducen la violación que llegue de
  Postgres a errores de dominio: `InvalidSalePriceError`,
  `MissingPriceError`, `IncompleteProvenanceError`.
- **El índice trgm** `products_nombre_trgm_idx` (expresión) tampoco: la
  búsqueda por nombre usa `contains` + `mode: 'insensitive'`, que Postgres
  resuelve con ese índice.

### Identidad (US-21, Épico 19) — `users.repository.ts`

Mismo agregado por introspección que el catálogo: `users`, `profiles`,
`permissions`, `permission_user` (sembrados por US-20) sirven ahora
`UserRecord`/`ProfileRecord`/`PermissionRecord` y siete funciones planas
en `src/repositories/users.repository.ts`. `PasswordResetToken` y
`OtpCode` entran como **modelos** de `schema.prisma` solo para que el
gate de drift cierre en 0 — sus repositorios llegan en US-24, no aquí.

**La frontera del hash es estructural, no de convención (D-2 del
épico).** `passwordHash` cruza en un único tipo, `UserCredentials`, que
vive en `users.repository.ts` y **no** en `records.ts` — así la frontera
de serialización del paquete ni siquiera nombra el campo. La única
función que lo devuelve es `findUserCredentialsByEmail`; las otras dos
escrituras (`createUser`, `updateUserPasswordHash`) lo reciben ya
hasheado. Hashear y verificar sigue siendo de `apps/api/rest` (US-22):
`bcryptjs` no entra a este paquete.

**Por qué `findUserCredentialsByEmail` usa `$queryRaw`.** `users.email`
no tiene un índice único total: la unicidad case-insensitive vive en
`users_email_lower_idx`, un índice **de expresión** sobre `lower(email)`
que Prisma no modela (como el trgm de `products`). Evidencia contra
Postgres real: ni `mode: 'insensitive'` (genera `ILIKE`) ni normalizar el
email en JS antes de un `equals` plano (genera `email = $1`) usan ese
índice — solo `WHERE lower(email) = lower($1)` explícito lo hace. Es el
único SQL crudo de dominio del paquete (el precedente ya existente es
`health.ts:21`); `${email}` interpola como parámetro del tagged
template, nunca concatenado. Cualquier consumidor nuevo que necesite
comparar por email hereda esta misma regla (`lower(email) = lower($1)`,
`identity-schema/spec.md`).

`listUsers` sigue el contrato del paquete (D-2 del proposal): devuelve
`{ items, total }`, no el envoltorio de `buildPaginator` — el caller
(el servicio de Nest de US-25) arma el envoltorio con su `baseUrl`.
`createUser` traduce el P2002 del email duplicado a `DuplicateEmailError`
(el índice que lo dispara es de expresión, invisible para Prisma, así
que el código crudo no basta); `updateUserPasswordHash`/`setUserActive`
traducen P2025 a `null`.

### Cómo lo consumirá `apps/api/rest` (paso posterior, NO hecho)

`apps/api/rest` tiene su propio `yarn install` fuera del workspace de
`apps/`, así que la vía simple es **dependencia por ruta relativa**:

```jsonc
// apps/api/rest/package.json
"dependencies": { "@safari/db": "file:../../../packages/db" }
```

Queda una sola cosa por resolver: **`DATABASE_URL` debe llegar al `.env` de la
API**.

## Por qué este paquete se construye (y el de referencia no)

`agenthub-platform/packages/db` no tiene build: sus `exports` apuntan al `.ts`
fuente y funciona, porque sus consumidores son apps Next.js, que bundlean con
SWC y transpilan dependencias.

Aquí el consumidor es **NestJS 9, que compila con `tsc` a secas**, y `tsc` no
transpila archivos que resuelve dentro de `node_modules`: los typechequea y los
deja intactos. Sin build, esto pasa:

```
$ tsc            # exit 0, ni una queja
$ node dist/main.js
SyntaxError: Unexpected token 'export'
   at loadESMFromCJS (node:internal/modules/cjs/loader)
```

La brecha es sutil y merece entenderla: **el compilador que typechequea ignora
el campo `exports` y el runtime que ejecuta lo respeta.** El `tsc` de la API no
declara `moduleResolution`, así que usa resolución `node10`, que no lee
`exports`; al no encontrar `main` ni `types` cae a su fallback de directorio,
localiza `index.ts` y typechequea contra el fuente sin protestar. Node, en
cambio, sí resuelve `exports`, carga el `.ts` y revienta.

De ahí tres detalles del `package.json` que no son decorativos:

- **`main` y `types` en el nivel superior**, no solo dentro de `exports`. Con
  resolución `node10` los `exports` se ignoran; sin `main`/`types` la API
  volvería a leer el `.ts` fuente.
- **Solo formato CJS.** El paquete exporta un singleton con estado (el cliente
  de Prisma): emitir CJS y ESM a la vez abre el *dual package hazard*, con dos
  clientes y dos pools de conexiones. Añadir `'esm'` es una línea en
  `tsup.config.ts` si algún día Next.js consume el paquete directamente.
- **`shims: true` en tsup.** El cliente generado por Prisma 7 arranca con
  `globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))`, y
  `import.meta` no existe en CommonJS: esbuild lo sustituye por un objeto vacío
  y `fileURLToPath(undefined)` lanza un `TypeError` **al cargar el módulo**. El
  build sale en verde y el artefacto no arranca. El shim lo resuelve.

El scraper Python (`services/scraper-worker`) **no** consume este paquete:
sigue hablando SQL directo. `upsertScrapedProduct` existe para cuando la
ingesta se mueva a Node, o para herramientas de administración.
