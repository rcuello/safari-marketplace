# Design: US-32 — Un solo reloj para `created_at` y `updated_at`

## Technical Approach

Se ejecuta la **Opción B** ya adoptada en `proposal.md` (decisión cerrada): el
DDL pierde `tocar_updated_at()` y sus 5 triggers, y cada ruta de
`UPDATE`/`upsert` de `packages/db` sobre `products`, `categories`, `shops` y
`users` fija `updatedAt: now()` desde `packages/db/src/clock.ts`, copiando el
patrón ya embarcado en `types.repository.ts:128-138`,
`tags.repository.ts:181-192` y `manufacturers.repository.ts:208-219`.

Tres superficies de riesgo desiguales: el **DDL** (bajo), la **re-introspección
de Prisma** (el único riesgo real; la predicción es "sin cambio semántico" y el
procedimiento de abajo clasifica el diff) y **repositorios + tests** (mecánico).
Satisface `specs/data-layer-clock-policy/spec.md` (6 requirements) y el delta de
`specs/category-tree-api/spec.md`.

---

## Architecture Decisions

### D-1: El bloque de `db/schema.sql:477-500` se sustituye por un comentario de política

**Choice**: borrar `tocar_updated_at()` (`:480-486`) y los 5 `CREATE OR REPLACE
TRIGGER` (`:488-500`), y reescribir el banner `:477-479` como nota de política.
Texto exacto (sustituye `:477-500`; las líneas en blanco `:501-502` y el
`COMMIT;` de `:503` no se tocan):

```sql
-- ---------------------------------------------------------------------
-- updated_at — reloj único, sin triggers (US-32 CA-1).
-- NINGUNA tabla lleva trigger BEFORE UPDATE. `updated_at` lo fija la capa de
-- datos con el reloj de Node (`packages/db/src/clock.ts` -> `now()`), el mismo
-- del que sale `created_at` (`@default(now())` de Prisma): una fila, un reloj.
-- Hasta 2026-09-14 hubo un `tocar_updated_at()` sobre products/categories/
-- shops/users/profiles; el reloj de Postgres derivaba del de Node hasta
-- ±676 ms y con signo variable, así que una fila podía servirse con
-- `updated_at` ANTERIOR a `created_at`. NO re-añadir triggers: toda tabla
-- nueva hereda esta política y cada `update`/`upsert` fija `updatedAt: now()`.
-- ---------------------------------------------------------------------
```

**Alternatives**: borrado sin rastro (el hueco invita a re-añadir un trigger);
SQL comentado (invita a descomentar); fichero-lápida (desproporcionado).

**Rationale**: lo que impide la regresión es la prohibición explícita, no el
hueco. El proposal pedía 3-4 líneas; se proponen 8 porque la frase que hace el
trabajo es la del dato medido (±676 ms, signo variable): sin ella la prohibición
se lee como preferencia de estilo. **Divergencia declarada.**

**Qué sobrevive del comentario de `:494-496`**: nada, por una razón de código.
Afirma que "`users` y `profiles` reciben UPDATE de verdad", y el inventario de
abajo muestra que `profiles` **no tiene ninguna ruta de `UPDATE`** — su trigger
era código muerto. Su otra mitad (`permissions` NO, catálogo estático) queda
subsumida por "ninguna tabla lleva trigger".

### D-2: `updatedAt: now()` como ÚLTIMA clave del objeto `data`

**Choice**: la línea va tras todos los spreads condicionales y antes del `}` de
`data`, como `types.repository.ts:136`, `tags.repository.ts:190` y
`manufacturers.repository.ts:217`.

**Rationale**: en un objeto literal de TS una clave posterior gana sobre un
spread previo; al final es inmune a que un spread futuro traiga `updatedAt`, y es
la posición que un revisor reconoce del precedente
(`follow_existing_patterns: true`, `openspec/config.yaml:79`).

### D-3: En el `upsert` del scraper la línea va SOLO en la rama `update:`

**Choice**: `products.repository.ts:396-406` (rama `update:`) recibe
`updatedAt: now()`; el objeto `scalars` (`:349-373`) y la rama `create:`
(`:388-395`) **no se tocan**.

