# US-34 — Esquema y capa de datos de contenido y configuración

> Crear en `db/schema.sql` las 12 tablas del Épico 33 —contenido (`faqs`,
> `terms_and_conditions`, `refund_policies`, `refund_reasons`), configuración
> (`taxes`, `shippings`), atributos (`attributes`, `attribute_values`) y avisos
> (`store_notices` + 3 pivotes)—, sembrarlas desde los JSON del mock y
> exponerlas en `@safari/db` como modelos introspectados y `*Record`. Todo el
> DDL del épico va aquí: un solo `just db-reset`.

**Épico:** [Épico 33](./README.md)
**Fecha:** 2026-09-14
**Status:** Listo para ejecución
**Depende de:** US-32 — **satisfecha**: cerrada el 2026-09-15 (Opción B, sin
triggers). Dependencia dura levantada; ver P-1
**LOC est.:** ~1450

---

## Decisiones del refinamiento — CONFIRMADAS por el dueño (2026-09-14)

Dos puntos del épico quedaron abiertos «para el refinamiento de US-34». Se
resolvieron con las recomendaciones de abajo y **el dueño las confirmó ambas
el 2026-09-14**: P-1 (US-32 va antes, no se pliega) y P-2 (los repositorios y
sus tests viven en US-35..39, no aquí). El argumento se conserva íntegro como
registro de por qué, no como propuesta abierta.

### P-1 — R-3 del épico: US-32 **no se pliega**; va **antes**, como dependencia dura

> **RESUELTO (2026-09-15).** US-32 se ejecutó por separado y cerró con la
> Opción B: no queda ningún trigger y la política de reloj es única. El
> argumento de abajo se conserva como registro de por qué se ordenó así;
> **su presente ya no describe el repo** — en particular, la frase «hoy el
> archivo tiene dos [políticas]» del punto 1 dejó de ser cierta.

**Recomendación:** ejecutar
[US-32](../32-deriva-reloj-updated-at-created-at.md) como sesión propia,
inmediatamente antes de esta, y declararla en `Depende de:`.

Argumentos, por peso:

1. **La decisión de US-32 es un insumo del DDL de esta US, no un vecino.**
   US-32 CA-1 elige una única fuente de reloj para `created_at`/`updated_at`
   (trigger de Postgres vs. `clock.ts`). Las 8 tablas de entidad que crea esta
   US reciben `PUT` reales desde el admin (las 8 tienen ruta `@Put(':id')`),
   así que cada una tiene que nacer bajo **una** política. Hoy el archivo
   tiene dos: trigger en 5 tablas (`db/schema.sql:488-500`) y `updatedAt:
   now()` desde el repositorio en `types`/`tags`/`manufacturers` (decisión 9
   del Épico 26). Crear 12 tablas sin haber decidido es garantizar que US-32
   toque 13 tablas en vez de 5 y exija un tercer `db-reset`.
2. **Plegarla mezcla dos superficies de riesgo distintas.** Esta US es
   puramente **aditiva** (tablas nuevas; no altera ninguna existente). US-32
   **modifica 5 tablas vivas** del catálogo y de identidad y, según la opción
   que elija, cada ruta de `update*` de los repositorios existentes. Si eso
   rompe un test del catálogo, con el pliegue se para la habilitadora del
   épico entero (R-4); por separado se para una US de ~80-250 LOC y esta ni
   arranca hasta que aquella cierre — mismo bloqueo, pero con commits, review
   y rollback separados.
3. **«1 US = 1 sesión» es regla dura del repo** (`docs/product/README.md`,
   flujo punto 7 y tabla de antipatrones). US-32 tiene CAs propios (invariante
   probado, documentación de `_setNowProvider`) sin relación con contenido ni
   configuración.
4. **El ahorro que R-3 quiere proteger es menor de lo que parece.** Lo que
   cuesta no es `just db-reset` (`docker compose down -v` + `db-up`,
   `justfile:322-324`: esquema + seed de 1200 productos en segundos; el
   proyecto no está en producción), sino **re-introspeccionar** (`prisma db
   pull` pisa los renombres manuales, `packages/db/README.md:94-100`). Y la
   re-introspección de US-32 es casi vacía: Prisma no modela triggers y un
   `DEFAULT now()` se introspecciona igual antes y después. El coste real de
   ambas es una sola re-introspección grande, la de esta US, que se hace
   igual con o sin pliegue.

**Coste de la recomendación:** dos `db-reset` en vez de uno, y un orden
obligatorio (US-32 → US-34). **La autorización del dueño para `db-reset`
hay que renovarla** (decisión 1 del Épico 26: la de 2026-08-31 fue para el
Épico 19); se pide **una vez** para las dos US, como ventana de DDL del
épico.

**Si el dueño decide plegar igualmente**, cambia esto en la US: `Depende
de: ninguna`; se añaden CA-3b («las 5 tablas con trigger quedan bajo la
misma política que las 12 nuevas») y CA-3c («test que fija `updated_at >=
created_at` en una fila creada y actualizada»); `Archivos` suma
`packages/db/src/clock.ts` y un `*.integration.test.ts` existente; y la LOC
sube ~+250 (DDL de 5 tablas ± triggers, test, documentación), a ~1700.
US-32 se archiva con referencia a esta US.

