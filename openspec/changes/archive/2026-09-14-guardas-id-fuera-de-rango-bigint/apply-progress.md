# Apply Progress: Guardas de id fuera del rango `bigint` (US-31)

Modo: Standard (strict_tdd: false). Chain strategy: stacked-to-main, 3 PRs.

## PR1 — `us-31-pr1-guardas-catalogo-fk` (Fases 1 y 2)

### Fase 1 — Guardas de FK en `packages/db`

- [x] 1.1 `tags.repository.ts` (`_assertValidTypeId`) y
      `manufacturers.repository.ts` (`_assertValidTypeId`):
      `Number.isInteger` → `Number.isSafeInteger`, sin `<= 0`. Comentario
      local explicando D31-2 (por qué NO `<= 0`), copiado del razonamiento de
      `categories.repository.ts:298-327`.
- [x] 1.2 `tags.integration.test.ts` y `manufacturers.integration.test.ts`:
      +2 tests c/u —
      - `typeId: 1e21` → `InvalidReferenceError` (regresión de
        `Number.isSafeInteger`).
      - `typeId: -5` → `InvalidReferenceError` **por `P2003`, no por la
        guarda**: discriminador `expect(message).not.toContain('-5')` (la
        guarda interpola el valor en el mensaje; la rama `P2003` de
        `translateCatalogWriteError` no pasa el tercer argumento).
- [x] 1.3 `just db-build` y `just db-check` verdes (ver evidencia abajo).

### Fase 2 — Guardas de ruta del catálogo

- [x] 2.1 `types.service.ts:126,151` y `tags.service.ts:170,200`:
      `!Number.isSafeInteger(id) || id <= 0`; doc-comment de `update`
      ampliado con las 2 frases de DD31-C; `remove` recibe la línea
      `/** Misma guarda de id que `update` (US-31). */`.
- [x] 2.1b Cross-ref corregido: los doc-comments de `types.service.ts` y
      `tags.service.ts` citaban *"precedente exacto
      `users.service.ts:94,113,142`"* — doblemente falso (users tenía el
      mismo defecto y esas líneas se desplazan en PR2). Sustituido por
      `categories.service.ts:275-293`.
      Verificación: `grep -rn "users.service.ts:94" apps/api/rest/src/` →
      sin resultados (confirmado, ver evidencia abajo).
- [x] 2.2 `manufacturers.service.ts:218,254`: mismo guard + comentario (sin
      cross-ref, su doc-comment no citaba `users`).
- [x] 2.3 `types.service.spec.ts`, `tags.service.spec.ts`,
      `manufacturers.service.spec.ts`: los 6 `it` de solo `NaN`
      (`update`/`remove` × 3 módulos) reemplazados por `it.each` de 4 casos
      (`NaN`, `0`, `-5`, `1e21`), testigo
      `expect(<mock>).not.toHaveBeenCalled()` por el `update{Type,Tag,Manufacturer}Mock`/
      `delete{Type,Tag,Manufacturer}Mock` respectivo (DD31-D).
- [x] 2.4 `cd apps/api/rest && npx jest` verde (ver evidencia abajo).

### Evidencia real — PR1

**`just db-build`** (recorte; build limpio):

```
> @safari/db@0.1.0 build
> prisma generate && tsup

✔ Generated Prisma Client (7.10.0) to .\generated\prisma\client in 500ms
CJS dist\index.js     165.27 KB
CJS dist\index.js.map 400.26 KB
CJS ⚡️ Build success in 134ms
DTS ⚡️ Build success in 7042ms
DTS dist\index.d.ts 1.40 MB
```

**`cd apps/api/rest && npx jest`**:

```
PASS src/common/errors/domain-error.mapper.spec.ts (57.804 s)
PASS src/users/user-dto.mapper.spec.ts (58.089 s)
PASS src/types/types.service.spec.ts (58.131 s)
PASS src/categories/categories.service.spec.ts (58.073 s)
PASS src/shops/shops.service.spec.ts (58.15 s)
PASS src/products/products.service.spec.ts (57.445 s)
PASS src/tags/tags.service.spec.ts (57.841 s)
PASS src/manufacturers/manufacturers.service.spec.ts (57.629 s)
PASS src/users/users.service.spec.ts (57.853 s)

Test Suites: 9 passed, 9 total
Tests:       257 passed, 257 total
Snapshots:   0 total
Time:        71.266 s
```

