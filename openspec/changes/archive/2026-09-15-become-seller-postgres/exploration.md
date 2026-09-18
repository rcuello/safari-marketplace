# Exploration: US-44 — `become-seller` desde Postgres

## Current State

- El módulo mock tiene exactamente **2 rutas activas**, ambas bajo
  `@Controller('became-seller')` (pasado, no `become-seller`; el prefijo
  global es `api`, así que la URL real es `/api/became-seller` —
  `apps/api/rest/src/become-seller/become-seller.controller.ts:9`) y ambas
  `@Public()` a nivel de clase (`:8`), sin ningún guard de admin:
  - `POST /api/became-seller` → `create(@Body() CreateBecomeSellerDto)`
    (`:13-16`) — hoy es un **no-op**: ignora el body y devuelve
    `this.becomeSeller` sin persistir nada
    (`become-seller.service.ts:14-16`).
  - `GET /api/became-seller` → `findAll()` (`:18-21`) — devuelve
    `this.becomeSeller`, un singleton construido una sola vez al cargar el
    módulo con `plainToClass(BecomeSeller, becomeSellerJson)`
    (`become-seller.service.ts:8,18-20`).
  - `findOne`/`update`/`remove` existen en el servicio (`:22-32`) pero
    **no están cableados en el controller** — código muerto, no rutas.
  - El endpoint `BECAME_SELLER: 'became-seller'` que consume el admin es
    literalmente este mismo path (`apps/admin/rest/src/data/client/api-
    endpoints.ts:101`, `apps/shop/src/framework/rest/client/api-
    endpoints.ts:68`) — confirma que el nombre "mal escrito" (pasado) es
    parte del contrato HTTP congelado, no un typo a corregir.
  - El admin actualiza con `becomeSellerClient.update` →
    `HttpClient.post(API_ENDPOINTS.BECAME_SELLER, data)`
    (`apps/admin/rest/src/data/client/become-seller.ts:19-23`): es decir,
    **la ruta de escritura real que CA-2 debe volver funcional es el mismo
    `POST` que hoy hace `create`**, no una ruta nueva.

## Affected Areas

- `apps/api/rest/src/become-seller/become-seller.service.ts` — reemplazar
  el singleton en memoria por lectura/escritura contra `@safari/db`.
- `apps/api/rest/src/become-seller/become-seller.service.spec.ts` — no
  existe todavía; no hay precedente de spec para `become-seller` ni para
  `settings` (ver hallazgo 5).
- `packages/db/src/repositories/become-seller.repository.ts` — **no
  existe**; hay que crearlo desde cero (funciones planas, sin clase).
- `packages/db/src/repositories/become-seller.integration.test.ts` — **ya
  existe** (creado por US-41) con 6 `describe` de invariantes de esquema
  contra Prisma directo; US-44 debe **extenderlo**, no recrearlo — la tabla
  del `## Archivos a crear / modificar` de la US lo lista como si fuera
  nuevo, lo cual es inexacto.
- `packages/db/index.ts` — añadir el/los export(s) de función nueva (hoy
  solo exporta el tipo `BecomeSellerRecord`, ninguna función).

## Hallazgos (evidencia, no intuición)

### 1. El JSON mock: confirmado empíricamente, dos claves hermanas

`apps/api/rest/src/db/pickbazar/become-seller.json` (14.115 B en disco) —
verificado con `node -e` en esta exploración:
- Claves top-level: `['page_options', 'commissions']`.
- `page_options` es el envoltorio: `{ id, page_options (24 claves), language,
  created_at, updated_at }` — `id:1`, `language:'en'`,
  `created_at:'2024-06-06T10:30:48.000000Z'`,
  `updated_at:'2024-06-12T11:31:46.000000Z'`.
- `commissions` es un **array de 2 objetos** (tiers `Level One`/`Level Two`,
  11 claves cada uno incl. `image`, `language`, `created_at`, `updated_at`
  propios).
- Reproduje la aserción de la US: `plainToClass(BecomeSeller, json)` en un
  script real da como resultado un objeto cuyo `JSON.stringify` es
  **byte-idéntico** al `JSON.stringify` del JSON crudo:
  `stringify(instance) === stringify(rawJson)` → `true`,
  **11.458 bytes / 11.456 caracteres** (el cuerpo real que sirve el `GET`
  hoy; los 14.115 B son solo el pretty-print en disco).
  `class-transformer` copia todas las claves del plano por defecto (sin
  `excludeExtraneousValues`), así que **el desajuste entre la entidad
  (`missions: CommissionItem[]`, `become-seller.entity.ts:10`) y el JSON
  real (`commissions`) es inofensivo**: la clave que viaja por HTTP es la
  del JSON (`commissions`), no la declarada en la clase.