### P-2 — Alcance: los **repositorios** van en US-35..39, no aquí

**Recomendación:** esta US entrega **todo lo que exige `db-reset` y todo lo
que comparten las cinco US siguientes** — DDL, generador y seed,
`schema.prisma` con los 12 modelos y sus renombres, los `*Record` y mappers en
`records.ts`, el barrel y la documentación — más un test de integración que
demuestre desde `@safari/db` que el seed cerró. Los repositorios de funciones
planas (`list*`/`find*`/`create*`/`update*`/`delete*`) y sus
`*.integration.test.ts` los escribe **cada US consumidora** en su propio
archivo, exactamente como hizo el Épico 26 (repositorio + tests + servicio +
spec por US).

Por qué:

1. **El épico es internamente inconsistente y hay que elegir un lado.** Su
   texto dice «DDL + repositorios» (R-4) y estima ~1200. Con anclas reales del
   paquete, 8 repositorios con tests son otra cosa: el agregado **más simple**
   del catálogo pesa `types.repository.ts` 182 + `types.integration.test.ts`
   185 = 367 líneas; la mediana (`tags`, `manufacturers`, `shops`, `users`)
   está en 550-780 por agregado. Ocho agregados —dos de ellos con hijos y
   pivotes— son **~3300 líneas solo de repositorios y tests**, y ~4600 con
   el resto. Eso es ×3,8 sobre lo que la tabla del épico dice y **cuatro
   veces** el umbral de ~900 que el Épico 26 fijó para partir una US.
2. **Las cifras del épico ya presuponen esta lectura.** US-35..39 se
   estimaron en ~1300-1800 «a partir de los reales del Épico 26», y esos
   reales **incluían** el repositorio y sus tests de integración. Y la nota
   de paralelismo del épico («solo comparten el barrel `packages/db/index.ts`,
   quien arranque segundo rebasea») solo tiene sentido si US-35..39 añaden
   exports al barrel, es decir, si escriben repositorios. Con los
   repositorios aquí, el épico contaría dos veces ~3300 líneas.
3. **Reduce el cuello de botella R-4 en vez de engordarlo.** Lo que de verdad
   bloquea a las cinco US es la base recreada y los archivos compartidos
   (`schema.prisma`, `records.ts`). Los repositorios no bloquean a nadie:
   cada uno vive en su archivo.
4. **Es el precedente del propio repo.** La partición de US-27 (Épico 26,
   «corte vertical, no por capas») descartó una US de «fundaciones» que
   dejara `packages/db` verde y ningún consumidor. Aquí la habilitadora es
   inevitable por el `db-reset`, pero no hay motivo para cargarla además con
   ocho repositorios sin consumidor.

**Coste de la recomendación:** ninguna cifra de US-35..39 cambia (ya
incluían el repositorio). Cambia la redacción de R-4 del épico («DDL +
repositorios» → «DDL + capa de datos compartida») y el título de esta US
sigue siendo exacto: `schema.prisma` + `records.ts` **son** la capa de
datos; los repositorios son sus consumidores internos.

**Si el dueño decide mantener los repositorios aquí**, la US pasa a
~4600 LOC (desglose abajo), debe arrancar como cadena de PRs por agregado
(precedente US-28/US-29) y la cláusula de partición del Épico 26 aplica
desde el primer `sdd-propose`: US-34a (esta, sin repositorios) + US-34b
(repositorios), que es exactamente esta recomendación con otro nombre.

---

## Historia

**Como** desarrollador del monorepo, **quiero** que las FAQ, los términos,
las políticas y motivos de reembolso, los impuestos, los envíos, los atributos
y los avisos de tienda existan como filas en Postgres con claves foráneas
reales hacia `shops` y `users`, y que `@safari/db` los conozca como modelos
y records, **para** que US-35..39 sean cambios de fuente de datos en los
servicios de Nest y no un rediseño, y para que ninguna de las cinco necesite
volver a recrear la base.

## Contexto

Todo lo de abajo está verificado contra el código, no contra el épico.

- **Exclusión del esquema.** `db/schema.sql:13-16` deja fuera «wallets,
  direcciones, órdenes, carritos y reviews» y dice que «el resto del dominio
  transaccional sigue fuera». Ninguna de las 12 tablas de esta US es
  transaccional: decisión 1 del épico, la exclusión **no se toca**. Sí hay
  que **actualizar esa cabecera** para nombrar el nuevo bloque, como US-20
  añadió «Identidad SÍ entra».
- **Idempotencia.** `db/schema.sql:18-21`: todo va con `IF NOT EXISTS`, por
  eso no altera tablas existentes. Esta US **no altera ninguna**: solo añade.
  El `db-reset` hace falta igual, porque la base local ya existe y las 12
  tablas no están en ella.
