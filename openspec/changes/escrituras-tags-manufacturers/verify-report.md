# Verification Report: `escrituras-tags-manufacturers` (US-27b)

**Fecha:** 2026-09-10 · **Fase:** `sdd-verify` · **Modo de artefactos:** `openspec`
(el MCP de Engram no está conectado; `artifact_store_mode: openspec`)
**Rama:** `us-27b-escrituras-tags-manufacturers` · **Base:** `da7dd84` · **HEAD:** `ad4bb4b`
**Postura:** adversarial e independiente. **Todos los comandos se reejecutaron en esta
sesión.** No se copió ninguna cifra de `apply-progress.md`; ese archivo se leyó solo para
saber qué se *afirmaba*.

---

## Verdicto

> **`PASS WITH FINDINGS`** — con **1 hallazgo CRITICAL** que **bloquea el archivo**.

**`blocking_for_archive`: `true`**

Los 7 requirements de los dos delta specs y los 7 CA de la US están **COMPLIANT** con
evidencia de runtime propia, incluida la evidencia central de la US (el toggle
`is_approved` sobrevive al reinicio y el payload parcial de 5 claves **no** borra
`description`/`website`/`image`). El bloqueo **no** es un fallo de contrato: es que el
gate de verificación designado del repo (`just db-check`, también `rules.verify.test_command`
en `openspec/config.yaml`) quedó **no determinista** por una carrera que introduce el
propio commit #1, reproducida en esta sesión con una tasa del **8,3 %**.

---

## Nota previa: discrepancia de SHA del commit #2

El prompt de esta fase cita `e140224` como commit #2. En el historial de la rama el
commit #2 es **`d6cf840`**; `e140224` es su versión **pre-`--amend`** (visible solo en
`git reflog`, no alcanzable desde `HEAD`).

```
$ git diff --stat e140224 d6cf840
 packages/db/src/repositories/tags.repository.ts | 426 ++++++------
 1 file changed, 213 insertions(+), 213 deletions(-)
```

Ese amend es exactamente la corrección de `\r` que menciona el prompt. **El historial
final está limpio**: en `d6cf840` el diff de `tags.repository.ts` contra su padre es
`0 añadidas / 3 borradas` (solo el remedio S-1), **no** una reescritura de archivo
completo. Los 4 commits bajo revisión son `684eef4`, `d6cf840`, `aaeed9b`, `ad4bb4b`.

---

## Gates reejecutados (salida real, exit codes reales)

| Gate | Resultado | Exit | Baseline / esperado | Veredicto |
|---|---|---|---|---|
| `just db-build` | Prisma Client 7.10.0 generado; `dist\index.js` 144.50 KB, `dist\index.d.ts` 1.39 MB | `0` | limpio | OK |
| `just db-check` ×10 | **9 archivos / 131 tests passed** en las 10 corridas | `0` ×10 | 9 / 111 al entrar; 131 afirmado | OK (ver `C-1`) |
| `cd apps/api/rest && npx jest` | **8 suites / 135 tests passed** | `0` | 6 / 92 al entrar; 8 / 135 afirmado | OK |
| `just build-api` | `nest build` · `Done in 38.34s` · sin errores de TypeScript | `0` | limpio | OK |
| `just verify` | `OK API :9001/api/settings 200 5503B` · `OK Shop :3003/en 200 190788B cards:30` · `OK Admin :3002/en/login 200 72821B cards:1` | `0` | verde | OK |

`packages/db` sigue con **9** archivos de test (el conteo de archivos no cambió, como
exigía el diseño) y **131** tests (+20 sobre la baseline de 111). Las 8 suites de jest
incluyen las dos nuevas (`tags.service.spec.ts`, `manufacturers.service.spec.ts`).

---

## Caracterización del flake de `just db-check` (encargo explícito)

**Tally: 10 corridas, 10 verdes, 0 rojas** (`131 passed (131)` en las 10, exit `0`).
No capturé ningún rojo por muestreo.

Un tally verde **no** cierra la pregunta, así que reproduje el mecanismo de forma
controlada en vez de confiar en la suerte. Script `race.cjs` contra el `dist/` recién
construido, 20 s de lectura y escritura concurrentes (`listProducts` en bucle contra
`createTag` → `productTag.create` sobre el producto sembrado id 1 → `deleteTag`), con
limpieza propia:

```
reads=1616 writeCycles=869 CRASHES=134
FIRST ERROR: TypeError :: Cannot read properties of null (reading 'id')
    at _toTagRecord (packages\db\dist\index.js:554:17)
    at Array.map (<anonymous>)
    at _toProductRecord (packages\db\dist\index.js:1206:20)
tags total: 10 | product_tag total: 0
```

**134 / 1616 = 8,3 % de fallo**, con la firma **exacta** que reportaron el orquestador
y la fase apply (`products.integration.test.ts > listProducts > busca por nombre
parcial case-insensitive`, `TypeError: Cannot read properties of null (reading 'id')`
en `_toTagRecord`). El mecanismo está probado, no inferido:

1. `packages/db` no tiene `vitest.config.*` (verificado: solo `biome.json`,
   `tsconfig.json`, `tsup.config.ts`, `prisma.config.ts`) ⇒ los 9 archivos corren en
   **paralelo dentro de una sola corrida**. El flake es **intra-corrida**; no hace
   falta que se solapen dos invocaciones de vitest, como suponía la hipótesis vigente.