**Alternatives**: añadirlo a `scalars`, más corto porque alimenta las dos ramas.
Rechazado: escribiría `updatedAt` también en el `INSERT`, dejando ambas columnas
en dos llamadas distintas al reloj dentro de la misma fila nueva y haciendo
`createdAt` parcialmente mockeable — contradice la sub-decisión (c) y el segundo
scenario de "Alcance documentado de `_setNowProvider`".

### D-4: `findOrCreateShopBySlug` se queda con `update: {}` y se blinda con comentario

**Choice**: no tocar el comportamiento de `shops.repository.ts:191-200`; ampliar
el comentario de `:198`:

```ts
    // El upsert exige `update`; no se pisa nada si ya existe. VACÍO A
    // PROPÓSITO (US-32): con la política de reloj en la capa de datos, esto
    // es lo que hace cierta esa promesa — el scraper re-corre N veces sobre
    // una tienda existente sin mover `updated_at`. NO añadir
    // `updatedAt: now()` aquí; el resto de `update`s de este archivo sí lo
    // llevan, y esa asimetría es la decisión, no un olvido.
    update: {},
```

**Rationale**: es el único sitio donde la ausencia de la línea ES la decisión.
Un revisor que aplique "las 7 rutas llevan `updatedAt`" mecánicamente lo
"arreglaría"; el comentario nombra la asimetría y la atribuye a la US.

**Cambio de comportamiento esperado, A CONFIRMAR en `sdd-apply` — NO verificado**:
la hipótesis es que hoy el trigger bumpea `updated_at` en cada corrida del
scraper y que con B deja de hacerlo. Depende de si Prisma emite un `UPDATE` real
para `update: {}`, y eso **no se puede confirmar sin correr la base** (este
diseño es read-only por contrato). Lo zanja un `log: ['query']` en una segunda
llamada sobre una tienda existente: si sale un `UPDATE shops`, se confirma; si
no, el trigger nunca se disparaba ahí. **El test de D-4 pasa en ambos casos**:
no bloquea, solo cambia cómo se redacta la evidencia de cierre.

### D-5: CA-3 se documenta en `clock.ts` (sustancia) + `README.md:37` (puntero)

**Choice**: la cabecera de `clock.ts:1-7` lleva el alcance completo;
`packages/db/README.md:37` (`clock.ts  now() inyectable para tests`) gana un
puntero a ella.

**Rationale**: una sola fuente de verdad (la cabecera, que viaja con el código) +
un puntero barato desde el índice. Solo README se desincroniza; solo `clock.ts`
es válido según la spec pero deja el README incompleto. Texto propuesto:

```ts
/**
 * Reloj mockeable para los repos de `@safari/db`. `now()` es la fuente única
 * de "ahora" en la capa de data-access.
 *
 * ALCANCE (US-32 CA-3) — qué gobierna `_setNowProvider`:
 *   · `updated_at` de types, tags, manufacturers, products, categories,
 *     shops y users: lo fija cada `update`/`upsert` de repositorio.
 *   · `consumedAt` de password_reset_tokens/otp_codes
 *     (`auth-tokens.repository.ts:171,207`) y `scrapedAt` de products
 *     (`products.repository.ts:351`).
 *   · `profiles` no tiene hoy ruta de `UPDATE`; la PRIMERA que se cree debe
 *     fijar `updatedAt: now()` igual que las demás.
 *
 * Qué NO gobierna: `created_at` de NINGUNA tabla. La resuelve el
 * `@default(now())` de `schema.prisma` (reloj de Node, ligado como parámetro
 * del INSERT); ningún repositorio la fija a mano. No-goal deliberado, no
 * descuido: ambas columnas ya salen del MISMO reloj, así que el invariante
 * `updated_at >= created_at` se cumple sin hacer `created_at` mockeable. Con
 * `_setNowProvider(fija)`, un `create` + `update` devuelve `createdAt` real y
 * `updatedAt` = fija.
 */
```

### D-6: Tres JSDoc de repositorio quedan FALSOS y se reescriben

Hallazgo **no inventariado en el proposal ni en la spec**: además de los tres
comentarios de test, tres JSDoc de repositorio afirman que el trigger fija la
columna. Dejarlos sería publicar documentación falsa en el mismo diff que la
desmiente.