- **Forma real de los JSON** (`apps/api/rest/src/db/pickbazar/`, medido con
  `node -e`):
  - `faqs.json`: 19 filas, ids 1-19, slugs únicos; `faq_type ∈ {global,
    shop}`; `issued_by` es el **nombre** del emisor («Super Admin»,
    «Furniture Shop», …), no un id; **sin `shop_id` ni `user_id`** aunque la
    entidad (`faqs/entities/faq.entity.ts`) declara ambos y el admin **envía
    `shop_id`** en create/update (`components/faqs/faqs-form.tsx:100-109`) y
    la tienda **filtra por `shop_id`, `faq_type` e `issued_by`**
    (`pages/shops/[slug]/faqs.tsx:26-29`, `pages/help.tsx:16-17`).
  - `terms-and-conditions.json`: 10 filas, ids `8,9,10,11,12,1,2,3,4,5`, y
    **5 slugs duplicados**: los ids 8-12 son **copias exactas** (título,
    descripción, `type`, `issued_by`) de los ids 1-5. `type = 'global'` e
    `is_approved = 1` (entero) en las 10. `findOne` del mock busca **por
    slug** (`terms-and-conditions.service.ts:61`, `Array.find` → devuelve la
    primera del archivo, o sea los ids 8-12). El admin envía `shop_id` y
    opcionalmente `slug` (`terms-and-conditions-form.tsx:129-139`), la
    tienda filtra por `shop_id` (`pages/shops/[slug]/terms.tsx:35`), y hay
    dos rutas de moderación (`approve-`/`disapprove-terms-and-conditions`).
  - `refund-policies.json`: 5, slugs únicos; `target ∈ {vendor, customer}`,
    `status = 'approved'` (el admin conoce además `pending`,
    `apps/admin/rest/src/types/index.ts:83-86`). La entidad declara
    `shop_id` opcional.
  - `refund-reasons.json`: 8, slugs únicos, plana. Trae `deleted_at: null`
    (soft delete de Laravel).
  - `taxes.json`: 1 fila; `rate: 2`, `is_global`, `on_shipping`, geo
    (`country`/`state`/`zip`/`city`) y `priority` en `null`.
  - `shippings.json`: 1 fila; `amount: 50`, `type: 'fixed'` (el enum de la
    entidad admite `fixed | percentage | free`).
  - `attributes.json`: 8 filas, ids `11,10,9,8,6,5,4,3`; `shop_id ∈ {1, 2,
    7, 9, 11}` — **los cinco existen en `shops.json`** (ids 1-7, 9, 11), así
    que la FK de D-6 cierra sin remapear. `type` es un objeto **todo `null`**
    (`{id, name, slug, logo}`): no hay `type_id` que persistir. `values`:
    **27 en total** (2 a 6 por atributo), cada uno con `id` (8-36),
    `attribute_id` (coincide siempre con el padre), `value`, `slug`, `meta`
    (17 no nulos: nombres de color, códigos `#hex`, nombres de icono),
    `language`, `translated_languages`. Slugs de valor únicos por atributo
    (y globalmente). Cuatro slugs de atributo llevan sufijo con mayúsculas
    (`color-OMG`, `size-zLh`, `color-A6u`): no pasarían por `slugify()`, pero
    se siembran tal cual — el DDL no impone formato de slug en ninguna tabla.
    El admin envía `values[].{id, value, meta, language}`
    (`components/attribute/attribute-form.tsx:72-76`); la entidad
    `AttributeValue` declara un `shop_id` que **ni el mock ni el formulario
    traen**.
  - `store-notices.json`: 3 filas. `priority ∈ {high, medium, low}`, `type =
    'all_vendor'` en las 3 (el admin envía además `specific_vendor`,
    `all_shop`, `specific_shop` y `received_by: number[]`,
    `store-notice-form.tsx:89-95,167-171`). **`created_by = 6`** y
    `updated_by ∈ {null, 6}`: el id 6 es el `admin@demo.com` del Laravel
    original, **no existe en el seed** (nuestro admin es el 3;
    `users.json` trae 1, 2, 3). El generador ya conoce esta trampa: descarta
    `permissions[].pivot.model_id = 6` por la misma razón
    (`db/generate-seed.mjs:76-81`). `users[]` (pivote `store_notice_user`):
    los usuarios 6 y 1 en las 3 filas; `shops: []` en las 3; `read_status[]`
    (pivote `store_notice_read`): los mismos dos usuarios con `pivot.is_read
    ∈ {1, 0}` (el admin ha leído, el dueño no). `is_read: true` de nivel
    superior y `creator_role` son **derivados** para el usuario actual, no
    columnas. `effective_from`/`expired_at` vienen como `'YYYY-MM-DD
    HH:mm:ss'` (sin `T` ni zona), a diferencia de `created_at` (ISO con 6
    decimales).
- **La ruta `store-notices/read` no existe en la API.** El admin la llama
  (`data/client/api-endpoints.ts:67`, `data/client/store-notice.ts:45`, hook
  `useStoreNoticeRead` consumido por `layouts/topbar/store-notice-bar.tsx:134`
  y `store-notice/store-notice-card.tsx:31`) y el controlador solo declara
  `POST /`, `GET /`, `GET /getUsersToNotify`, `GET /:param`, `PUT /:id`,
  `DELETE /:id` (`store-notices.controller.ts:30-61`). Es el mismo caso que
  `transfer-shop-ownership` en el inventario del backlog. **Decidir si
  US-39 la añade es de US-39**; a esta US le basta con que la tabla
  `store_notice_read` exista, porque el contrato de lectura ya embebe
  `read_status`.
