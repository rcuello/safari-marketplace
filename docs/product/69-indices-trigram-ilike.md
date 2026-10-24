# US-69 — Los índices trigram que el `ILIKE` de Prisma no usa

> La búsqueda por nombre de productos y por texto de preguntas se escribe con
> `contains` + `mode: 'insensitive'`, que Prisma traduce a `ILIKE`. Los dos
> índices trigram existen, pero están definidos sobre `lower(columna)`, así
> que el `ILIKE` no los usa nunca: cada búsqueda recorre la tabla entera. Con
> los 1200 productos del seed no se nota; con el catálogo que el scraper va a
> añadir, sí.

**Épico:** ninguno (US standalone). Nace de la nota de índices de
[US-55](./46-api-sin-mocks-json/55-questions-postgres.md).
**Fecha:** 2026-10-22
**Status:** ✅ Completada (2026-10-23), opción (a)
**Depende de:** US-55 (crea `questions_question_trgm_idx`). Toca
`db/schema.sql` y `packages/db/prisma/schema.prisma`, compartidos con el
Épico 46, así que **no puede ir en paralelo** con ninguna US de ese épico
(R-2). Necesita `just db-reset`, que para una US standalone requiere
**autorización explícita del dueño**: la del Épico 46 no se hereda.
**LOC est.:** ~200

## Historia

**Como** cliente que busca un producto en el shop, y como el scraper que va a
multiplicar el catálogo, **quiero** que la búsqueda por texto use el índice
que ya existe para eso, **para** que buscar no recorra la tabla entera a
medida que crece.

## Contexto — verificado en código y en la base (2026-10-22)

**Cómo se busca hoy:**

- `packages/db/src/repositories/products.repository.ts:219`: `name: {
  contains: input.name, mode: 'insensitive' }`. Es la búsqueda principal del
  shop (`search=name:<texto>`).
- `packages/db/src/repositories/questions.repository.ts:100`: `question: {
  contains: …, mode: 'insensitive' }` (US-55).
- Prisma traduce `contains` + `insensitive` a `columna ILIKE '%texto%'`.

**Los índices** (`db/schema.sql`):

- `products_nombre_trgm_idx ON products USING gin (lower(name) gin_trgm_ops)`;
- `questions_question_trgm_idx ON questions USING gin (lower(question)
  gin_trgm_ops)` (US-55, copiado del anterior).

Los dos son **índices de expresión** sobre `lower(...)`. Un índice de expresión
solo sirve a consultas que usan **la misma expresión**, y `ILIKE` sobre la
columna no la usa.

**`EXPLAIN` sobre `products`** (1200 filas, seed en reposo):

| Consulta | Plan |
|---|---|
| `name ILIKE '%phone%'` | `Seq Scan on products … Filter: (name ~~* '%phone%')` |
| ídem con `enable_seqscan = off` | **sigue** `Seq Scan` (coste `10000000000…`): el índice no es aplicable |
| `lower(name) LIKE '%phone%'` | `Bitmap Index Scan on products_nombre_trgm_idx` |

En `questions` pasa exactamente lo mismo; US-55 lo midió y lo dejó anotado.

**Prueba con un índice sobre la columna** (`gin (name gin_trgm_ops)`, sin
`lower`), creado dentro de una transacción con `ROLLBACK`:

| Consulta | Plan |
|---|---|
| `name ILIKE '%phone%'`, **sin** forzar nada | `Bitmap Index Scan on tmp_products_name_trgm`; `actual time 0.323 ms`, 3 filas |
| `name ILIKE '%ph%'` (2 caracteres), con `enable_seqscan = off` | usa el índice, pero con coste `24963`, frente a `91` del `Seq Scan` |

`pg_trgm` resuelve el `ILIKE` con `gin_trgm_ops` sobre la columna, así que no
hace falta `lower()`: el trigrama ya es insensible a mayúsculas.

**Cómo lo ve Prisma** (`prisma db pull --print` con ese índice creado y
borrado después; la base quedó sin cambios):

