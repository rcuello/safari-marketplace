# Design: US-44 — `become-seller` desde Postgres

## Technical Approach

Se ejecuta el Approach de `proposal.md` con las decisiones del dueño ya cerradas
(CA-1 estructural, ruta `/api/became-seller` intacta, `domain-error.mapper.ts`
sin tocar). El delta es un tramo de fontanería de 4 piezas sobre una base que
US-41 ya dejó completa —tabla (`db/schema.sql:485-493`), seed (`db/seed.sql:33-35`),
modelo Prisma (`schema.prisma:341-350`), `BecomeSellerRecord` +
`_toBecomeSellerRecord` (`packages/db/src/records.ts:187-194`, `:336-345`) y una
suite de esquema de 87 líneas—:

1. `become-seller.repository.ts`: `getBecomeSeller()` + `updateBecomeSeller()`.
2. El barrel `packages/db/index.ts`: 1 `export type` + 1 `export`.
3. `become-seller.service.ts`: Postgres en lugar del literal en memoria, con el
   envoltorio recompuesto a mano.
4. Dos suites: se **extiende** la de integración y se **crea** la de Nest.

Superficies de riesgo, desiguales: **repositorio** (bajo, calco de
`settings.repository.ts` + `users.repository.ts:324-338`), **servicio** (medio —
el DTO heredado no describe el body real, D-4), **determinismo de la integración**
(el riesgo real, D-5) y **evidencia de CA-1** (medio — el deep-equal ingenuo
falla, D-3).

Es la **primera escritura persistente sobre un singleton** del repo: `settings`
es el hermano más cercano y sus escrituras **deliberadamente no persisten**
(`settings.service.ts:42-51`; `settings.repository.ts` tiene 14 líneas y solo
`getSettings()`). No se construye ninguna abstracción de «singleton genérico»:
una ocurrencia no la justifica.

Estado verificado hoy con `node -e` sobre el mock: cuerpo de **11 458 B**
(11 456 caracteres), claves top-level `['page_options','commissions']`, envoltorio
de 5 claves `['id','page_options','language','created_at','updated_at']`, objeto
interno de **24** claves, `commissions` de longitud **2**.

---

## Architecture Decisions

### D-1: Repositorio de dos funciones planas, ambas `| null`, sin errores de dominio

**Choice**

```ts
export async function getBecomeSeller(): Promise<BecomeSellerRecord | null>
export async function updateBecomeSeller(
  input: UpdateBecomeSellerInput
): Promise<BecomeSellerRecord | null>
```

`getBecomeSeller` es calco literal de `getSettings()`
(`settings.repository.ts:11-14`): `findUnique({ where: { id: 1 } })` +
`_toBecomeSellerRecord`. `updateBecomeSeller` hace `prisma.becomeSeller.update({
where: { id: 1 }, data: { …spreads, updatedAt: now() } })` dentro de un `try` que
traduce **P2025 → `null`**, con el helper privado `_isRecordNotFound` duplicado
localmente (7 líneas, calco de `users.repository.ts:391-397`).

**Alternatives**

| Opción | Descarte |
|---|---|
| `upsert`/`create` si falta la fila | La fila fija la garantiza `CHECK become_seller_fila_unica` (`db/schema.sql:492`); crear sería pelear con la CHECK. CA-3 exige que ninguna ruta cree una segunda fila |
| Lanzar `RecordNotFoundError` (dominio) | Obligaría al servicio a llamar `toWriteHttpException` y arrastraría `domain-error.mapper.ts` al diff, contra CA-7 (D-6) |
| Dejar burbujear el `P2025` crudo | Un 500 con stack de Prisma donde `settings` ya da un mensaje accionable |
| Extraer `_isRecordNotFound` a un módulo compartido | Sería la **segunda** ocurrencia (hoy solo `users.repository.ts:396`); la tercera justificaría la extracción, no esta |