- **Precedentes del DDL que se calcan** (`db/schema.sql`): PK `bigserial`
  (`:91`), `slug text NOT NULL UNIQUE` (`:93,234,264,284,298,328`),
  `language text NOT NULL DEFAULT 'es'` (`:76,98,270,303`; el seed copia el
  `'en'` del mock, `generate-seed.mjs:195,296,335`), `translated_languages`
  **solo** columna en `products` (`:379`; en el resto el servicio emite
  `['en']`: `types.service.ts:29,39`, `tags.service.ts:46`) — D-2 del épico,
  se respeta. CHECK de enumerados en línea (`:335-336,359-360`). Dinero y
  porcentajes en `numeric`, nunca `float` (`:338-348`). Pivotes N:M con PK
  compuesta y FKs `ON DELETE CASCADE` (`category_product`/`product_tag`,
  `:425-435`; `permission_user`, `:173-178`). Cada FK saliente con su índice
  (`:453-474`). Comentario-banner por tabla explicando la decisión, no la
  columna.
- **Política de `updated_at`.** **Una sola, ya vigente: la fija el
  repositorio, nunca la base.** US-32 (cerrada 2026-09-15, Opción B) retiró
  `tocar_updated_at` y sus cinco triggers; hoy **ninguna tabla lleva
  trigger** y cada ruta de `UPDATE`/`upsert` fija `updatedAt: now()` desde
  `packages/db/src/clock.ts` (`types.repository.ts:136` como patrón; la
  política está escrita en `db/schema.sql:540-550` y especificada en
  `openspec/specs/data-layer-clock-policy/spec.md`). **Las 8 tablas de
  entidad de esta US nacen bajo ella: NO crear triggers**, y cada `update`
  nuevo del repositorio fija el reloj explícitamente — el test del
  invariante NO detecta una ruta olvidada (`updated_at == created_at` pasa
  un `>=`), así que la garantía es el inventario de rutas, no la suite.
  `created_at` sigue saliendo del `@default(now())` de Prisma: mismo reloj
  de Node, y deliberadamente NO mockeable con `_setNowProvider`. Ver P-1.
- **Introspección.** `packages/db/prisma/schema.prisma` se regenera con
  `prisma db pull` y **pisa los renombres** (`packages/db/README.md:94-100`);
  hoy 15 modelos en 319 líneas. No quitar el preview `partialIndexes`
  (`schema.prisma:34`). Las CHECK que Prisma no modela se listan en la
  cabecera (`:10-16`) y se validan en los repositorios.
- **Frontera de serialización.** `records.ts` (303 líneas, 9 records):
  `BigInt → number` con `_id()`, `Decimal → number` con `_dec()`, fechas como
  `Date`; mappers `_to*Record` internos, tipos `*Record` públicos vía el
  barrel `packages/db/index.ts`.
- **Suites hoy.** `just db-check`: 10 archivos / 210 tests (línea base tras
  el cierre de US-32; eran 203 al cerrar US-31).
  `cd apps/api/rest && npx jest`: 8 archivos `*.spec.ts` (CLAUDE.md dice «4
  suites / 65 tests»: está desactualizado; el número real se pega al
  ejecutar, no se copia de ahí). Los asserts por conteo de las suites
  existentes (`shops` 12, `categories` 198, `manufacturers` 14, `tags` 10,
  1200 productos) deben seguir verdes tras regenerar el seed.

## Scope

**Incluye:** el DDL de las 12 tablas (con sus CHECK, FKs, índices y
comentarios) en `db/schema.sql`, incluida la actualización de su cabecera;
la extensión de `db/generate-seed.mjs` para leer los 8 JSON y emitir las 12
tablas, con validación previa, deduplicación de `terms`, remapeo de ids de
usuario por email y adelanto de secuencias; el `db/seed.sql` regenerado; la
re-introspección de `schema.prisma` con los 12 modelos renombrados y las
relaciones inversas en `User` y `Shop`; los `*Record` y mappers en
`records.ts`; sus exports en el barrel; un test de integración que verifique
el seed desde `@safari/db`; y la documentación del modelo en `db/README.md`,
`packages/db/README.md` y la cabecera de `schema.prisma`.

**NO incluye:** ningún repositorio de funciones planas ni su
`*.integration.test.ts` (P-2: van en US-35..39); ningún servicio, controlador
o DTO de `apps/api/rest`; ningún cambio en `apps/shop` ni `apps/admin`; la
ruta `store-notices/read` que el admin llama y la API no tiene (decisión de
US-39); persistir variaciones de producto sobre `attributes` (decisión 4 del
épico: épico aparte); columnas `deleted_at` (soft delete de Laravel: el repo
borra de verdad en los 6 agregados del catálogo, y aquí igual);
`translated_languages` como columna (D-2); `type_id` en `attributes` (el
mock lo trae todo `null`); `shop_id` en `attribute_values` (ni el mock ni el
formulario lo traen: se deriva del padre); tocar `types`/`tags`/
`manufacturers` ni los 5 triggers existentes (US-32); corregir el conteo de
suites de `CLAUDE.md`.

## Criterios de aceptación

### CA-1 — Las 12 tablas existen, con la forma que los consumidores exigen
`db/schema.sql` define, en el estilo del archivo (banner por tabla, PK
`bigserial`, `language` con default, timestamps):