### 2. Lo que US-41 YA construyó — la US-44 subestima el punto de partida

Contrario a como la US-44 describe el trabajo ("repositorio de funciones
planas... nuevo"), US-41 (commit `f06f0e3`, "Expone shop_staff y
become_seller en @safari/db") ya dejó:
- **Tabla**: `db/schema.sql:485-493` — `become_seller(id smallint PK
  DEFAULT 1, page_options jsonb NOT NULL, commissions jsonb NOT NULL,
  language text DEFAULT 'es', created_at, updated_at, CHECK
  become_seller_fila_unica (id = 1))`. Exactamente 2 columnas jsonb, como
  pide la US corregida.
- **Seed**: `db/seed.sql:33-35` siembra la fila 1 con los valores reales del
  mock (`page_options` = objeto interno de 24 claves, `commissions` = array
  de 2, `language='en'`) vía `INSERT ... ON CONFLICT (id) DO UPDATE`.
- **Prisma**: `packages/db/prisma/schema.prisma:341-349`, modelo
  `BecomeSeller` con `@@map("become_seller")`.
- **Record + mapper**: `packages/db/src/records.ts:187-194`
  (`BecomeSellerRecord { id, pageOptions, commissions, language, createdAt,
  updatedAt }`) y `:335-344` (`_toBecomeSellerRecord`). Ya exportado el TIPO
  desde `packages/db/index.ts:31`.
- **Test de esquema**: `packages/db/src/repositories/become-seller.
  integration.test.ts` (88 líneas) — consulta Prisma directo (`prisma.
  becomeSeller.findUniqueOrThrow`), NO usa ningún repositorio (todavía no
  existe), y ya afirma: fila única id=1, CHECK rechaza una segunda fila,
  las 24 claves de `pageOptions` sin fusionar con `commissions`, `updatedAt
  === createdAt` (sin ruta de update todavía) y ausencia de trigger.

**Delta real para US-44**: falta únicamente (a) `become-seller.
repository.ts` con una función de lectura y una de escritura real, (b)
exportar esa(s) función(es) desde `index.ts`, (c) reescribir el servicio
Nest para consumirlas, (d) el `spec.ts` del servicio con `@safari/db`
mockeado, y (e) sumar `describe` nuevos al integration test **existente**
para las funciones del repositorio (no crear el archivo).

### 3. Precedente `settings` — coincide y diverge de lo que pide CA-2

`apps/api/rest/src/settings/settings.service.ts` es el precedente
byte-congelado (`settings.service.ts:22-40`, `getSettings()` desde
`@safari/db`, traducción camelCase→snake_case a mano). Coincide con lo que
US-44 debe hacer para el `GET`.

**Diverge en la escritura**: `settings.service.ts:45-51` — `create()` y
`update()` **no persisten**, solo llaman a `findAll()` de nuevo, con un
comentario explícito: "el mock nunca persistió nada... se mantiene ese
comportamiento". `packages/db/src/repositories/settings.repository.ts`
(14 líneas) **solo exporta `getSettings()`**, ninguna función de escritura.
CA-2 de US-44 pide lo contrario explícitamente ("La ruta de escritura
actualiza el singleton y el GET siguiente refleja el cambio") — **esta US
sería la PRIMERA en implementar una escritura real sobre un singleton de
página** en este repo; no hay una función `updateX()` de un singleton para
copiar 1:1. El patrón de `updatedAt: now()` sí está establecido para
updates de fila (`categories.repository.ts:545`, `import { now } from
'../clock'` en `categories.repository.ts:19` y `users.repository.ts:16`),
solo que nunca aplicado a un singleton bare (settings no lo usa porque
nunca escribe de verdad).

`packages/db/src/clock.ts` — API exacta: `now(): Date` y `_setNowProvider
(provider: () => Date): void` (`clock.ts:23-33`). Su cabecera de alcance
(`:6-13`) NO menciona `become_seller` explícitamente en la lista de tablas
gobernadas, pero sí generaliza: "profiles no tiene hoy ruta de UPDATE; la
PRIMERA que se cree debe fijar `updatedAt: now()` igual que las demás" — el
mismo principio aplica aquí.

### 4. `domain-error.mapper.ts` probablemente NO aplica

`apps/api/rest/src/common/errors/domain-error.mapper.ts` traduce un
conjunto **cerrado** de 5 códigos de error de escritura de catálogo
(`EmptySlug`, `InvalidReference`, `RecordNotFound`, `DependentRows`,
`SlugConflict` — `:81-98`), pensados para agregados con slug/FK/filas
dependientes (`tags`, `manufacturers`, `categories`, `products`, `shops`).
`become_seller` es un singleton de fila fija (`id=1` siempre, sin slug, sin
FK entrante, sin borrado): ninguno de los 5 códigos es alcanzable desde su
repositorio si la función de escritura hace `update({ where: { id: 1 },
data: {...} })` sin intentar crear una fila nueva. El propio spec de este
mapeador exige que `git diff` de ese archivo quede **vacío** al integrar un
agregado nuevo (`domain-error.mapper.spec.ts` cabecera, CA-7 citada en el
código: `:7-9`) — la propuesta debería declarar explícitamente que
`become-seller` no lo toca, salvo que aparezca un error real que lo
justifique.

### 5. Tests — medido, no leído de memoria

- **Jest (`apps/api/rest`)**: corrí `npx jest --listTests` en esta
  exploración → **9 archivos**, ninguno es `become-seller.service.spec.ts`
  ni `settings.service.spec.ts` (settings tampoco tiene spec propio hoy).
  El conteo de 285 tests que cita `CLAUDE.md` **no lo re-ejecuté** en esta
  exploración (solo confirmé el listado de archivos, no corrí la suite
  completa) — se toma la cifra del `CLAUDE.md` como referencia, no como
  medición propia.
- El patrón de mock de `@safari/db` en Jest (visto en
  `categories.service.spec.ts:66-82`): `jest.mock('@safari/db', () => ({
  ...jest.requireActual(...), createCategory: jest.fn(), ... }))` +
  `jest.mocked(fn)` por cada función importada — es el patrón a copiar para
  `become-seller.service.spec.ts` (mockeando la(s) función(es) nueva(s) del
  repositorio).
- **Vitest (`packages/db`)**: NO corrí `just db-check` ni `npm test` en
  esta exploración (evité ejecutar la suite completa para no generar ruido
  de estado; el contenedor `safari-postgres` está `Up 8h (healthy)`,
  confirmado con `docker ps`). La cifra base citada por la exploración
  archivada de US-41 es 10 archivos / 210 tests — no la re-verifiqué aquí,
  queda pendiente para el cierre de la propuesta/apply.
- `vitest.config.ts` fija `fileParallelism: false` (evita contaminación de
  conteos entre archivos de integración contra el mismo Postgres).

### 6. Consumidores reales — confirmados, con una corrección de ruta

- Shop: `apps/shop/src/pages/become-seller/index.tsx` usa `getStaticProps`
  de `apps/shop/src/framework/rest/become-seller.ts:18-21`, que hace
  `fetchQuery([API_ENDPOINTS.BECAME_SELLER, ...], () =>
  client.becomeSeller.get(...))` y compone el prop `data` mezclando
  `data.page_options.page_options` con `settingsData.options.
  isMultiCommissionRate` (`:26-34`) — confirma que el consumidor real
  necesita el envoltorio anidado exacto (`page_options.page_options`), no
  una versión aplanada.
  `apps/shop/src/components/become-seller/index.tsx:40-41` lee
  `data?.page_options?.page_options` y `data?.commissions` como **hermanos**
  — confirma la forma de dos colecciones, no una anidada dentro de otra.
- Los "dos headers" que cita la US existen, pero en la ruta real
  `apps/shop/src/components/layouts/header.tsx:300` y `.../header-
  minimal.tsx:239` (no `apps/shop/src/layouts/...` como sugiere la prosa) —
  y **solo enlazan** a `Routes.becomeSeller = '/become-seller'`
  (`apps/shop/src/config/routes.ts:50`); no leen el JSON directamente. El
  consumidor real de los datos es la página, no los headers.
- Admin: `apps/admin/rest/src/data/become-seller.ts` (`useBecomeSellerQuery`
  + `useUpdateBecomeSellerMutation`) y `data/client/become-seller.ts` — el
  `update` hace `POST` (no PUT/PATCH) al mismo endpoint, confirmando el
  hallazgo del punto 1.

### 7. Riesgo concreto y medido: CA-1 "byte a byte" es más frágil de lo que la US asume

Verificado empíricamente contra el Postgres real (`safari-postgres`, ya
sembrado por US-41):

- **Postgres `jsonb` NO preserva el orden de claves del objeto original.**
  `SELECT jsonb_object_keys(page_options) FROM become_seller` devuelve un
  orden (`banner, contact, faqItems, faqTitle, dashboard, ...`)
  completamente distinto al orden del JSON fuente (`defaultCommissionRate,
  defaultCommissionDetails, banner, sellingStepsTitle, ...`). Mismo
  fenómeno confirmado en cada objeto de `commissions` (p. ej. `id, image,
  level, language, sub_level, commission, created_at, updated_at,
  description, max_balance, min_balance` vs. el orden original `id, level,
  sub_level, description, min_balance, max_balance, commission, image`).
  El **array** sí preserva el orden de sus elementos (tier 79 antes que 83);
  solo las claves de OBJETO se reordenan.
- Medí el efecto exacto: `JSON.stringify` del `pageOptions`/`commissions`
  leídos de vuelta de Postgres tiene el **mismo largo en bytes** que el
  original (9.861 B y 1.439 B respectivamente) pero **la cadena no es
  idéntica** (`identical strings: false` en ambos) — incluso cuando algún
  DoD compare solo tamaños, un diff de contenido real fallaría.
- Más grave: simulé la reconstrucción completa que el servicio tendría que
  devolver (`{ page_options: { id, page_options, language, created_at,
  updated_at }, commissions }`, con `created_at`/`updated_at` como objetos
  `Date` reales de la fila, tal como los expone `BecomeSellerRecord`) y el
  cuerpo resultante mide **11.452 B**, no 11.458 B — **6 bytes menos** que
  el original. Causa: `Date.toJSON()` de Node emite 3 dígitos decimales de
  fracción de segundo (`.000Z`) donde el mock trae 6 (`.000000Z`), por 2
  campos (`created_at`/`updated_at` del envoltorio) → 3 caracteres × 2 = 6
  bytes. Esto es la MISMA clase de divergencia que `CLAUDE.md` documenta
  como "ya embarcada" para `/api/settings`, pero ahí el texto afirma que
  "los timestamps ISO miden lo mismo" — no logré verificar esa afirmación
  para `settings` en esta exploración (no reproduje su medición), y para
  `become-seller` mi propia medición SÍ muestra una diferencia de tamaño
  real, no solo de contenido. La propuesta/diseño debe decidir
  explícitamente cómo cerrar CA-1: opciones no excluyentes — (a) formatear a
  mano los 2 timestamps del envoltorio para preservar 6 decimales antes de
  serializar, (b) reconstruir `page_options`/`commissions` con el orden de
  claves original en vez de devolver el objeto crudo de `jsonb` (p. ej.
  recomponiendo el objeto campo a campo en un orden fijo), o (c) relajar la
  redacción de CA-1 a "mismo *contenido* (claves/valores), no
  necesariamente mismo string" y dejar que el DoD lo evidencie con un diff
  estructural (`JSON.parse` + comparación profunda) en vez de una
  comparación de bytes cruda — que es más honesto dado lo que Postgres
  realmente garantiza.
- Los `created_at`/`updated_at` **dentro** de cada tier de `commissions`
  (p. ej. `"2024-06-11T18:52:37.000000Z"`) SÍ viajan intactos porque están
  congelados como texto dentro del jsonb (no son columnas de la tabla) —
  solo se reordenan junto con las demás claves del objeto, no cambian de
  valor.

## Approaches

1. **Repositorio con lectura + escritura real, reconstrucción manual del
   envoltorio para preservar orden y formato de timestamp (recomendado)**
   - `getBecomeSeller()`: `prisma.becomeSeller.findUnique({ where: {id:1}
     })` → `_toBecomeSellerRecord`.
   - `updateBecomeSeller(input)`: `prisma.becomeSeller.update({ where:
     {id:1}, data: {...input, updatedAt: now()} })` — nunca crea fila,
     solo actualiza la fija por CHECK.
   - El servicio de Nest reconstruye el envoltorio a mano, formateando
     `created_at`/`updated_at` explícitamente (p. ej. con un helper que
     imponga 6 decimales) para minimizar la deriva de bytes, y deja
     constancia en el DoD del diff exacto que sí sobrevive (reordenado de
     claves) citando esta exploración.
   - Pros: escritura real (cumple CA-2 literal), reutiliza clock.ts (US-32),
     no toca `domain-error.mapper.ts`.
   - Cons: el formateo manual del timestamp es una pieza de código nueva sin
     precedente exacto en el repo (settings nunca la necesitó, porque nunca
     escribe de verdad).
   - Effort: Low-Medium.

2. **Escritura real pero CA-1 redefinido como "contenido", no "bytes"**
   - Igual repositorio, pero la propuesta ajusta CA-1 para verificar con
     `JSON.parse` + comparación profunda (deep-equal) en vez de comparación
     cruda de bytes, documentando por qué (evidencia de esta exploración:
     Postgres no garantiza orden de claves jsonb).
   - Pros: evita construir un formateador de fecha a mano solo para ganar
     bytes; más honesto sobre lo que Postgres puede garantizar.
   - Cons: se aparta de la letra de la US ("mismo tamaño en bytes"); exige
     que el dueño apruebe el cambio de criterio antes de `sdd-propose`.
   - Effort: Low.

## Recommendation

Approach 1 como default técnico, pero **la decisión entre 1 y 2 es del
dueño**, no del ejecutor: la US-44 fue escrita asumiendo que el JSON
"vive" en Postgres sin fricción, y la evidencia de esta exploración muestra
que no es gratis. `sdd-propose` debe presentar ambas opciones citando los
números exactos medidos aquí (6 bytes de diferencia real, reordenado de
claves siempre) y dejar que la propuesta declare cuál CA-1 se implementa.

## Risks

- **CA-1 "byte a byte" tal como está escrito puede no ser alcanzable sin
  trabajo extra de formateo** — ver hallazgo 7, medido con evidencia
  reproducible (11.452 B reconstruidos vs 11.458 B originales, más
  reordenado de claves en ambos jsonb). Si `sdd-propose` no lo resuelve
  explícitamente, `sdd-verify` fallará CA-1 con una comparación de bytes
  real (no con `wc -c`/`Content-Length`, que no detecta el reordenado pero
  sí detectaría el faltante de 6 bytes).
- **La tabla "Archivos a crear/modificar" de la US-44 está desactualizada**:
  lista `become-seller.integration.test.ts` como archivo nuevo cuando ya
  existe (creado por US-41, 88 líneas, 6 `describe` de invariantes de
  esquema). El ejecutor debe EXTENDERLO, no sobrescribirlo — sobrescribir
  perdería cobertura ya verde.
- **No hay precedente de escritura persistente para un singleton en este
  repo.** `settings` (el "hermano" más cercano) deliberadamente NO
  persiste sus escrituras; become-seller sería el primero. Esto significa
  que el patrón de "reconstrucción del envoltorio + `now()`" no tiene una
  función gemela para copiar 1:1, solo piezas sueltas (`_toBecomeSellerRecord`,
  `now()`, el patrón de `update` de `categories.repository.ts`).
- **`domain-error.mapper.ts` probablemente no necesita tocarse** (hallazgo
  4) — si la propuesta lo modifica de todos modos, contradice la garantía
  de "git diff vacío" (CA-7) que otros specs del repo declaran para ese
  archivo; vale la pena que `sdd-design` lo declare explícitamente en vez
  de dejarlo implícito.
- **El endpoint es `/api/became-seller` (pasado), no `/api/become-seller`.**
  Cualquier código nuevo (tests, curls de evidencia) que asuma el nombre
  "corregido" romperá el contrato. Ya verificado en 3 puntos: controller,
  y las dos constantes `API_ENDPOINTS.BECAME_SELLER` del shop y del admin.
- **El barrel `packages/db/index.ts` se comparte con US-42** (nota ya en el
  README del épico): quien lo toque segundo debe rebasear — riesgo de
  conflicto si ambas US corren en paralelo, no bloqueante para esta
  exploración.
- **No medí en esta sesión** el conteo actual de `just db-check` (vitest)
  ni re-corrí los 285 tests de Jest — ambos quedan como verificación
  pendiente antes de cerrar la propuesta o el apply, no se debe asumir que
  siguen en los mismos números citados por `CLAUDE.md`/la exploración de
  US-41 sin re-confirmarlos en su momento.

## Ready for Proposal

Sí, con una condición: `sdd-propose` MUST declarar explícitamente cuál de
las dos interpretaciones de CA-1 (Approach 1 o 2) se implementa, citando
los números medidos en el hallazgo 7 de esta exploración — no se puede
prometer "byte a byte" sin decidir primero cómo se resuelve el reordenado
de claves jsonb y el faltante de 6 bytes en los timestamps del envoltorio.
El resto del alcance (repositorio nuevo, servicio, tests) está claro y sin
bloqueos.
