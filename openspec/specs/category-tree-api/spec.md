# Category Tree API Specification

## Purpose

`GET /api/categories` y `GET /api/categories/:param` leen `categories` en
Postgres vía `@safari/db` en vez de `categories.json`, reconstruyendo el
árbol a profundidad arbitraria (hoy 3 niveles reales, no 2) y preservando el
contrato HTTP salvo divergencias declaradas.

## Requirements

### Requirement: Árbol reconstruido a profundidad arbitraria (D-1) (CA-2)

El repositorio MUST traer las 198 filas con un único `findMany()` sin
`include` anidado y ensamblar el árbol en memoria agrupando por `parentId`,
de forma recursiva y sin límite de profundidad fijo.

#### Scenario: La cadena de nietos sobrevive el round trip (CA-2)
- GIVEN la base sembrada con `just db-up`
- WHEN pido el árbol de categorías
- THEN la raíz `124` trae `163` en `children`, y `163` trae `169` y `170` en
  su propio `children`, cada uno con `image`/`icon`/`slug` propios
- AND los conteos son 198 total, 83 raíces, 115 descendientes, 6 nietos

### Requirement: Cadena ascendente `parent` sin ciclos (D-2)

Cada nodo descendiente MUST llevar `parent` con la cadena ascendente
completa (el nodo padre, y el `parent` de ese padre, hasta `null`). Los
nodos ascendentes MUST NOT llevar `children` ni `type` — son una proyección
distinta a los nodos descendientes, para que la estructura no sea circular.

#### Scenario: Serialización segura
- GIVEN el árbol completo reconstruido
- WHEN corro `JSON.stringify(tree)`
- THEN no lanza `TypeError` de estructura circular
- AND `169.parent.parent` es el objeto completo de la raíz `124` con
  `parent: null`, y ese objeto `124` no tiene `children` embebido

### Requirement: Semántica de `parent` — raíces vs. listado plano (D-4)

Solo con `parent='null'` literal el listado MUST devolver las 83 raíces
(cada una con su subárbol anidado). Sin `parent`, con `parent='all'` o con
cualquier otro valor, MUST devolver los 198 nodos planos en el nivel
superior, cada uno con su propio subárbol.

> El default `parent='null'` que declara `GetCategoriesDto` **nunca se
> aplica**: `main.ts:9` instancia `new ValidationPipe()` sin `transform`, así
> que una petición sin `parent` llega con `parent === undefined` y el filtro
> de raíces no dispara. El mock hacía exactamente lo mismo
> (`if (parent === 'null')`, ver `git show be778be^`), así que devolver 198 es
> paridad de contrato, no un defecto. Una versión anterior de esta requirement
> afirmaba 83 para el caso sin `parent`; `sdd-verify` la refutó contra el
> endpoint real y se corrigió aquí.

#### Scenario: `parent=null` — solo raíces
- GIVEN `GET /api/categories?limit=1000&parent=null`
- WHEN el endpoint responde
- THEN `data` tiene 83 elementos, todos con `parent_id` nulo

#### Scenario: Sin `parent` — listado plano de 198
- GIVEN `GET /api/categories?limit=1000` sin el parámetro `parent`
- WHEN el endpoint responde
- THEN `data` tiene 198 elementos, igual que hacía el mock

#### Scenario: `parent=all` no rompe la home de `daily-needs`
- GIVEN `GET /api/categories?parent=all&search=type.slug:daily-needs`
- WHEN el endpoint responde
- THEN `data` trae los 198 nodos planos (filtrados a la vertical si aplica)
- AND `just verify` con el shop en modo `minimal` sigue en 200

### Requirement: Filtro por vertical `search=type.slug:<slug>`

El endpoint MUST aceptar `search=type.slug:<slug>` y traducirlo a un filtro
SQL exacto por `typeId`, reemplazando el `fuse.js` difuso del mock.

#### Scenario: Filtro por type
- GIVEN `search=type.slug:gadget`
- WHEN el endpoint responde
- THEN todas las categorías de `data` pertenecen al type `gadget`