| Tabla | Columnas propias y restricciones (qué, no cómo) |
|---|---|
| `faqs` | `faq_title`, `slug` UNIQUE, `faq_description`, `faq_type` CHECK `∈ {global, shop}`, `issued_by` (texto: es lo que la tienda filtra), `shop_id` FK → `shops` **nullable**, `user_id` FK → `users` **nullable** |
| `terms_and_conditions` | `title`, `slug` UNIQUE, `description`, `type` CHECK `∈ {global, shop}`, `issued_by`, `is_approved boolean NOT NULL` (cola de moderación), `shop_id` y `user_id` como en `faqs` |
| `refund_policies` | `title`, `slug` UNIQUE, `description`, `target` CHECK `∈ {vendor, customer}`, `status` CHECK `∈ {approved, pending}`, `shop_id` FK nullable |
| `refund_reasons` | `name`, `slug` UNIQUE |
| `taxes` | `name`, `rate numeric`, `is_global`, `on_shipping`, `country`/`state`/`zip`/`city` nullable, `priority integer` nullable |
| `shippings` | `name`, `amount numeric`, `is_global`, `type` CHECK `∈ {fixed, percentage, free}` |
| `attributes` | `name`, `slug` UNIQUE, `shop_id` FK → `shops` **NOT NULL** (D-6) |
| `attribute_values` | `attribute_id` FK → `attributes` CASCADE, `value`, `slug`, `meta` nullable, UNIQUE `(attribute_id, slug)` |
| `store_notices` | `priority` CHECK `∈ {high, medium, low}`, `notice`, `description`, `effective_from timestamptz`, `expired_at timestamptz`, `type` CHECK `∈ {all_vendor, specific_vendor, all_shop, specific_shop}`, `created_by` FK → `users` NOT NULL, `updated_by` FK → `users` nullable |
| `store_notice_user` | PK `(store_notice_id, user_id)`, ambas FK CASCADE |
| `store_notice_shop` | PK `(store_notice_id, shop_id)`, ambas FK CASCADE |
| `store_notice_read` | PK `(store_notice_id, user_id)`, ambas FK CASCADE, `is_read boolean NOT NULL DEFAULT false` |

Los `ON DELETE` de las FK hacia `users` y `shops` siguen el criterio del
archivo (`shops.owner_id` es `RESTRICT` para no arrastrar; los pivotes son
`CASCADE`): nunca un `CASCADE` desde `users` o `shops` hacia contenido que
otra tienda pueda estar leyendo. La opción elegida por columna queda
comentada en el DDL. Cada FK saliente tiene índice. La cabecera del archivo
(`:13-16`) nombra el bloque nuevo y mantiene la exclusión transaccional.

### CA-2 — Ninguna tabla existente cambia
`git diff db/schema.sql` no toca ninguna sentencia `CREATE TABLE` previa ni
el comentario de política de reloj de `:477-487` (US-32 ya retiró de ahí la
función y los cinco triggers; **no re-añadirlos**). Solo hay adiciones y el
cambio de cabecera.

### CA-3 — Las tablas nacen bajo la política de reloj de US-32
Las 8 tablas de entidad aplican para `created_at`/`updated_at` **la misma
política que US-32 dejó declarada** en su CA-1 (trigger en todas, o ninguna
y `clock.ts` desde el repositorio), y el DDL lo dice en un comentario junto
al bloque de triggers. Los 3 pivotes no llevan `updated_at`
(`store_notice_read` tampoco: `is_read` es un estado, y `permission_user`
es el precedente de pivote con solo `created_at`). Si P-1 se resuelve
plegando US-32, este CA absorbe sus CA-1 y CA-2.

### CA-4 — El generador emite las 12 tablas desde los 8 JSON, con validación
`db/generate-seed.mjs` lee los 8 archivos y emite los bloques **después** de
`users` y `shops` (las FK lo exigen), en el estilo del archivo (banner,
comentario de procedencia, `ON CONFLICT DO NOTHING`, ids preservados). Cuatro
reglas propias de este lote, todas validadas **antes** de emitir (el
generador falla con mensaje, no produce SQL inaplicable):

1. **`terms` se deduplica por `slug`**, conservando la **primera aparición
   en el orden del archivo** (ids 8-12), que es exactamente la fila que
   `GET /terms-and-conditions/:slug` devuelve hoy (`Array.find`). Las 5
   copias exactas (ids 1-5) se descartan y el banner del bloque lo dice con
   el número. Si el JSON trajera dos filas con el mismo slug **y contenido
   distinto**, el generador falla: eso ya no sería ruido sino un dato que
   alguien tiene que decidir.
2. **Los ids de usuario de `store-notices` se resuelven por email**, nunca
   se copian: `created_by`/`updated_by` vía `creator.email`, y los pivotes
   `users[]`/`read_status[]` vía el `email` de cada elemento, contra
   `users.json`. Un email sin usuario en el seed es error de generación.
   `is_read` del pivote llega como entero → `bool()`.
3. **`attributes.shop_id` se valida contra el conjunto final de shops**
   (los de `shops.json` más los recuperados), igual que hoy `products`.
