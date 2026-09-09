# Exploration: Escrituras de `types` y piezas compartidas (US-27a)

> **Nota de alcance (añadida por el orquestador tras la partición del
> 2026-09-09).** Esta exploración se hizo cuando la US cubría los **tres**
> catálogos planos. Tras el pronóstico de ~1500 líneas de `proposal.md`, la
> US-27 original se partió en **US-27a** (`types` + las dos piezas
> compartidas — el alcance de ESTE change) y **US-27b** (`tags` +
> `manufacturers`). Los hallazgos sobre `tags` y `manufacturers` que siguen
> **son válidos y quedan aquí a propósito**: son el punto de partida de
> US-27b, no hace falta re-explorarlos. Lo que este change implementa es solo
> la parte de `types` más el helper de slug y el mapeo de errores. Ver
> `docs/product/26-escrituras-catalogo-postgres/README.md`, sección
> "Partición de US-27".

## Current State

### Los stubs — verificados, coinciden con lo citado en la US (sin drift material)

- `apps/api/rest/src/types/types.service.ts`: `create()` (:92-94) devuelve
  `this.types[0]`; `update()` (:104-106) ídem; `remove()` (:108-110) devuelve
  el string `This action removes a #${id} type`. `findAll()` (:96-98) y
  `findOne()` (:100-102) son restos muertos — confirmado: `types.controller.ts`
  solo invoca `create`, `getTypes` (`@Get()`), `getTypeBySlug` (`@Get(':slug')`),
  `update`, `remove`; nunca `findAll`/`findOne`. Import de `@db/types.json`
  (:19) + `Fuse` (:20, instanciado :29) sin uso funcional real (queda
  `private types: Type[] = types` solo para alimentar los stubs).
- `apps/api/rest/src/tags/tags.service.ts`: `create()` (:67-72) fabrica
  `id: this.tags.length + 1` y hace spread del DTO sin persistir; `update()`
  (:131-133) devuelve `this.tags[0]`; `remove()` (:135-137) string stub.
  Mismos imports huérfanos (`@db/tags.json` :22, `Fuse` :24/:33).
- `apps/api/rest/src/manufacturers/manufacturers.service.ts`: `create()`
  (:76-78) → `this.manufacturers[0]`; `update()` (:171-178) **muta el array
  en memoria** (`manufacturer.is_approved = updateManufacturesDto.is_approved
  ?? true`) — sobrevive en memoria del proceso, se pierde al reiniciar;
  `remove()` (:180-182) devuelve literalmente `This action removes a #${id}
  product` (el "sic" de la US es correcto — dice "product", no "manufacturer").
  Mismos imports huérfanos (`@db/manufacturers.json` :8, `Fuse` :10/:38).

Las líneas citadas en la US y el epic README coinciden con el código actual
carácter por carácter en los fragmentos verificados (offsets ±1-2 líneas por
formato, sin drift de contenido). **No se encontró drift** en esta sección.

### Mappers de lectura — key-sets confirmados

- `toTypeDto` (`types.service.ts:39-51`): 9 claves — `id, name, language,
  translated_languages, slug, banners, promotional_sliders, settings, icon`.
  `promotional_sliders` es constante `null` (V-8), `translated_languages`
  constante `['en']` (V-9).
- `toTagDto` (`tags.service.ts:43-61`): 9 claves — `id, name, language,
  translated_languages, slug, details, image, icon, type`. `type` se resuelve
  en memoria contra un `Map<number, TypeRecord>` construido desde
  `listTypes()`.
- `toManufacturerDto` (`manufacturers.service.ts:48-70`): 13 claves — `id,
  name, slug, language, translated_languages, products_count, is_approved,
  description, website, socials, image, cover_image, type`. `is_approved:
  Number(record.isApproved)` (coerción booleano→0/1, línea 60 exacta — el
  update futuro debe preservar esa proyección). `products_count`, `socials`,
  `cover_image`, `language` son constantes (V-1/V-2/V-3/V-10).

Esto coincide con `openspec/specs/flat-catalogs-api/spec.md` (Requirement
"Key-set snake_case por catálogo": types 9, tags 9, manufacturers 13) y con
la decisión 3 del épico (D-6: las escrituras deben reutilizar estos mismos
mappers). El contrato CA-1 (POST/PUT con el mismo key-set y orden que el GET)
es alcanzable con solo llamar a `toTypeDto`/`toTagDto`/`toManufacturerDto`
sobre el `Record` que devuelva el nuevo `createX`/`updateX` del repositorio —
no hace falta un mapper nuevo.

