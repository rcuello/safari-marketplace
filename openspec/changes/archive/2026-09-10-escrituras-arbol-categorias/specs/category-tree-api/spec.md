# Delta for Category Tree API

## ADDED Requirements

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

## MODIFIED Out of Scope (no-estándar — ver nota de convención)

> **Nota de convención.** `openspec-convention.md` no define un merge
> estructurado para prosa de cabecera (`Out of Scope`). Precedente aplicado
> por `sdd-archive` en `flat-catalogs-api` (US-27b): reemplaza la lista
> completa a mano, en vez de fusionar por requirement.

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/category-tree-api/spec.md`:

> `types`/`tags`/`manufacturers`/`shops` (US-4a, US-27a, US-27b, change
> hermano) · `authors` (fuera del esquema del catálogo) · mover productos
> entre categorías y poblar `category_product` (US-29) · cambios de
> frontend (`apps/shop/**`, `apps/admin/**`) · `ExceptionFilter` global.

(Previously: parqueaba "endpoints de escritura del admin (`POST`/`PUT`/
`DELETE /categories`, siguen en mock)"; esta capability los deja en
alcance.)