4. **`is_approved` de `terms` llega como entero → `bool()`**, como
   `users.is_active`.

Las 10 tablas con `bigserial` entran en el bloque de `setval` (los 3
pivotes no tienen secuencia). La cabecera del seed y la salida por consola
del generador añaden los conteos nuevos.

### CA-5 — El seed cierra y los conteos son los esperados
Tras `just db-reset`, los conteos por tabla son: `faqs` 19,
`terms_and_conditions` **5**, `refund_policies` 5, `refund_reasons` 8,
`taxes` 1, `shippings` 1, `attributes` 8, `attribute_values` 27,
`store_notices` 3, `store_notice_user` 6, `store_notice_shop` 0,
`store_notice_read` 6 (3 con `is_read = true`, las del admin). Cero filas
con FK huérfana (consulta explícita por cada FK nueva). Y los conteos
previos **intactos**: 10 types, 12 shops (`max(id) = 15`), 198 categorías,
14 manufacturers, 10 tags, 1200 productos, 3 usuarios, 4 permisos, 6
`permission_user`.

### CA-6 — Modelos introspeccionados, no escritos a mano
`schema.prisma` incorpora los 12 modelos vía `prisma db pull`, con los
renombres del paquete aplicados a mano (modelos PascalCase, campos camelCase
con `@map`, relaciones con nombre: `Attribute.values`, `StoreNotice.creator`,
`StoreNotice.users`/`shops`/`reads`, y las inversas en `User` y `Shop`).
`prisma validate` pasa y `prisma migrate diff` entre la base y el schema da
`EXIT=0`. La cabecera del archivo añade las CHECK nuevas a la lista de «lo
que Prisma no modela» (`:10-16`), porque US-35..39 las validarán en sus
repositorios. El preview `partialIndexes` sigue ahí.

### CA-7 — Records y barrel
`records.ts` define `FaqRecord`, `TermsAndConditionsRecord`,
`RefundPolicyRecord`, `RefundReasonRecord`, `TaxRecord`, `ShippingRecord`,
`AttributeRecord`, `AttributeValueRecord` y `StoreNoticeRecord`, con sus
mappers `_to*Record`, siguiendo las dos conversiones del archivo (`_id`,
`_dec` para `rate`/`amount`) y sin ninguna clave que no tenga columna
(`translated_languages`, `deleted_at`, `is_read` derivado, `creator_role` y
el `type` nulo de `attributes` los emitirán las US consumidoras como
constantes o derivados, D-2). Los tipos se exportan desde `index.ts`. Los
records de los pivotes no hacen falta: sus lecturas las modelará cada
repositorio consumidor.

### CA-8 — Un test de integración demuestra el seed desde `@safari/db`
Un `*.integration.test.ts` nuevo en `packages/db/src` (no un repositorio:
consulta con `prisma.*` directo, como `slug.integration.test.ts`) asevera
los conteos de CA-5 y dos hechos que el `psql` de la DoD no cubre desde
Node: que `StoreNotice.creator` resuelve a `admin@demo.com` (id 3) en las 3
filas y que `Attribute.values` devuelve 27 en total. `just db-check` sube de
10 archivos / 203 tests.

### CA-9 — Documentación
`db/README.md` gana la sección del modelo de contenido y configuración (las
12 tablas, la deduplicación de `terms`, el remapeo por email y la ruta
`store-notices/read` inexistente como aviso a US-39); la línea de conteos
del README y del seed se actualizan; `packages/db/README.md` documenta los
records nuevos y que los repositorios llegan con US-35..39.

## Escenarios Gherkin

```gherkin
Feature: Esquema de contenido y configuracion en Postgres
  Scenario: CA-4/CA-5 — los terminos duplicados no rompen el unique de slug
    Given el mock trae 10 terminos con 5 slugs repetidos por copias exactas
    When se regenera el seed y se recrea la base
    Then terms_and_conditions tiene 5 filas
    And la fila con slug "privacy-policy" conserva el id 10
    And ningun INSERT falla por slug duplicado

  Scenario: CA-4/CA-5 — el creador de los avisos es un usuario real
    Given store-notices.json declara created_by 6 y creator.email admin@demo.com
    When se aplica el seed
    Then las 3 filas de store_notices tienen created_by 3
    And no hay filas con created_by fuera de users

  Scenario: CA-4 — un email desconocido detiene la generacion
    Given un aviso cuyo creator.email no existe en users.json
    When se ejecuta node db/generate-seed.mjs
    Then el proceso termina con codigo distinto de cero
    And db/seed.sql no se sobrescribe

  Scenario: CA-1/CA-5 — la FK de atributos cierra
    Given la base recreada con just db-reset
    When se cuentan los atributos cuyo shop_id no existe en shops
    Then el resultado es cero
    And attribute_values tiene 27 filas repartidas en 8 atributos

  Scenario: CA-6 — la introspeccion no acusa drift
    Given db/schema.sql aplicado a la base
    When se ejecuta prisma validate y prisma migrate diff contra el schema
    Then ambos terminan sin diferencias

  Scenario: CA-5 — sin regresion del catalogo ni de identidad
    Given el seed regenerado
    When se cuentan products, shops, categories, users y permission_user
    Then valen 1200, 12, 198, 3 y 6
    And just db-check sigue verde en las 10 suites previas
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/schema.sql` | 12 tablas nuevas con CHECK, FKs, índices y banners; cabecera actualizada; política de reloj heredada de US-32 en el bloque de triggers |
| `db/generate-seed.mjs` | leer 8 JSON; deduplicar `terms`; remapear usuarios por email; validar FKs y enumerados; emitir 12 bloques tras `shops`; `setval` de 10 secuencias; conteos en cabecera y consola |
| `db/seed.sql` | regenerado (artefacto, no se edita a mano) |
| `db/README.md` | modelo de contenido y configuración; conteos; avisos para US-35..39 |
| `packages/db/prisma/schema.prisma` | 12 modelos por `db pull` + renombres; relaciones inversas en `User` y `Shop`; cabecera con las CHECK nuevas |
| `packages/db/src/records.ts` | 9 records + mappers |
| `packages/db/index.ts` | exports de los tipos nuevos |
| `packages/db/src/content-seed.integration.test.ts` (nombre orientativo) | nuevo: conteos y relaciones del seed desde Prisma |
| `packages/db/README.md` | records nuevos; repositorios diferidos a US-35..39 |
| `docs/product/33-contenido-configuracion-postgres/README.md` | fila de US-34 (LOC, dependencia) y, tras el visto bueno, R-3/R-4 reescritos |

