# @safari/db — la capa de datos del catálogo

Paquete **autónomo** (fuera del workspace de yarn de `apps/`) que expone el
acceso a Postgres vía Prisma 7 + `@prisma/adapter-pg`: un cliente singleton
y repositorios de **funciones planas** por agregado. Sin paso de build: los
`exports` de `package.json` apuntan directo al `.ts` fuente.

```bash
cd packages/db
npm install           # dependencias propias (NO forma parte de apps/)
npm run generate      # prisma generate → generated/prisma/client
npm run typecheck     # tsc --noEmit
npm test              # integración contra el Postgres del docker-compose
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

### Cómo lo consumirá `apps/api/rest` (paso posterior, NO hecho)

`apps/api/rest` tiene su propio `yarn install` fuera del workspace de
`apps/`, así que la vía simple es **dependencia por ruta relativa**:

```jsonc
// apps/api/rest/package.json
"dependencies": { "@safari/db": "file:../../../packages/db" }
```

Dos cosas a resolver en ese paso (deliberadamente no resueltas aquí):

1. Los `exports` apuntan a `.ts` fuente: el consumidor debe transpilar el
   paquete (en Nest: `ts-node`/SWC ya lo hacen si el paquete entra por
   `file:`; si no, añadir un paso de build aquí).
2. `DATABASE_URL` debe llegar al `.env` de la API.

El scraper Python (`services/scraper-worker`) **no** consume este paquete:
sigue hablando SQL directo. `upsertScrapedProduct` existe para cuando la
ingesta se mueva a Node, o para herramientas de administración.
