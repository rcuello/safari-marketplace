# Apply Progress: Catálogos planos (`types`, `tags`, `manufacturers`, `shops`) desde Postgres — US-4a

> Ejecutado en un solo batch, en orden PR #1 → PR #2 → PR #3, sobre 3 ramas
> stacked-to-main. 45/45 tasks de `tasks.md` completadas. Commits locales
> creados por PR (sin push, regla de la sesión).

## Ramas y commits

| PR | Rama | Base | Commit |
|---|---|---|---|
| #1 | `feat/us-4a-pr1-parse-search-types` | `main` | `417251b` |
| #2 | `feat/us-4a-pr2-tags-manufacturers` | PR #1 | `bd803f8` |
| #3 | `feat/us-4a-pr3-shops-docs` | PR #2 | (este commit) |

## PR #1 — `parse-search` + `types` (135 líneas reales: 150 insertions/40 deletions)

Tasks 1.1.1–1.5.4: todas `[x]`.

- **Baseline**: `curl :9001/api/types` → 10 filas, 9 claves
  (`id,name,language,translated_languages,slug,banners,promotional_sliders,settings,icon`)
  guardado en `mock-types.json` ANTES de editar.
- **`packages/db`**: `types.repository.ts` gana `ListTypesInput { name? }` con
  `contains`/`insensitive`; `index.ts` línea 66 exporta el tipo. Suite nueva
  `types.integration.test.ts` (4 tests).
  ```
  npm run typecheck → tsc --noEmit (sin errores)
  npm test → Test Files 2 passed (2) · Tests 18 passed (18)
  ```
- **`just db-build`**: verde (`dist/index.js` 93.00 KB, `dist/index.d.ts` 941.38 KB).
- **`apps/api/rest`**: `parse-search.ts` creado; `types.service.ts` →
  `getTypes`/`getTypeBySlug` async sobre `@safari/db` + `toTypeDto` (9 claves).
- **Verificación**:
  ```
  just build-api → Done in 70.16s
  just db-check → Test Files 2 passed (2) · Tests 18 passed (18)
  ```
  Diff `mock-types.json` vs `pg-types.json` (`node -e`, plantilla de
  design.md): `filas 10->10`, `claves 9->9`, `mismo orden: true`,
  `faltan: []`, `sobran: []`. Únicas divergencias de valor: `promotional_sliders`
  → `null` (V-8, esperado) y `translated_languages` de `books`
  (`["en","de"]`→`["en"]`, V-9, esperado). El resto de diffs reportados por el
  diff (`banners`/`settings`) son reordenamientos de claves DENTRO del JSONB
  (mismo valor, mismo dato) — artefacto de cómo Postgres serializa jsonb, no
  una divergencia de contrato.
  ```
  curl :9001/api/types/gadget       → 200
  curl :9001/api/types/no-existe-xyz → 404
  {"statusCode":404,"message":"No existe un type con slug `no-existe-xyz`.","error":"Not Found"}
  curl :9001/api/types?search=name:gadget → 1 fila (gadget)
  ```

## PR #2 — `tags` + `manufacturers` (333 insertions/59 deletions)

Tasks 2.1.1–2.5.4: todas `[x]`.

- **Baseline**: `curl :9001/api/tags?limit=100` → 10/9, `/manufacturers?limit=30`
  → 14/13, `/top-manufacturers?limit=10` → 10/13, capturados ANTES de editar.
- **`packages/db`**: `tags.repository.ts` gana `name?` + `orderBy: {id:'desc'}`
  (Decisión D); `manufacturers.repository.ts` gana `name?` (orderBy asc
  intacto). Dos suites nuevas.
  ```
  npm run typecheck → sin errores
  npm test → Test Files 4 passed (4) · Tests 29 passed (29)
  ```
- **`just db-build`**: verde.
- **`apps/api/rest`**: `tags.service.ts`/`manufacturers.service.ts` migrados,
  `console.log` de depuración eliminados, `type` anidado resuelto vía
  `Map<number,TypeRecord>` de un `listTypes()` en paralelo.