Nota: la cifra "hoy 4 suites / 65 tests" de `openspec/config.yaml` y de
`proposal.md` está desactualizada frente al estado real del repo (9 suites,
257 tests: incluye `categories`, `shops`, `products`, `domain-error.mapper`,
`user-dto.mapper` además de los 4 originales). No es una regresión de esta
US ni se corrige aquí — es un dato de contexto para el cierre, fuera del
"NO incluye" congelado de la propuesta.

**`just db-up`** (recorte; contenedor ya existía, se reaplicó
`schema.sql`/`seed.sql` de forma idempotente):

```
NOTICE:  relation "tags" already exists, skipping
...
  * esquema y datos de referencia aplicados
```

**`just db-check`**:

```
npm run typecheck
> tsc --noEmit
  (sin salida — 0 errores)

npm test
> vitest run

 Test Files  10 passed (10)
      Tests  203 passed (203)
   Duration  25.38s
```

**Verificación 2.1b**:

```
$ grep -rn "users.service.ts:94" apps/api/rest/src/
(sin resultados)
```

## PR2 — `us-31-pr2-guardas-users` (Fase 3)

- [x] 3.1 `users.service.ts:findOne` (línea ~99 tras el doc-comment nuevo):
      `!Number.isSafeInteger(id) || id <= 0`; doc-comment de 8 líneas, ancla
      de los cinco guards de este archivo.
- [x] 3.2 `update`, `makeAdmin` (sobre el `id` numérico ya derivado de
      `userId`), `banUser` (antes del chequeo de auto-bloqueo) y
      `activeUser`: mismo guard; 1 línea añadida al doc-comment ya existente
      de cada uno, apuntando a `findOne` (US-31).
- [x] 3.3 `users.service.spec.ts`: el `it` único de `NaN` en
      `findOne` (:231-239) reemplazado por `it.each` de 4 casos
      (`NaN`/`0`/`-5`/`1e21`); nuevo `it.each` agregado en `update` (no
      tenía ningún test de id inválido). Testigo:
      `findUserWithRelationsMock.not.toHaveBeenCalled()` — las otras dos
      aserciones (instancia + mensaje) NO discriminan por sí solas
      (DD31-E).
- [x] 3.4 `it.each` nuevos en `banUser` (reemplaza el `it` único de `NaN`) y
      en `activeUser` (no tenía ninguno): ambos afirman
      `findUserWithRelationsMock` y `setUserActiveMock`
      `not.toHaveBeenCalled()`.
- [x] 3.5 `it.each` de strings (`'abc'`,`'0'`,`'-5'`,`'1e21'`) en
      `makeAdmin` (reemplaza el `it` único de `'abc'`), testigo
      `grantPermissionMock.not.toHaveBeenCalled()`.
- [x] 3.6 `cd apps/api/rest && npx jest` verde (ver evidencia abajo).

### Evidencia real — PR2

**`cd apps/api/rest && npx jest`**:

```
PASS src/users/users.service.spec.ts (25.693 s)
PASS src/shops/shops.service.spec.ts (25.817 s)
PASS src/common/errors/domain-error.mapper.spec.ts (25.992 s)
PASS src/manufacturers/manufacturers.service.spec.ts (26.443 s)
PASS src/tags/tags.service.spec.ts (26.612 s)
PASS src/users/user-dto.mapper.spec.ts (26.639 s)
PASS src/categories/categories.service.spec.ts (26.93 s)
PASS src/products/products.service.spec.ts (27.612 s)
PASS src/types/types.service.spec.ts (27.612 s)

Test Suites: 9 passed, 9 total
Tests:       274 passed, 274 total
Snapshots:   0 total
Time:        34.057 s
```

Recuento: 257 (PR1) → 274 (PR2): +17 tests nuevos en `users.service.spec.ts`
(4 `findOne` + 4 `update` + 4 `banUser` + 4 `activeUser` + 4 `makeAdmin` −
3 `it` únicos reemplazados, netos +17 sobre el archivo).

## PR3 — `us-31-pr3-docs` (Fase 5)