**Rationale**: las dos firmas `| null` dan al servicio **una sola forma de
guarda** para las dos rutas (tres líneas repetidas, ninguna abstracción). El
modelo Prisma **no** lleva `@updatedAt` (`schema.prisma:348`), así que el reloj es
explícito vía `now()` (`clock.ts:31-33`), exactamente como
`categories.repository.ts:546` y `users.repository.ts:331`. Es el hecho que
convierte el escenario condicional de `data-layer-clock-policy` en verificable.

`UpdateBecomeSellerInput` lleva las tres columnas **opcionales** y se aplican con
el spread condicional del repo (`...(input.x !== undefined && { x: input.x })`,
`types.repository.ts:95-98`, `categories.repository.ts:537-544`): un body parcial
no borra columnas. Los dos `jsonb` se tipan `Prisma.InputJsonValue`, el tipo que
el repo ya usa para toda columna `jsonb NOT NULL` (`types.repository.ts:72-74`,
`shops.repository.ts:245-248`).

### D-2: El envoltorio se recompone en el servicio, con literal de orden fijo

**Choice**: `become-seller.service.ts` construye

```ts
{
  page_options: {
    id: row.id,
    page_options: row.pageOptions,
    language: row.language,
    created_at: row.createdAt,   // Date -> toJSON() al serializar
    updated_at: row.updatedAt,
  },
  commissions: row.commissions,
}
```

**Alternatives**: (a) devolver `BecomeSellerRecord` plano y que el frontend se
adapte — imposible, `apps/shop/src/framework/rest/become-seller.ts:27-33` y
`apps/shop/src/components/become-seller/index.tsx:40-41` leen
`data.page_options.page_options` y `data.commissions` como hermanas; (b)
recomponerlo en el repositorio — rompería la regla de `config.yaml` («la API
publica snake_case; la capa de datos devuelve camelCase; la traducción vive en
los servicios de Nest»).

**Rationale**: el diseño ya está declarado en el propio DDL —«El envoltorio se
recompone en el servicio (US-44)», `db/schema.sql:483-484`— y es el patrón literal
de `settings.service.ts:33-39`. **Efecto colateral buscado**: al ser un literal,
el orden de las 2 claves top-level y de las 5 del envoltorio es idéntico al del
mock por construcción; el único reordenado que sobrevive es el **interno** de los
dos `jsonb`, que Postgres no preserva (exploración, hallazgo 7).

El tipo de retorno se cierra con `as unknown as BecomeSeller`, el mismo recurso
declarado de `settings.service.ts:39` (`as unknown as Setting`), no `as any`.

### D-3: CA-1 se verifica por equivalencia estructural **acotada a 5 campos**, no por deep-equal del cuerpo entero

**Choice**: la comparación de evidencia (y el test) compara:

| Campo | Comparación |
|---|---|
| Claves top-level | `['page_options','commissions']`, iguales y en ese orden |
| Claves del envoltorio | las 5, iguales y en ese orden |
| `page_options.id`, `page_options.language` | deep-equal (`1`, `'en'`) |
| `page_options.page_options` | deep-equal de las 24 claves |
| `commissions` | deep-equal del array de 2 (incluidos sus `created_at`/`updated_at` internos) |
| `page_options.created_at` / `updated_at` | **excluidos** del deep-equal; se declara la divergencia |

Más una línea de bytes: **11 458 B (mock) → 11 452 B (Postgres), −6 B**.

**Alternatives explícitamente descartadas por el dueño** (decisión c de
`proposal.md:79-88`): reconstruir 6 decimales de fracción de segundo, forzar el
orden de claves del `jsonb` al serializar, o congelar en la base las fechas del
mock. Ninguna se diseña.