| `file:line` | Qué dice hoy | Acción |
|---|---|---|
| `categories.repository.ts:502-504` | "`updatedAt` NO se fija a mano: el trigger `categories_updated_at` (`db/schema.sql:490`) lo hace con el reloj de Postgres (DD28-7)" | Reescribir: lo fija `updatedAt: now()` desde `clock.ts` (US-32). La cita `:490` además queda colgando |
| `products.repository.ts:749-751` | "…el trigger `products_updated_at` lo hace con el reloj de Postgres" | Ídem |
| `shops.repository.ts:288-289` | "…lo hace el trigger `shops_updated_at` con el reloj de Postgres (DD30-7)" | Ídem, conservando DD30-7 como historia |

**Excluidos a propósito** (referencias rancias, no afirmaciones falsas;
incluirlas sería inflar el scope): `products.repository.ts:877-880`
(`deleteProduct`) nombra el trigger, pero "un `DELETE` no dispara el trigger"
sigue siendo **cierto** —de forma vacua— y su conclusión no cambia;
`tags.repository.ts:169` y `manufacturers.repository.ts:195` citan
`db/schema.sql:480-500` para decir "esta tabla no tiene trigger", y la cita sigue
apuntando al bloque que sustenta la frase.

---

## Data Flow

```
ANTES    created_at ← Node/Prisma @default(now())
         updated_at ← Postgres now() (trigger)     ← deriva −543..+676 ms
DESPUÉS  created_at ← Node/Prisma @default(now())  ┐ el mismo
         updated_at ← Node/clock.ts now()          ┘ proceso
```

---

## File Changes

| File | Action | Description |
|---|---|---|
| `db/schema.sql:477-500` | Modify | Fuera función + 5 triggers; entra el comentario de política (D-1) |
| `…/repositories/products.repository.ts` | Modify | 2 líneas (tabla de abajo); JSDoc `:749-751` reescrito. `now` YA importado (`:21`) |
| `…/repositories/categories.repository.ts` | Modify | 1 línea; JSDoc `:502-504` reescrito. **Falta el import**: `import { now } from '../clock';` tras `:18` (orden de biome: `../client` < `../clock` < `../domain-errors`) |
| `…/repositories/shops.repository.ts` | Modify | 2 líneas; comentario de `:198` ampliado (D-4); JSDoc `:288-289` reescrito. **Falta el import** tras `:8` |
| `…/repositories/users.repository.ts` | Modify | 2 líneas. **Falta el import** tras `:15` |
| `packages/db/src/clock.ts:1-7` | Modify | Cabecera CA-3 (D-5) |
| `packages/db/README.md:37` | Modify | Puntero al alcance documentado |
| `packages/db/prisma/schema.prisma` | **Sin cambio semántico** | Predicción falsable; un diff cosmético (renombres re-aplicados) es aceptable, uno semántico para el change |
| `{categories,products,shops,users}.integration.test.ts` | Modify | 4 tests nuevos + 1 de idempotencia del scraper; reescritura de los 3 comentarios obsoletos. **Los CUATRO** necesitan `import { _setNowProvider } from '../clock';` y `afterEach` de `vitest` (hoy no los tiene ninguno) |

**No se tocan** (no-goals): `types`/`tags`/`manufacturers`, servicios de Nest
(passthrough puro), frontend, `db/seed.sql`, el scraper.

---

## Interfaces / Contracts

### Inventario de rutas de `UPDATE` — verificado contra el código

`grep -n "\.update(\|\.upsert(\|updateMany" src/repositories/*.ts` devuelve 19
líneas. Filtradas a las 5 tablas de la política:

| # | `file:line` | Función | Inserción | `now` importado |
|---|---|---|---|---|
| 1 | `products.repository.ts:381` (rama `update:` en `:396`) | `upsertScrapedProduct` | última clave de `update:`, tras el cierre del spread de `tagIds` en `:405` (`}),`), antes del `}` de `:406` | Sí (`:21`) |
| 2 | `products.repository.ts:817` | `updateProduct` | última clave de `data`, tras el cierre del spread de `tagIds` en **`:856`** (`}),`), antes del `}` de `:857` | Sí |
| 3 | `categories.repository.ts:534` | `updateCategory` | tras `language` (`:543`), antes del `}` de `:544` | **No** |
| 4 | `shops.repository.ts:302` | `updateShop` | tras `settings` (`:312`), antes del `}` de `:313` | **No** |
| 5 | `shops.repository.ts:333` | `setShopActive` | one-liner `:335` → `data: { isActive, updatedAt: now() },` | **No** |
| 6 | `users.repository.ts:328` | `updateUserPasswordHash` | one-liner `:330` → `data: { passwordHash, updatedAt: now() },` | **No** |
| 7 | `users.repository.ts:345` | `setUserActive` | one-liner `:347` → `data: { isActive, updatedAt: now() },` | **No** |

**Trampa verificada en el sitio 2**: el spread de `tagIds` de `updateProduct`
ocupa `:851-856` y anida un objeto `tags:` que cierra en **`:855`**. Insertar
tras `:855` mete `updatedAt` DENTRO de `tags:` y Prisma falla el typecheck: la
línea va tras `:856`. En el upsert el objeto `tags:` es de una sola línea
(`:403-405`), por eso allí `:405` sí es el punto correcto.

Excluidos, con razón: `shops.repository.ts:191` (`update: {}`, D-4);
`users.repository.ts:381` (`permissionUser.upsert` — el pivote solo tiene
`created_at`, `db/schema.sql:173-178`); `auth-tokens.repository.ts:130,169,205`
(`consumedAt`, ya por `clock.ts`); `manufacturers.repository.ts:80,208`,
`tags.repository.ts:181`, `types.repository.ts:128` (fuera de las 5 tablas).

**El inventario del proposal es correcto y completo**, confirmado de forma
independiente.

---

## El paso de re-introspección (el riesgo real)

### Predicción falsable

Tras `just db-reset` (que ya invoca `just db-up`, `justfile:322-324`) y
`npx prisma db pull`, el archivo que se commitea NO tiene **ningún cambio
semántico**: mismos 15 modelos, tipos, `@map`/`@@map`, `previewFeatures` y
`@default(now())` en las 10 parejas de timestamps.

**Por qué**: la introspección no modela triggers. La cabecera `schema.prisma:10-28`
enumera todo lo que Prisma no modela (6 CHECK, trigram, `users_email_lower_idx`,
el unique parcial) y **no menciona triggers**; `grep @updatedAt` → 0,
`grep dbgenerated` → 0. Los 5 pares de columnas de las tablas con trigger
(`:81-82,100-101,183-184,240-241,258-259`) son idénticos a los de
`Type`/`Tag`/`Manufacturer` (`:59-60,122-123,140-141`) y `Setting`/`Permission`
(`:45-46,270-271`), que nunca lo tuvieron. Nada en el archivo deriva de ellos.

**Por qué NO "diff de cero bytes"**: `README.md:97` dice literalmente
`npx prisma db pull   # OJO: pisa los renombres manuales`, y el Scope de US-32
habla de "`prisma db pull` **+ renombres**": re-aplicarlos es el flujo esperado,
no una anomalía. Además `datasource db` (`:37-39`) no lleva `url` —vive en
`prisma.config.ts`— y el pull es conocido por re-añadirlo.

### Procedimiento de seguridad

`prisma db pull` reescribe el archivo entero y en este repo es conocido por
perder trabajo manual (`README.md:97`).

1. **Antes del pull**: `git status --porcelain packages/db/prisma/schema.prisma`
   debe salir vacío; si no, commitear o stashear, o `git checkout --` deja de ser
   una red.
2. **Copia al scratchpad**: `cp …/schema.prisma <scratch>/schema.prisma.pre`.
3. **Pull**: `cd packages/db && npx prisma db pull` (URL vía `prisma.config.ts` →
   `env('DATABASE_URL')` → `packages/db/.env`).
4. **Verificar**: `git diff packages/db/prisma/schema.prisma` COMPLETO (los 15
   modelos, no los 5 tocados). Diff vacío ⇒ se pega la salida y termina aquí.