### Requirement: Detalle por id o slug (D-6)

`GET /api/categories/:param` MUST resolver `param` como id numérico o como
slug mediante una única función `findCategoryByIdOrSlug`.

#### Scenario: Mismo resultado por id o por slug
- GIVEN una categoría con id `124` y slug `dairy-2`
- WHEN pido `/api/categories/124` y `/api/categories/dairy-2`
- THEN ambas respuestas son el mismo objeto

### Requirement: 404 para categoría inexistente (D-7)

Un `param` sin coincidencia MUST responder HTTP 404 (`NotFoundException`),
divergiendo del mock (200 con cuerpo vacío) por coherencia con
`product-detail-api`.

#### Scenario: Slug inexistente
- GIVEN la API contra la base sembrada
- WHEN pido `curl -i GET /api/categories/no-existe-xyz`
- THEN recibo 404 y el proceso Nest sigue vivo

### Requirement: Errores de conexión a Postgres (D-8)

Si Prisma no puede conectar, el endpoint MUST responder 503 vía
`getUserFriendlyMessage()` (`isPrismaConnectionError`); cualquier otro error
no controlado MUST responder 500 con el mismo helper.

#### Scenario: Postgres caído
- GIVEN `just db-down`
- WHEN pido `GET /api/categories`
- THEN recibo 503 con `{statusCode, message, error}` legibles

### Requirement: Key-set uniforme de 16 claves — divergencia declarada (D-5)

