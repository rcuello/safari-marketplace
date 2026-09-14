# Design: Guardas de id fuera del rango `bigint` (US-31)

## Technical Approach

La propuesta ya cerró el *qué* (13 guardas, `Number.isSafeInteger`, asimetría
ruta/FK, ningún status cambia) en D31-1..D31-4, y los delta specs de
`flat-catalogs-api` y `user-management-api` ya fijan los escenarios. **Este
documento no re-abre nada de eso**: aporta únicamente lo que queda ambiguo en el
momento de teclear —forma literal del código, dónde vive cada comentario, qué
aserción es realmente el testigo de regresión, dónde puede vivir el testigo del
guard de FK, el orden que mantiene el árbol verde y el recorte de PRs—.

Deliberadamente **no se desarrolla** aquí: la justificación de `2^53` (D31-1 la
agota), la cadena de error hasta el 500 (`exploration.md` §5 la documenta
archivo por archivo, y no cambia), ni una comparativa de alternativas de
arquitectura (no hay: es replicar un patrón embarcado en `categories` US-28 y
`shops` US-30).

## Architecture Decisions

### DD31-A — Los mensajes de excepción se preservan tal cual, por agregado

**Choice**: el diff de cada una de las 11 guardas de ruta es **una sola línea**
—el predicado—. La línea del `throw` no se toca.

| Guarda | Mensaje que se conserva |
|---|---|
| `types.service.ts:126,151` | `` `No existe un type con id ${id}.` `` |
| `tags.service.ts:170,200` | `` `No existe un tag con id ${id}.` `` |
| `manufacturers.service.ts:218,254` | `` `No existe una marca con id ${id}.` `` |
| `users.service.ts:94,113,142,165,211` (×5) | `'El identificador de usuario no es válido.'` |

**Alternatives considered**: homogeneizar los cuatro mensajes a una plantilla
única.
**Rationale**: (1) el mensaje es el campo `message` del cuerpo 404 que emite
Nest — cambiarlo es una regresión de contrato y CA-3 dice explícitamente que los
cuerpos no cambian; (2) `users.service.spec.ts:231-239` **asserta la cadena
literal** y su comentario (`// El mensaje no debe filtrar el valor coercionado
(NaN)`) documenta que la ausencia del id es intencional en una superficie
admin-only, mientras que el catálogo sí interpola el id: unificar obliga a
romper una de las dos decisiones; (3) el objetivo de la US es *qué valores caza*
la guarda, no *qué responde*.

### DD31-B — Forma literal de los dos guards

**Choice**: dos formas fijas, copiadas de los precedentes vivos.

Guard de ruta (11 sitios) — precedente `categories.service.ts:298,336`:

```ts
if (!Number.isSafeInteger(id) || id <= 0) {
  throw new NotFoundException(/* mensaje actual, sin tocar — DD31-A */);
}
```

En `makeAdmin` la línea previa `const id = Number(userId);`
(`users.service.ts:141`) se mantiene: la guarda opera sobre el número derivado,
no sobre el string del body.

Guard de FK (2 sitios) — precedente `categories.repository.ts:328-332`:

```ts
function _assertValidTypeId(typeId: number | null | undefined): void {
  if (typeId != null && !Number.isSafeInteger(typeId)) {
    throw new InvalidReferenceError('tags' /* | 'manufacturers' */, 'type_id', typeId);
  }
}
```

**Alternatives considered**: extraer un helper compartido (`assertRouteId(id)`)
para los 11 sitios.
**Rationale**: se descarta. El repo tiene ya cinco copias del predicado
(`categories`, `shops` ×2, `products` ×2, `auth` ×2) sin helper; introducir uno
ahora (a) toca `categories`/`shops`/`products`, que están fuera de scope, o (b)
deja seis copias y un helper conviviendo, que es peor que seis copias. La regla
del repo es seguir el patrón existente, no mejorarlo de paso.

### DD31-C — El comentario largo vive en un solo sitio; el resto referencia

**Choice**: la explicación forense ya existe y **no se toca** (está fuera de
scope): `categories.service.ts:275-293` para el guard de ruta y
`categories.repository.ts:298-327` para la asimetría de FK. Los sitios nuevos
llevan lo mínimo para que nadie revierta por ignorancia:

| Sitio | Comentario |
|---|---|
| `types`/`tags`/`manufacturers` `.update` (doc-comment ya existente) | +2 frases: `Number.isSafeInteger` (no `Number.isInteger`, que deja pasar `1e21` hasta el driver) + `id <= 0` porque ningún id real es no positivo. Referencia: `categories.service.ts:275-293` |
| `types`/`tags`/`manufacturers` `.remove` (hoy **sin** comentario) | 1 línea: `/** Misma guarda de id que `update` (US-31). */` |
| `users.service.ts` `findOne` (hoy **sin** doc-comment — único hueco del archivo) | bloque de 4-6 líneas: es el ancla de los cinco guards de `users` |
| `users.service.ts` `update`/`makeAdmin`/`banUser`/`activeUser` (ya tienen doc-comment) | 1 línea dentro del bloque existente: *"Guarda de id: misma regla y mismo porqué que `findOne` (US-31)."* |
| `tags.repository.ts:108-115` y `manufacturers.repository.ts:131-139` (`_assertValidTypeId`) | +3-4 líneas, y **el "por qué NO `<= 0`" se escribe completo en local, no como referencia** |

**Alternatives considered**: repetir el párrafo largo en los 13 sitios; o no
comentar nada y dejar que el `git blame` hable.
**Rationale**: repetir 13 veces garantiza deriva. Pero la excepción de las dos
FK está justificada por el riesgo "Media" de la propuesta (*aplicar `<= 0` por
inercia*): es la única línea del cambio que un revisor bien intencionado
"arreglaría", y una referencia a otro archivo no lo frena — el argumento
(un `type_id` no positivo SÍ es representable como `bigint`, no reproduce el
defecto, y ya resuelve en 400 por `P2003`) tiene que estar **a la vista de quien
edita esa línea**.

**Corrección colateral obligatoria**: los doc-comments de `types.service.ts:118-124`
y `tags.service.ts:162-168` citan hoy *"precedente exacto `users.service.ts:94,113,142`"*.
Esa referencia queda doblemente falsa con este cambio: `users` deja de ser
precedente (tiene el mismo defecto y se corrige en este mismo change) y esas
líneas se desplazan al insertar el bloque de `findOne`. Se sustituye el puntero
por `categories.service.ts:275-293`. Son líneas que ya se están tocando, no
scope nuevo.

### DD31-D — El testigo de regresión es `not.toHaveBeenCalled()`, no el status

**Choice**: cada caso del `it.each` afirma tres cosas, y la tercera es la que
importa:

```ts
it.each([
  ['NaN', NaN],
  ['cero', 0],
  ['negativo', -5],
  ['fuera del rango seguro de bigint (1e21)', 1e21],
])('id %s → 404 sin llamar al repositorio (`!Number.isSafeInteger(id) || id <= 0`)', async (_label, id) => {
  expect.assertions(3);
  try {
    await service.update(id, updateDto({ name: 'x' }));
  } catch (error) {
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getStatus()).toBe(404);
    expect(updateTypeMock).not.toHaveBeenCalled();
  }
});
```

**Rationale**: en `users`, las dos primeras aserciones **no distinguen nada**.
Con el guard roto y `id = 0`, el flujo sigue a `findUserWithRelations(0)`; el
mock reseteado devuelve `undefined`, cae en `if (!record) throw new
NotFoundException(...)` (`users.service.ts:101,120,149,176,218`) y el
test ve exactamente el mismo `NotFoundException` 404. **Solo
`expect(<mock>).not.toHaveBeenCalled()` separa "la guarda atajó" de "la fila no
existía"**. En el catálogo el status sí diverge por accidente (el mock devuelve
`undefined`, `toTypeDto(undefined)` lanza y el `catch` degrada a 500), pero
apoyarse en un accidente es frágil: la tercera aserción es obligatoria en los
once sitios.

Por qué `NaN` no sirve de testigo y los otros sí:

| Caso | `Number.isInteger` (antes) | `!Number.isSafeInteger(id) \|\| id <= 0` (después) | ¿Testigo de regresión? |
|---|---|---|---|
| `NaN` | rechaza | rechaza | **No** — pasa con ambos predicados |
| `0` | acepta | rechaza | Sí, de la cláusula `id <= 0` |
| `-5` | acepta | rechaza | Sí, de la cláusula `id <= 0` |
| `1e21` | acepta | rechaza | Sí — **el único** de `Number.isSafeInteger` |

`NaN` se conserva igualmente: es el caso que ya cubría el test viejo y protege
la mitad `!Number.isSafeInteger` frente a un "arreglo" que dejara solo `id <= 0`.

### DD31-E — El testigo del guard de FK no puede vivir en el spec de jest

**Choice**: los dos guards de FK se prueban en
`packages/db/src/repositories/{tags,manufacturers}.integration.test.ts`
(vitest, `just db-check`), no en los `*.service.spec.ts`.

**Rationale**: los cinco specs de la API hacen `jest.mock('@safari/db', ...)` y
sustituyen `createTag`/`createManufacturer` por `jest.fn()`. `_assertValidTypeId`
es **privada del módulo real** y nunca se ejecuta bajo jest: un test ahí no
puede fallar si se revierte el predicado. CA-4 exige un testigo por guarda y las
FK son 2 de las 13 ⇒ el testigo tiene que estar donde el código corre de verdad.
Precedente exacto de forma y de ubicación: `categories.integration.test.ts:450-465`
(*"`Number.isInteger` deja pasar `1e21`; `Number.isSafeInteger` lo atrapa antes
del driver"*), junto a los tests ya existentes de `typeId` mal formado
(`tags.integration.test.ts:101`, `manufacturers.integration.test.ts:115`).

**Discriminador del caso negativo (el que blinda D31-2)**: un `typeId: -5` debe
seguir dando `InvalidReferenceError` **por `P2003`, no por la guarda**. Ambas
vías lanzan la misma clase, así que la única señal observable es el mensaje:
`InvalidReferenceError(aggregate, field, value?)` interpola el valor solo cuando
recibe el tercer argumento; la guarda lo pasa (`(-5)` aparece en el mensaje) y
la rama `P2003` de `translateCatalogWriteError` lo construye **sin** valor
(`domain-errors.ts`, rama `P2003`: `new InvalidReferenceError(context.aggregate, field)`).
Aserción: `rejects.toBeInstanceOf(InvalidReferenceError)` **y**
`expect(message).not.toContain('-5')`. Es un acoplamiento al formato del
mensaje; se acepta porque es el único testigo disponible y porque su valor
—hacer fallar el test si alguien añade `<= 0` a la FK— es precisamente el riesgo
"Media" de la propuesta.

### DD31-F — Orden seguro: los dos bloques de código son verdes-independientes

**Choice**: `packages/db` primero, `apps/api/rest` después, `users` al final,
documento de la US el último.

**Rationale**: las suites de jest mockean el acceso a datos ⇒ tocar los
repositorios **no puede** poner jest en rojo; y vitest corre contra
`packages/db/src/` ⇒ tocar los servicios de Nest **no puede** poner `db-check`
en rojo. No hay un orden "peligroso"; el orden propuesto solo agrupa el
`just db-build` una sola vez.

`just db-build` es obligatorio **después** de editar `packages/db/src/` y
**antes** de: `just build-api`, levantar `just api-dev` para los `curl` de CA-1
y `just verify` — la API consume `@safari/db` por `link:` contra `dist/`
(`apps/api/rest/package.json:32`, `packages/db/package.json` → `main: ./dist/index.js`).
**No** es obligatorio para `just db-check` (vitest compila `src/`) ni para que
`npx jest` pase (ninguna suite ejercita `_assertValidTypeId`), pero correrlo
inmediatamente tras tocar `packages/db` evita razonar sobre un `dist/` desfasado.
`just db-up` sigue siendo previo a `just db-check`.

### DD31-G — La enmienda del documento de la US es quirúrgica y no renumera

**Choice**: se editan estas secciones de `docs/product/31-guardas-id-fuera-de-rango-bigint.md`:

| Líneas | Cambio |
|---|---|
| 3-5 (blockquote) | nombrar también `users` y las dos FK |
| 9 (`**Status:**`) | `Listo para ejecución` → `Implementada` al cerrar (paso 6 de `docs/product/README.md`) |
| 11 (`**LOC est.:**`) | `~120` → `~230` |
| 29-32 (viñeta de guards) | añadir `users.service.ts:94,113,142,165,211` y las 2 FK de `packages/db` |
| 42-44 ("Pendiente de verificar: `shops`") | reemplazar por el resultado: **no aplica**, US-30 lo corrigió (`shops.service.ts:285,373`) |
| 48-51 (`Incluye`) | añadir `users` + las 2 FK; retirar "auditar `shops` y decidir" (ya resuelto) |
| 53-56 (`NO incluye`) | añadir `products.repository.ts:511` y `categories.repository.ts:248` |
| 60-64 (CA-1) | sustituir "(y `shops` si el refinamiento determina que aplica)" por las rutas reales de `users` |
| 81-93 (Gherkin) | **añadir** un escenario de `users`; no reescribir los dos existentes |
| 97-103 (tabla de archivos) | la fila de `shops` pasa a `users.service.ts`/`users.service.spec.ts`; añadir los 2 repos y los 2 `*.integration.test.ts` |
| 107-114 (DoD) | `curl` de `users`; marcar la decisión de `shops` |

**NO se toca**: el título y el número/slug del archivo (la numeración es global
e inmutable, `docs/product/README.md:44-51`); `**Épico:** ninguno`;
`**Fecha:** 2026-09-11` (es la fecha de creación de la US, no la de ejecución);
el orden y los encabezados de la plantilla; y sobre todo **la numeración
`CA-1..CA-4` — no se inserta un CA-5 ni se renumera**: `users` se absorbe dentro
de CA-1/CA-3/CA-4, porque el `proposal.md` y los dos delta specs ya referencian
esos números y renumerar los dejaría colgando.

## Data Flow

Un id fuera de rango, antes y después. La corrección cierra la puerta en el
primer paso; nada del resto de la cadena cambia.

```
PUT /api/types/1e21
   │
   ▼
TypesController (+id → 1e21)
   │
   ▼
TypesService.update ──[guarda]──► ANTES: Number.isInteger(1e21) === true → PASA
   │                              AHORA: !Number.isSafeInteger(1e21) → 404 ⟂ (fin)
   ▼ (solo "antes")
updateType() ──► prisma.type.update({ where: { id: 1e21 } })
   │
   ▼
@prisma/adapter-pg → "invalid input syntax for type bigint" (SIN .code de Prisma)
   │
   ▼
translateCatalogWriteError  → devuelve el error INTACTO (solo P2002/P2003/P2025)
   │
   ▼
toWriteHttpException → rama final → InternalServerErrorException  ✗ 500

(`users` recorre la misma forma con otro traductor:
 withPrismaErrorTranslation → solo distingue error de conexión → 500)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/rest/src/types/types.service.ts` | Modify | guardas `:126`, `:151`; doc-comment de `update` ampliado + cross-ref corregido (DD31-C); 1 línea en `remove` |
| `apps/api/rest/src/tags/tags.service.ts` | Modify | guardas `:170`, `:200`; ídem |
| `apps/api/rest/src/manufacturers/manufacturers.service.ts` | Modify | guardas `:218`, `:254`; ídem (su comentario no cita `users`, no hay cross-ref que corregir) |
| `apps/api/rest/src/users/users.service.ts` | Modify | guardas `:94`, `:113`, `:142`, `:165`, `:211`; bloque de comentario en `findOne` + 1 línea en los otros cuatro |
| `packages/db/src/repositories/tags.repository.ts` | Modify | `_assertValidTypeId` (`:115`) → `Number.isSafeInteger`, **sin** `<= 0`; comentario local del porqué |
| `packages/db/src/repositories/manufacturers.repository.ts` | Modify | ídem (`:139`) |
| `apps/api/rest/src/types/types.service.spec.ts` | Modify | los `it` de `NaN` (`:200` update, `:252` remove) → `it.each` de 4 casos |
| `apps/api/rest/src/tags/tags.service.spec.ts` | Modify | ídem (`:337`, `:443`) |
| `apps/api/rest/src/manufacturers/manufacturers.service.spec.ts` | Modify | ídem (`:334`, `:487`) |
| `apps/api/rest/src/users/users.service.spec.ts` | Modify | 5 `it.each` nuevos; `update` y `activeUser` no tienen hoy ningún test de id inválido |
| `packages/db/src/repositories/tags.integration.test.ts` | Modify | +2 tests de FK (DD31-E), junto al existente de `:101` |
| `packages/db/src/repositories/manufacturers.integration.test.ts` | Modify | +2 tests de FK, junto al existente de `:115` |
| `docs/product/31-guardas-id-fuera-de-rango-bigint.md` | Modify | enmienda de DD31-G |

Nada se crea ni se borra. `categories`, `shops`, `products`,
`domain-error.mapper.ts`, `domain-errors.ts`, DDL y frontend: intactos.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (jest, `cd apps/api/rest && npx jest`) | las 11 guardas de ruta | 11 `it.each` × 4 casos, forma de DD31-D |
| Integration (vitest, `just db-check`, requiere `just db-up`) | las 2 guardas de FK | `createTag`/`createManufacturer` con `typeId: 1e21` (regresión) y `typeId: -5` (bloqueo de D31-2), forma de DD31-E |
| E2E manual (`curl` + `just verify`) | CA-1 y CA-2 en vivo | ver la trampa de permisos, abajo |

Mock que debe quedar sin llamar en cada `it.each` (dato exacto, verificado):

| Suite | Método | Tipo del caso | Mock testigo |
|---|---|---|---|
| `types.service.spec.ts` | `update` / `remove` | `number` | `updateTypeMock` / `deleteTypeMock` |
| `tags.service.spec.ts` | `update` / `remove` | `number` | `updateTagMock` / `deleteTagMock` |
| `manufacturers.service.spec.ts` | `update` / `remove` | `number` | `updateManufacturerMock` / `deleteManufacturerMock` |
| `users.service.spec.ts` | `findOne`, `update` | `number` | `findUserWithRelationsMock` |
| `users.service.spec.ts` | `banUser`, `activeUser` | `number` | `findUserWithRelationsMock` **y** `setUserActiveMock` |
| `users.service.spec.ts` | `makeAdmin` | **`string`** | `grantPermissionMock` |

Detalles que ahorran un ciclo de rojo:

- `makeAdmin(userId: string)` recibe el body sin coercer ⇒ su tabla es de
  strings: `['no numérico', 'abc'], ['cero', '0'], ['negativo', '-5'],
  ['fuera del rango seguro', '1e21']`. `@types/jest` infiere la tupla
  `[string, string]`, así que ts-jest (el transform real,
  `apps/api/rest/package.json`) no protesta; con la tabla mixta de los otros
  infiere `[string, number]` — por eso las dos tablas van separadas.
- `banUser` necesita el segundo argumento: el helper `currentUser(1)` ya existe
  en el spec. La guarda corre **antes** del chequeo de auto-bloqueo, así que
  ningún caso de la tabla puede colisionar con el 409.
- Reset de mocks: los cuatro specs del catálogo resetean dentro de cada
  `describe`; `users.service.spec.ts` lo hace en un único `beforeEach`
  (`:91-97`). Los `it.each` nuevos deben quedar dentro del `describe` que ya
  resetea el mock testigo — no crear bloques `describe` sueltos al final.
- El `it` antiguo de solo `NaN` se **reemplaza** por el `it.each`, no se deja
  conviviendo (duplicaría cobertura y confundiría el recuento).
- Ningún test existente usa un id `0` o negativo en estos cuatro módulos
  (verificado por `grep`), así que añadir `|| id <= 0` no rompe nada verde.

**Trampa de los `curl` de la DoD**: las once rutas están tras
`@Permissions(...ADMIN_ONLY)` / `ADMIN_OWNER_AND_STAFF`
(`users.controller.ts:24`, `types.controller.ts:22,40,46`, etc.). Un `curl` sin
token devuelve 401/403, que satisface literalmente "es 4xx y no es 500" **sin
haber ejecutado la guarda**: sería evidencia falsa. Los `curl` MUST llevar un
Bearer de admin y afirmar el status **exacto** (404 en las once rutas, 400 en
las dos de `type_id`), no "4xx".

## Migration / Rollout

No hay migración de datos, DDL ni contrato. Tres cortes de PR, con verificación
propia cada uno:

| PR | Archivos | ¿Independiente? | Verificación | LOC est. |
|---|---|---|---|---|
| **PR1 — catálogo + FK** | 3 `*.service.ts`, 3 `*.service.spec.ts`, 2 `*.repository.ts`, 2 `*.integration.test.ts` | Sí: no comparte archivo con PR2 ni PR3 | `just db-build` → `npx jest` + `just db-check` | ~175-215 |
| **PR2 — `users`** | `users.service.ts`, `users.service.spec.ts` | Sí | `npx jest` | ~95 |
| **PR3 — documento** | `docs/product/31-…md` | Archivo-independiente, **contenido-dependiente**: recoge la evidencia de PR1/PR2 y pone `Status: Implementada` ⇒ va último | lectura | ~45 |

Los tres caben en el presupuesto de 400 líneas. PR1 queda por encima del
reparto de la propuesta (~150) por los cuatro tests de integración de DD31-E; si
aun así incomoda, el corte natural es `packages/db` (repos + integration tests,
~70) aparte de los servicios del catálogo (~145) — siguen sin compartir archivo.

Cadena de ramas (Section E del protocolo): PR1 → rama base; PR2 sobre PR1; PR3
sobre PR2. Al ser conjuntos de archivos disjuntos, ningún rebase debería
producir conflicto; si GitHub muestra el diff de PR1 dentro de PR2, retargetear.

**Rollback**: revertir el commit del PR correspondiente. Tras revertir PR1 hay
que volver a correr `just db-build` para que `dist/` vuelva al estado anterior.

## Open Questions

- [x] **RESUELTO por el orquestador (gate de design, 2026-09-14).** Hallazgo
      confirmado leyendo `users.controller.ts:25` (`@Controller('users')`) y
      `main.ts:8` (`setGlobalPrefix('api')`). Corregidas ya las 3 filas de la
      tabla de D31-4 en `proposal.md` y las 5 ocurrencias en el delta de
      `user-management-api` (incluido el escenario heredado `make-admin
      concede el permiso...`, que arrastraba el mismo error desde
      `openspec/specs/user-management-api/spec.md:98` — el bloque `MODIFIED`
      lo reemplaza entero al archivar, así que la fusión corrige de paso ese
      error preexistente de la spec principal). **No re-accionar en `apply`.**
      Descripción original del hallazgo, para el registro:

- [ ] **Prefijo real de las rutas de `users`.** El `proposal.md` (tabla de
      D31-4) y ambos delta specs escriben `POST /api/make-admin`,
      `/api/block-user`, `/api/unblock-user`. Las rutas reales son
      `/api/users/make-admin`, `/api/users/block-user`,
      `/api/users/unblock-user`: los tres handlers cuelgan de
      `@Controller('users')` (`users.controller.ts:25,54,59,70`) con
      `setGlobalPrefix('api')` (`main.ts:8`). No implica ningún cambio de
      código, pero los `curl` de la DoD contra las rutas de la propuesta
      darían 404 *del router*, no de la guarda — evidencia inválida. Los delta
      specs deberían corregirse antes de `sdd-archive`.
- [ ] **`docs/product/README.md:203,214-217,222-229`** describe US-31 como
      "copiar el precedente a `types`/`tags`/`manufacturers`" y estima ~120 LOC.
      Con `users` dentro queda obsoleto. No está en la tabla de archivos
      congelada de la propuesta. Recomendación: incluir la corrección de 2-3
      líneas en PR3; requiere visto bueno del orquestador por estar fuera de esa
      lista.
- [ ] **Los 4 tests de integración de FK (DD31-E)** son exigidos por el Success
      Criteria de CA-4 ("cada guarda tiene un caso que falla si se revierte")
      aplicado a las 13 guardas, pero el punto 4 del In Scope y la tabla de
      áreas afectadas de la propuesta solo enumeran los `*.service.spec.ts`.
      Son la única ubicación donde ese testigo puede existir. Recomendación:
      adoptarlos; si se rechazan, CA-4 queda insatisfecha para 2 de las 13
      guardas y hay que decirlo explícitamente en el reporte de cierre.