2. `tags.integration.test.ts` (nuevo en commit #1, test `desenlace:`) crea una fila de
   `product_tag` sobre el **producto sembrado id 1** (`orderBy: { id: 'asc' }, take: 1`)
   y a continuación borra el tag.
3. `products.repository.ts:48` carga los tags con `tags: { include: { tag: true } }`.
   Sin el preview `relationJoins` (el schema solo activa `partialIndexes`), Prisma
   resuelve el include anidado en **dos consultas**: primero las filas de `product_tag`,
   después los `tags` por id.
4. Si el tag se borra entre esas dos consultas, la fila pivote llega con `tag: null` y
   `products.repository.ts:515` lo mapea **sin guarda**:
   `tags: row.tags.map((link) => _toTagRecord(link.tag))` — a diferencia de su hermano
   de la línea 512, `manufacturer: row.manufacturer ? _toManufacturerRecord(...) : null`.

**¿Es la interacción entre archivos genuinamente insegura?** Sí. El aislamiento por
centinela de `DD-8.1` protege los **conteos** de `tags`/`manufacturers`, pero no aísla
la **tabla pivote sobre una fila sembrada que otra suite escanea sin filtro**. Los
asserts por fila (B-2) están correctamente implementados; el problema no está en los
asserts, está en la elección del producto sonda.

---

## Hallazgos

### CRITICAL

#### `C-1` — El gate `just db-check` quedó no determinista por una carrera que introduce el commit #1

- **Archivos:** `packages/db/src/repositories/tags.integration.test.ts` (test
  `desenlace: borra el tag y product_tag desenlaza por CASCADE`, ~línea 200) ·
  causa raíz aguas abajo en `packages/db/src/repositories/products.repository.ts:515`.
- **Evidencia:** reproducción controlada arriba — **134 fallos / 1616 lecturas (8,3 %)**
  con la firma exacta ya observada dos veces por otras fases. 10/10 verdes por muestreo,
  lo que confirma que es intermitente, no que esté sano.
- **Por qué importa:** `just db-check` es el **único gate envuelto en una receta de
  `just`** y es `rules.verify.test_command` en `openspec/config.yaml`. La DoD de esta US
  (`CA-6`) exige "`just db-check` verde". Un gate que se pone rojo ~1 vez cada 12 por un
  motivo ajeno al test que falla envenena toda verificación futura: obliga a que cada
  fase decida a ojo si un rojo es real, que es exactamente el modo de fallo que la fase
  `sdd-verify` existe para evitar. Además el rojo aparece en
  `products.integration.test.ts`, un archivo que esta US **no toca**, así que el síntoma
  no apunta a la causa.
- **Antes de este change no existía:** ningún test del repo creaba filas de
  `product_tag` sobre un producto **sembrado**. La fixture de
  `products.integration.test.ts:198-237` usa `upsertScrapedProduct`, es decir un producto
  propio, y no borra tags.
- **Remediación mínima, dentro de los archivos que esta US ya modifica** (decisión del
  orquestador/usuario, **no** accionada aquí):
  1. Que el test `desenlace` de `tags` cree su **propio** producto sonda en vez de
     enlazar el sembrado id 1 (mismo criterio que la fixture de `products`), **o**
  2. añadir `packages/db/vitest.config.ts` con `fileParallelism: false` — arregla el
     síntoma en el gate, no el NPE de producción (ver `W-3`), y encarece la suite.
  La opción (1) es la que respeta el alcance de la US; la opción (3) —guardar
  `link.tag`— toca `products.repository.ts`, que **no** está en la tabla *File Changes*.

### WARNING

#### `W-1` — La divergencia declarada `V-5` es **falsa**: `image: null` sobreescribe la columna y pierde la imagen previa

- **Archivos:** `apps/api/rest/src/tags/tags.service.ts:176-178`,
  `apps/api/rest/src/manufacturers/manufacturers.service.ts:233-235`,
  `packages/db/src/repositories/{tags,manufacturers}.repository.ts` (spread
  `input.image !== undefined`).
- **Lo que declara el diseño** (`DD-5`, `V-5`): «`image: null` en el body se trata como
  **ausente** (no se envía) y la columna queda intacta».
- **Lo que hace el código** (verificado en runtime, no leído):

```
POST /api/manufacturers {"name":"Vf Img Probe","image":{"id":7,"original":"o"},"description":"keep-me"}
psql antes:  image::text={"id": 7, "original": "o"} | image IS NULL = false | jsonb_typeof=object
PUT  /api/manufacturers/91 {"name":"Vf Img Probe","image":null}   -> HTTP 200
psql después: image::text=null | image IS NULL = false | jsonb_typeof=null | description=keep-me
```

  La columna pasó de `{"id": 7, "original": "o"}` a **jsonb `null`**. La imagen previa se
  perdió. Mismo resultado en `tags`. La guarda es `!== undefined`, y `null !== undefined`,
  así que el `null` viaja hasta el `data` de Prisma; el tipo `image?: Prisma.InputJsonValue`
  **sin `| null`** solo protege en compilación y el servicio lo neutraliza con
  `as unknown as Prisma.InputJsonValue` (`ValidationPipe` corre sin `transform` ni
  `whitelist`, así que el tipo no es garantía de runtime — el mismo argumento B2/B3 que
  el propio diseño usa para exigir la capa 2 de `name`).
- **Por qué importa:** es pérdida silenciosa de datos en **exactamente la clase de payload
  parcial** que `CA-2`/`B-4` existen para cerrar. Un cliente que serialice campos vacíos
  como `null` (patrón habitual) destruye la imagen en cada guardado.
- **Impacto práctico hoy: nulo por el frontend.** `manufacturer-form.tsx:210-214` y
  `tag-form.tsx:169-173` **siempre** envían `image` como objeto
  (`{thumbnail, original, id}`), nunca `null`; y el toggle de aprobación no envía `image`
  en absoluto. Por eso no rompe ningún CA. Pero la divergencia declarada es falsa y la
  sección *Lo que quedará NO VERIFICADO* del diseño la dejó explícitamente sin probar
  («`image: null` limpiando la columna: no soportado por decisión»), así que nadie la
  había mirado. **Cerrarla cuesta una línea** por sitio
  (`input.image !== undefined && input.image !== null`), o hay que corregir el texto de
  `V-5` para que diga la verdad.

#### `W-2` — Asimetría de `type_id` string entre los dos agregados, con mensaje **falso** en `tags`

```
POST /api/tags          {"name":"Vf Str","type_id":"9"}  -> 400  `tags.type_id` referencia un registro inexistente (`9`).
POST /api/manufacturers {"name":"Vf Str","type_id":"9"}  -> 201  type: {"id":9,"name":"Gadget",...}
```

- El type 9 **existe**. `tags.service.ts` no coerciona `type_id` (comentario en
  `:118-120`: «`tag.entity.ts` no declara `type_id` como `string`»), así que la cadena
  `"9"` llega al repositorio y `_assertValidTypeId` la rechaza con
  `!Number.isInteger("9")`. `manufacturers.service.ts:190-195` sí hace `Number(...)`
  (`DD-2`) y acepta.
- **Por qué importa:** el mensaje es **falso** —la misma clase de defecto que `S-1`— y
  las dos rutas hermanas de una misma US se comportan distinto ante el mismo body.
- **No rompe ningún CA:** los dos formularios del admin envían `type.id` **numérico**
  (`tag-form.tsx:174` `type_id: values.type?.id`, `manufacturer-form.tsx:219`
  `type_id: type?.id!`), y el `id` que sirve la lectura ya es `number`. Es alcanzable por
  Swagger/`curl`/cualquier cliente futuro, no por el admin actual.

#### `W-3` — NPE alcanzable en producción en `products.repository.ts:515` (preexistente, ahora demostrado)

```ts
// packages/db/src/repositories/products.repository.ts:512-515
manufacturer: row.manufacturer ? _toManufacturerRecord(row.manufacturer) : null,
categories: row.categories.map((link) => _toCategoryRecord(link.category)),
tags: row.tags.map((link) => _toTagRecord(link.tag)),     // ← sin guarda de null
```

- Es la causa raíz de `C-1`, pero su alcance **no** es solo el gate: cualquier borrado de
  tag concurrente con una lectura de `/api/products` produce un **500** en la tienda
  (`listProducts` alimenta el SSR). El defecto es **preexistente** y
  `products.repository.ts` **no** está en la tabla *File Changes*, así que corregirlo aquí
  sería salirse del alcance — se **reporta**, no se acciona.
- Lo que esta US cambia es la **probabilidad**: antes de `deleteTag` no había ninguna ruta
  HTTP que borrara tags; ahora sí, y es una ruta de admin.
- **Forward:** la línea 514 (`categories`) tiene la **misma forma sin guarda**. US-28
  añadirá `deleteCategory` con el mismo test de desenlace sobre `category_product` y
  reproducirá `C-1` idéntico. Conviene resolverlo **antes** de US-28, no después.

#### `W-4` — Volumen: 2094 líneas cambiadas frente a ~1666 previstas (+26 %); patrón dos de dos

Medido por mí, no copiado (`git diff --numstat`, solo archivos de código; los artefactos
de `openspec/` van aparte):

| Commit | Añadidas | Borradas | Cambiadas | Forecast (añadidas) | Δ |
|---|---|---|---|---|---|
| `684eef4` #1 | 358 | 6 | 364 | ~330 | +8 % |
| `d6cf840` #2 | 591 | 29 | 620 | ~460 / ~467 | +27 % |
| `aaeed9b` #3 | 381 | 5 | 386 | ~335 | +14 % |
| `ad4bb4b` #4 | 697 | 33 | 730 | ~500 / ~495 | **+39 %** |
| **Total (neto `da7dd84..HEAD`)** | **2024** | **70** | **2094** | ~1620 / ~1666 | **+26 %** |

- Cada uno de los 4 commits supera el presupuesto de revisión de 400 líneas de la
  Sección E; el #4 lo supera **×1,8**.
- El exceso sigue concentrado en los specs de jest, como el diseño ya avisó — pero el
  diseño ya había **corregido hacia arriba** su ancla (331 líneas reales de
  `types.service.spec.ts` en vez de ~145) y **volvió a quedarse corto**: reales
  `tags.service.spec.ts` **474** (previsto ~320) y `manufacturers.service.spec.ts`
  **551** (previsto ~330).
- El umbral de "pártela" del épico 26 es ~900 líneas: US-27b lo rebasa **×2,3**.
  US-27a cerró en ~1470 contra ~915 previstas. **El patrón es dos de dos**: la heurística
  de estimación de esta capability subestima sistemáticamente entre un 25 % y un 60 %.
  Recomendación para US-28/29/30: anclar el spec de jest en **~500 líneas por agregado**,
  no ~330, y contar con que un agregado = 2 slices de ~600 líneas cada uno.

#### `W-5` — Cifras de `apply-progress.md` que no cuadran con el diff comprometido

`apply-progress.md` es el rastro de auditoría de la fase apply; tres de sus cifras no
coinciden con lo que hay en los commits:

| Afirmado en `apply-progress.md` | Real (`git show --numstat ad4bb4b`) |
|---|---|
| `manufacturers.service.spec.ts` = **498** líneas | **551** (`wc -l` = 551, `numstat` = 551 añadidas) |
| `create-manufacturer.dto.ts` = **39/6** | **38/8** |
| `manufacturers.service.ts` = **109/31** | **108/25** |

No afecta al código ni a ningún CA (probablemente se midieron antes del último ajuste
previo al commit), pero invalida la aritmética de la tabla "Forecast vs actual" del
propio archivo y obliga a remedir todo desde `git`. La conclusión cualitativa del apply
(«el spec de jest es el que se desborda») **sí** se sostiene: se desborda más de lo que
declaró.

#### `W-6` — La divergencia `V-11` está subestimada: el bump de `products.updated_at` ocurre en **cada** `just db-check`

`V-11` enmarca el bump no restaurable de `products.updated_at` de la fila sonda como
«efecto del setup manual de `CA-3`». Pero el test `desenlace` de
`manufacturers.integration.test.ts:214-220` hace `prisma.product.update({ data: {
manufacturerId } })` sobre el producto sembrado **id 1**, y otra vez al `SET NULL` del
borrado: dispara el trigger `products_updated_at` (`db/schema.sql:488`) **dos veces por
corrida de la suite**. Estado final medido en esta sesión:

```
products.updated_at id=1: 2026-09-10 16:58:13.994785+00   ← movido (10 corridas + mi CA-3)
products.updated_at id=2: 2026-09-02 15:33:36.102816+00   ← intacto (el INSERT en product_tag no toca products)
```

Invisible por HTTP (`products.service.ts` no emite timestamps) y sin impacto en ningún
assert, pero significa que el estado sembrado **deriva monótonamente** con cada corrida
del gate, no solo con evidencia manual. Declarar `V-11` como "residuo de setup" es
incompleto.

### SUGGESTION

- **`S-1`** — `_assertValidTypeId` está duplicado literalmente en los dos repositorios.
  El apply lo declaró como desviación DRY del pseudocódigo del diseño. Correcto y
  aceptable (el diseño prohíbe piezas compartidas nuevas), pero cuando US-28/29/30
  añadan la cuarta y quinta copia conviene una decisión explícita del épico sobre dónde
  vive esa guarda.
- **`S-2`** — `manufacturer-list.tsx:141` hace `type_id: record?.type.id`: si `type` es
  `null`, revienta en el cliente al pulsar el toggle. Esta US hace ese estado
  trivialmente alcanzable por API (`POST /api/manufacturers {"name":"X"}` sin `type_id`
  devuelve `"type": null`; verificado). Frontend está fuera de alcance (decisión 14):
  se menciona, no se acciona.
- **`S-3`** — La ausencia de `vitest.config.*` en `packages/db` ya cuesta dinero
  (`C-1`, y `DD-8.1` gira entera alrededor de compensarla a mano). Un
  `vitest.config.ts` con aislamiento explícito por archivo es material de US-10 /
  Épico 9 (`just check`), no de esta US, pero conviene levantarlo como deuda con dueño.

---

## Matriz de CA (US-27b)

| CA | Veredicto | Evidencia propia (resumen) |
|---|---|---|
| **CA-1** — crear persiste y responde con la proyección del `GET` | **COMPLIANT** | `POST /api/tags` → 201, **9 claves en el mismo orden** que `GET /api/tags/{slug}` (`node -e`, sin `.sort()`, `true`); `POST /api/manufacturers` → 201, **13 claves en el mismo orden**. `socials`/`cover_image`/`language`/`shop_id` aceptados **sin error** y ausentes o constantes en la respuesta (`socials: []`, `cover_image: null`, `language: "en"`). **Reinicio real de proceso** (kill + relanzamiento, puerto confirmado libre en medio): `GET` de ambos → 200 con el mismo key-set en orden |
| **CA-2** — editar persiste, no cambia el slug, `updated_at` avanza | **COMPLIANT** | `PUT /api/tags/298 {"name":"Vf Oferta de Invierno","slug":"intento-de-cambiar"}` → 200, `slug` sigue `vf-oferta-verano`, `name` nuevo; `updated_at` en la columna `16:46:18.852+00` → `16:48:40.757+00`. Manufacturers `16:46:44.303+00` → `16:48:29.08+00`. **Toggle tras un segundo reinicio real, en medio de la secuencia: `is_approved = 0`** (era la regresión silenciosa que cierra esta US) |
| **CA-3** — borrar desenlaza, no arrastra | **COMPLIANT** | Setup por `psql` (`UPDATE products SET manufacturer_id=86 WHERE id=1`, `INSERT INTO product_tag VALUES (2,298)`). `DELETE` de ambos → **200** (nunca 409, en ninguna ruta). Después: `products=1200` (sin cambio), `products.manufacturer_id` de la fila 1 = **NULL**, `product_tag=0`, **el producto 2 sigue existiendo**, `GET` posterior de los dos slugs → **404**. Respuestas de `DELETE` con las mismas 9 y 13 claves en orden. Confirmado por lectura de código que el repositorio **no** borra `product_tag` (`deleteTag` = `findUnique` + `prisma.tag.delete`, nada más): lo hace el `ON DELETE CASCADE` de `product_tag.tag_id` |
| **CA-4** — errores de dominio, nunca 500 | **COMPLIANT** | 404 ×4 en `PUT`/`DELETE .../99999`; 404 en `PUT /api/tags/abc` y `PUT /api/manufacturers/abc` (`NaN`); 400 en `POST {}`, `POST {"name":""}`, `POST {"name":"!!!"}` en los dos agregados; 400 en `PUT {"name":""}` sobre `tags/53` y `manufacturers/1` con **`psql` probando la fila intacta** (nombre y `updated_at` idénticos antes y después); 400 con `type_id: 99999` en los dos, **sin fila creada**; colisión literal `oferta` → `oferta-2` → `oferta-3` y `medicure` → `medicure-2`. **`grep -cE '^\s+at ' = 0`** sobre el log de la API de toda la batería, y `0` líneas `ERROR` de Nest y `0` respuestas 500 |
| **CA-5** — permisos intactos | **COMPLIANT** | Tokens reales acuñados vía `POST /api/token` (permisos verificados en la respuesta). Sin token: **401 ×6**. `customer`: **403 ×6**. `store_owner` en `tags`: **403 ×3**. `store_owner` en `manufacturers`: secuencia autolimpiante sobre centinela propio `POST → 201` (id 90) / `PUT → 200` / `DELETE → 200`. Ningún id sembrado tocado con ese token; `manufacturers` de vuelta a 14. `git diff` de los dos controladores vacío |
| **CA-6** — sin mock huérfano ni regresión | **COMPLIANT** | `grep -n "fuse\|@db/"` en los dos servicios → **exit 1, 0 líneas** (también `grep -in fuse` → 0). Conteos de lectura tras las 10 corridas de la suite: `GET /api/tags total = 10`, `GET /api/manufacturers total = 14`. `just db-check`, `npx jest`, `just build-api` y `just verify` verdes (ver tabla de gates) |
| **CA-7** — piezas compartidas consumidas sin modificarse | **COMPLIANT** | `git diff --stat da7dd84..HEAD -- packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/` → **salida vacía, exit 0**. Ver además el *Juicio forward* |

---

## Requirements por delta spec

### `specs/flat-catalogs-api/spec.md` (6 ADDED + 1 MODIFIED)

| Requirement / Scenario | Veredicto | Evidencia |
|---|---|---|
| **R1** — Escritura reutiliza la proyección de lectura (CA-1) | **COMPLIANT** | `toTagDto`/`toManufacturerDto` son los mismos mappers de la lectura (leídos: `tags.service.ts:37-55`, `manufacturers.service.ts:41-63`); no hay mappers nuevos. Key-sets 9/13 idénticos y **en orden** entre `POST`/`PUT`/`DELETE` y el `GET` por slug |
| ↳ *Scenario: la marca creada sobrevive al reinicio* | **COMPLIANT** | `POST` → id 86 → **kill del proceso + puerto libre confirmado + relanzamiento** → `GET /api/manufacturers/vf-marca-prueba` → 200, 13 claves, mismo `Object.keys()` que el `POST` (`true`) |
| ↳ *Scenario: el tag creado ignora campos sin columna* | **COMPLIANT** | `POST /api/tags` con `socials` y `cover_image` → **201**, 9 claves, `'socials' in o === false`, `'cover_image' in o === false`, sin error |
| **R2** — Editar persiste, slug estable, `updated_at` avanza en la columna (CA-2) | **COMPLIANT** | Ver CA-2. `is_approved` sigue emitiéndose como `Number(record.isApproved)` (`manufacturers.service.ts:53`, byte-idéntica; el desplazamiento `:60`→`:53` es consecuencia del borrado del scaffolding, no un cambio) |
| ↳ *Scenario: el toggle de aprobación sobrevive al reinicio* | **COMPLIANT** | `is_approved: 1` → `PUT` 5 claves → `is_approved: 0` → **reinicio real** → `GET` → `is_approved = 0` |
| ↳ *Scenario: renombrar no cambia el slug* | **COMPLIANT** | `slug` inalterado con intento explícito de cambiarlo en el body; `updated_at` posterior en la columna vía `psql` |
| **R3** — Borrado desenlaza sin arrastrar, sin protección (CA-3) | **COMPLIANT** | Ver CA-3. Sin 409 en ninguna ruta; `products` sin cambio; 404 posterior |
| ↳ *Scenario: borrar una marca no borra sus productos* | **COMPLIANT** | `DELETE` → 200, `count(*) FROM products` = 1200 antes y después, fila 1 con `manufacturer_id NULL` |
| ↳ *Scenario: borrar un tag elimina sus enlaces `product_tag`* | **COMPLIANT** | `DELETE` → 200, `count(*) FROM product_tag WHERE tag_id = 298` = 0, `GET /api/tags/vf-oferta-verano` → 404 |
| **R4** — Errores de dominio nunca producen 500 (CA-4) | **COMPLIANT** | Ver CA-4. **Adicional no pedido:** con Postgres **detenido** (`docker stop safari-postgres`), las **6** rutas de escritura devuelven **503** (`No se puede conectar con el servicio…`), no 500 — la rama de conexión que el verify de US-27a encontró muerta (`C-1`) sigue viva en los 6 call sites nuevos, y sin stack en el log |
| ↳ *Scenario: `type_id` inexistente* | **COMPLIANT** | `POST /api/tags {"name":"Vf X","type_id":99999}` → 400; `SELECT count(*) FROM tags WHERE name LIKE 'Vf %'` = 0 |
| ↳ *Scenario: id inexistente y colisión de slug* | **COMPLIANT** | `PUT /api/manufacturers/99999` → 404 y `POST /api/tags {"name":"Oferta"}` → 201 `slug: "oferta"`, repetido → 201 `slug: "oferta-2"` (y un tercero → `oferta-3`) |
| **R5** — Permisos sin cambios (CA-5) | **COMPLIANT** | Matriz completa con tokens reales; ver CA-5 |
| ↳ *Scenario: matriz de permisos* | **COMPLIANT** | `tags` 401/403/403 · `manufacturers` 401/403/200 |
| **R6** — Sin mock huérfano ni regresión de lectura (CA-6) | **COMPLIANT** | Ver CA-6 |
| ↳ *Scenario: sin imports huérfanos* | **COMPLIANT** | `grep` exit 1 en los dos archivos |
| ↳ *Scenario: el conteo de lectura no cambia* | **COMPLIANT** | 10 y 14 tras 10 corridas de `just db-check`; centinelas `zz-tags-`/`zz-manu-` presentes en los archivos y `0` residuos `zz-%` al cierre |
| **MODIFIED `Out of Scope`** | **NOT-VERIFIED (por diseño)** | Es una instrucción de merge para `sdd-archive`; `openspec/specs/flat-catalogs-api/spec.md` todavía **no** debe estar modificado, y no lo está (`git diff` vacío). La convención no estándar está declarada en el propio delta con 4 precedentes. Nada que verificar hasta el archivo |

### `specs/catalog-write-foundations/spec.md` (1 ADDED)

| Requirement / Scenario | Veredicto | Evidencia |
|---|---|---|
| **R7** — `InvalidReference` observado por primera vez sobre HTTP, piezas compartidas sin cambios (CA-7) | **COMPLIANT** | Primer 400 real de `InvalidReference` por HTTP confirmado en los dos agregados. La integración es **solo call sites**: los repositorios importan `generateSlug`/`normalizeSlug`/`translateCatalogWriteError`/`InvalidReferenceError`/`RecordNotFoundError` y no editan nada. `git diff` de los tres paths protegidos: **vacío** |
| ↳ *Scenario: `type_id` inexistente → primer 400 real, piezas intactas* | **COMPLIANT** | `POST /api/tags {"name":"Vf X","type_id":99999}` → **400**, nunca 500; `git diff --stat` de los tres paths → vacío |

---

## Juicio sobre el remedio `S-1` (encargado explícitamente: juzgar, no observar)

**Literales verificados en runtime, los dos:**

```
POST /api/tags          {"name":"Vf X","type_id":99999}  -> 400  `tags.desconocida` referencia un registro inexistente.
POST /api/manufacturers {"name":"Vf X","type_id":99999}  -> 400  `manufacturers.desconocida` referencia un registro inexistente.
PUT  /api/tags/53       {"type_id":99999}                -> 400  `tags.desconocida` referencia un registro inexistente.
```

Confirmado por lectura que los **6** call sites de `translateCatalogWriteError` omiten
`uniqueField` (`tags.repository.ts:144-146,183-186,208-211`;
`manufacturers.repository.ts`, tres sitios equivalentes), y que el commit #2 aplicó el
remedio a `tags.repository.ts` con exactamente `0 añadidas / 3 borradas`.

**¿Es "vago pero nunca falso" la decisión correcta?** Para **estos dos agregados, sí.**
Cada uno tiene **una sola** FK saliente (`type_id → types(id)`, verificado en
`pg_constraint`), así que `` `tags.desconocida` `` tiene un único referente posible y la
pérdida de información real es cero: el mensaje es menos legible, no menos informativo.
El estado anterior (`` `tags.slug` ``) era **activamente engañoso** —apuntaba a la
columna equivocada— y en un mensaje de 400 que llega a un formulario de admin eso es
peor que la vaguedad. Además el remedio cuesta **cero bytes** en archivos compartidos y
mantiene `CA-7` intacto, mientras la alternativa (arreglar
`domain-errors.ts:150-156`) lo rompía.

**¿Omitir `uniqueField` degrada la rama P2002?** Para estos dos agregados, **no**.
`domain-errors.ts:142-147` resuelve el campo del P2002 como
`Array.isArray(meta.target) ? target.join(', ') : (context.uniqueField ?? 'slug')`. Es
decir: (a) si Prisma entrega `meta.target` como array, el mensaje usa el campo real y
`uniqueField` es irrelevante; (b) si no, cae al literal **`'slug'` hardcodeado**, que es
correcto porque —verificado en `pg_index`— el **único** unique no-PK de `tags` y de
`manufacturers` es `slug`. Con o sin `uniqueField`, el mensaje del P2002 es idéntico.

**Intento de construir un caso donde el cambio empeore algo.** Recorrí las tres ramas de
`translateCatalogWriteError`: P2025 no lee `uniqueField`; P2002 es idéntico por el
razonamiento anterior; P2003 mejora. **No encontré ninguna regresión para `tags`/
`manufacturers`.** El único caso en que el patrón empeora las cosas es un agregado con
**más de un unique** o con **más de una FK saliente** — y eso no es hipotético: es
`products`. Ver abajo.

---

## Juicio forward (US-28 / US-29 / US-30)

**¿Pueden `categories`, `products` y `shops` consumir las piezas compartidas solo como
call sites?** **Sí estructuralmente, pero `products` NO debe copiar el patrón de US-27b
tal cual, y `products`/`shops` heredan un techo de calidad que conviene decidir antes,
no descubrir en verify.** Datos medidos, no recordados (`pg_constraint` / `pg_index`):

| Agregado | FKs salientes | Uniques no-PK | ¿Transfiere el patrón US-27b? |
|---|---|---|---|
| `tags` | 1 (`type_id`) | `slug` | — (es el patrón) |
| `manufacturers` | 1 (`type_id`) | `slug` | — |
| `categories` (US-28) | **2**: `parent_id → categories`, `type_id → types` (`ON DELETE CASCADE`) | `slug` | Sí, con degradación del mensaje |
| `products` (US-29) | **3**: `manufacturer_id`, `shop_id`, `type_id` | `slug` **+ `products_procedencia_key`** (`(source_store, source_product_id) WHERE source_store IS NOT NULL`) | **No tal cual — ver riesgo** |
| `shops` (US-30) | 1 (`owner_id → users`, `ON DELETE RESTRICT`) | `slug` | Sí |

1. **Las firmas son genéricas de verdad.** `generateSlug(source, lookup, aggregate)`,
   `normalizeSlug(source, aggregate)`, `translateCatalogWriteError(error, {aggregate,
   id?, uniqueField?})` y las 5 clases de error están parametrizadas por `aggregate` sin
   un solo literal de `types`/`tags`/`manufacturers`. El `ExistingSlugLookup` mantiene la
   tabla fuera del helper. `toWriteHttpException` no conoce agregados. Dos agregados más
   ya lo demostraron sin tocar un byte compartido. **CA-7 es sostenible.**

2. **Riesgo material y concreto para US-29 (`products`): el segundo unique.** Si US-29
   copia "omitir `uniqueField`" y Prisma no entrega `meta.target` como array —que es
   exactamente lo que observamos con el P2003—, una violación de
   `products_procedencia_key` (el unique parcial de procedencia del scraper) saldría
   como *«Ya existe un registro de `products` con el slug `slug`»*: **falso**, y falso
   sobre la ruta que el scraper ejercita a diario. US-29 debe **pasar `uniqueField`
   explícitamente por call site** (es un campo de `context`, cero bytes compartidos) o
   discriminar por nombre de constraint antes de traducir. **El remedio S-1 es local a
   agregados de un solo unique; no es una regla general.** Conviene escribirlo así en el
   diseño de US-29 en vez de dejarlo como "plantilla heredada".

3. **El fallback `desconocida` es más pobre con varias FKs, pero se arregla en el call
   site.** Para `products`, `` `products.desconocida` referencia un registro
   inexistente. `` no dice si falló `shop_id`, `type_id` o `manufacturer_id`, y
   `translateCatalogWriteError` **nunca** pasa `value`, así que tampoco dice qué valor.
   Un admin no puede actuar con ese mensaje. Salidas disponibles **sin tocar
   `domain-errors.ts`**:
   - **(a) Recomendada** — pre-validar la existencia de cada FK en el repositorio del
     agregado (`prisma.shop.count({where:{id}})`, etc.) y lanzar
     `new InvalidReferenceError('products', 'shop_id', value)` directamente, con campo
     **y** valor correctos. `DD-2` la rechazó para US-27b (una query extra + TOCTOU) y
     esa decisión fue razonable para **una** FK cuyo nombre es deducible del agregado;
     con **tres** el cálculo se invierte. El P2003 genérico queda como backstop del
     TOCTOU. Es un cambio de call site, compatible con `CA-7`.
   - **(b)** Extender la guarda tipo `_assertValidTypeId` a cada FK: solo cubre
     malformados, no inexistentes. Necesaria pero insuficiente.
   - **(c) A evitar** — pasar como `uniqueField` la FK "más probable": reintroduce
     exactamente la falsedad de `S-1`.
   Si en cambio se quiere la solución de raíz (un `context.fkFields?: Record<string,
   string>` indexado por nombre de constraint), **eso sí edita `domain-errors.ts`** y
   debe ser una **decisión explícita del épico**, no un drive-by de US-29: rompería el
   precedente de `CA-7` que dos US ya sostienen.

4. **`shops` (US-30) tiene una forma distinta que el patrón no cubre.**
   `shops.owner_id` es `ON DELETE RESTRICT`: eso significa que el 409 de
   `DependentRowsError` —que en esta US no tiene productor y quedó sin verificar— **sí**
   tendrá uno en US-30, por la vía de las FKs **entrantes** de `shops` (`products.shop_id`
   es `ON DELETE CASCADE`, ojo: borrar una tienda **borra sus productos**). US-30 no puede
   heredar el «no hay 409 en ninguna ruta» de US-27b; su `deleteShop` necesita el conteo
   de dependientes del patrón de `types` (US-27a), no el de `tags` (US-27b).

5. **Deuda que US-28 hereda hoy mismo:** `products.repository.ts:514` mapea
   `categories` con la misma forma sin guarda que la línea 515 (`W-3`). En cuanto US-28
   añada `deleteCategory` y su test de desenlace sobre `category_product`, `C-1` se
   reproduce idéntico. Resolverlo **antes** de US-28 es más barato que dos veces después.

---

## Coherencia con el diseño (drift)

| Ítem del diseño | Estado | Nota |
|---|---|---|
| `DD-1` (inputs campo a campo, `Partial<Omit<...,'slug'>>`, spread condicional) | **Cumplido** | Interfaces fijadas al pie de la letra en los 4 tipos; verificado por lectura y por el `psql` de `B-4` |
| `DD-2` (coerción en servicio, guarda en repositorio, P2003 en el `catch`) | **Cumplido con asimetría** | Las 3 capas existen. `tags` **no** coerciona `type_id` (documentado en el propio código) → `W-2` |
| `DD-3` (mensaje observado; remedio = omitir `uniqueField`) | **Cumplido** | Literales `desconocida` verificados; remedio aplicado en los 6 call sites; `domain-errors.ts` intacto |
| `DD-4` (mapeador tal cual, `catch` de una línea) | **Cumplido** | `git diff` vacío; probado además con la base caída (503 ×6) |
| `DD-5` (`image` como ausente si `null`) | **NO cumplido** | → `W-1`. El único drift de diseño con consecuencia funcional |
| `DD-6` (`Boolean()` entra, `Number()` sale) | **Cumplido** | `Number(record.isApproved)` byte-idéntica; `@IsOptional() @IsBoolean()` presente |
| `DD-7` (un `listTypes()` secuencial tras la escritura, nunca `Promise.all`) | **Cumplido** | Verificado por lectura en los 6 métodos + tests de orden de llamada en los dos specs de jest |
| `DD-8` (centinela por archivo, escrituras al final, cleanup plegado, assert de cierre) | **Cumplido en la letra; insuficiente en el fondo** | Prefijos `zz-tags-`/`zz-manu-`, comentario `DD-8.3` presente, `beforeAll(cleanup)` + cleanup plegado en el `afterAll` con `try/finally`, asserts de cierre `count()===10`/`===14`, asserts de desenlace **por fila**. Lo que no cubre: la fila `product_tag` sobre un producto **sembrado** → `C-1` |
| `DD-9` (DTOs declaran los campos reales, `name` en dos capas) | **Cumplido** | `PickType`/`OmitType` como se fijaron; `created_at`/`updated_at` omitidos (N-9); 400 verificado por `curl` contra proceso compilado, ningún spec de jest asserta el `ValidationPipe` (N-1) |
| `DD-10` (guarda de id no entero) | **Cumplido** | `PUT /api/tags/abc` → 404 `No existe un tag con id NaN.`; `PUT /api/manufacturers/abc` → 404; tests de jest verifican que el repositorio no se llama |
| Correcciones del gate `B-1` … `B-4`, `N-1` … `N-9` | **Cumplidas las 13** | `B-1` secuencia autolimpiante de `store_owner` (id 90, borrado); `B-2` asserts por fila; `B-3` `socials`/`cover_image` en el `POST` de evidencia; `B-4` probado por `psql`; `N-3` colisión literal; `N-5` `grep -cE '^\s+at '` = 0; `N-6`/`N-7`/`N-8`/`N-9` verificados |
| Tabla *File Changes* como valla de alcance | **Respetada** | Ver más abajo |

---

## Disciplina de alcance

`git diff --name-status da7dd84..HEAD` — **19 archivos, ninguno fuera de la tabla**:
los 11 de código previstos (5 en `packages/db`, 6 en `apps/api/rest`, de los cuales 2
`Create`) más los 8 artefactos SDD de `openspec/changes/escrituras-tags-manufacturers/`.

**Confirmado sin diff** (`git diff --stat da7dd84..HEAD --`, salida vacía, exit 0):
`packages/db/src/slug.ts` · `packages/db/src/domain-errors.ts` ·
`apps/api/rest/src/common/errors/**` · `packages/db/src/errors.ts` · `db/schema.sql` ·
`db/seed.sql` · `packages/db/prisma/schema.prisma` · `apps/api/rest/src/main.ts` ·
`tags.controller.ts` · `manufacturers.controller.ts` · `tag.entity.ts` ·
`manufacturer.entity.ts` · `update-tag.dto.ts` · `update-manufacturer.dto.ts` ·
`apps/shop/**` · `apps/admin/**`.

`findOrCreateManufacturerBySlug` verificado intacto por lectura (el código nuevo está
íntegramente por debajo de su cierre).

## Higiene de finales de línea

Auditado byte a byte sobre los **blobs comprometidos** (no sobre el working tree) con un
script de node: en los 4 commits, **todos** los archivos tienen `CR = 0` y `loneCR = 0`
(LF puro en el object store). **Cero `\r` sueltos en cualquier archivo comprometido.**
Y ningún diff es una reescritura fantasma de archivo completo: la única que hubo
(`tags.repository.ts`, 213/213) quedó **fuera** del historial alcanzable al hacer
`--amend` `e140224` → `d6cf840`, cuyo diff contra su padre es `0/3`.

## Tareas

**24 de 24 tareas marcadas `[x]`, y las 24 verificadas como realmente ocurridas** por
inspección de código y/o reejecución. Única excepción declarada y correcta: la tarea
**4.11** dice explícitamente que el `push` **no** se ejecutó (confirmado:
`git ls-remote --heads origin us-27b-escrituras-tags-manufacturers` → vacío; la rama es
solo local). No hay ninguna tarea de implementación sin hacer.

## Divergencias declaradas — reverificadas

| # | Estado | Nota |
|---|---|---|
| `V-1` `socials`/`cover_image` aceptados e ignorados | **Real y exacta** | `POST` con los dos → 201; respuesta `socials: []`, `cover_image: null` |
| `V-2` `language` de `manufacturers` ignorado (sin columna) | **Real y exacta** | Enviado `"language":"es"`, respuesta `"language":"en"`; `db/schema.sql:281-292` sin columna. Contraste: `tags.language` **sí** persiste (`POST` con `"fr"` → columna `fr`) |
| `V-3` `shop_id` declarado e ignorado | **Real y exacta** | Enviado `"shop_id":"7"` → 201, ignorado, sin error |
| `V-4` `products_count`/`translated_languages` constantes | **Real y exacta** | `0` y `["en"]` en todas las respuestas |
| `V-5` `image: null` **no** limpia la columna | **FALSA** | → `W-1`. La columna se sobreescribe con jsonb `null` |
| `V-6` la respuesta no trae `created_at`/`updated_at` | **Real y exacta** | 9 y 13 claves, sin timestamps; `updated_at` observado solo por `psql` |
| `V-7` el 400 de `InvalidReference` puede nombrar mal el campo | **Real, y ya remediada** | `desconocida` en vez de `slug`; ver el juicio de `S-1` |
| `V-8` las lecturas conservan `isPrismaConnectionError` | **Real y exacta** | Las dos cadenas coexisten en los dos servicios: lecturas con `isPrismaConnectionError` + `InternalServerErrorException`, escrituras con `toWriteHttpException`. Con la base caída **las dos** dan 503 (verificado), así que la divergencia no es observable por HTTP hoy |
| `V-9` `findOrCreateManufacturerBySlug` sin call site en TS | **Real y exacta** | Intacta; consumidor es el scraper en Python |
| `V-10` `manufacturer.entity.ts` tipa `type_id` como `string` | **Real y exacta** | No corregida; coerción en el servicio. Es la causa de `W-2` |
| `V-11` bump no restaurable de `products.updated_at` | **Real pero subestimada** | → `W-6`: ocurre en **cada** `just db-check`, no solo en el setup manual |
| `V-12` 4 commits secuenciales, sin PRs | **Real y exacta** | 4 commits en una rama local; sin push |
| `V-13` `@IsBoolean` en `is_approved` + timestamps al `OmitType` | **Real y exacta** | Presentes en `create-manufacturer.dto.ts` |
| Efectos de desenlace de `deleteTag`/`deleteManufacturer` | **Reales y exactos** | `SET NULL` y `CASCADE` los hace Postgres; el repositorio no toca `product_tag` ni `products` (verificado por lectura y por runtime) |

---

## NOT VERIFIED (declarado, nunca inferido)

1. **`SlugConflictError` → 409 sobre HTTP.** Sin productor determinista: `generateSlug`
   agota el sufijo antes de intentar el INSERT, así que solo lo alcanza una carrera de
   dos `POST` simultáneos con el mismo nombre. Cubierto **a nivel de jest** con fixture
   (tests `SlugConflictError del repositorio → 409` en los dos specs, verdes en mi
   corrida). **No probado por HTTP.**
2. **`DependentRowsError` → 409.** No tiene productor en esta US por construcción.
   Cubierto en jest, no por HTTP. (Sí tendrá productor en US-30 — ver *forward* punto 4.)
3. **Si Prisma 7 + `adapter-pg` puebla `meta.field_name` en algún P2003.** Observé que
   **no** lo hace en las rutas de esta US (de ahí `desconocida`), pero es un dato
   empírico de esta versión del driver, no una garantía.
4. **`meta.target` como array en un P2002 real.** No conseguí un P2002 determinista (ver
   punto 1), así que la rama `Array.isArray(target)` de `domain-errors.ts:144` sigue sin
   observación de runtime. Es justo la rama que decide si el riesgo del punto 2 del
   *forward* para `products` se materializa.
5. **`staff` sobre `/api/manufacturers`.** `ADMIN_OWNER_AND_STAFF` le abre la ruta, pero
   no hay relación staff↔tienda en la base (decisión 8, diferida) y `CA-5` no lo pide.
   No probado.
6. **Escrituras concurrentes sobre la misma fila.** `updateTag`/`updateManufacturer` no
   usan transacción ni bloqueo optimista; último escritor gana. Fuera de alcance, no
   probado.
7. **`socials`/`cover_image`/`language`(manufacturers)/`shop_id` persistidos.** No tienen
   columna; solo verifiqué que **no** producen error y que la respuesta emite las
   constantes de la lectura.
8. **El toggle del admin end-to-end desde el navegador.** Reproduje su payload exacto de
   5 claves por `curl` (`manufacturer-list.tsx:134-142`, leído para confirmar que
   `type_id` sale de `record?.type.id`, numérico). **No** pulsé el switch en el navegador.
9. **`just db-test` (scraper).** Roto desde antes (tabla `productos`, US-6), sin relación
   con esta US. No ejecutado.
10. **`just build`** (shop + admin de producción). No ejecutado: la DoD de esta US pide
    `just build-api` y `just verify`, que sí corrí. `rules.verify.build_command` apunta a
    `just build`; lo declaro como no cubierto en vez de darlo por bueno.

---

## Entorno que dejo atrás

**Base de datos** (`docker exec safari-postgres psql`, con `just db-check` detenido):

```
tags                                     10   ← baseline
manufacturers                            14   ← baseline
product_tag                               0   ← baseline
products                               1200   ← baseline
products WHERE manufacturer_id IS NOT NULL 0  ← baseline
types                                    10
leftovers 'vf-%' en tags / manufacturers  0 / 0
leftovers 'zz-%' en tags / manufacturers  0 / 0
```

- **Contenedor:** `safari-postgres` **Up (healthy)**, `0.0.0.0:5433->5432/tcp`.
  Lo **detuve y arranqué** (`docker stop`/`docker start`) una vez, a propósito, para
  probar la rama 503; el volumen no se tocó y los 5 conteos se reverificaron después.
  **`just db-reset` NUNCA se ejecutó.**
- **Limpieza:** toda por el **id exacto que devolvió la respuesta** (tags 298, 300, 301,
  302, 303, 304; manufacturers 86, 88, 89, 90, 91), nunca por `id > N`. `git status`
  final: **limpio** (salvo este informe).
- **Derivas no restaurables, declaradas:** `tags_id_seq` 255 → **1191** y
  `manufacturers_id_seq` 43 → **109** (10 corridas de la suite + el script de la
  reproducción + mis sondas). Ningún assert depende de posiciones de secuencia.
  `products.updated_at` de la fila **id 1** movido a `2026-09-10 16:58:13.994785+00`
  (`V-11` / `W-6`); la fila id 2 **intacta** (insertar en `product_tag` no dispara el
  trigger de `products`).
- **Procesos:** encontré **tres** árboles `nest start --watch` huérfanos preexistentes
  (raíces `600`, `23212` y uno más), y **el que servía el 9001 era el huérfano `600`**,
  que se había rebindeado solo al detectar el `dist/` que acababa de escribir mi
  `just build-api` — mi propio `yarn start:dev` murió con `EADDRINUSE`. **Es el modo de
  fallo que este repo lleva reportando varias sesiones, y en esta casi contamina la
  evidencia** (habría verificado contra un proceso que no lancé). Maté los tres árboles
  y lancé **un solo** proceso controlado, `env PORT=9001 node -r
  source-map-support/register dist/main` (sin `--watch`, para que ningún rebuild lo
  reinicie a mis espaldas). Reiniciado dos veces a propósito para la evidencia de
  `CA-1`/`CA-2`. `shop-dev` y `admin-dev` levantados solo para `just verify`.
  **Todo muerto al cierre**: `netstat` de `:9001`, `:3002` y `:3003` → **vacío**, y no
  queda ningún `nest start --watch` ni `node dist/main` vivo.
- **Archivos temporales:** todos en el scratchpad de la sesión. El único script que
  escribí dentro del repo (`packages/db/vf-race.cjs`) se borró en la misma invocación;
  `git status` limpio lo confirma.

---

## Recomendación

1. **Resolver `C-1` antes de archivar.** Es un arreglo de pocas líneas en
   `tags.integration.test.ts` (producto sonda propio en vez del sembrado id 1), dentro de
   un archivo que esta US ya modifica. Dejarlo para "más tarde" significa que US-28 lo
   duplica y que todo verify futuro arranca sin poder confiar en su gate.
2. **Decidir sobre `W-1`**: o se corrige el guard (`!== undefined && !== null`, una línea
   por sitio) o se corrige el texto de `V-5` para que declare lo que el código hace de
   verdad. Lo que no debe quedar es una divergencia declarada que es falsa.
3. **`W-3` como US propia** (guarda de `link.tag`/`link.category` en
   `products.repository.ts`), a resolver **antes** de US-28.
4. **`W-4`/`W-5` como insumo de planificación** para US-28/29/30: reanclar la estimación
   del spec de jest en ~500 líneas por agregado y remedir el volumen desde `git`, no
   desde el reporte de apply.
5. Sin hallazgos CRITICAL pendientes, este change está listo para `sdd-archive`
   (incluido el merge no estándar del bloque `## Out of Scope`, con su precedente
   declarado).

---
---

# ANEXO — Re-verificación dirigida de la remediación (commit `cc0059f`)

> **Este anexo NO modifica nada de lo anterior.** Todo lo que está por encima de
> esta línea es el registro de auditoría del primer pase de `sdd-verify`
> (`PASS WITH FINDINGS`, `blocking_for_archive: true`) y se conserva íntegro:
> veredicto, hallazgos, matrices y lista *NOT VERIFIED*. Este anexo solo añade el
> resultado de comprobar si la remediación cerró `C-1` y `W-1` sin romper nada más.

**Fecha:** 2026-09-10 · **Fase:** `sdd-verify` (re-verificación dirigida) ·
**Modo de artefactos:** `openspec` (Engram no conectado)
**Base:** `da7dd84` · **HEAD:** `cc0059f` · **Commit remediador:** `cc0059f`
**Postura:** adversarial e independiente, igual que el primer pase. **Todos los
comandos y todos los arneses se construyeron y ejecutaron de nuevo en esta
sesión.** No se copió ninguna cifra de `apply-progress.md` ni del mensaje del
commit `cc0059f`; esos textos se leyeron únicamente para saber qué había que
intentar refutar.

## Veredicto del anexo

> **`PASS WITH WARNINGS`** — **`blocking_for_archive`: `false`**.
>
> `C-1` (CRITICAL) está **cerrado con evidencia de control A/B propia**. `W-1`
> está **cerrado** en repositorio y sobre HTTP, en los dos agregados y en las dos
> operaciones. Los cuatro gates vuelven verdes con conteos reales. `CA-7` sigue
> intacto a nivel de byte. No queda ningún hallazgo CRITICAL.
>
> El cambio de veredicto **no** revoca el del primer pase: aquel era correcto para
> `ad4bb4b`. Este es el veredicto para `cc0059f`.

## 1. `C-1` — ¿desapareció de verdad?

Un tally verde no prueba nada aquí: el primer pase ya obtuvo 10/10 verdes **con
el defecto presente**. Así que la evidencia decisiva es un **control A/B a nivel
de mecanismo**, con arnés propio (`reverify-race.cjs`, escrito en esta sesión, en
el scratchpad; nunca dentro del repo) y con **las dos ramas ejecutadas por el
mismo arnés**:

- **Rama de control (código PRE-arreglo).** Se construyó `dist/vf-prefix.cjs`
  copiando el `dist/index.js` recién compilado y revirtiendo por string-replace
  **solo** los dos `.filter(...)`. Vive en `dist/`, que está gitignored, y se
  borró al cerrar (`git status` limpio, `ls dist/` sin residuos). El working tree
  **nunca** se modificó.
- **Rama arreglada.** El `dist/index.js` de `just db-build` sobre `cc0059f`.

Arnés: 2 lectores en bucle (`listProducts({ name })` + `findProductBySlug`) sobre
el producto sembrado **id 1** (`slug=apples`), y 1 escritor en bucle
(`createTag` -> `productTag.create(productId=1)` -> `deleteTag`), con limpieza por
id exacto.

| Rama | Duración | reads | writeCycles | **CRASHES** | Tasa |
|---|---|---|---|---|---|
| **Control (pre-arreglo)** | 20 s | 1863 | 772 | **364** | **19,5 %** |
| Arreglada | 90 s | 8658 | 3068 | **0** | 0 |
| Arreglada | 30 s | 2458 | 879 | **0** | 0 |
| **Arreglada, total** | 120 s | **11 116** | **3947** | **0** | **0** |

Firma del control, idéntica a la del primer pase y a la de las fases anteriores:

```
RESULT module=vf-prefix.cjs reads=1863 writeCycles=772 CRASHES=364
FIRST ERROR: TypeError :: Cannot read properties of null (reading 'id')
    at _toTagRecord (packages\db\dist\vf-prefix.cjs:554:17)
    at packages\db\dist\vf-prefix.cjs:1213:34
    at Array.map (<anonymous>)
cleanup -> tags=10 product_tag=0
```

```
RESULT module=index.js reads=8658 writeCycles=3068 CRASHES=0
cleanup -> tags=10 product_tag=0
```

**Cota.** El arnés reproduce el defecto al 19,5 % en el mismo binario, la misma
base y el mismo producto sonda; a esa tasa, 11 116 lecturas habrían producido
~2170 fallos. Se observaron **0**. Cota superior al 95 % de confianza con 0/11 116
=> **< 0,035 %**, es decir una reducción de al menos **x550** frente a la tasa
medida del control. No es "no lo vi": es "no puede estar a la tasa anterior".

**Gate designado, además:** `just db-check` x5 corridas secuenciales,
**9 archivos / 131 tests passed** y exit `0` en las cinco. Se declara
explícitamente como evidencia **corroborante, no probatoria** (ver arriba por qué).

`c1_closed`: **true**.

## 2. La pregunta de fondo: ¿el `.filter()` es correcto o solo cómodo?

Es la pieza más delicada de la remediación, porque un `.filter()` **descarta en
silencio**. Tres preguntas separadas, con respuesta medida:

### 2.1 ¿Puede existir una fila pivote huérfana en reposo? **No.** Demostrado.

`db/schema.sql:425-435` declara las dos pivotes con FK `NOT NULL` +
`ON DELETE CASCADE`. Verificado contra la base real (`pg_constraint`), no solo
contra el DDL: **no deferrable, no deferred** en las cuatro FKs.

```
product_tag_tag_id_fkey            FOREIGN KEY (tag_id)      REFERENCES tags(id)       ON DELETE CASCADE
product_tag_product_id_fkey        FOREIGN KEY (product_id)  REFERENCES products(id)   ON DELETE CASCADE
category_product_category_id_fkey  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
category_product_product_id_fkey   FOREIGN KEY (product_id)  REFERENCES products(id)   ON DELETE CASCADE
(condeferrable=f, condeferred=f en las cuatro)
```

Tres intentos de fabricar el huérfano, los tres rechazados por la base:

```
INSERT INTO product_tag VALUES (1, 999999);
  ERROR: violates foreign key constraint "product_tag_tag_id_fkey"
  DETAIL: Key (tag_id)=(999999) is not present in table "tags".

INSERT INTO product_tag VALUES (1, NULL);
  ERROR: null value in column "tag_id" ... violates not-null constraint

-- enlazar y luego borrar el tag, en la misma transacción:
pivot_before_delete=1
orphan_pivot_rows_after=0     <- el CASCADE se lleva la pivote atómicamente
```

**Conclusión: el `.filter()` no puede enmascarar un problema de integridad de
datos, porque ese problema no es representable.** Solo un
`session_replication_role = replica` o un `DISABLE TRIGGER ALL` de superusuario
podría crear la fila huérfana, y eso ya no es un estado alcanzable por la
aplicación.

### 2.2 ¿El array más corto es la respuesta correcta, o habría que emitir un error?

**Correcta.** La ventana en la que `link.tag` llega `null` es exactamente el
*read skew* interno de Prisma: la consulta 1 (filas de `product_tag`) ve un
snapshot pre-borrado y la consulta 2 (`tags` por id) ve uno post-borrado. Al
filtrar, la respuesta que se devuelve es **la misma que devolvería una lectura
íntegramente posterior al borrado**: el tag ya no existe, y el enlace tampoco
existe en reposo. Es decir, el resultado es **serializable a "leer después del
DELETE"**, que es una linealización legítima de dos operaciones concurrentes.

La alternativa —propagar un error— convertiría una carrera benigna en un **500**
en el SSR de la tienda, que es precisamente el `W-3` del primer pase. Y no hay
tercera vía razonable: no se puede "rellenar" el tag, porque ya no existe.

Tampoco hay riesgo de **falso descarte**: `link.tag` solo llega `null` cuando la
consulta 2 no encontró la fila en su snapshot, no por truncado ni por batching.
Nunca se pierde un enlace cuyo destino esté vivo.

Coherencia interna, además: la línea hermana `manufacturer` (`:511-513`) ya usaba
guarda de null por una razón *legítima y distinta* (`products.manufacturer_id` es
`NULLABLE`, FK `ON DELETE SET NULL`), y de paso cubría la carrera. La remediación
alinea `categories`/`tags` con ese precedente en vez de inventar un patrón.

### 2.3 La objeción real: la guarda es **invisible al sistema de tipos**.

Aquí está la única debilidad genuina. Prisma tipa `link.tag` y `link.category`
como **no-nullables**, así que `.filter((link) => link.tag !== null)` es, para
TypeScript, una condición que nunca puede ser falsa. `tsc --noEmit` pasa
(`exit 0`, verificado), pero eso significa que **nada mecánico impide que un
refactor futuro borre la guarda por "código muerto"**. Lo único que la sostiene
es el comentario en español que el propio commit añadió —que es bueno y explica
la causa raíz— y **ningún test**. Ver `RV-1`.

`filter_judgement`: **correcto, no meramente cómodo.** No puede enmascarar un
problema de integridad (2.1), devuelve la única respuesta consistente disponible
(2.2), y es coherente con la guarda hermana preexistente. Su fragilidad no es
semántica sino de **mantenimiento**: es invisible al compilador y no está cubierta
por ningún test.

## 3. `W-1` — ¿está cerrada?

Sí, en **las dos capas**, los **dos agregados** y las **dos operaciones**.
La distinción que importa es la del primer pase: `image IS NULL` (columna SQL
`NULL` = "ausente") frente a `jsonb_typeof(image) = 'null'` (jsonb `null` escrito
encima = pérdida). Medido con `psql` sobre la columna, nunca por la respuesta HTTP.

### 3.1 Nivel repositorio (contra `dist/` recién construido)

```
sanity: (0 != null)=true  ("" != null)=true  (false != null)=true  (null != null)=false

== TAGS ==
  1 create image=objeto           image={"id": 7, "original": "o"} | sqlNULL=false | jsonb_typeof=object
  2 update image=null             image={"id": 7, "original": "o"} | sqlNULL=false | jsonb_typeof=object | name=zzvf Img A2 details=keep-me
  3 update image=objeto nuevo     image={"id": 8, "original": "p"} | sqlNULL=false | jsonb_typeof=object
  4 update sin clave image        image={"id": 8, "original": "p"} | ... | details=changed-details
  5 update image=undefined        image={"id": 8, "original": "p"}
  6 create image=null             image=<SQLNULL>                  | sqlNULL=true
  7 create image=0 (falsy valido) image=0                          | jsonb_typeof=number

== MANUFACTURERS ==
  1 create image=objeto           image={"id": 7, "original": "o"} | jsonb_typeof=object | desc=keep-desc | web=https://keep.example
  2 update image=null             image={"id": 7, "original": "o"} | name=zzvf Img MA2 | desc=keep-desc | web=https://keep.example
  3 update image=objeto nuevo     image={"id": 8, "original": "p"}
  4 update sin clave image        image={"id": 8, "original": "p"} | desc=changed-desc | web=https://keep.example
  5 create image=null             image=<SQLNULL>                  | sqlNULL=true

cleanup -> tags=10 manufacturers=14 product_tag=0
```

### 3.2 Nivel HTTP (proceso compilado, token real de `admin@demo.com`)

```
POST /api/tags {"name":"Vf2 Img Tag","details":"keep-details","image":{...}} -> 201 id=7959
  psql: image={"id": 7, "original": "o"} sqlnull=false jt=object details=keep-details
PUT  /api/tags/7959 {"name":"Vf2 Img Tag B","image":null}                    -> 200
  psql: image={"id": 7, "original": "o"} sqlnull=false jt=object   <- INTACTA
        name=Vf2 Img Tag B  details=keep-details                   <- name sí cambió; details preservado
PUT  /api/tags/7959 {"image":{"id":8,"original":"p"}}                        -> 200
  psql: image={"id": 8, "original": "p"}                           <- SIGUE PUDIENDO FIJARSE
PUT  /api/tags/7959 {"details":"changed-details"}   (sin clave image)        -> 200
  psql: image={"id": 8, "original": "p"}  details=changed-details   <- ausencia respetada
POST /api/tags {"name":"Vf2 Img Tag Null","image":null}                      -> 201 id=7960
  psql: image=<SQLNULL> sqlnull=true                               <- "ausente", no jsonb null

POST /api/manufacturers {..."description":"keep-desc","website":"https://keep.example","image":{...}} -> 201 id=197
  psql: image={"id": 7, "original": "o"} desc=keep-desc web=https://keep.example
PUT  /api/manufacturers/197 {"name":"Vf2 Img Manu B","image":null}           -> 200
  psql: image={"id": 7, "original": "o"} jt=object                 <- INTACTA
        name=Vf2 Img Manu B  desc=keep-desc  web=https://keep.example
PUT  /api/manufacturers/197 {"image":{"id":8,"original":"p"}}                -> 200
  psql: image={"id": 8, "original": "p"}
PUT  /api/manufacturers/197 {"description":"changed-desc"}  (sin clave image)-> 200
  psql: image={"id": 8, "original": "p"} desc=changed-desc web=https://keep.example
POST /api/manufacturers {"name":"Vf2 Img Manu Null","image":null}            -> 201 id=198
  psql: image=<SQLNULL> sqlnull=true
```

Contraste directo con el primer pase, que sobre `PUT {"image":null}` midió
`image::text=null | image IS NULL = false | jsonb_typeof=null`. Ahora el valor
previo **no se toca**. La divergencia `V-5` del diseño («`image: null` se trata
como ausente y la columna queda intacta») pasa de **FALSA** a **REAL Y EXACTA**.

### 3.3 Tres comprobaciones que la remediación podía haber roto y no rompió

1. **`!= null` no descarta falsy válidos.** `image: 0` persiste como
   `jsonb_typeof=number`; `0 != null`, `'' != null` y `false != null` son `true`.
   El `!=` suelto acierta aquí: es el chequeo *nullish*, no un chequeo de
   veracidad. Habría sido un error usar `input.image &&`.
2. **Fijar imagen sigue funcionando** (casos 3 de las dos capas).
3. **La proyección HTTP no cambió.** El paso de jsonb `null` a `NULL` SQL en el
   `create` es invisible en el contrato: `POST` y `GET` emiten `"image": null` con
   la clave presente en los dos casos (verificado sobre el registro creado con
   `image: null`). No hay deriva de bytes.

**Nota de capas, sin consecuencia funcional hoy:** los servicios de Nest
(`tags.service.ts:140,176`, `manufacturers.service.ts:187,233`) siguen usando
`!== undefined`, así que el `null` del cliente **sí** cruza la frontera de servicio
y es el repositorio quien lo descarta. Como todas las escrituras pasan por el
repositorio, el comportamiento observable es correcto; pero la decisión vive en un
solo sitio, y sin test que la fije (ver `RV-1`).

`w1_closed`: **true**.

## 4. Barrido de regresión — los cuatro gates

| Gate | Resultado real | Exit |
|---|---|---|
| `just db-build` (previo, para que `dist/` refleje `cc0059f`) | Prisma Client 7.10.0 · `dist\index.js` **145.08 KB** · `dist\index.d.ts` 1.39 MB | `0` |
| `just db-check` x5 | **9 archivos / 131 tests passed** en las cinco | `0` x5 |
| `cd apps/api/rest && npx jest` | **8 suites / 135 tests passed**, 29,7 s | `0` |
| `just build-api` | `rimraf dist` + `nest build` · `Done in 21.17s` · sin errores de TypeScript | `0` |
| `just verify` | `OK API :9001/api/settings 200 5503B` · `OK Shop :3003/en 200 190788B cards:30` · `OK Admin :3002/en/login 200 72821B cards:1` | `0` |

Extras no exigidos por la DoD:

- `packages/db` -> `npm run typecheck` (`tsc --noEmit`) **exit 0**. Relevante:
  confirma que comparar contra `null` un tipo que Prisma declara no-nullable
  compila sin queja (y por eso mismo no protege — ver 2.3).
- `packages/db` -> `npm run lint` (`biome check .`) **exit 1, 26 errores**.
  **Preexistente y fuera de alcance:** son `assist/source/organizeImports` y un
  `lint/complexity/noUselessSwitchCase`, y fallan igual en archivos que este
  change **no toca** (`types.repository.ts`, `types.integration.test.ts`,
  `auth-tokens.integration.test.ts`); el `switch` señalado en
  `products.repository.ts:234` ya existía en `da7dd84`. `biome check` no es
  ninguno de los cuatro gates ni está en la DoD. Se registra, no se acciona.

### CA-1 — paridad de key-set, remedida

`node -e` sobre las respuestas reales, comparación posicional (`a[i]===b[i]`),
**sin `.sort()` en ningún punto**:

```
== tags == id=7961  POST=201 GET=200 PUT=200 DELETE=200
  keys(9) esperado=9 -> true
  orden POST===GET: true | POST===PUT: true | POST===DELETE: true
  keys: id,name,language,translated_languages,slug,details,image,icon,type
  GET tras DELETE -> 404
== manufacturers == id=199  POST=201 GET=200 PUT=200 DELETE=200
  keys(13) esperado=13 -> true
  orden POST===GET: true | POST===PUT: true | POST===DELETE: true
  keys: id,name,slug,language,translated_languages,products_count,is_approved,description,website,socials,image,cover_image,type
  GET tras DELETE -> 404
```

### CA-7 — piezas compartidas, byte a byte

```
$ git diff --stat da7dd84..HEAD -- packages/db/src/slug.ts packages/db/src/domain-errors.ts apps/api/rest/src/common/errors/
(salida vacía, exit 0)
$ git diff da7dd84..HEAD -- <los mismos tres paths> | wc -c
0
```

**Cero bytes** de diff en los tres paths protegidos, con el commit remediador
incluido en el rango. La distinción se sostiene: `products.repository.ts` **no**
es uno de los tres paths de `CA-7`; lo protegido dentro de `packages/db` es
`slug.ts` y `domain-errors.ts`, no todo el paquete. **`CA-7` no está afectado por
la remediación.**

## 5. Contabilidad de alcance — desviación declarada

`git diff --name-status da7dd84..HEAD` (con `cc0059f`): **12 archivos de código**
(antes 11) + 9 artefactos de `openspec/changes/escrituras-tags-manufacturers/`.
El archivo nuevo en la lista es:

```
M  packages/db/src/repositories/products.repository.ts     (13 añadidas / 2 borradas)
```

**Se declara sin ambages:** `products.repository.ts` **no aparece en la tabla
*File Changes* del diseño** (`design.md:459-479`), y esa tabla se declara a sí
misma cerrada («cualquier archivo fuera de ella con diff es una desviación que hay
que declarar»). Por tanto es una **desviación de alcance**, y fue una **decisión
explícita del usuario** tomada sobre el hallazgo `W-3` de este mismo informe: se
prefirió cerrar la causa raíz —que también es un 500 real de producción y la misma
trampa que espera a US-28 en la línea gemela de `categories`— antes que arreglar
solo el test, que habría sido frágil porque cualquier producto es compartido entre
suites. `sdd-archive` debe registrarla como **desviación declarada, no como
violación**: no toca ninguna pieza protegida por `CA-7`, no altera ningún contrato
HTTP y su diff son 13/2 líneas, de las cuales 8 son el comentario que documenta la
causa raíz.

Los otros 11 archivos siguen dentro de la valla, y siguen **sin diff** los paths
que el primer pase enumeró como intactos.

## 6. Higiene de finales de línea del commit remediador

Auditoría byte a byte sobre los **blobs comprometidos** de `cc0059f` (object
store, no working tree), con script propio de node:

```
CR=0 CRLF=0 loneCR=0    openspec/changes/escrituras-tags-manufacturers/verify-report.md
CR=0 CRLF=0 loneCR=0    packages/db/src/repositories/manufacturers.repository.ts
CR=0 CRLF=0 loneCR=0    packages/db/src/repositories/products.repository.ts
CR=0 CRLF=0 loneCR=0    packages/db/src/repositories/tags.repository.ts
```

**Cero `\r`** de cualquier tipo. Y **ninguna reescritura fantasma**: el diffstat es
quirúrgico (`2/2`, `2/2`, `13/2`) frente a archivos de 213, 240 y 528 líneas —
nada parecido al `213/213` que hubo que corregir con `--amend` en el commit #2.

## 7. Hallazgos NUEVOS que introduce la propia remediación

### WARNING

#### `RV-1` — Los dos arreglos van **sin ningún test que los fije**

`cc0059f` no toca un solo archivo de test (verificado: `git show --name-only` solo
lista los 3 repositorios y este informe). Consecuencias asimétricas:

- **`C-1` / la guarda de null:** es inherentemente difícil de testear (depende de
  una carrera) y además **invisible al sistema de tipos** (ver 2.3). Un refactor
  futuro puede borrar los dos `.filter()` como código muerto, `tsc` no dirá nada,
  y el gate volverá a ser no determinista al 8-20 %. Lo único que lo sostiene es
  el comentario del código. Mitigación barata y determinista disponible: un test
  de unidad sobre `_toProductRecord` con un payload sintético que traiga
  `{ tag: null }` / `{ category: null }` — no necesita carrera ni base.
- **`W-1` / `image: null`:** es **determinista y trivial de testear**, y sigue sin
  test. `grep` sobre `tags.integration.test.ts` y
  `manufacturers.integration.test.ts` -> **0 asserts sobre `image`**; en los specs
  de jest, `image: null` aparece solo como dato de fixture
  (`tags.service.spec.ts:73`, `manufacturers.service.spec.ts:75`), nunca como
  aserción de la semántica de escritura. Es exactamente la condición que permitió
  que `V-5` fuera falsa durante todo el change sin que nadie lo notara: la
  divergencia estaba *declarada* y por eso quedó *sin probar*. Cerrar el código
  sin cerrar la cobertura deja el mismo agujero abierto para la próxima vez.

**No bloquea el archivo** (nada está roto ahora mismo, y añadir tests saldría de la
tabla *File Changes* igual que el arreglo), pero debe viajar a US-28 como trabajo
con dueño.

#### `RV-2` — El arreglo es un parche puntual en 2 de 6 sitios estructuralmente idénticos

El mensaje del commit justifica salirse del alcance apelando a que se pre-empta
US-28. Es cierto para `categories`, pero la **clase** de defecto —desreferenciar
sin guarda el destino de un `include` que Prisma resuelve en dos consultas—
sobrevive en otros cuatro sitios del mismo `packages/db`:

| Sitio | Forma | ¿Alcanzable hoy? |
|---|---|---|
| `products.repository.ts:509` `type: _toTypeRecord(row.type)` | to-one sin guarda. `products.type_id` es `NOT NULL` -> `types` `ON DELETE CASCADE` | **Casi no.** `DELETE /api/types` existe desde US-27a, pero `deleteType` cuenta dependientes y devuelve 409 si hay productos o categorías; solo queda el TOCTOU ya declarado de US-27a |
| `products.repository.ts:510` `shop: _toShopRecord(row.shop)` | to-one sin guarda. `products.shop_id` es `NOT NULL` -> `shops` `ON DELETE CASCADE` | **No hoy** (no hay ruta que borre tiendas) — **pero es justo la que abre US-30**, y borrar una tienda arrastra sus productos |
| `categories.repository.ts:99` `_toTypeRecord(row.type)` | to-one sin guarda | Igual que el primero, cubierto por el 409 de `deleteType` |
| `users.repository.ts:181` `row.permissions.map((link) => _toPermissionRecord(link.permission))` | **pivote sin guarda, forma idéntica a la que se acaba de arreglar**. `permission_user` con las dos FKs `ON DELETE CASCADE` | **No**: no existe ninguna ruta que borre permisos (tabla de referencia estática) |

Ninguno es explotable hoy, así que **no bloquea el archivo**. Pero la lectura
correcta es que la remediación **no** cerró la clase: la cerró en los dos sitios
donde el gate la hizo visible. **US-30 debe guardar `row.shop` antes de añadir
`deleteShop`**, o reproducirá `C-1` con la firma `_toShopRecord`. Conviene
apuntarlo en el diseño de US-30 en lugar de redescubrirlo en verify.

### SUGGESTION

#### `RV-3` — El «5503 bytes» de `/api/settings` son 5503 **caracteres**, no bytes

Hallazgo lateral, no atribuible a este change, pero toca el invariante central del
repo. `just verify` reporta `5503B` porque su script acumula el body en una
**string de JS** y mide `body.length` (unidades UTF-16, `justfile:196-204`). El
payload real pesa **5504 bytes** (`curl | wc -c` y `Content-Length: 5504`,
deterministas: mismo `md5` en 3 muestras consecutivas). La diferencia es un único
carácter no-ASCII, el `©` del `copyrightText`:

```
bytes= 5504   js_string_length= 5503   delta= 1   non-ascii= ["©"]
```

No hay ninguna deriva: las dos cifras miden cosas distintas. Pero `CLAUDE.md`
documenta el precedente de `/api/settings` como «5503 bytes antes y después», y
`just verify` imprime una `B` que sugiere bytes. Con «contratos preservados byte a
byte» como regla de diseño del épico, conviene que la unidad del medidor sea la
que dice ser — o que la doctrina diga «caracteres».

## 8. Hallazgos ARRASTRADOS — confirmación de que siguen en pie

No remediados y no re-litigados: solo comprobados otra vez para que
`sdd-archive` los arrastre con exactitud.

| # | Estado | Comprobación propia de este anexo |
|---|---|---|
| **`W-2`** asimetría de `type_id` string, con mensaje falso en `tags` | **EN PIE, sin cambios** | `POST /api/tags {"name":"Vf3 Str","type_id":"9"}` -> **400** `` `tags.type_id` referencia un registro inexistente (`9`). `` — y el type 9 **existe**. `POST /api/manufacturers` con el mismo body -> **201**, `type={"id":9,"name":"Gadget","slug":"gadget","logo":null}`. Reproducido literal |
| **`W-3`** NPE en `products.repository.ts` | **CERRADO** por la remediación en `categories`/`tags`; **abierto** en `type`/`shop` -> reclasificado como `RV-2` |
| **`W-4`** volumen +26 % | **EN PIE, ligeramente peor** | Remedido con `git diff --numstat` (solo código): `684eef4` 364 · `d6cf840` 620 · `aaeed9b` 386 · `ad4bb4b` 730 · `cc0059f` **23**. Neto `da7dd84..HEAD` = **2037 añadidas / 72 borradas / 2109 cambiadas** (era 2094) vs ~1666 previstas => **+26,6 %**. Anclas confirmadas: `tags.service.spec.ts` **474**, `manufacturers.service.spec.ts` **551**. La recomendación de reanclar en ~500 líneas por agregado sigue vigente |
| **`W-5`** aritmética de `apply-progress.md` | **EN PIE, verbatim** | El archivo sigue afirmando `manufacturers.service.spec.ts` = **498** líneas (`:824`, `:841`, `:1285`, `:1295`) y `39 + 109 + 498 = 646 added`. Real (`git show --numstat ad4bb4b`): **551/0**; `create-manufacturer.dto.ts` **38/8** (afirmado 39/6); `manufacturers.service.ts` **108/25** (afirmado 109/31). `wc -l` confirma 551 |
| **`W-6`** `V-11` subestimada: el bump ocurre en **cada** `just db-check` | **EN PIE, y ahora con serie temporal** | `products.updated_at` de la fila **id 1**: `2026-09-10 16:58:13.994785+00` al cierre del primer pase -> **`2026-09-10 17:45:17.506137+00`** al cierre de este anexo. Lo movieron **solo mis 5 corridas del gate** (`manufacturers.integration.test.ts:215-237` hace `prisma.product.update` sobre el producto sembrado id 1, y otra vez al `SET NULL`). La fila **id 2** sigue en `2026-09-02 15:33:36.102816+00`, intacta. Prueba directa de que la deriva es por corrida de gate, no residuo de setup manual |
| `S-1`, `S-2`, `S-3` | **EN PIE** | No tocadas. `S-3` (ausencia de `vitest.config.*`) gana peso: sigue siendo la razón por la que los 9 archivos corren en paralelo y por la que `C-1` fue posible |

## 9. Lista *NOT VERIFIED* — sin cambios

Los **10 puntos** de la sección *NOT VERIFIED* del primer pase siguen vigentes tal
cual: la remediación no aporta evidencia sobre ninguno y este anexo tampoco los
persiguió (no estaban en el encargo). En particular siguen sin observación de
runtime `SlugConflictError`->409 y `DependentRowsError`->409 sobre HTTP,
`meta.target` como array en un P2002 real, y `just build` (shop+admin de
producción). **No se degradó ni se "cerró por conveniencia" ninguno.**

## 10. Entorno que dejo atrás

**Base de datos** — exactamente como la encontré, verificado con `just db-check`
detenido y todos los procesos muertos:

```
tags                                     10   <- baseline
manufacturers                            14   <- baseline
product_tag                               0   <- baseline
products                               1200   <- baseline
products WHERE manufacturer_id IS NOT NULL 0  <- baseline
types                                    10
categories                              198
category_product                           0
leftovers 'Vf%' / 'zz%' en tags y manufacturers: 0
```

- **`just db-reset` NUNCA se ejecutó.** El contenedor `safari-postgres` no se paró
  ni se arrancó en este anexo: `Up About an hour (healthy)`,
  `0.0.0.0:5433->5432/tcp`.
- **Limpieza toda por id exacto devuelto por la respuesta** — tags 7959, 7960,
  7961, 7962; manufacturers 197, 198, 199, 200 — más los centinelas del arnés
  (`zzvf-race-*`) y de la sonda de repositorio (`zzvf-img-*`), borrados por id y
  con un barrido final por prefijo propio. Nunca un `id > N`.
- **Derivas no restaurables, declaradas:** `tags_id_seq` -> **7962** y
  `manufacturers_id_seq` -> **200** (el arnés del control A/B creó y borró ~3900
  tags). Ningún assert del repo depende de posiciones de secuencia (los tests de
  colisión usan sufijos de slug, no ids). `products.updated_at` de la fila id 1
  movido otra vez, ver `W-6`; la fila id 2 sigue intacta.
- **Procesos: cero orfandades.** Antes de empezar comprobé el **dueño del puerto**
  y no solo la respuesta: `netstat` no mostraba nada en 9001/3002/3003, y los 12
  `node.exe` vivos eran servidores MCP de la sesión (`chrome-devtools-mcp`,
  `memento`), ninguno un `nest start --watch` — el primer pase había limpiado
  bien. Levanté **un solo** proceso de API, `env PORT=9001 node -r
  source-map-support/register dist/main` (sin `--watch`), y **verifiqué que el PID
  que servía el 9001 era el mío** antes de fiarme de cualquier respuesta:
  `PID 35100`, `CreationDate 12:47:24`, `CommandLine ... dist/main`. Un segundo
  intento de arranque murió con `EADDRINUSE` — era mi propio primer proceso, no un
  huérfano; se confirmó por PID y hora de creación, no por suposición. Después
  `just shop-dev` (61144) y `just admin-dev` (41452) solo para `just verify`.
  **Los tres muertos al cierre**: `netstat` de 9001/3002/3003 vacío y ningún
  `node` con `nest`/`next`/`dist/main` en su línea de comandos.
- **Archivos:** todos los arneses en el scratchpad de la sesión, fuera del repo.
  El único artefacto escrito dentro del repo fue `packages/db/dist/vf-prefix.cjs`
  (el build de control A/B), en un directorio **gitignored** y **borrado** al
  cerrar (`ls dist/` -> solo `index.d.ts`, `index.js`, `index.js.map`).
  `git status --porcelain` -> **vacío** salvo este anexo.

## 11. Recomendación del anexo

1. **`sdd-archive` está desbloqueado.** No queda ningún hallazgo CRITICAL. Al
   archivar, registrar `products.repository.ts` como **desviación de alcance
   declarada** (§5), no como violación.
2. **Arrastrar `W-2`, `W-4`, `W-5`, `W-6`, `S-1`, `S-2`, `S-3`** al informe de
   archivo tal como están redactados; los cuatro `W` se reconfirmaron aquí uno a
   uno.
3. **`RV-1` y `RV-2` como insumo de US-28, con dueño:** (a) un test de unidad
   determinista sobre `_toProductRecord` con `{tag:null}`/`{category:null}` —
   fija la guarda que el compilador no protege; (b) un assert de integración de
   `image: null` en las dos suites; (c) **guardar `row.shop` antes de que US-30
   añada `deleteShop`**, y `row.type` de paso.
4. **`S-3` sube de prioridad:** `packages/db/vitest.config.ts` con aislamiento
   explícito por archivo sigue siendo material de US-10 / Épico 9, pero es la
   causa estructural de que `C-1` fuera posible y de que `DD-8.1` exista.
5. **`RV-3`** es una corrección de una línea en `CLAUDE.md` o en el `justfile`, a
   criterio del dueño del repo.