### `packages/db` — repositorios actuales y precedente de escritura

- `types.repository.ts` (32 líneas): solo `listTypes`/`findTypeBySlug`.
- `tags.repository.ts` (53 líneas): solo `listTags`/`findTagBySlug`.
- `manufacturers.repository.ts` (71 líneas): `listManufacturers`,
  `findManufacturerBySlug`, y `findOrCreateManufacturerBySlug` (para el
  scraper) — este último ya es un `prisma.manufacturer.upsert({ where:
  {slug}, create: {...}, update: {} })`, precedente directo pero **no**
  cubre `create/update/delete` explícitos para el admin.
- `packages/db/index.ts` (111 líneas) exporta hoy solo lecturas de los tres
  catálogos (`findTypeBySlug/listTypes`, `findTagBySlug/listTags`,
  `findManufacturerBySlug/findOrCreateManufacturerBySlug/listManufacturers`).
  Ningún `create*`/`update*`/`delete*` de agregados planos existe todavía —
  US-27 los introduce desde cero.
- **Precedente de escritura real**: `upsertScrapedProduct`
  (`products.repository.ts:328-397`). Patrón a replicar:
  1. Validación de dominio ANTES del INSERT/UPDATE (aquí:
     `input.salePrice >= input.price` → `throw new InvalidSalePriceError`,
     línea 331-333).
  2. El `slug` NUNCA se toca en `update` (comentario explícito, línea 382).
  3. `try { await prisma.product.upsert(...) } catch (error) { throw
     _translateCheckViolation(error) }` (líneas 364-396) — backstop que
     traduce el nombre del constraint violado en el mensaje de error de
     Postgres a una clase de error de dominio (`_translateCheckViolation`,
     líneas 454-466, matching por `message.includes('constraint_name')`).
  4. Errores de dominio son clases (`InvalidSalePriceError`,
     `MissingPriceError`, `IncompleteProvenanceError`) con `code` y `name`
     propios, exportadas desde `index.ts` (líneas 72-76).
  5. Los pivotes (`categoryIds`/`tagIds`) se reemplazan completos con
     `deleteMany({}) + create(...)` solo si el caller los envía (patrón
     útil para CA-3: borrar `product_tag` al eliminar un tag).

  Este precedente resuelve directamente R-5 (inputs tipados explícitos,
  nunca spread del body a Prisma) y da la forma exacta que deberían tener
  `createType/updateType/deleteType` etc.

### Slug — la función SQL, verbatim

`db/schema.sql:39-61`:
```sql
CREATE OR REPLACE FUNCTION unaccent_simple(texto text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT translate(texto,
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC');
$$;

CREATE OR REPLACE FUNCTION slugify(texto text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT trim(both '-' from
        regexp_replace(
            regexp_replace(
                lower(unaccent_simple(texto)),
                '[^a-z0-9]+', '-', 'g'
            ),
            '-{2,}', '-', 'g'
        )
    );
$$;
```
Confirmado carácter por carácter contra la cita de la US (`schema.sql:39-61`,
`:48-61` en el epic). Ningún trigger la invoca — la usa el scraper desde
Python replicando la regla en `services/scraper-worker` (fuera de alcance
aquí, solo referencia).

**Las dos estrategias candidatas que la US pide sopesar (sin decidir):**

| | A. Reimplementar en TS | B. Delegar a Postgres (`SELECT slugify($1)`) |
|---|---|---|
| Correctness | Riesgo de diverger sutilmente (Unicode normalization, rangos de `[^a-z0-9]+`, orden de `trim`/`collapse`) — hay que portar la tabla de 51 caracteres de `translate()` a mano | Cero riesgo de divergencia: es la MISMA función que ya usa el scraper y que valida el UNIQUE |
| Round-trips | Ninguno extra: cálculo in-process | +1 round-trip por escritura (`SELECT slugify($1)` antes del INSERT); mitigable combinándolo en la misma transacción/CTE del INSERT |
| Testabilidad | Test unitario puro en TS, rápido, sin DB — pero el propio test que la US pide (comparar contra la función SQL) exige tener Postgres arriba de todos modos para no perder cobertura de divergencia | El test de comparación es trivial (literalmente llama a ambos lados con el mismo input) pero requiere DB en CI/dev siempre — ya es el caso hoy (`just db-check` la exige) |
| Colisión | Requiere una query aparte de todos modos (`SELECT slug FROM {tabla} WHERE slug LIKE base || '%'`) en ambas estrategias — no es un diferenciador | igual |
| Mantenimiento a 2 lugares | Si la función SQL cambia algún día, hay que recordar sincronizar el TS | Un solo lugar de verdad — cambios al DDL se reflejan solos |
| Precedente del repo | Ninguno — sería la primera lógica de negocio duplicada BD/TS | Alineado con el principio ya aplicado (`_translateCheckViolation` también consulta el mensaje que devuelve Postgres, no reimplementa el CHECK) |

