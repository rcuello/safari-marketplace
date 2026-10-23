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
**Status:** Listo para ejecución
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

- [ ] Autorización del dueño para `just db-reset` pegada en el reporte.
- [ ] Línea base antes del cambio: los `EXPLAIN` de CA-1 (`Seq Scan`) y los
  cuerpos de CA-2.
- [ ] `just db-reset` y los `EXPLAIN` de CA-1 después.
- [ ] `prisma validate` + `migrate diff --exit-code` → `EXIT=0`, y `just
  db-build`.
- [ ] CA-2: comparación `node -e` en `OK`.
- [ ] CA-4: el test nuevo en verde y la prueba de que falla sin el índice.
- [ ] CA-5: `just db-check`, `npx jest`, `just build-api` y `just verify` con
  recuentos.
- [ ] Status actualizado aquí y en el mapa de `docs/product/README.md`.

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