- el índice sobre columna **sí** se modela:
  `@@index([name(ops: raw("gin_trgm_ops"))], map: "…", type: Gin)`;
- los de expresión aparecen en la lista de «not supported by Prisma Client»,
  y por eso hoy viven solo en `db/schema.sql` y en la cabecera de
  `schema.prisma`.

## Opciones evaluadas

| Opción | Qué cambia | A favor | En contra |
|---|---|---|---|
| **(a) Índices sobre la columna** | `gin (name gin_trgm_ops)` y `gin (question gin_trgm_ops)` en lugar de los de `lower(...)` | Las consultas no cambian: el `ILIKE` de Prisma empieza a usar el índice. Prisma lo modela, así que deja de ser una excepción de la cabecera | Requiere `db-reset` (el DDL solo crea con `IF NOT EXISTS`, no reemplaza) y añadir el `@@index` a `schema.prisma` para que `migrate diff` siga en `EXIT=0` |
| (b) `$queryRaw` con `lower() LIKE` | Las dos búsquedas pasan a SQL a mano | No toca el DDL | `listProducts` combina el texto con 10 filtros más (type, categoría, tienda, precio, estado…): habría que reescribir su `where` en SQL, perder el tipado de Prisma y duplicar lógica. Lo mismo, en menor escala, en `listQuestions` |

**Recomendación: (a).** Arregla la causa (el índice no corresponde a la
consulta) sin tocar ningún repositorio, y además saca los dos índices de la
lista de excepciones de Prisma.

## Scope

**Incluye:**

- reemplazar en `db/schema.sql` los dos índices de expresión por índices gin
  trigram sobre la columna, con el comentario del motivo;
- añadir los dos `@@index(..., type: Gin)` a `schema.prisma` (por
  introspección) y quitar los dos índices de la lista de la cabecera;
- un test de integración que compruebe con `EXPLAIN` que la búsqueda usa el
  índice, para que una regresión del índice se vea en `just db-check`;
- actualizar `db/README.md`, `packages/db/README.md` y los comentarios que
  hablan del índice en los dos repositorios.

**NO incluye:**

- cambiar las consultas de los repositorios (con la opción (a) no hace falta);
- búsquedas de menos de 3 caracteres: no hay trigramas que extraer, así que el
  planificador elige `Seq Scan`, que es lo correcto (ver Notas);
- otros índices de expresión que Prisma tampoco modela
  (`users_email_lower_idx`, `reviews_autor_producto_orden_key`): esos sí
  corresponden a su consulta;
- búsqueda por relevancia o *full text search*;
- tocar frontends.

## Criterios de aceptación

### CA-1 — El `ILIKE` usa el índice

Tras `just db-reset`, sin forzar nada en el planificador:

- `EXPLAIN SELECT id FROM products WHERE name ILIKE '%phone%'` muestra un
  `Bitmap Index Scan` sobre el índice nuevo de `products`;
- `EXPLAIN SELECT id FROM questions WHERE question ILIKE '%apple%'` muestra
  un `Bitmap Index Scan` sobre el índice nuevo de `questions`, **al menos**
  con `enable_seqscan = off` (con 68 filas el planificador puede preferir el
  `Seq Scan`, y eso no es un fallo).

### CA-2 — Los resultados no cambian

Las mismas búsquedas devuelven las mismas filas, en el mismo orden, antes y
después:

- `GET /api/products?search=name:<texto>` para al menos dos textos, uno de
  ellos con mayúsculas;
- `GET /api/questions?product_id=1&search=question:apple`, que debe seguir
  dando 34, 31 y 26 (CA-3 de US-55).

Se comparan con `node -e` contra una línea base capturada antes del cambio.

### CA-3 — Prisma sin drift

- `prisma validate` en verde.
- `migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma
  --exit-code` → `EXIT=0`.