5. **Si hay diff, CLASIFICARLO** (no es por sí mismo motivo de parada):

   | Clase | Ejemplos | Acción |
   |---|---|---|
   | **Cosmético / renombre re-aplicable** | cabecera `:1-28` perdida; modelos vueltos a `snake_case` sin `@@map`; campos sin `@map`; `previewFeatures` (`:31-35`, línea `:34`) ausente; `url = env("DATABASE_URL")` re-añadido al `datasource` (`:37-39`); relaciones renombradas; bloques reordenados | **Re-aplicar y continuar** — es el flujo de `README.md:95-99`. La copia del paso 2 es la referencia byte a byte |
   | **Semántico** | un tipo de campo distinto; un `@default(now())` que desaparece o pasa a `dbgenerated`; un `@@map` irrestaurable porque la tabla cambió; un modelo nuevo o desaparecido; un `@unique` nuevo en `User.email` | **STOP y reportar. No aceptar el archivo.** La predicción era falsa: o la base no quedó como el DDL declara, o la introspección de Prisma 7 cambió. Es material de reporte, no de decisión autónoma |

6. **Atajo**: si el diff es 100 % cosmético,
   `git checkout -- packages/db/prisma/schema.prisma` devuelve el archivo
   revisado byte a byte, más seguro que re-aplicar a mano (de ahí el paso 1).
   Solo legítimo DESPUÉS de clasificar: con drift real, descartar el pull lo
   ocultaría.
7. **Cierre**: `npm run generate` (vía `just db-build`) y el `git diff` final
   como evidencia.

---

## Testing Strategy

El gate es `just db-check` (`npm run typecheck` + `vitest run`), que **requiere
`just db-up`** (`openspec/config.yaml:40`). `vitest.config.ts` fija
`fileParallelism: false`: los archivos de integración se serializan.

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Integración | Invariante `updated_at >= created_at` (CA-2) | 4 tests nuevos, uno por tabla |
| Integración | Que `updated_at` AVANZA (detección de ruta olvidada) | mismo test, aserción `toBe(future)` con `_setNowProvider` |
| Integración | `findOrCreateShopBySlug` no mueve `updated_at` | 1 test nuevo en `shops.integration.test.ts` |
| Unit (Nest) | — | Sin cambios: los specs de la API mockean `@safari/db` con fechas fijas; radio de impacto cero |

### Forma del test — el patrón que SÍ caza una ruta olvidada

La spec ("Inventario exhaustivo") avisa de que el invariante por sí solo no
detecta una ruta olvidada: un `updated_at` congelado cumple `>=` por igualdad.
**`types.integration.test.ts:92-116`** ya resuelve eso y es el patrón a copiar:

```ts
describe('updateCategory — CA-2 de US-32: reloj único', () => {
  afterEach(() => { _setNowProvider(() => new Date()); });   // types:93-95

  it('updated_at sale de clock.ts y cumple updated_at >= created_at', async () => {
    const created = await createCategory({ /* centinela */ });
    const future = new Date(Date.now() + 60_000);
    _setNowProvider(() => future);
    const updated = await updateCategory(created.id, { name: '…' });

    // (a) ruta olvidada: sin `updatedAt` el valor sería el del INSERT y FALLA.
    expect(updated.updatedAt.getTime()).toBe(future.getTime());
    // (b) el invariante de CA-2.
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
      updated.createdAt.getTime()
    );
    // (c) createdAt NO es mockeable (D-5, no-goal declarado).
    expect(updated.createdAt.getTime()).toBeLessThan(future.getTime());
  });
});
```

`(a)` falla si se revierte el change (CA-2 lo exige); `(b)` es el invariante de
la spec; `(c)` documenta ejecutablemente el no-goal de la sub-decisión (c).

Por archivo (todos los records exponen ambas columnas, `records.ts:183-301`;
`CategoryTreeNode` las hereda de `CategoryRecord`, `categories.repository.ts:52`):