Todos los nodos top-level MUST emitir el mismo conjunto de 16 claves,
incluidas las 21 raíces de `type_id 9` (gadget) y `type_id 11` (medicine)
que el mock sirve con una variante de 13 claves en otro orden
(`products_count: null`, sin `created_at`/`updated_at`/`deleted_at`/
`parent_id`). Esto diverge deliberadamente del CA-1 literal ("mismas
claves") del épico; se ratifica emitir uniformidad sobre ramificar el
mapper por id.

#### Scenario: Las 21 raíces de gadget/medicine ahora con 16 claves
- GIVEN una raíz de `type_id 9` o `type_id 11` (13 claves en el mock)
- WHEN la sirvo desde Postgres
- THEN trae las mismas 16 claves que cualquier otra raíz, incluidas
  `created_at`, `updated_at`, `deleted_at`, `parent_id`

### Requirement: `products_count` constante en 0 — divergencia declarada (V-1)

`products_count` MUST ser `0` en todo nodo **descendiente** (los que lo
llevan), porque `category_product` está vacía por diseño (fuera de alcance
de este change). Los 198 nodos de nivel superior NO llevan la clave, igual
que el mock.

#### Scenario: products_count siempre 0 en descendientes
- GIVEN un nodo descendiente cualquiera (p. ej. `169`)
- WHEN leo `products_count`
- THEN el valor es `0`, aunque el mock traiga valores 0-22 en descendientes
- AND los nodos de nivel superior no traen la clave, como en el mock

### Requirement: Divergencias del objeto `type` embebido — declaradas

El `type` embebido MUST servirse desde la fila canónica de `types` en
Postgres, no desde la copia que `categories.json` tenía embebida. Estas
diferencias se aceptan y se declaran:

| Campo | Divergencia | Alcance | Ref. |
|---|---|---|---|
| `type.settings` | La copia del mock estaba obsoleta: 49 nodos de `type_id 1` pasan `isHome true→false` y `productCard "neon"→"helium"`; 8 de `type_id 8` ganan 7 claves | 57 de 198 nodos | V-11 |
| `type.banners` | No se emite (el mapper de `type` embebido publica 10 claves fijas); el mock sí lo traía en gadget/medicine | 21 nodos | V-12 |

> Ambas las levantó `sdd-verify`, no el diseño. Sin impacto de consumidor
> medido: toda lectura de `type.settings`/`type.banners` en el frontend viene
> de `/api/types` o de `product.type`, no de `category.type`. Es el análogo
> directo de la V-25 (`tags.image`) de US-4a: dato del seed/canónico, no del
> mapper.

Las divergencias V-3/V-6/V-7/V-8/V-9/V-10 que `design.md` documenta
(`image: []`→`null` en 101 nodos, el `parent` escalar en profundidad 2, las
marcas de tiempo del seed, el `limit` ausente) MUST leerse como parte de
este contrato: `design.md` no se fusiona en `openspec/specs/` al archivar, y
esta referencia es lo que las mantiene alcanzables desde la spec publicada.

### Requirement: Comentarios de documentación corregidos (D-3)

El comentario de cabecera de `categories.repository.ts` y el comentario
homólogo de `db/schema.sql` MUST reflejar los conteos verificados: 198
categorías = 83 raíces + 115 descendientes, de las cuales 6 son nietos
(`165-168` bajo `164`, `169-170` bajo `163`, ambos bajo la raíz `124`,
`type_id 7`), profundidad máxima 2 saltos.

#### Scenario: El comentario ya no dice "2 niveles reales"
- GIVEN `categories.repository.ts:1-7` y `db/schema.sql:130-135`
- WHEN los leo
- THEN ninguno afirma "2 niveles reales" y ambos citan los conteos 198/83/115/6

### Requirement: Creación de categorías raíz e hijas con madre válida (CA-1)

`POST /categories` MUST crear una fila y responder con las 16 claves de
`toCategoryDto`, en el mismo orden que `GET /categories/:id`, con `parent`
resuelto igual que en la lectura. Sin `parent` (o `parent: null`) crea una
raíz; con `parent` crea una hija cuya madre exista y comparta su `type_id`.
El `slug` MUST generarse con el helper de servidor de
`catalog-write-foundations`, nunca a mano en el servicio.

#### Scenario: CA-1 — crear una categoría raíz
- GIVEN un token `super_admin` y ningún `parent` en el body
- WHEN `POST /categories` con `name` y `type_id` válidos
- THEN la respuesta es 201 con las 16 claves de `toCategoryDto` y `parent: null`

#### Scenario: CA-1 — crear una hija bajo una madre válida
- GIVEN una categoría existente `124` de `type_id 7`
- WHEN `POST /categories` con `parent: 124` y `type_id: 7`
- THEN la respuesta es 201, `parent` trae la cadena hasta `124`, y
  `GET /categories/124` incluye la nueva fila en `children`

### Requirement: Edición y reenraizado sin ciclos, slug inmutable (CA-2)

`PUT /categories/:id` MUST actualizar los campos enviados y permitir mover
la categoría cambiando `parent`, respondiendo con la misma proyección de 16
claves que el `GET`. `slug` MUST NOT cambiar aunque cambie `name`.
`updated_at` MUST avanzar respecto al valor previo tras cualquier `PUT`
exitoso — la columna la fija un trigger de base de datos, no el
repositorio, así que su verificación MUST comparar por monotonía contra el
reloj de la base, nunca por igualdad contra un reloj fijado en el test.

#### Scenario: CA-2 — renombrar no cambia el slug
- GIVEN una categoría con slug `"lacteos-prueba"`
- WHEN `PUT /categories/:id` con un `name` distinto
- THEN la respuesta trae `slug "lacteos-prueba"` y `updated_at` posterior al
  valor previo

#### Scenario: CA-2 — mover una categoría a otra madre válida
- GIVEN dos categorías raíz `A` y `B` del mismo `type_id`
- WHEN `PUT /categories/A` con `parent: B.id`
- THEN `parent` trae la cadena hasta `B`, y `GET /categories/B` incluye `A`
  en `children`

### Requirement: Borrado re-enraíza a las hijas y devuelve el snapshot pre-borrado (CA-3)

`DELETE /categories/:id` MUST borrar la fila y responder con las 16 claves
de `toCategoryDto`, proyectadas sobre el nodo capturado **antes** del
borrado. Las hijas MUST re-enraizarse (`parent_id NULL`, vía
`ON DELETE SET NULL`) y aparecer como raíces en
`GET /categories?parent=null`; sus enlaces `category_product` MUST
desaparecer. Un `GET /categories/:id` posterior MUST responder 404.
**Divergencia declarada**: el `children` de la respuesta refleja el árbol
**pre-borrado** (parent_id antiguo), aunque en la base ya está re-enraizado.

#### Scenario: CA-3 — borrar una madre re-enraíza a sus hijas
- GIVEN una categoría `M` con hijas `H1` y `H2`
- WHEN `DELETE /categories/M`
- THEN la respuesta es 200 con `children` mostrando `H1`/`H2` con su
  `parent_id` previo
- AND `GET /categories/H1` devuelve `parent: null`, y `GET /categories/M`
  responde 404

#### Scenario: CA-3 — los enlaces de producto desaparecen — **UNTESTED (verificación diferida a US-29)**
- GIVEN una categoría con filas en `category_product`
- WHEN `DELETE /categories/:id`
- THEN `count(*) FROM category_product WHERE category_id = :id` es 0

**Estado real, tal como lo fija el gate adversarial de cierre de US-28
(condición vinculante para el archive): este escenario está marcado
`UNTESTED`, no `COMPLIANT`.** Cero código de esta US toca `category_product`
— el desenlace es 100% el `ON DELETE CASCADE` preexistente de
`category_product_category_id_fkey` (confirmado por lectura contra la base
real) — y no existe hoy ninguna ruta HTTP que pueble esa tabla
(`products.service.ts` `create`/`update` siguen siendo stubs hasta US-29).
Poblarla habría exigido un `INSERT` por `psql`, fuera del contrato de
comandos de solo lectura de esta sesión. La mitad observable de CA-3 que sí
depende de código nuevo de esta US (el re-enraizado de hijas y el snapshot
pre-borrado, escenario anterior) está `COMPLIANT` y probada en vivo. **US-29
hereda explícitamente la obligación de cerrar este escenario como parte de
su propia Definición de Done**, la primera vez que exista una ruta de
escritura real para `category_product`.

### Requirement: Las siete reglas de la arista madre→hija responden 400, nunca 500 (CA-1, CA-2)

Toda escritura sobre una arista madre→hija MUST validar, en código de
aplicación y **antes** del write, las reglas de la tabla; cada rechazo
MUST responder 400 con un discriminador reconocible en el campo `field`,
sin crear ni modificar ninguna fila. Como consecuencia de la regla 7, en un
nodo **con hijas** cambiar su `type_id` siempre responde 400; solo en una
categoría **hoja** el `type_id` es mutable de hecho. **Consecuencia
observable adicional** (hallazgo de `sdd-apply`, ronda de corrección de
PR#2): en una categoría **hoja que sí tiene madre**, cambiar solo su
`type_id` también responde 400, pero por la regla 4 (`parent_id (dentro de
type_id N)`), no por la regla 7 — la arista efectiva se re-valida contra la
madre existente con el `type_id` nuevo (DD28-5) y el `field` reportado
nombra `parent_id`, un campo que el cliente no envió en ese `PUT`. El
rechazo es correcto (la arista rompería), pero un panel de administración
que resalte el control por `field` señalaría el campo equivocado.

| # | Regla | `field` |
|---|---|---|
| 1 | `type_id` sin forma entera | `type_id` |
| 2 | `parent` sin forma entera (incluye `"abc"`, que de otro modo daría `NaN`) | `parent_id` |
| 3 | la madre indicada no existe | `parent_id` |
| 4 | la madre pertenece a otro `type_id` | `parent_id (dentro de type_id N)` |
| 5 | `parent` es la propia categoría (autorreferencia) | `parent_id (autorreferencia)` |
| 6 | `parent` desciende de la categoría editada (ciclo) | `parent_id (ciclo…)` |
| 7 | cambiar el `type_id` deja hijas con otro `type_id` | `type_id (N hija(s) con otro type_id)` |

Una violación del CHECK `categories_no_autoreferencia` (`db/schema.sql:274`)
MUST ser inalcanzable por construcción sobre HTTP: ese código no pertenece
al conjunto cerrado que traduce errores de dominio (ver
`catalog-write-foundations`), y delegarle la regla 5 degradaría la
respuesta a 500. La regla 5 MUST resolverse en código antes del write.

#### Scenario: 400 — `type_id` o `parent` sin forma entera, nunca 500
- WHEN `POST /categories` con `type_id: "abc"`, y por separado con
  `parent: "abc"`
- THEN ambas respuestas son 400, nunca 500, y ninguna fila se crea

#### Scenario: 400 — madre inexistente o de otro `type_id`
- GIVEN la categoría `124` de `type_id 7`
- WHEN `POST /categories` con `parent: 999999`, y por separado con
  `parent: 124` y `type_id: 9`
- THEN ambas respuestas son 400

#### Scenario: 400 — autorreferencia y ciclo A→B→A
- GIVEN una categoría raíz `A` y su hija `B`
- WHEN `PUT /categories/A` con `parent: A.id`, y por separado con
  `parent: B.id`
- THEN ambas respuestas son 400, y `GET /categories/A` conserva `parent: null`

#### Scenario: 400 — cambiar el `type_id` de un nodo con hijas; una hoja sí lo acepta
- GIVEN una categoría con al menos una hija, y otra categoría sin hijas
- WHEN a ambas se les hace `PUT` con un `type_id` distinto del actual
- THEN la primera responde 400 sin cambiar su `type_id`, y la segunda
  responde 200 con el nuevo `type_id`

### Requirement: Profundidad 4 servida de extremo a extremo (CA-4)

Crear una categoría hija de una nieta existente (nivel 4) MUST aceptarse sin
400, y MUST servirse anidada tanto por `GET /categories` como por
`GET /categories/:slug`. Esta requirement se declara **pendiente de
confirmación empírica**: predice, sobre el ensamblado del árbol sin tope de
profundidad en código, que el nivel 4 se sirve sin 400; `sdd-apply`/
`sdd-verify` MUST pegar evidencia real de ambos endpoints antes de cerrar
CA-4. Si el experimento la contradice, se reabre con la rama "400 declarado".

#### Scenario: CA-4 — nivel 4 se sirve anidado, sin 400
- GIVEN una categoría de nivel 3 (nieta) existente
- WHEN `POST /categories` con `parent` apuntando a esa nieta
- THEN la respuesta es 201, no 400
- AND `GET /categories` y `GET /categories/:slug` de la raíz correspondiente
  devuelven la nueva fila anidada a 4 niveles

### Requirement: Permisos de escritura intactos; lecturas sin cambios (CA-5)

`POST`/`PUT`/`DELETE /categories` MUST seguir exigiendo `ADMIN_ONLY`: sin
token MUST responder 401, con un token `store_owner` MUST responder 403. Los
endpoints `GET /categories` y `GET /categories/:param` MUST NOT cambiar su
key-set ni su conteo como consecuencia de esta capability.

#### Scenario: CA-5 — 401 sin token y 403 con `store_owner`
- WHEN `POST /categories` sin token, y luego el mismo body con un token
  `store_owner`
- THEN la primera respuesta es 401 y la segunda es 403

### Requirement: Sin mock huérfano ni regresión de lectura (CA-6)

`categories.service.ts` MUST NOT importar `@db/categories.json` ni
`fuse.js`. Tras correr la suite de integración con su propio centinela, los
conteos de la semilla (`198` total, `83` raíces, `53` en `daily-needs`, `10`
raíces del filtro) MUST permanecer sin cambios.

#### Scenario: CA-6 — sin imports huérfanos y conteos de la semilla intactos
- GIVEN el servicio ya migrado y la suite con centinela `zz-categories-`
- WHEN se busca `fuse`/`@db/` en `categories.service.ts` y corre `just db-check`
- THEN no hay coincidencias, y los conteos siguen en 198/83/53/10 con la
  suite verde

## Out of Scope

`types`/`tags`/`manufacturers`/`shops` (US-4a, US-27a, US-27b, change
hermano) · `authors` (fuera del esquema del catálogo) · mover productos
entre categorías y poblar `category_product` (US-29) · cambios de
frontend (`apps/shop/**`, `apps/admin/**`) · `ExceptionFilter` global.