- [x] 5.1 `docs/product/31-guardas-id-fuera-de-rango-bigint.md` enmendado
      quirúrgicamente (DD31-G, sin renumerar CA1-CA4): blockquote (nombra
      `users` y las 2 FK), `Status` → `Implementada`, `LOC est.` → `~230`,
      viñeta de guards afectados (+`users` + 2 FK), decisión de `shops`
      resuelta (no aplica, ya corregida en US-30), `Incluye`/`NO incluye`
      actualizados (+`users`+FK; retirado "auditar shops"; añadido
      `products.repository.ts:511` y `categories.repository.ts:248` al NO
      incluye), CA-1 con las rutas reales de `users`, +1 escenario Gherkin
      de `users` (los 2 existentes intactos), tabla de archivos ampliada
      (repos + integration tests + `users.service.ts`), DoD con la
      evidencia real de la Fase 4 (referenciando este mismo
      `apply-progress.md`).
- [x] 5.2 `docs/product/README.md`: 2 líneas actualizadas (mapa del backlog
      y bullet de la lista de US standalone) — US-31 marcada como
      implementada, con el alcance real (`users` + 2 FK) y la LOC real
      (~230, no ~120). No se tocó el párrafo de recomendación de arranque
      (fuera del recorte quirúrgico de 2-3 líneas del task 5.2).

### Nota de cierre

No se re-ejecutaron `npx jest`/`db-check`/`build-api`/`verify` en este PR:
es un cambio documental puro (`docs/product/*.md`), no toca código ni
tests. La evidencia de esos comandos vive íntegra en las secciones de PR1,
PR2 y Fase 4 de este mismo archivo.

## Fase 4 — Verificación viva

Ejecutada tras PR2 y antes de PR3, con la API real levantada
(`just api-dev`, puerto 9001) y un Bearer de admin real (nunca sin token —
las 14 rutas relevantes están tras `@Permissions(...ADMIN_ONLY)` en
`types`/`tags` o `@Permissions(...ADMIN_OWNER_AND_STAFF)` en
`manufacturers`; `users` tras `@Permissions(...ADMIN_ONLY)` a nivel de
controller).

- [x] 4.1 `just db-build` → `just build-api` en verde.
- [x] 4.2 `curl` Bearer admin, 11 rutas × `1e21`/`0`/`-1`, status exacto.
- [x] 4.3 `curl` Bearer admin, FK de `tags`/`manufacturers` + `1e16` (CA-2).
- [x] 4.4 `just verify` en verde con `shop`/`admin` levantados.

### Evidencia real — Fase 4

**Token admin real** (`POST /api/token`, `admin@demo.com`/`demodemo`, id 3,
`db/seed.sql:51,83-85` → permisos 1,2,3 = `super_admin`,`customer`,`store_owner`):

```
$ curl -s -X POST http://localhost:9001/api/token -H "Content-Type: application/json" -d '{"email":"admin@demo.com","password":"demodemo"}'
{"token":"eyJhbGci...","permissions":["super_admin","customer","store_owner"],"role":"super_admin"}
```

**`just build-api`**: `Done in 71.62s.` (recorte de `yarn build` → `nest build`, 0 errores).

**11 rutas de ruta (guard de ruta/body con `id`), Bearer admin, `1e21`/`0`/`-1` → 404 exacto**:

```
PUT /api/types/1e21        -> 404
DELETE /api/types/1e21     -> 404
PUT /api/types/0           -> 404
DELETE /api/types/0        -> 404
PUT /api/types/-1          -> 404
DELETE /api/types/-1       -> 404
PUT /api/tags/1e21         -> 404
DELETE /api/tags/1e21      -> 404
PUT /api/tags/0            -> 404
DELETE /api/tags/0         -> 404
PUT /api/tags/-1           -> 404
DELETE /api/tags/-1        -> 404
PUT /api/manufacturers/1e21   -> 404
DELETE /api/manufacturers/1e21 -> 404
PUT /api/manufacturers/0      -> 404
DELETE /api/manufacturers/0   -> 404
PUT /api/manufacturers/-1     -> 404
DELETE /api/manufacturers/-1  -> 404
GET /api/users/1e21        -> 404
PUT /api/users/1e21        -> 404
GET /api/users/0           -> 404
PUT /api/users/0           -> 404
GET /api/users/-1          -> 404
PUT /api/users/-1          -> 404
POST /api/users/make-admin   user_id=1e21 -> 404
POST /api/users/block-user   id=1e21      -> 404
POST /api/users/unblock-user id=1e21      -> 404
POST /api/users/make-admin   user_id=0    -> 404
POST /api/users/block-user   id=0         -> 404
POST /api/users/unblock-user id=0         -> 404
POST /api/users/make-admin   user_id=-1   -> 404
POST /api/users/block-user   id=-1        -> 404
POST /api/users/unblock-user id=-1        -> 404
```