| Archivo | Función | Centinela a reutilizar | Bloque de imports a tocar |
|---|---|---|---|
| `categories.integration.test.ts` | `updateCategory` | `SENTINEL_PREFIX` + `deleteCategory` | `:14-26` |
| `products.integration.test.ts` | `updateProduct` | `SENTINEL_PREFIX` + `deleteProduct` | `:9-27` |
| `shops.integration.test.ts` | `updateShop` | `zz-tiendas-` + `prisma.shop.delete` | `:7-23` |
| `users.integration.test.ts` | `setUserActive` | `TEST_DOMAIN` (`@users-integration.test`) | `:17-30` |

**Los CUATRO necesitan dos imports nuevos** (verificado uno a uno: ninguno
importa `'../clock'`, y los cuatro importan de `vitest` exactamente
`{ afterAll, beforeAll, describe, expect, it }`, sin `afterEach`):

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { _setNowProvider } from '../clock';   // tras 'vitest', antes de '../client'
```

(orden de `types.integration.test.ts:15-17`.)

**Variante obligada en `users`**: `setUserActive` devuelve
`Promise<UserRecord | null>` (`users.repository.ts:340-343`) y el `tsconfig.json`
del paquete tiene `"strict": true`, así que `updated.updatedAt.getTime()` NO
compila ("'updated' is possibly 'null'") y `npm run typecheck` es la primera
mitad de `just db-check`. Hay que estrechar el tipo antes de leer:

```ts
const updated = await setUserActive(user.id, false);
expect(updated).not.toBeNull();
if (!updated) throw new Error('setUserActive devolvió null');  // estrecha el tipo
expect(updated.updatedAt.getTime()).toBe(future.getTime());
```

Las otras tres devuelven tipos no nulables y no necesitan la guarda. El test de
`users` va en el `describe` de escrituras (`:157`) o en uno nuevo a continuación,
**nunca sobre los 3 usuarios sembrados** (`:1-15`: `setUserActive(3,false)` deja
el admin inaccesible).

**Test de D-4** (scenario "correr el scraper dos veces"; `findOrCreateShopBySlug`
no tiene test hoy). Ubicación **normativa** en `shops.integration.test.ts`: tras
el `describe` de monotonía (cierra en `:415`) y **ANTES** del tripwire de
`:417-436`. NO al final — el comentario `:424-428` lo prohíbe literalmente:

> `// VA EL ÚLTIMO A PROPÓSITO. […] vitest ejecuta los describe de un archivo en`
> `// orden de declaración, así que solo desde el final cubre toda la batería.`
> `// Al añadir un describe de escritura nuevo, va ANTES de este.`

Ponerlo después lo dejaría sin la red de restitución del seed de ese bloque
(`count()` = 12 sin filtro, cola de moderación vacía, `items[0].id` = 15,
`:432-434`).

```ts
const primero = await findOrCreateShopBySlug({ slug: `${SENTINEL_PREFIX}scraper`, name: '…' });
const segundo = await findOrCreateShopBySlug({ slug: `${SENTINEL_PREFIX}scraper`, name: '…' });
expect(segundo.updatedAt.getTime()).toBe(primero.updatedAt.getTime());
await prisma.shop.delete({ where: { id: primero.id } });
```

### Reescritura de los tres comentarios obsoletos

Los tres explican por qué la comparación es "nunca create-vs-update"; tras el
change esa restricción desaparece.

| `file:line` | Reescritura |
|---|---|
| `categories.integration.test.ts:277-289` (+ título del `describe` en `:277`, "updatedAt por trigger de base", y la nota de `:306-313`) | El `describe` pasa a "updatedAt explícito" (como `types:92`). El comentario largo baja a 3-4 líneas: `updateCategory` fija `updatedAt: now()` (US-32); create-vs-update ya es comparable porque el reloj es el mismo; se sigue comparando update-vs-update por monotonía |
| `products.integration.test.ts:518-539` (+ la nota de `:557-561`) | Ídem. La medición de ~150-450 ms pasa a tiempo pasado y con fecha: es el dato que justificó US-32, no una restricción vigente |
| `shops.integration.test.ts:374-381` (+ título del `describe` en `:373`, "…nunca create-vs-update (DD30-7)", que el change falsifica igual que el de `categories`) | Ídem, versión corta. Su primera línea cita `products.integration.test.ts:517-567`, rango que se moverá al reescribir ese bloque: re-citar o quitar |