- **Bug encontrado y corregido en el mismo batch**: `getTopManufactures`
  devolvía 500 (`{"statusCode":500,"message":"Ocurrió un error inesperado..."}`).
  Causa: `ValidationPipe` no transforma — `limit` llega como `string`;
  `Array.prototype.slice` (código viejo) lo coercía en silencio, pero
  `Prisma`'s `take` exige `number` real y lanzaba. Corregido con
  `Number(limit) || 10` (mismo criterio que `parseFiniteNumber` de
  `products.service.ts`, US-2). Verificado limpio tras el fix.
- **Verificación**:
  ```
  just build-api → Done in 48.12s (+ segundo build tras el fix de getTopManufactures)
  just db-check → Test Files 4 passed (4) · Tests 29 passed (29)
  ```
  Diff `tags`: `filas 10->10`, `claves 9->9`, `mismo orden: true`, `ids
  62,61,...,53` en ambos lados (orden desc preservado, D). `total`/`count`
  reales (10/10, V-13). Única divergencia de valor no declarada explícitamente
  en design.md: `image: [] -> null` en las 10 filas — verificado con `psql`
  (`SELECT image FROM tags`) que la columna es genuinamente `NULL` en el seed;
  es un hecho de los datos, no un bug de mapeo (documentado también en el DoD
  de la US).
  Diff `manufacturers`: `filas 14->14`, `claves 13->13`, `mismo orden: true`.
  Divergencias: `products_count`→`0` (V-1, 14/14 mock traía 3-20),
  `socials`→`[]` (V-2), `cover_image`→`null` (V-3). `image`/`socials` con
  reordenamiento interno de jsonb (no divergencia real).
  ```
  curl :9001/api/tags/62 → 404 (V-21, mock devolvía 200)
  curl :9001/api/tags?search=name:baby&limit=100      → [baby-growth, baby-milk]
  curl :9001/api/manufacturers?search=name:publication&limit=30 → total 9
  curl :9001/api/manufacturers?limit=30 primeros 3 slugs → too-cool-publication, jeremy-publications, wonder-publications
  ```

## PR #3 — `shops` + cierre documental (este commit)

Tasks 3.1.1–3.6.3: todas `[x]`.

- **Baseline**: `curl :9001/api/shops?limit=30` → 9/16 guardado en
  `mock-shops.json` ANTES de editar.
- **`packages/db`**: `shops.repository.ts` gana `name?`, `orderBy:
  {id:'desc'}` (Decisión D), y `_count` filtrado
  (`status:'publish',visibility:'visibility_public'`) en **`listShops` Y
  `findShopBySlug`** (Decisión E — el detalle también lo necesita o pierde
  la clave `products_count`). `records.ts` gana `ShopRecord.productsCount?`.
  Suite nueva `shops.integration.test.ts` (6 tests).
  ```
  npm run typecheck → sin errores
  npm test → Test Files 5 passed (5) · Tests 35 passed (35)
  ```
- **`just db-build`**: verde.
- **`apps/api/rest`**: `shops.service.ts` — solo `getShops`/`getShop`
  migrados; `getNewShops`/`getStaffs`/`getNearByShop`/`approveShop`/
  `disapproveShop`/`update`/`remove`/`create` intactos sobre el mock.