**Rationale y precisión que el input no trae**: un `deepStrictEqual` del cuerpo
completo **falla**, y no solo por formato. Los `created_at`/`updated_at` del
envoltorio salen de las columnas `timestamptz`, y el seed **no las inserta**
(`db/seed.sql:33`, `INSERT ... (id, page_options, commissions, language)`): toman
`now()` del último `db-up`, no `2024-06-06T10:30:48.000000Z` /
`2024-06-12T11:31:46.000000Z` (verificado hoy con `node -e`). Difieren en **valor**,
no solo en los 3 decimales. Es exactamente la divergencia que `CLAUDE.md` declara
«ya embarcada» para `/api/settings`. Los −6 B sí se explican solo por el formato:
`YYYY-MM-DDTHH:MM:SS.ffffffZ` (27 car.) vs. `.fffZ` (24 car.) × 2 campos,
independientemente del instante.

Si el script de evidencia se escribe como un `deepStrictEqual` plano, CA-1 dará
rojo por una razón equivocada. La comparación **debe** excluir esos dos campos y
declararlos aparte.

### D-4: El body del `POST` se reinterpreta con un tipo local; la entidad **no** se corrige

**Trampa verificada**: `CreateBecomeSellerDto` es
`OmitType(BecomeSeller, ['created_at','updated_at'])`
(`dto/create-become-seller.dto.ts:4-7`) y `BecomeSeller` declara
`page_options: { page_options: BecomeSellerOptions }` y **`missions`**, no
`commissions` (`entities/become-seller.entity.ts:6-10`). Es decir: `dto.commissions`
**no compila** y `dto.page_options` está tipado un nivel más profundo de lo que el
admin envía. Lo que el admin manda de verdad es `BecomeSellerInput =
{ language?, page_options: <objeto interno>, commissions }`
(`apps/admin/rest/src/types/index.ts:2242-2246`), armado en
`become-seller-form.tsx:81-96` (`page_options: {...values.page_options}`, el objeto
**plano**) y enviado por `POST` en `data/client/become-seller.ts:19-23`.

**Choice**: declarar en el servicio un tipo que describa el body real y
reinterpretar el DTO con `as unknown as` (precedente `settings.service.ts:39`,
`manufacturers.integration.test.ts:289`), con comentario que cite las dos fuentes.

**Alternatives**: (a) corregir `become-seller.entity.ts` (`missions` → `commissions`,
aplanar `page_options`) — es la corrección «correcta», no cambia nada en runtime
(el plugin `@nestjs/swagger` de `nest-cli.json` solo alimenta `/docs`), pero toca
un archivo fuera de la tabla de áreas afectadas de la propuesta y roza el «NO
incluye» («nombres de clave»); (b) `@Body()` sin tipo o `any` — prohibido.

**Rationale**: el `ValidationPipe` global es el de por defecto, **sin `whitelist`
ni `transform`** (`main.ts:9`), y el DTO no tiene decoradores: el body llega
íntegro sea cual sea el tipo declarado. El tipo es documentación, no runtime. Se
elige la opción de menor superficie y se **menciona** (a) como mejora adyacente no
accionada.

### D-5: Determinismo de la integración — snapshot + restauración exacta, describes de escritura al final

**El problema, verificado**: `become-seller.integration.test.ts:57-62` afirma
`updatedAt === createdAt` («no hay ruta de update»). Esta US crea esa ruta. Y
`db/seed.sql:35` es `ON CONFLICT (id) DO UPDATE SET page_options = EXCLUDED.page_options,
commissions = EXCLUDED.commissions, language = EXCLUDED.language` — **`updated_at`
no está en el SET**, así que `just db-up` **no** repara la deriva. Sin mecanismo
propio, la primera corrida deja el archivo rojo para siempre (salvo `db-reset`,
destructivo y no autorizado).

**Choice** — tres piezas, ninguna opcional:

1. **Snapshot en `beforeAll`**: `prisma.becomeSeller.findUniqueOrThrow({ where: { id: 1 } })`
   guardado en un `let` de módulo (`pageOptions`, `commissions`, `language`,
   `updatedAt`). No muta nada.