Sin recomendación cerrada aquí (corresponde a `sdd-design`), pero la
inclinación de la propia US ("Opción más segura: pedirle el slug a
Postgres") es consistente con el patrón ya establecido en el repo de no
duplicar reglas de validación entre capas.

### Errores de dominio → HTTP (D-4)

`apps/api/rest/src/common/` HOY contiene: `common.module.ts`,
`constants.ts`, `dto/`, `entities/`, `pagination/`, `search/`. **No existe
`apps/api/rest/src/common/errors/`** — es 100% código nuevo, no un refactor.
El repeticiones de `isPrismaConnectionError` (backstop de conexión) aparecen
en **10 archivos / ~26 sitios** de todo `apps/api/rest/src` (auth, categories,
manufacturers ×3, products ×6, shops ×4, tags ×2, types ×2, users ×2) — la
nueva traducción D-4 debe convivir con ese patrón existente sin tocarlo
(decisión explícita del épico: los métodos de lectura NO se refactorizan
aquí). `main.ts:9` confirma `app.useGlobalPipes(new ValidationPipe())` sin
`whitelist`/`transform` — cualquier campo desconocido en el body llega
íntegro al DTO/servicio.

### Schema — columnas, CHECKs, FKs (verbatim, sin drift)

- `types` (`schema.sql:90-101`): `id, name, slug UNIQUE, icon, settings
  jsonb NOT NULL DEFAULT '{}', banners jsonb NOT NULL DEFAULT '[]',
  language DEFAULT 'es', created_at, updated_at`. Sin columna para
  `promotional_sliders`.
- `manufacturers` (`:281-292`): `id, name, slug UNIQUE, description,
  website, image jsonb, type_id → types(id) ON DELETE SET NULL, is_approved
  boolean NOT NULL DEFAULT true, created_at, updated_at`. Sin `socials` ni
  `cover_image`.
- `tags` (`:295-306`): `id, name, slug UNIQUE, details, icon, image jsonb,
  type_id → types(id) ON DELETE SET NULL, language DEFAULT 'es', created_at,
  updated_at`.
- Triggers `tocar_updated_at()` (`:480-500`) cubren `products, categories,
  shops, users, profiles` — confirmado que **NO** incluyen `types`, `tags`,
  `manufacturers`: el repositorio deberá fijar `updatedAt: now()` a mano en
  cada `update*` (decisión 9), usando `now()` de `packages/db/src/clock.ts`
  (mismo import que usa `upsertScrapedProduct`).
- FKs relevantes para el borrado protegido de `types` (decisión 7 / R-1):
  `categories.type_id → types(id) ON DELETE CASCADE` (`:269`),
  `products.type_id → types(id) ON DELETE CASCADE` (`:331`). Sin protección
  a nivel de API, un `DELETE FROM types WHERE id = X` borraría en cascada
  TODAS las categorías y productos de esa vertical. La cuenta que
  `deleteType` debe hacer antes de borrar es `COUNT(*) FROM categories WHERE
  type_id = X` + `COUNT(*) FROM products WHERE type_id = X` (dos queries o un
  `EXISTS` compuesto) → 409 si cualquiera es > 0.
- `manufacturers.type_id`/`tags.type_id` son `SET NULL` (no CASCADE): borrar
  una marca o un tag no arrastra nada, solo desenlaza — consistente con
  decisión 7 ("tags y marcas: se permite").

### DTOs vs. lo que el admin envía realmente

- `create-type.dto.ts`: `export class CreateTypeDto {}` — clase vacía,
  confirmado línea 1 exacta. El formulario (`group-form.tsx`, `onSubmit`
  alrededor de líneas 280-343) envía `name, icon, banners[],
  promotional_sliders[], settings{isHome, layoutType, productCard},
  language` y, en creación, opcionalmente `slug` si `initialValues.slug`
  existe.
- `create-manufacturer.dto.ts`: `OmitType(Manufacturer, ['id',
  'cover_image', 'description', 'image', 'name', 'products_count', 'slug',
  'socials', 'type', 'type_id', 'website', 'translated_languages'])` +
  `shop_id?: string` — confirmado que **omite `name`, `description`,
  `website`, `image`, `type_id`, `socials`, `cover_image`**, es decir, casi
  todos los campos reales que el formulario (`manufacturer-form.tsx:184-220`)
  sí envía: `language, name, slug, description, is_approved, website,
  socials[], image{thumbnail,original,id}, cover_image{...}, type_id`
  (más `shop_id` solo en create). Como `ValidationPipe` no filtra
  (`main.ts:9`), esto "funciona" hoy solo porque el body llega completo de
  todos modos — pero el DTO como documentación Swagger es objetivamente
  incorrecto (confirma decisión 15).
- **Drift menor detectado, no contemplado explícitamente por el texto de la
  US**: `manufacturer-list.tsx:134-142` (el toggle de aprobación) NO envía
  solo `{id, is_approved}` como sugiere la nota del agente ejecutor — envía
  `{id, name, is_approved: !is_approved, type_id: record?.type.id,
  language}`. Es decir, el payload del toggle en la práctica ya trae `name`
  y `type_id` completos (tomados del propio `record` de la fila), no un PATCH
  parcial minimalista. Esto simplifica `updateManufacturer`: no hace falta
  soportar un `PUT` con solo `is_approved` y nada más — el caso real trae
  siempre el conjunto completo de campos editables. Vale la pena
  confirmarlo en `sdd-design` para no sobre-diseñar un "partial update".
- `create-tag.dto.ts` (`PickType(Tag, ['name','type','details','image',
  'icon','language'])`) no está señalado como roto por la US y, a diferencia
  de `CreateManufacturerDto`, sí cubre razonablemente los campos que
  `tag-form.tsx:162-190` envía (`name, slug, details, image, icon,
  type_id`) — aunque declara `type` (objeto) en vez de `type_id` (el campo
  real de columna); no está en el scope de "Archivos a crear/modificar" de
  la US, que solo lista `create-type.dto.ts` y `create-manufacturer.dto.ts`
  para corrección. Mencionar como posible gap adyacente, no accionarlo.

### Tests — baselines medidos, no asumidos

- `just db-check` (vitest, `packages/db`), corrido en este entorno con la
  base sembrada arriba (`safari-postgres` healthy, puerto 5433):
  **8 test files, 91 tests, todos passed**. Coincide exactamente con lo que
  cita la US/el epic ("91 tests hoy"). Desglose por archivo:
  `auth-tokens.integration.test.ts` 11, `categories.integration.test.ts` 13,
  `manufacturers.integration.test.ts` 6, `products.integration.test.ts` 20,
  `shops.integration.test.ts` 9, `tags.integration.test.ts` 5,
  `types.integration.test.ts` 4, `users.integration.test.ts` 23.
- `cd apps/api/rest && npx jest`, corrido en este entorno (requiere
  `packages/db/dist` ya construido — estaba presente):
  **4 suites, 65 tests, todos passed**. Coincide exactamente con
  `CLAUDE.md` ("4 suites / 65 tests") — el conteo naive por `grep -c
  "it("` da 57 porque `products.service.spec.ts` usa dos `it.each(casos)`
  con un array de 4 casos (líneas ~579-625: `getPopularProducts,
  getBestSellingProducts, getProductsStock, getDraftProducts`) que expanden
  a 8 tests en runtime (20 `it()` estáticos + 8 = 28 en ese archivo;
  `users.service.spec.ts` 27, `shops.service.spec.ts` 5,
  `user-dto.mapper.spec.ts` 5 → 28+27+5+5 = 65).
- Conteos por catálogo confirmados con `toBe(N)` en el código: `types.
  integration.test.ts` no tiene un assert de conteo total explícito (usa
  `rows[0].slug` / `row?.slug` contra `'gadget'`, sin `toBe(10)` literal) —
  **posible imprecisión de la US/epic al citar "types 10" como assert de
  conteo**: el 10 aparece confirmado indirectamente por
  `categories.integration.test.ts:103,110` (`rootsOnly.total` /
  `flat.total` ambos `toBe(10)`, pero eso son categorías raíz, no types) —
  no se encontró un `toBe(10)` sobre types. `tags.integration.test.ts:18,25`
  sí tiene `toBe(10)` dos veces; `manufacturers.integration.test.ts:18` tiene
  `toBe(14)`. **Riesgo bajo pero real para R-4**: si `types` no tiene un
  assert de conteo hoy, un test de integración de escritura mal limpiado
  para `types` no rompería ningún test existente por conteo — la protección
  de "cada test borra lo que crea" (decisión 13) recae 100% en la disciplina
  del centinela para `types`, sin una red de seguridad adicional como sí la
  tienen `tags`/`manufacturers`.
- Precedente de limpieza por centinela: `users.integration.test.ts:32-40`
  usa un **dominio** de correo reservado (`TEST_DOMAIN =
  '@users-integration.test'`, RFC 2606) con `cleanup = () =>
  prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } })`
  en `beforeAll(cleanup)` + `afterAll(async () => { await cleanup(); await
  prisma.$disconnect(); })`. Para `types/tags/manufacturers` (sin columna de
  email) el equivalente natural es un prefijo de `slug`/`name` (p. ej.
  `zz-test-`, como ya sugiere la propia US) con `deleteMany({ where: { slug:
  { startsWith: 'zz-test-' } } })`.

### Prior art

- `openspec/changes/archive/2026-08-26-catalogos-planos-postgres/` (US-4a):
  el precedente de estilo repositorio+servicio+mapper para lecturas de estos
  4 catálogos (incluye `shops`, fuera del alcance de US-27). Su
  `design.md`/`proposal.md` documentan las decisiones V-1..V-25 que
  `toTypeDto`/`toTagDto`/`toManufacturerDto` ya aplican hoy.
- `openspec/specs/flat-catalogs-api/spec.md`: spec actual, **Out of Scope**
  declara explícitamente "endpoints de escritura del admin (POST/PUT/DELETE
  de los 4 catálogos)" — confirma que este change (US-27) es exactamente lo
  que ese spec dejó pendiente. Los requirements de key-set (9/9/13),
  envoltorio de paginación, `type` anidado y errores de conexión (503/500)
  son el contrato de LECTURA que las escrituras deben respetar sin
  modificar (D-6: reutilizar los mismos mappers). Ningún requirement
  existente choca con lo que US-27 introduce — son complementarios (lectura
  vs. escritura del mismo agregado).