- La cabecera de `schema.prisma` ya no lista `products_nombre_trgm_idx` ni
  `questions_question_trgm_idx` como índices no modelados.

### CA-4 — La regresión se detecta

Un test de integración ejecuta el `EXPLAIN` de CA-1 sobre `products` y falla
si el plan no usa el índice. Se comprueba que falla quitando el índice a mano
en una base de prueba, o se razona en el reporte por qué no se pudo.

### CA-5 — Sin regresión

`just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
recuentos. `/api/settings` sigue en 5503 B.

## Escenarios Gherkin

```gherkin
Feature: La busqueda por texto usa su indice
  Scenario: CA-1 — el ILIKE de productos usa el indice trigram
    Given la base recreada con los indices sobre la columna
    When se explica SELECT id FROM products WHERE name ILIKE '%phone%'
    Then el plan es un Bitmap Index Scan sobre el indice de products

  Scenario: CA-2 — buscar devuelve lo mismo que antes
    Given la linea base de GET /api/products?search=name:phone
    When se repite la busqueda tras el cambio
    Then el cuerpo es deep-equal a la linea base
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | los dos índices pasan a `gin (columna gin_trgm_ops)`, con su comentario |
| `packages/db/prisma/schema.prisma` | `@@index(..., type: Gin)` en `Product` y `Question`; cabecera sin los dos índices |
| `packages/db/src/repositories/products.integration.test.ts` (o uno nuevo) | el `EXPLAIN` de CA-4 |
| `packages/db/src/repositories/products.repository.ts`, `questions.repository.ts` | solo comentarios |
| `db/README.md`, `packages/db/README.md` | el índice y por qué va sobre la columna |

## Definición de Done

- [x] Autorización del dueño para `just db-reset` pegada en el reporte.
- [x] Línea base antes del cambio: los `EXPLAIN` de CA-1 (`Seq Scan`) y los
  cuerpos de CA-2.
- [x] `just db-reset` y los `EXPLAIN` de CA-1 después.
- [x] `prisma validate` + `migrate diff --exit-code` → `EXIT=0`, y `just
  db-build`.
- [x] CA-2: comparación `node -e` en `OK`.
- [x] CA-4: el test nuevo en verde y la prueba de que falla sin el índice.
- [x] CA-5: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [x] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **`IF NOT EXISTS` no reemplaza un índice.** Si solo se cambia la definición
  bajo el mismo nombre, una base ya creada conserva el índice viejo. Usar un
  nombre nuevo y quitar el `CREATE` del viejo; `just db-reset` deja la base
  limpia. No añadir `DROP INDEX` al DDL: rompería su idempotencia.
- **El `@@index` sale de la introspección**, no se escribe a mano: `prisma db
  pull --print` contra la base recreada y se copia la línea al modelo,
  renombrando los campos al camelCase del schema (`name`, `question`). En
  esta prueba salió así: `@@index([name(ops: raw("gin_trgm_ops"))], map:
  "…", type: Gin)`.
- **Menos de 3 caracteres.** `pg_trgm` no puede extraer trigramas de `ph`:
  con `enable_seqscan = off` el índice se usa con coste `24963`, frente a
  `91` del `Seq Scan`, y sin forzar nada el planificador elige el `Seq Scan`.
  Es el comportamiento correcto; anotarlo en el reporte, no corregirlo.
- **El `EXPLAIN` del test** se lanza con `prisma.$queryRawUnsafe('EXPLAIN
  …')` o `$queryRaw`, y se busca el nombre del índice en las filas del plan.
  No asertar costes, que cambian entre máquinas: solo el nombre del índice.
- Con 68 preguntas, el planificador puede seguir eligiendo `Seq Scan` en
  `questions` aunque el índice sea aplicable. Por eso CA-1 lo exige allí solo
  con `enable_seqscan = off`.

## Evidencia (2026-10-23)

**Autorización:** el dueño autorizó el `just db-reset` de esta US
(2026-10-23) y eligió la opción (a), la recomendada.

**Implementación:**