2. **Restauración exacta dentro del `afterAll` YA EXISTENTE** (`:17-19`), en
   `try { restore } finally { $disconnect }` — **no** un segundo `afterAll`: el
   default `sequence.hooks: 'stack'` de vitest los corre LIFO y el segundo tocaría
   un cliente ya desconectado (la trampa está documentada en
   `auth-tokens.integration.test.ts:9-11`). El `update` repone las 3 columnas **y
   `updatedAt` explícito** (la columna es escribible: no lleva `@updatedAt`).
3. **Orden de declaración**: los `describe` nuevos de escritura van **al final del
   archivo**, después del tripwire de reposo. Regla citada literal en el repo:
   «vitest ejecuta los `describe` de un archivo en orden de declaración»
   (`shops.integration.test.ts:472-476`).

El `describe` de `:57-62` se **conserva con su aserción intacta** (`updatedAt ===
createdAt`) y se **reencuadra en la prosa**: deja de significar «no existe ruta de
update» (falso tras esta US) y pasa a ser un **tripwire de estado de reposo** —
«el seed y la restauración dejan la fila así; si esto está rojo, una corrida
anterior abortó a mitad de escritura». El comentario incluye la reparación exacta:
`UPDATE become_seller SET updated_at = created_at;` en `just db-shell`.

**Alternatives**

| Opción | Descarte |
|---|---|
| Auto-reparar en `beforeAll` (`SET updated_at = created_at`) | Enmascara la deriva y vuelve tautológica la aserción de `:57-62` |
| Relajar la aserción a `updatedAt >= createdAt` | Sobrevive a cualquier deriva, luego no detecta ninguna: pierde el valor del tripwire |
| Borrar ese `describe` | Pierde cobertura ya verde y el único centinela de estado del singleton |
| Fila centinela propia (patrón `zz-`) | Imposible: la CHECK prohíbe una segunda fila |

**Rationale**: la restauración exacta hace el archivo **idempotente frente a sus
propias escrituras**; el tripwire estricto convierte la única deriva posible
(corrida abortada) en una señal, no en un falso rojo perpetuo. Es la aplicación
del precedente `beforeAll(cleanup)` («corrida abortada previa»,
`types.integration.test.ts:26`) al único caso donde limpiar significa restaurar, no
borrar.

### D-6: `domain-error.mapper.ts`, el módulo Nest y los métodos muertos no se tocan

**Confirmado, no heredado**: el mapeador traduce un conjunto **cerrado** de 5
códigos de escritura de catálogo (`domain-error.mapper.ts:96-113`) y su cabecera
(`:1-10`) exige `git diff` vacío al integrar un agregado nuevo (CA-7).
`become_seller` no tiene slug, ni FK entrante, ni filas dependientes, ni borrado:
ninguno de los 5 es alcanzable, y por D-1 el repositorio nunca lanza un error de
dominio ni el servicio llama a `toWriteHttpException`. **Se confirma: el archivo
no se toca.**

`become-seller.module.ts` queda **literal**: `SettingsService` consume `@safari/db`
por import directo, sin provider ni módulo de datos (`settings.module.ts:5-9`).
`findOne`/`update`/`remove` no están cableados en el controller
(`become-seller.controller.ts:13-21`); al desaparecer el campo en memoria,
`update()` pasa a `return this.findAll()` y los otros dos conservan sus literales
— exactamente `settings.service.ts:49-59`. Borrarlos sería superficie que la US no
pide.

---

## Data Flow

**Lectura** (`GET /api/became-seller`):

    HTTP GET ──→ BecomeSellerController.findAll (controller:18-21)
                     │
                     ▼
              BecomeSellerService.findAll ──→ getBecomeSeller()  [camelCase]
                     │                              │
                     │                              ▼
                     │                     prisma.becomeSeller.findUnique({id:1})
                     │                              │
                     │                     _toBecomeSellerRecord (records.ts:336)
                     ▼
              envoltorio snake_case   ← ÚNICO punto de traducción (D-2)
                     │
                     ▼
              JSON.stringify de Nest  ← aquí Date -> ".fffZ" (los −6 B, D-3)