## Estimación: ~1450 LOC (alcance recomendado)

Bottom-up contra tamaños reales del repo, sin `db/seed.sql` (generado):

| Componente | Ancla real hoy | Δ estimado | Motivo |
|---|---|---|---|
| `db/schema.sql` | identidad: 6 tablas en ~110 líneas (`:104-212`) + 4 índices + 2 triggers ≈ 21 líneas/tabla | **+300** | 12 tablas, 9 CHECK de enumerado, ~10 FK con índice, banners; `store_notices` es la tabla más comentada |
| `db/generate-seed.mjs` | 431 líneas para 10 datasets (~43/dataset con validación) | **+280** | 8 datasets + 4 reglas de CA-4 + validaciones + secuencias |
| `schema.prisma` | 319 líneas / 15 modelos (~21/modelo) | **+270** | 12 modelos + campos de relación en `User` y `Shop` + cabecera |
| `records.ts` | 303 líneas / 9 records (~34/record con mapper) | **+300** | 9 records |
| test de integración del seed | `slug.integration.test.ts` 113 | **+150** | conteos + 2 relaciones |
| `index.ts` | — | **+15** | |
| `db/README.md` + `packages/db/README.md` | — | **+130** | |
| **Total** | | **~1445 → ~1450** | |

Es ×1,2 sobre el ~1200 del épico, no por el sesgo histórico sino porque
la tabla del épico no contaba `records.ts` ni el test. **Sigue siendo
suelo, no techo** (R-1): el precedente más cercano en forma, US-20 + US-21
(1 agregado, 6 tablas, 1 repositorio), se estimó en 380 + 450.

**Si P-2 se resuelve manteniendo los repositorios aquí**, se suman 8
repositorios con sus tests de integración, anclados en los reales del
paquete: 6 agregados planos × (~200 repo + ~250 test) = ~2700;
`attributes` con hijos ≈ 350 + 350; `store_notices` con 3 pivotes,
`created_by` y lectura por usuario ≈ 450 + 450 → **~3300 adicionales,
total ~4600**. Ninguna US del repo ha cerrado por encima de ~2100 líneas
sin partirse en varios PRs.

## Definición de Done

- [x] **Autorización de `just db-reset`: CONCEDIDA por el dueño (2026-09-14)**,
      renovando la del 2026-08-31 del Épico 19. Registrada como decisión 6 del
      [Épico 33](./README.md) y cubre también a US-32. No quedan decisiones
      abiertas: P-1 y P-2 se confirmaron el mismo día.
- [ ] US-32 con Status `Implementada`. Es dependencia dura (P-1): esta US no
      arranca antes.
- [ ] `node db/generate-seed.mjs` con la salida pegada: los conteos nuevos
      en consola, y el mensaje de fallo pegado de una corrida con un JSON
      alterado a propósito (email de creador inexistente), restaurado
      después.
- [ ] `just db-reset` completo sin errores, salida pegada.
- [ ] `psql` pegado con: los 12 conteos de CA-5; **0** filas huérfanas por
      cada FK nueva (`faqs.shop_id`, `faqs.user_id`,
      `terms_and_conditions.shop_id`/`user_id`, `refund_policies.shop_id`,
      `attributes.shop_id`, `attribute_values.attribute_id`,
      `store_notices.created_by`/`updated_by`, los 3 pivotes); la fila de
      `terms_and_conditions` con slug `privacy-policy` mostrando `id = 10`;
      las 3 filas de `store_notices` con `created_by = 3`.
- [ ] Conteos previos pegados e intactos: 1200 / 12 (`max(id)=15`) / 198 /
      10 / 14 / 10 / 3 / 4 / 6.
- [ ] `git diff db/schema.sql` pegado en resumen (`--stat` y las líneas
      que cambian fuera del bloque nuevo): solo cabecera y adiciones.