Las 11 rutas de la tabla D31-4 (6 de catálogo + 5 de `users`) responden 404
exacto en las 3 combinaciones de id fuera de rango — 33 combinaciones en
total, cero 500, cero "4xx genérico" (todas con Bearer real, nunca sin
token: un 401/403 hubiera sido evidencia falsa).

**FK de `type_id` (asimetría D31-2, confirmada en vivo) — CA-1**:

```
$ curl -X POST /api/tags -d '{"name":"zz-curl-tag--1","type_id":-1}'
{"statusCode":400,"message":"`tags.desconocida` referencia un registro inexistente.","error":"Bad Request"}

$ curl -X POST /api/tags -d '{"name":"zz-curl-tag-0","type_id":0}'
{"statusCode":400,"message":"`tags.desconocida` referencia un registro inexistente.","error":"Bad Request"}

$ curl -X POST /api/tags -d '{"name":"zz-curl-tag-1e21","type_id":1e21}'
{"statusCode":400,"message":"`tags.type_id` referencia un registro inexistente (`1e+21`).","error":"Bad Request"}

$ curl -X POST /api/manufacturers -d '{"name":"zz-curl-manu--1","type_id":-1}'
{"statusCode":400,"message":"`manufacturers.desconocida` referencia un registro inexistente.","error":"Bad Request"}

$ curl -X POST /api/manufacturers -d '{"name":"zz-curl-manu-0","type_id":0}'
{"statusCode":400,"message":"`manufacturers.desconocida` referencia un registro inexistente.","error":"Bad Request"}

$ curl -X POST /api/manufacturers -d '{"name":"zz-curl-manu-1e21","type_id":1e21}'
{"statusCode":400,"message":"`manufacturers.type_id` referencia un registro inexistente (`1e+21`).","error":"Bad Request"}
```

Confirma D31-2 EN VIVO, no solo en el mock de integración: `-1`/`0`
resuelven por `P2003` (mensaje `desconocida`, sin interpolar el valor,
`field_name` no vino del meta de Prisma en este caso) y `1e21` resuelve por
la guarda `_assertValidTypeId` (mensaje interpola `1e+21` — el tercer
argumento `value` sí llegó). Los tres son 400, ninguno 500.

**El límite no se adelanta (CA-2) — HALLAZGO, ver más abajo**:

```
$ curl -X DELETE /api/types/1e16 -H "Authorization: Bearer $TOKEN"
{"statusCode":404,"message":"No existe un type con id 10000000000000000.","error":"Not Found"}

$ curl -X DELETE /api/types/123456789012345 -H "Authorization: Bearer $TOKEN"
{"statusCode":404,"message":"No existe un registro de `types` con id 123456789012345.","error":"Not Found"}
```

**Hallazgo (no silenciado, no corregido por estar fuera del alcance
congelado de `apply`)**: `1e16` = `10000000000000000` es en realidad
**MAYOR** que `Number.MAX_SAFE_INTEGER` (`9007199254740991`) —
`Number.isSafeInteger(1e16) === false`, verificado con Node. El ejemplo
`1e16` que usan `proposal.md`, `design.md` y los dos delta specs como "caso
dentro del rango seguro, fila inexistente" está mal elegido: en producción
ese id **lo atrapa la propia guarda** (mismo mensaje de la guarda, `No
existe un type con id 10000000000000000.`), no la búsqueda de fila. La
segunda prueba con `123456789012345` (genuinamente `< 2^53-1`) sí prueba lo
que CA-2 pide: pasa la guarda, llega al repositorio, y el 404 viene de
`RecordNotFoundError` (mensaje distinto: `` No existe un registro de
`types` con id 123456789012345. ``) — nunca 400. El comportamiento
observable (404 en ambos casos) es el mismo por accidente feliz (types usa
el mismo status en la guarda y en fila-inexistente), así que CA-2 **no
queda invalidada**, pero el ejemplo numérico de la spec no discrimina lo
que dice discriminar. Reportado para que `sdd-verify`/`sdd-archive` decidan
si corregir el ejemplo en los delta specs (cambiar `1e16` por
`123456789012345` o similar) antes de fusionar a la spec principal.

**`just verify`** (con `just api-dev`, `just shop-dev`, `just admin-dev` los
tres levantados):

```
OK   API    :9001/api/settings  200  5503B  42ms
OK   Shop   :3003/en  200  190788B  18282ms  cards:30
OK   Admin  :3002/en/login  200  72821B  10550ms  cards:1
```