**Escritura** (`POST /api/became-seller`):

    body {language?, page_options, commissions}   ← ValidationPipe SIN whitelist (main.ts:9)
         │
         ▼
    Controller.create ──→ Service.create ──→ updateBecomeSeller(input)
                              │                    │  spreads condicionales
                              │                    │  + updatedAt: now()  (clock.ts:31)
                              │                    ▼
                              │           prisma.becomeSeller.update({where:{id:1}})
                              ▼
                        mismo envoltorio que el GET

Las claves del body **ya son** los nombres de columna en snake_case
(`page_options`, `commissions`, `language`): el mapeo es 1:1 y **no hay traducción
inversa**. La frontera camelCase↔snake_case solo existe en la lectura.

---

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/db/src/repositories/become-seller.repository.ts` | **Create** | `getBecomeSeller`, `updateBecomeSeller`, `UpdateBecomeSellerInput`, `_isRecordNotFound` privado (D-1) |
| `packages/db/index.ts` | Modify | `export type { UpdateBecomeSellerInput }` + `export { getBecomeSeller, updateBecomeSeller }`, bloque nuevo **antes** de `./src/repositories/categories.repository` (`:59`) por el orden alfabético que mantiene biome. **Superficie compartida con US-42: quien llegue segundo rebasea** |
| `packages/db/src/repositories/become-seller.integration.test.ts` | Modify | `beforeAll` de snapshot; `afterAll` `:17-19` ampliado con la restauración; prosa de `:57-62` reencuadrada (aserción intacta); 2-3 `describe` nuevos **al final** (D-5) |
| `apps/api/rest/src/become-seller/become-seller.service.ts` | Modify | Se van `plainToClass`, el import de `@db/become-seller.json` y el campo `private becomeSeller`; entran `getBecomeSeller`/`updateBecomeSeller`, el envoltorio (D-2) y el tipo local del body (D-4) |
| `apps/api/rest/src/become-seller/become-seller.service.spec.ts` | **Create** | Jest con `@safari/db` mockeado (patrón `categories.service.spec.ts:66-82`) |
| `docs/product/40-identidad-extendida-postgres/44-become-seller-postgres.md` | Modify | Las 5 correcciones de `proposal.md:121-143` |

**No se tocan** (`git diff` vacío esperado, CA-4): `domain-error.mapper.ts`,
`settings/` (servicio, repositorio, tamaño congelado), `become-seller.module.ts`,
`become-seller.controller.ts`, `entities/`, `dto/`, `db/schema.sql`, `db/seed.sql`,
`schema.prisma`, `records.ts`, cualquier frontend.

---

## Interfaces / Contracts

```ts
// packages/db/src/repositories/become-seller.repository.ts

/** Columnas actualizables. Todas opcionales: un body parcial no borra nada. */
export interface UpdateBecomeSellerInput {
  /** Objeto INTERNO de 24 claves, no el envoltorio (db/schema.sql:479-482). */
  pageOptions?: Prisma.InputJsonValue;
  commissions?: Prisma.InputJsonValue;
  language?: string;
}

/** La fila única, o `null` si la base no está sembrada. */
export async function getBecomeSeller(): Promise<BecomeSellerRecord | null>;

/**
 * Actualiza la fila fija (id = 1). NUNCA crea: la CHECK
 * `become_seller_fila_unica` garantiza que existe una y solo una.
 * `null` si la base no está sembrada (P2025), misma convención que
 * `setUserActive` (users.repository.ts:341-355).
 */