- `db/schema.sql`: los dos índices pasan a `gin (columna gin_trgm_ops)` con
  nombres nuevos, `products_nombre_ilike_trgm_idx` y
  `questions_question_ilike_trgm_idx`. Llevan nombre nuevo porque
  `IF NOT EXISTS` no reemplaza el índice viejo en una base ya creada.
- `schema.prisma`: los dos `@@index(..., type: Gin)` salen de
  `prisma db pull --print`, y la cabecera ya no los lista como no modelados.
- Solo cambian comentarios en `products.repository.ts` y
  `questions.repository.ts`, más los dos README.

**Decisión añadida al ejecutar: `VACUUM ANALYZE` en `just db-migrate`.**
Tras el primer `db-reset`, el `ILIKE` de `products` seguía en `Seq Scan`
sin forzar nada, incluso tras `ANALYZE`. Forzando el plan, el índice costaba
`310` frente a `91`. La causa es la *pending list* del GIN: el DDL crea el
índice **antes** de que el seed cargue las filas, así que las 1200
inserciones quedan pendientes y no en el árbol. La medida con `pgstattuple`
fue:

```
antes del VACUUM:   version 2 | pending_pages 69 | pending_tuples 1200
después del VACUUM: version 2 | pending_pages  0 | pending_tuples    0
```

La extensión `pgstattuple` se creó solo para medir y se borró después; la
base quedó con `pg_trgm` y `plpgsql`.

En la prueba de esta US el índice se creó con los datos ya cargados y por
eso no apareció. El dueño eligió añadir `VACUUM ANALYZE;` como último paso
de `db-migrate` (una línea del `justfile`, fuera de la tabla de archivos de
la US). Descartó documentarlo sin más y descartó `fastupdate = off`.

**Línea base** (antes del cambio):

```
EXPLAIN SELECT id FROM products WHERE name ILIKE '%phone%'
 Seq Scan on products  (cost=0.00..91.00 rows=1 width=8)
   Filter: (name ~~* '%phone%'::text)
SET enable_seqscan=off  →  Seq Scan on products  (cost=10000000000.00..10000000091.00 rows=1 width=8)
EXPLAIN SELECT id FROM questions WHERE question ILIKE '%apple%' (enable_seqscan=off)
 Seq Scan on questions  (cost=10000000000.00..10000000002.85 rows=2 width=8)
```

```
/products?search=name:apple&limit=50 → 200 total 17 ids [1, 219, 372, 374, 522, 523, 524, 709, 710, 711, 821, 822, 823, 828, 830, 1077, 1135]
/products?search=name:Baby&limit=50 → 200 total 11 ids [2, 16, 99, 387, 546, 567, 972, 978, 1046, 1078, 1092]
/products?search=name:CHAIR&limit=50 → 200 total 1 ids [435]
/questions?product_id=1&search=question:apple → 200 total 3 ids [34, 31, 26]
```

**CA-1**, tras `just db-reset` con la receta nueva y sin forzar nada:

```
 products_nombre_ilike_trgm_idx    | CREATE INDEX products_nombre_ilike_trgm_idx ON public.products USING gin (name gin_trgm_ops)
 questions_question_ilike_trgm_idx | CREATE INDEX questions_question_ilike_trgm_idx ON public.questions USING gin (question gin_trgm_ops)

EXPLAIN SELECT id FROM products WHERE name ILIKE '%phone%'
 Bitmap Heap Scan on products  (cost=30.19..34.20 rows=1 width=8)
   Recheck Cond: (name ~~* '%phone%'::text)
   ->  Bitmap Index Scan on products_nombre_ilike_trgm_idx  (cost=0.00..30.19 rows=1 width=0)
EXPLAIN SELECT id FROM products WHERE name ILIKE '%Phone%'
   ->  Bitmap Index Scan on products_nombre_ilike_trgm_idx  (cost=0.00..30.19 rows=1 width=0)
EXPLAIN ANALYZE (tras VACUUM)  →  Bitmap Index Scan … actual time=0.047..0.047 rows=3; Execution Time: 0.274 ms
EXPLAIN SELECT id FROM questions WHERE question ILIKE '%apple%'
 Seq Scan on questions  (cost=0.00..2.85 rows=2 width=8)          ← 68 filas: el planificador lo prefiere, previsto en CA-1
SET enable_seqscan=off
   ->  Bitmap Index Scan on questions_question_ilike_trgm_idx  (cost=0.00..17.40 rows=2 width=0)
```