## Affected Areas

- `apps/api/rest/src/types/types.service.ts` — migrar `create/update/remove`,
  eliminar `findAll/findOne` muertos, `@db/types.json`, `Fuse`.
- `apps/api/rest/src/tags/tags.service.ts` — migrar `update/remove` (create
  ya tiene forma distinta al resto: fabrica id local), eliminar
  `@db/tags.json`, `Fuse`.
- `apps/api/rest/src/manufacturers/manufacturers.service.ts` — migrar
  `create/update/remove`, ojo con preservar `Number(record.isApproved)`.
- `apps/api/rest/src/{types,manufacturers}/dto/create-*.dto.ts` — corregir
  campos declarados (decisión 15); `create-tag.dto.ts` no está en scope de
  la US pero tiene el mismo tipo de gap menor (`type` vs `type_id`).
- `apps/api/rest/src/common/` — nuevo submódulo de errores de dominio → HTTP
  (D-4); no existe hoy ningún archivo bajo `common/errors/`.
- `packages/db/src/slug.ts` (nuevo), `packages/db/src/repositories/{types,
  tags,manufacturers}.repository.ts` (extender con `create*/update*/
  delete*`), `packages/db/index.ts` (barrel a actualizar).
- `packages/db/src/repositories/products.repository.ts` — NO se modifica,
  pero es la referencia de estilo obligatoria (`upsertScrapedProduct`,
  `_translateCheckViolation`).