- [ ] `cd packages/db && npx prisma validate` y `npx prisma migrate diff
      --from-config-datasource --to-schema ./prisma/schema.prisma
      --exit-code` pegados, `EXIT=0` («No difference detected»; es el gate
      que US-21 dejó como precedente).
- [ ] `just db-build` limpio (prisma generate + tsup, CJS + `.d.ts`).
- [ ] `just db-check` verde, con el recuento pegado: sube de 10 archivos /
      203 tests, y las 10 suites previas siguen pasando.
- [ ] `cd apps/api/rest && npx jest` verde con el recuento pegado (la API
      no cambia, pero consume `dist/` recién construido: es la prueba de que
      el barrel no rompió nada).
- [ ] `db/README.md`, `packages/db/README.md` y la cabecera de
      `schema.prisma` actualizados.
- [ ] Status de esta US actualizado, fila del épico marcada, y las
      **divergencias para US-35..39** (sección de notas) copiadas en el
      reporte final.

## Notas para el agente ejecutor

- **Leer antes de tocar código:** esta US entera, el README del épico,
  `CLAUDE.md`, `db/README.md`, `packages/db/README.md`, US-20 y US-21 (son el
  molde) y **US-32 ya cerrada**, para heredar su política de reloj (CA-3).
- **No arrancar sin la confirmación de P-1/P-2 pegada.** Si el dueño no ha
  respondido, esta US no está lista: parar y preguntar.
- **`prisma db pull` pisa los renombres.** Hacer el pull, revisar el diff
  completo y re-aplicar los renombres de los 15 modelos previos además de
  nombrar los 12 nuevos. No editar `schema.prisma` para cambiar el modelo:
  si falta una columna, se corrige `db/schema.sql`, `db-reset` y pull otra
  vez (antipatrón declarado en `docs/product/README.md`).
- **Windows:** vitest reporta «0 tests» si el `cwd` tiene la unidad en
  minúscula; `just db-check` ya lo re-normaliza. Si el test nuevo no
  aparece, mirar el casing antes que la base.
- **Regla de deduplicación de `terms`**: conservar la **primera aparición
  en el orden del archivo**, no el id más bajo. Son cosas distintas aquí
  (el archivo va 8,9,10,11,12,1,…) y solo la primera preserva lo que
  `GET /:slug` devuelve hoy.
- **`effective_from`/`expired_at`** llegan como `'2023-03-15 18:00:00'`:
  Postgres los acepta como `timestamptz` en la zona del servidor. No
  convertirlos en el generador; la divergencia de formato en la respuesta es
  de US-39 (abajo).
- **Tentación a evitar:** un «repositorio genérico» para los 6 agregados
  planos. No aplica aquí (esta US no escribe repositorios) y tampoco después:
  el patrón del paquete son funciones planas tipadas por agregado (D-2 del
  Épico 26); lo compartido ya existe (`generateSlug`,
  `translateCatalogWriteError`, `buildPaginator`).
- **Nada de `apps/`**: si algo del DDL parece exigir tocar un servicio o un
  formulario, es señal de que el contrato de lectura de una US consumidora
  se malinterpretó. Anotar y seguir.

### Divergencias que esta US deja declaradas para US-35..39

Van al reporte final y a `db/README.md`; no se resuelven aquí.

| US | Hecho | Consecuencia que esa US debe decidir/declarar |
|---|---|---|
| US-35 | `terms_and_conditions` siembra 5 filas, no 10 (CA-4.1) | `GET /terms-and-conditions` publica `total: 5`; la primera página conserva los mismos 5 primeros elementos e ids que el mock; `GET /:slug` es byte a byte idéntico |
| US-35 | `faqs`/`terms` no traen `shop_id`/`user_id` en el mock | El seed los deja `NULL`; las lecturas emiten `null` donde el mock **omite** la clave — divergencia de forma a decidir (omitir vs. `null`) |
| US-36 | `refund_reasons.deleted_at: null` en el mock | Constante `null` desde el servicio; no hay columna |
| US-37 | `taxes`/`shippings` se leen también en `pages/settings/*` del admin | R-5 del épico: verificar que `/api/settings` no cambia |
| US-38 | `attributes[].type` es `{id:null,name:null,slug:null,logo:null}` | Constante desde el servicio; no hay `type_id` |
| US-38 | 4 slugs con mayúsculas (`color-OMG`, …) | Se leen tal cual; al **crear** desde el admin, `generateSlug` los normalizará a minúsculas — declarar |
| US-39 | `POST /store-notices/read` no existe en la API y el admin lo llama | Decidir si se añade (la tabla `store_notice_read` ya está) o se declara stub; es la ruta 7 que el épico cuenta como 6 |
| US-39 | `is_read` y `creator_role` de nivel superior son derivados por usuario | Se calculan en el servicio desde `store_notice_read` y los permisos del creador |
| US-39 | `effective_from`/`expired_at` sin `T` ni zona en el mock | `Date.toJSON()` emitirá ISO: divergencia de formato a declarar, hermana de D-4 |
| US-39 | `created_by` remapeado 6 → 3 y `creator` embebido | El objeto `creator` se arma desde `users`, no se persiste |
| Todas | `translated_languages` no es columna (D-2) | Constante `['en']`, precedente `types.service.ts:39` |