**Las aserciones `toBeGreaterThan` estrictas se conservan**: siguen cazando el
fallo real (una ruta que no fija `updatedAt` produce igualdad). Riesgo a nombrar:
ahora reposan en la resolución de 1 ms de `new Date()` en vez de los
microsegundos de Postgres; el delta medido entre dos `PUT` es de 17-45 ms, así
que sobra margen — pero si alguno flakea, la causa es esa y la respuesta es
`_setNowProvider`, no relajar a `>=`.

---

## Migration / Rollout

No hay migración de datos: el seed es determinista y no inserta
`created_at`/`updated_at`. Orden de ejecución y punto de fallo de cada paso:

| # | Paso | Falla ⇒ |
|---|---|---|
| 1 | Editar `db/schema.sql:477-500` (D-1) | Trivial; `git checkout -- db/schema.sql` |
| 2 | `just db-reset` (destructivo; autorizado 2026-09-14, decisión 6 del Épico 33; incluye `db-up` → `db-migrate`) | Si `psql` aborta (`ON_ERROR_STOP=1`) el DDL tiene un error: revertir paso 1 y repetir |
| 3 | Seed: `SELECT count(*) FROM categories` = **198**, `WHERE parent_id IS NULL` = **83** | Si no cuadra, `just db-reset` otra vez. NO continuar con conteos malos |
| 4 | `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;` → 0 filas | Cierra el scenario "no hay trigger `BEFORE UPDATE`" con evidencia, no por lectura del DDL |
| 5 | `cd packages/db && npx prisma db pull` + `git diff` completo | **Punto de parada condicional**: diff cosmético ⇒ re-aplicar o `git checkout --` y seguir; diff SEMÁNTICO ⇒ STOP y reportar (clasificación arriba) |
| 6 | Repositorios: 3 imports de `now`, 7 líneas, 1 comentario de D-4, 3 JSDoc de D-6 | `git checkout -- packages/db/src/` |
| 7 | `just db-build` (prisma generate + tsup) | El typecheck de `db-check` no ve `@safari/db` sin esto |
| 8 | `clock.ts` (D-5) + `README.md:37` | — |
| 9 | Tests nuevos + reescritura de los 3 comentarios | — |
| 10 | Verificación: `just db-check`, `cd apps/api/rest && npx jest`, `just build-api`, `just verify`, y `psql` con ambas columnas de una fila creada-y-actualizada en las 5 tablas | — |

Para `profiles` se espera `updated_at = created_at` en el paso 10 y **así se
declara de antemano**: sin ruta de update (sub-decisión b), el invariante se
cumple por ausencia de `UPDATE`.

**Rollback** (el del proposal): `git revert` del commit —o `git checkout --
db/schema.sql packages/db/`, primero el DDL—, `just db-reset`, `npx prisma db
pull` (misma clasificación del diff), `npm run generate`, `just db-build`, y
re-verificar 198/83 + `just db-check`. No hay artefactos generados versionados.

---

## Open Questions

Ninguna que bloquee. Tres discrepancias verificadas contra el código, ya
incorporadas arriba:

1. **`profiles` nested create**: la spec cita `users.repository.ts:292-294`; las
   líneas reales son `:293-295` (el `create` en `:294`). La exploración ya decía
   `:293-294`. No cambia ninguna decisión.
2. **Tres JSDoc de repositorio quedan falsos** (D-6) — ni el proposal ni la spec
   los inventarían. Se incorporan por el mismo argumento con el que el proposal
   incorporó los tres de test, no como drive-by.
3. **`schema.prisma` tiene 319 líneas** (`wc -l`), no 320, y **15 modelos**. De
   ellos **10** llevan par `created_at`/`updated_at` — `Setting`, `Type`,
   `Shop`, `Category`, `Manufacturer`, `Tag`, `Product`, `User`, `Profile`,
   `Permission` (`:45-46, 59-60, 81-82, 100-101, 122-123, 140-141, 183-184,
   240-241, 258-259, 270-271`) — y 3 más solo `created_at`. Los 8 de la tabla de
   la exploración son un subconjunto (5 con trigger + 3 del patrón de
   repositorio). La revisión del diff del paso 4 cubre los 15.