- `db/schema.sql` — NO se modifica (fuente de verdad de `slugify()`,
  CHECKs y FKs consultados en solo lectura).

## Approaches

1. **Slug — reimplementar en TypeScript**
   - Pros: sin round-trip extra a Postgres; testeable con Vitest puro.
   - Cons: riesgo de divergencia sutil frente a `unaccent_simple`/`slugify`
     SQL (mapa de 51 caracteres, orden exacto de regex); duplica lógica de
     negocio entre capas, sin precedente en el repo.
   - Effort: Medium (portar la tabla de tildes + escribir el test
     comparativo contra SQL de todos modos, para no perder la garantía).

2. **Slug — delegar a Postgres (`SELECT slugify($1)`)**
   - Pros: cero riesgo de divergencia (reutiliza la función que ya usa el
     scraper); alineado con el patrón `_translateCheckViolation` de
     consultar lo que Postgres ya sabe en vez de reimplementarlo.
   - Cons: +1 round-trip por escritura (mitigable en la misma transacción
     del INSERT/UPDATE); exige Postgres arriba también para el test del
     helper (ya es el caso de `just db-check` hoy).
   - Effort: Low — es una query SQL más dentro del repositorio, ya se tiene
     el cliente `prisma.$queryRaw` disponible en el resto del paquete.