- **Verificación**:
  ```
  just build-api → Done in 62.47s
  just db-check → Test Files 5 passed (5) · Tests 35 passed (35)
  ```
  Diff `shops`: `filas 9->12` (CA-3), `claves 16->16`, `mismo orden: true`.
  3 filas nuevas: id 15 `tetetetet`, id 14 `launchidea`, id 12 `noaw`.
  Divergencias en las 9 originales: `owner`→`null` (V-4), `orders_count`→`0`
  (V-5), `created_at`/`updated_at`→hora real de `db-up` (V-7), y
  `makeup-shop` (id 4) `products_count` 81→82 (Decisión E: el mock se
  equivoca, Postgres cuenta bien — suma de cierre 1199 confirmada).
  `address`/`settings`/`logo`/`cover_image` con reordenamiento interno de
  jsonb (no divergencia real).

  `psql` delta 9→12 (CA-3):
  ```
   id |      slug      | recon
  ----+----------------+-------
   15 | tetetetet      | t
   14 | launchidea     | t
   12 | noaw           | t
   11 | medicine       |        ← description NULL en el seed; LIKE(NULL) = NULL, no "f" — dato, no bug
    9 | gadget         | f
    7 | books-shop     | f
    6 | grocery-shop   | f
    5 | bakery-shop    | f
    4 | makeup-shop    | f
    3 | bags-shop      | f
    2 | clothing-shop  | f
    1 | furniture-shop | f
  (12 rows)
  ```

  Detalle vs listado:
  ```
  curl :9001/api/shops/gadget: claves 16 16 | idéntico: true | products_count: 44
  curl :9001/api/shops/no-existe-xyz → 404 {"statusCode":404,"message":"No existe una tienda con slug `no-existe-xyz`.","error":"Not Found"}
  curl :9001/api/shops?search=name:gadget&limit=30 → [gadget]
  curl :9001/api/shops?search=is_active:1&limit=30 → total 12
  ```

  Postgres caído / arriba:
  ```
  just db-down
  types 503 · tags 503 · manufacturers 503 · shops 503 · top-manufacturers 503
  settings 500   ← DESVIACIÓN vs design.md (esperaba 200). settings.service.ts
                   (US-1, fuera de alcance) no envuelve getSettings() en el
                   patrón isPrismaConnectionError; el error se propaga y Nest
                   lo convierte en 500 por defecto filter. El proceso siguió
                   vivo (el propio 500 lo prueba — no hubo timeout/ECONNREFUSED),
                   que es lo que el criterio de aceptación pide en sustancia.
                   No se tocó settings.service.ts: fuera de alcance de esta US.
  just db-up → datos intactos (12 shops, incl. las 3 reconstruidas)
  ```

  `just verify`:
  ```
  OK   API    :9001/api/settings  200  5503B  319ms
  OK   Shop   :3003/en  200  201498B  50815ms  cards:30
  OK   Admin  :3002/en/login  200  72821B  100890ms  cards:1
  ```
  CA-4 adicional:
  ```
  curl :3003/en/gadget      | grep -c product-card → 1
  curl :3003/en/shops       | grep -c gadget        → 1
  curl :3003/en/shops/gadget | grep -ci products     → 1
  ```

- **Cierre documental**: `docs/product/1-catalogo-desde-postgres/4-migrar-catalogos-apoyo.md`
  reescrito a US-4a (Status: Implementada, LOC ~590, scope sin `categories`,
  DoD con toda la evidencia de arriba); `README.md` del épico con fila US-4a
  (Implementada) + US-4b (Pendiente) y "Orden sugerido" actualizado;
  `docs/product/README.md` línea 196 → `US-2, US-3, US-4a, US-4b`.

## Divergencias/hallazgos NO previstos en el design, documentados en el DoD

1. `getTopManufactures` 500 por coerción de `limit` (bug real, corregido en
   PR #2 — ver arriba).
2. `tags.image: [] -> null` en 10/10 filas (dato del seed, no bug — ver PR #2).
3. `settings` responde 500 (no 200) con la base caída (código pre-existente
   de US-1, fuera de alcance de esta US — ver PR #3).
4. `psql` del delta: fila `medicine` (id 11) muestra `recon` en blanco (NULL)
   en vez de `f` porque su `description` es NULL en el seed y `LIKE` sobre
   NULL da NULL — semánticamente sigue siendo "no reconstruida", solo cambia
   cómo psql lo imprime.

Ninguno de los 4 requirió tocar `db/schema.sql`, `packages/db/prisma/schema.prisma`
ni el scope declarado fuera de límites (`categories`, endpoints de escritura,
`GET /staffs`, etc.).

## Estado final

45/45 tasks completadas. Los 3 PRs verificados de punta a punta,
independientemente, en el orden de la cadena. Listo para `sdd-verify`.