export async function updateBecomeSeller(
  input: UpdateBecomeSellerInput
): Promise<BecomeSellerRecord | null>;
```

Guarda única en el servicio, para las dos rutas (mensaje calcado de
`settings.service.ts:28-30`):

```ts
if (!row) {
  throw new InternalServerErrorException(
    'No hay fila en `become_seller`. Siembra la base con `just db-migrate`.',
  );
}
```

---

## Testing Strategy

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración (vitest, `packages/db`) | Las 2 funciones contra Postgres real | Extender `become-seller.integration.test.ts` (D-5) |
| Unit (jest, `apps/api/rest`) | El envoltorio y la delegación del `POST` | `become-seller.service.spec.ts` nuevo, `@safari/db` mockeado |
| Contrato | CA-1 / CA-2 | `curl` + `node -e` (evidencia, no suite) |

**Integración** — `describe` nuevos, en este orden, todos **después** del tripwire
de reposo:

1. `getBecomeSeller` devuelve la fila: `id === 1`, `pageOptions` con 24 claves,
   `commissions` de longitud 2, `language === 'en'`. Requiere el narrowing
   explícito (`as Record<string, unknown>` / `as unknown[]`) que ya usa el archivo
   en `:41-42`: con `strict: true` (`packages/db/tsconfig.json:7`) un `JsonValue`
   no es asignable a `Object.keys`, y `db-check` corre el typecheck **antes** de
   vitest.
2. `updateBecomeSeller` persiste y fija el reloj: `_setNowProvider(() => fija)` →
   update → `updatedAt.getTime() === fija.getTime()` y `> createdAt`; relectura con
   `getBecomeSeller` que confirma el valor nuevo. `afterEach(() => _setNowProvider(() => new Date()))`,
   patrón de `types.integration.test.ts:93-95`.
3. `updateBecomeSeller` no crea una segunda fila (CA-3): `prisma.becomeSeller.count()`
   sigue en 1 tras el update.

**Unit (Nest)** — `jest.mock('@safari/db', () => ({ ...jest.requireActual(...),
getBecomeSeller: jest.fn(), updateBecomeSeller: jest.fn() }))` + `jest.mocked(fn)`,
copia literal de `categories.service.spec.ts:66-82` (el barrel es seguro de cargar
sin `DATABASE_URL`). Casos:

- `findAll()` con un `BecomeSellerRecord` fijo → `Object.keys` top-level
  `['page_options','commissions']`, `Object.keys` del envoltorio
  `['id','page_options','language','created_at','updated_at']`, y
  `page_options.page_options` idéntico por referencia al `pageOptions` del record.
- `findAll()` con `null` → `InternalServerErrorException`.
- `create(body)` delega en `updateBecomeSeller` con **las 3 claves tal cual** y
  devuelve el mismo envoltorio que el `GET`.
- `create(body)` con `null` → `InternalServerErrorException`.
- `create({ page_options })` sin `language` → el input no lleva la clave
  `language` (spread condicional, no `undefined` explícito).

---

## Plan de evidencia (Definición de Done)

Ninguna cifra base se da por buena: `proposal.md:176-183` ya avisa de que
10/210 (vitest) y 9/285 (jest) vienen de US-41 / `CLAUDE.md` y **no** se
re-midieron. Se miden **antes** de tocar código y se vuelven a medir después.

| # | Comando | Qué demuestra |
|---|---|---|
| 1 | `curl -s localhost:9001/api/became-seller > antes.json` (con el código actual) | Línea base del mock: 11 458 B |
| 2 | `node -e` comparando `antes.json` vs `despues.json` **por los 5 campos de D-3** + imprimiendo ambos tamaños | CA-1. `jq` no está instalado |
| 3 | `curl -X POST … -d` cambiando el título del banner + `GET` posterior | CA-2 |
| 4 | `just db-check` con el conteo re-medido antes/después | Vitest verde, sin regresión |
| 5 | `cd apps/api/rest && npx jest` con el conteo re-medido | Jest verde, suite nueva incluida |
| 6 | `just build-api` | Compila sin el JSON importado |
| 7 | `just verify` | Los 3 servicios responden; `/api/settings` en **5503 B** |
| 8 | `git diff --stat` | `domain-error.mapper.ts` y `settings/` ausentes del diff (CA-4/CA-7) |
| 9 | `SELECT count(*), updated_at = created_at FROM become_seller;` tras la suite | La restauración de D-5 funcionó |

---

## Migration / Rollout

**No hay migración**: sin DDL, sin seed, sin `prisma db pull`. `just db-reset` es
destructivo y **no está autorizado** en esta US.

| # | Paso | Falla ⇒ |
|---|---|---|
| 1 | Medir las 2 líneas base (4 y 5) + `curl` de `antes.json` | Si `db-check` ya está rojo, parar: la deriva es previa |
| 2 | Repositorio + barrel + `just db-build` | `git checkout -- packages/db/` |
| 3 | Extender la integración (D-5) y correr `just db-check` | `git checkout --` del archivo |
| 4 | Servicio + spec de Nest, `npx jest`, `just build-api` | `git checkout -- apps/api/rest/src/become-seller/` |
| 5 | `curl` de `despues.json`, deep-equal acotado, `POST` + `GET` | Si CA-1 falla por los timestamps del envoltorio, el script no está acotado (D-3) |
| 6 | Correcciones de la US + `git diff --stat` | — |

**Rollback**: `git revert` del commit (o `git checkout -- packages/db/
apps/api/rest/src/become-seller/`) → `just db-build` → si una prueba manual dejó la
fila editada, `just db-up` repone `page_options`/`commissions`/`language` y
`UPDATE become_seller SET updated_at = created_at;` en `just db-shell` repone lo
que el seed **no** toca (`db/seed.sql:35`) → `just db-check` + `npx jest`.

**Estado conocido-bueno**: 1 fila, `pageOptions` de 24 claves, `commissions` de
longitud 2, `language = 'en'`, `updated_at = created_at`.

---

## Risks

| Riesgo | Sev. | Mitigación |
|---|---|---|
| El script de CA-1 se escribe como deep-equal plano y da rojo por los timestamps del envoltorio (valores distintos, no solo formato) | **Alta** | D-3: la comparación excluye esos 2 campos y los declara aparte |
| Deriva de `updated_at` si una corrida de vitest aborta a mitad | **Alta** | D-5: restauración exacta en `afterAll`; reparación manual documentada en el propio test |
| `dto.commissions` no compila (la entidad declara `missions`) | Media | D-4: tipo local + `as unknown as`, con cita a las dos fuentes |
| Conflicto en `packages/db/index.ts` con US-42 | Media | Rebase del que llegue segundo; única superficie compartida |
| Un cliente manda `page_options: null` → Prisma rechaza (`jsonb NOT NULL`) | Baja | Comportamiento correcto (500); el mock tampoco lo aceptaba de forma útil. No se añade validación: el DTO sin decoradores es el statu quo del repo |
| Código nuevo asume `/api/become-seller` | Media | Ruta verificada en 3 puntos (`become-seller.controller.ts:9` + las 2 constantes `BECAME_SELLER`); todos los `curl` usan el pasado |
| Las cifras base (10/210, 9/285) no coinciden al medirlas | Media | Se re-miden en el paso 1 del rollout; no se citan sin medir |

---

## Open Questions

Ninguna que bloquee. Tres matices del código que los artefactos de entrada no
traían y que quedan incorporados arriba:

1. **Los `created_at`/`updated_at` del envoltorio difieren en VALOR, no solo en
   formato** — el seed no inserta esas columnas (`db/seed.sql:33`). Un deep-equal
   del cuerpo entero falla aunque los −6 B se acepten (D-3).
2. **`become-seller.entity.ts:10` declara `missions`, no `commissions`**, y anida
   `page_options` — el DTO heredado no describe el body real del admin (D-4). La
   corrección de la entidad se **menciona, no se acciona**: está fuera del alcance.
3. **La restauración va DENTRO del `afterAll` existente**, no en uno nuevo: con
   `sequence.hooks: 'stack'` un segundo hook correría sobre un cliente ya
   desconectado (`auth-tokens.integration.test.ts:9-11`).