Con menos de 3 caracteres (`'%ph%'`), sin forzar nada sale `Seq Scan`
(coste 91). Forzando, sale el índice con coste 739. Es lo correcto y no se
corrige (Notas).

**CA-2** (`node`, deep-equal sin `created_at`/`updated_at`, que salen del
`now()` de cada `db-reset`, una divergencia ya declarada):

```
/products?search=name:apple&limit=50: deep-equal (sin created_at/updated_at) OK, orden OK
/products?search=name:Baby&limit=50: deep-equal (sin created_at/updated_at) OK, orden OK
/products?search=name:CHAIR&limit=50: deep-equal (sin created_at/updated_at) OK, orden OK
/questions?product_id=1&search=question:apple: deep-equal (sin created_at/updated_at) OK, orden OK
```

**CA-3:**

```
npx prisma validate  →  The schema at prisma\schema.prisma is valid 🚀
npx prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --exit-code  →  No difference detected.  EXIT=0
sin los @@index (git stash)  →  EXIT=2: [-] Removed index on columns (name) / [-] Removed index on columns (question)
just db-build  →  ✔ Generated Prisma Client (7.10.0) … DTS ⚡️ Build success
```

**CA-4.** Es un test nuevo en `products.integration.test.ts`, dentro de una
transacción con `SET LOCAL enable_seqscan = off`. Lo que comprueba es que el
índice sea **aplicable**, que es lo que fallaba: el viejo no se usaba ni
forzado. Así no depende de la pending list ni de los costes. Busca el nombre
del índice en el plan.

```
✓ índices trigram del ILIKE (US-69, CA-4) > SELECT id FROM products WHERE name ILIKE '%phone%' usa products_nombre_ilike_trgm_idx
✓ índices trigram del ILIKE (US-69, CA-4) > SELECT id FROM questions WHERE question ILIKE '%apple%' usa questions_question_ilike_trgm_idx
```

Para verlo fallar, se volvió a poner a mano el índice viejo en `products`
(`DROP` del nuevo y `CREATE … (lower(name) gin_trgm_ops)`):

```
× SELECT id FROM products WHERE name ILIKE '%phone%' usa products_nombre_ilike_trgm_idx
AssertionError: expected 'Seq Scan on products  (cost=100000000…' to contain 'Bitmap Index Scan on products_nombre_…'
Tests  1 failed | 1 passed | 44 skipped (46)
```

Después se restauró el índice nuevo, con `VACUUM ANALYZE products`, y el
test volvió a dar `2 passed`.

**CA-5:**

```
just db-check                      →  Test Files  32 passed (32) / Tests  412 passed (412)   (410 + 2 de CA-4)
npx jest                           →  Test Suites: 34 passed, 34 total / Tests: 565 passed, 565 total
npx tsc --noEmit -p tsconfig.json  →  EXIT=0
just build-api                     →  Done in 27.64s.
just verify
OK   API    :9001/api/settings  200  5503B  536ms
OK   Shop   :3003/en  200  190788B  837ms  cards:30
OK   Admin  :3002/en/login  200  72821B  2309ms  cards:1
```

**Para el reporte:**

- Fuera del seed, el scraper inserta poco a poco y el autovacuum vacía la
  pending list. El `VACUUM ANALYZE` solo hace falta tras la carga masiva del
  seed.
- `openspec/changes/archive/` sigue citando los nombres viejos: es historia
  y no se toca.