3. **Errores de dominio → HTTP — módulo nuevo, sin tocar lecturas**
   - Único enfoque viable dado D-4 explícito: crear
     `apps/api/rest/src/common/errors/` con un mapeador
     (`mapDomainErrorToHttp` o similar) que las 9 rutas de escritura llamen
     en su `catch`, sin tocar los 26 sitios existentes de
     `isPrismaConnectionError` en métodos de lectura.
   - Effort: Low-Medium — el patrón ya existe en `_translateCheckViolation`
     + los `catch` de los servicios; es ensamblar, no inventar.

## Recommendation

No corresponde recomendar una implementación en esta fase (es competencia
de `sdd-design`), pero la evidencia recogida inclina hacia:
- Slug: **Opción 2** (delegar a Postgres) por alineación con el precedente
  ya establecido del repo (nunca duplicar una regla de validación que
  Postgres ya aplica) y por eliminar de raíz el riesgo R-3 de divergencia.
- Errores: un único módulo en `common/errors/` que envuelva las clases de
  error de dominio de `packages/db` (siguiendo el patrón
  `InvalidSalePriceError`/`MissingPriceError` ya exportado) y las traduzca a
  `BadRequestException`/`NotFoundException`/`ConflictException` — sin
  modificar el patrón `isPrismaConnectionError` existente.

## Risks

- **R-1 (alto, épico)** — CASCADE de `types.id` sobre `categories`/`products`
  confirmado en el DDL actual (`schema.sql:269,331`); el `deleteType`
  DEBE contar dependientes antes de borrar. Verificado, sin drift.
- **R-3 (medio, épico)** — divergencia de slug. Mitigado si se elige la
  Opción 2 (delegar a Postgres); si se elige la Opción 1, el test
  comparativo de 3 nombres con tilde contra la función SQL es obligatorio,
  no opcional.
- **R-4 (medio, épico)** — tests de integración sobre la base sembrada.
  Hallazgo nuevo: `types.integration.test.ts` **no tiene hoy** un
  `toBe(N)` de conteo total (a diferencia de `tags` `toBe(10)` y
  `manufacturers` `toBe(14)`), así que para `types` la única red de
  seguridad contra basura de una corrida abortada es la disciplina del
  centinela — no hay un test existente que la detecte automáticamente.
  Recomendación operativa para `sdd-tasks`: considerar añadir un assert de
  conteo a `types.integration.test.ts` como parte de esta US, o al menos
  señalarlo explícitamente en la DoD.
- **DTO `create-tag.dto.ts`** (bajo, nuevo hallazgo, fuera del scope
  declarado de la US) — declara `type` en vez de `type_id`; no bloquea
  nada porque `ValidationPipe` no filtra, pero es la misma clase de defecto
  de documentación que motivó la decisión 15 para los otros dos DTOs. Se
  menciona, no se acciona (no está en "Archivos a crear/modificar" de la
  US).
- **Payload del toggle `is_approved`** (bajo, aclaración) — el toggle de
  `manufacturer-list.tsx` envía el objeto completo (`name`, `type_id`,
  `language` incluidos), no un parche minimalista de un solo campo. Esto
  reduce el riesgo de que `updateManufacturer` necesite lógica de "partial
  update" — puede asumir que todos los campos editables llegan siempre.

## Ready for Proposal

Sí. El scope de la US está verificado contra el código actual sin drift
material (las líneas citadas coinciden con el comportamiento real); los dos
puntos de diseño abiertos que deja explícitamente a `sdd-design`/`sdd-propose`
(estrategia de slug, forma exacta del módulo de errores) están documentados
arriba con sus tradeoffs. Recomendación para el orquestador: avanzar a
`sdd-propose` sin bloqueos; llevar a esa fase la pregunta puntual sobre si
añadir un assert de conteo a `types.integration.test.ts` (hallazgo R-4) y la
confirmación de que `create-tag.dto.ts` queda fuera de esta US a pesar del
gap menor detectado.
