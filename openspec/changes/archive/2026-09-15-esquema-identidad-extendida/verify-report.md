# Verification Report: `esquema-identidad-extendida` (US-41)

**Change**: `esquema-identidad-extendida`
**US**: US-41 — Esquema y capa de datos de identidad extendida (Épico 40)
**Fecha de verificación**: 2026-09-15
**Modo**: verificación completa (proposal + design + 3 delta specs + tasks presentes)
**Artifact store**: `openspec` · **strict_tdd**: `false` · **`rules.verify.require_evidence`**: `true`
**Estado del árbol**: limpio, `main` en `f06f0e3`; cambio embarcado en dos cortes
(`5af81ad` DDL/seed/introspección/tests, `f06f0e3` capa de datos/mappers/docs).

**Veredicto final: PASS WITH WARNINGS.** Los 12 requirements y los 22 scenarios
se cumplen; las 3 observaciones abiertas son de documentación, ninguna de
comportamiento. Ninguna CRITICAL.

---

## 0. Frontera de la evidencia

Esta sección es normativa para el resto del informe: `require_evidence: true`
exige salida real, y la evidencia heredada no se presenta como propia.

### 0.1 Reproducido en esta sesión (evidencia propia)

| # | Comando / consulta | Resultado |
|---|---|---|
| E1 | `cd packages/db && npm run typecheck` | limpio, sin salida de error |
| E2 | `cd packages/db && npm test` (vitest) | **12 archivos / 225 tests, todos verdes**, 28.90s |
| E3 | `cd apps/api/rest && npx jest` | **9 suites / 285 tests verdes**, 90.4s |
| E4 | `psql \d shop_staff` / `\d become_seller` | catálogo vivo (ver §2) |
| E5 | `psql` conteos vivos + seed | 198/83, 12, 3, 1200, 3 `shop_staff`, 1 `become_seller` |
| E6 | `psql` cascadas en transacción con `ROLLBACK` | ambas cascadas ejercitadas, conteos intactos tras el rollback |
| E7 | `psql` `INSERT INTO become_seller (id…) VALUES (2, …)` | `ERROR: … violates check constraint "become_seller_fila_unica"` |
| E8 | `psql` `pg_trigger WHERE NOT tgisinternal` | `0` repo-wide; `0` sobre cada tabla nueva |
| E9 | `information_schema.columns` + `pg_constraint` + `pg_indexes` vs `schema.prisma` | cruce columna a columna, sin divergencia (§4) |
| E10 | `node` deep-equal del `jsonb` vivo contra `become-seller.json` | `page_options` ≡ objeto INTERNO (24 claves), `commissions` ≡ array de 2 |
| E11 | Re-ejecución de `db/generate-seed.mjs` con `writeFileSync` redirigido al scratchpad | salida **byte-idéntica** a `db/seed.sql` commiteado; `db/seed.sql` NO se tocó (`git status` limpio después) |
| E12 | `psql` `min/max(created_at)` por tabla + `pg_postmaster_start_time()` | corrobora el `db-reset` (§5.2) |
| E13 | `git diff --numstat` de `schema.prisma`, `records.ts`, `index.ts`, `schema.sql` | §4, §7 |
| E14 | `grep` de fugas de US-42/US-44 y de citas `schema.sql:N` | §6, §8 |

### 0.2 Heredado de la fase apply (NO reproducido aquí)

Prohibido por el encargo de esta fase (mutan la base o requieren tres servidores
vivos). Se transcribe la evidencia del implementador y se marca como heredada:

| Ítem | Evidencia heredada | Por qué no se reprodujo |
|---|---|---|
| `just db-reset` | `apply-progress.md` §"Phase 3": contenedor recreado, `schema.sql` + `seed.sql` aplicados con `ON_ERROR_STOP=1`, conteos verificados | destructivo; instrucción explícita de no mutar la base. **Corroborado indirectamente** por E12 (ver §5.2) |
| `just build-api` | `apply-progress.md` §"Phase 8": `rimraf dist` + `nest build`, `Done in 49.38s` | fuera del conjunto de comandos permitidos en esta fase |
| `just verify` | `apply-progress.md` §"Phase 8": `API :9001/api/settings 200 5503B`, `Shop :3003/en 200 cards:30`, `Admin :3002/en/login 200 cards:1` | requiere `api-dev`/`shop-dev`/`admin-dev` levantados |
| `just db-seed-generate` (la corrida original) | `apply-progress.md` §"Phase 2" | **superado**: E11 reproduce el generador y prueba que `db/seed.sql` es exactamente su salida |
| Clasificación del `git diff` crudo de `prisma db pull` | `apply-progress.md` §"Phase 4" | el pull crudo ya no existe; **el estado final sí se verificó** contra el catálogo vivo (E9) |

---

## 1. Completitud de tareas

| Métrica | Valor |
|---|---|
| Tareas `[x]` | 53 |
| Tareas `[ ]` | 0 |
| Tareas devueltas a `[ ]` por esta verificación | **0** |

Ninguna tarea marcada `[x]` resultó no hecha. Las tres que dependen de comandos
que esta fase no puede correr (3.2 `db-reset`, 8.3 `build-api`, 8.4 `verify`)
quedan aceptadas sobre evidencia heredada, explícitamente etiquetada como tal en
§0.2 — no se declaran reproducidas.

Tarea 4.7 ("pegar el diff clasificado como evidencia en el reporte de verify")
queda satisfecha por §4.2 de este documento.

---

## 2. Estado vivo del esquema (E4)

```
                       Table "public.shop_staff"
   Column   |           Type           | Nullable | Default
------------+--------------------------+----------+---------
 user_id    | bigint                   | not null |
 shop_id    | bigint                   | not null |
 created_at | timestamp with time zone | not null | now()
Indexes:
    "shop_staff_pkey" PRIMARY KEY, btree (user_id, shop_id)
    "shop_staff_tienda_idx" btree (shop_id)
Foreign-key constraints:
    "shop_staff_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    "shop_staff_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

                        Table "public.become_seller"
    Column    |           Type           | Nullable |  Default
--------------+--------------------------+----------+------------
 id           | smallint                 | not null | 1
 page_options | jsonb                    | not null |
 commissions  | jsonb                    | not null |
 language     | text                     | not null | 'es'::text
 created_at   | timestamp with time zone | not null | now()
 updated_at   | timestamp with time zone | not null | now()
Indexes:
    "become_seller_pkey" PRIMARY KEY, btree (id)
Check constraints:
    "become_seller_fila_unica" CHECK (id = 1)
```

Tablas totales en `public`: 17 (las 15 previas + las 2 nuevas). **No** existen
`balance`, `withdraws` ni `ownership_transfers` — el alcance del épico se
respetó.

---

## 3. Matriz de cumplimiento requirement por requirement

12 requirements / 22 scenarios. `COVERING TEST` = test que pasó en tiempo de
ejecución en E2; `PSQL` = consulta reproducida en esta sesión.

### capability `extended-identity-schema` (6 requirements, 10 scenarios)

| # | Requirement | CA | Scenarios | Evidencia que lo zanja | Veredicto |
|---|---|---|---|---|---|
| R1 | Pivote `shop_staff` bare, sin columna de rol | CA-1 | 2/2 | **S1** "un usuario staff de dos tiendas": `shop-staff.integration.test.ts:97-139` verde (E2). **S2** "sin columna de rol": test `:194-201` afirma `information_schema.columns = {created_at, shop_id, user_id}`, y E4 lo confirma en el catálogo vivo. PK compuesta `(user_id, shop_id)`, ambas FK `ON DELETE CASCADE`, `created_at timestamptz NOT NULL DEFAULT now()`, sin `updated_at`. `shop_staff_tienda_idx ON shop_staff (shop_id)` presente (E4, `pg_indexes`), espejo de `permission_user_permiso_idx` (`db/schema.sql:530`, verificado). | **PASS** |
| R2 | Idempotencia de la asignación staff↔tienda | CA-1 | 1/1 | `shop-staff.integration.test.ts:63-95`: `upsert({ where: { userId_shopId }, create, update: {} })` dos veces → `resolves.not.toThrow()` ambas, `findMany` del par → 1 fila. Verde en E2. Garantía estructural = PK compuesta (E4). | **PASS** |
| R3 | Cascadas del pivote | CA-1 | 2/2 | Tests `:142-165` (borrar tienda → pivote 0, usuario vivo) y `:167-190` (borrar usuario → pivote 0, tienda viva), verdes en E2. **Además reproducido en psql** (E6, §5.3) con fixtures desechables dentro de `BEGIN … ROLLBACK`. | **PASS** |
| R4 | Singleton `become_seller` con dos columnas `jsonb` | CA-2 | 2/2 | **S1**: `become-seller.integration.test.ts:29-35` → `rejects.toThrow(/become_seller_fila_unica/)`; reproducido en psql (E7). **S2**: test `:37-55` (24 claves incl. `defaultCommissionRate`, `commissions` array de 2, ninguna anidada). **Verificación independiente más fuerte (E10)**: el `jsonb` vivo es *deep-equal* al objeto INTERNO `data.page_options.page_options` del mock y a `data.commissions`; `page_options ? 'page_options'` → `f`, `page_options ? 'created_at'` → `f`. El envoltorio con forma de `settings` NO se fosilizó. | **PASS** |
| R5 | Sin trigger de `updated_at` en las tablas nuevas | CA-3 | 1/1 | Tests `shop-staff…:203-209` y `become-seller…:64-72` (`pg_trigger` = 0 por tabla), verdes en E2; reproducido en psql (E8): **0 triggers no internos en toda la base**. El bloque de política: `git diff 5af81ad~1..HEAD -- db/schema.sql` tiene **0 líneas de borrado**, luego el comentario es literalmente el mismo texto (hoy en `:540-550`, desplazado 63 líneas por la inserción del DDL) y no ganó entradas nuevas. | **PASS** |
| R6 | Seed determinista sin regresión de conteos vivos | CA-5 | 2/2 | **S1**: test `shop-staff…:46-61` (3 filas, pares exactos, ninguna con `userId` 1) + psql (E5). **S2**: psql (E5) → `categories 198` / raíces `83` / `shops 12` / `users 3` / `products 1200`. `db/seed.sql` emite exactamente `(2,1),(2,2),(3,1)` con `ON CONFLICT (user_id, shop_id) DO NOTHING`, y E11 prueba que ese archivo es la salida sin editar del generador. | **PASS** |

### capability `extended-identity-data-layer` (4 requirements, 8 scenarios)

| # | Requirement | CA | Scenarios | Evidencia que lo zanja | Veredicto |
|---|---|---|---|---|---|
| R7 | Modelos introspectados con los renombres manuales del par nuevo | CA-4 | 2/2 | **S1**: `schema.prisma` declara `model ShopStaff { … @@id([userId, shopId]) @@index([shopId], map:"shop_staff_tienda_idx") @@map("shop_staff") }` y `model BecomeSeller { id Int @id @default(1) @db.SmallInt … @@map("become_seller") }`, con `@map` en cada campo no trivial. **Cruce independiente contra la base (E9, §4.1): sin una sola divergencia.** **S2**: el diff commiteado de `schema.prisma` es 33+/2− y NO toca ninguno de los 15 modelos preexistentes salvo un realineado de espacios en `Shop.owner` y las 2 back-relations esperadas (`Shop.staff`, `User.staffShops`); `User.email` sigue sin `@unique`, el preview `partialIndexes` sigue puesto (§4.2). | **PASS** |
| R8 | `*Record` y mappers para ambas tablas | CA-4 | 3/3 | **S1**: `ShopStaffRecord { userId: number; shopId: number; createdAt: Date }` — sin `updatedAt` (`records.ts`). **S2**: `_toShopStaffRecord` usa `_id()` en ambos ids; test `shop-staff…:212-226` verde (E2): `typeof userId/shopId === 'number'`, `not.toHaveProperty('updatedAt')`, `JSON.stringify` no lanza. **S3**: `_toBecomeSellerRecord` copia `pageOptions`/`commissions` como `Prisma.JsonValue` hermanos; test `become-seller…:74-87` verde. `id` se copia sin `_id()` (smallint→Int, precedente `_toSettingRecord`) — correcto: `_id()` solo acepta `bigint`. Fechas se quedan como `Date`. | **PASS** |
| R9 | Exportación por el barrel del paquete | CA-4 | 2/2 | **S1**: `packages/db/index.ts:31,38` añade `BecomeSellerRecord` y `ShopStaffRecord` al bloque alfabetizado `export type { … } from './src/records'`; `packages/db/dist/index.d.ts:30505` los expone construidos. **S2**: no existen `shop-staff.repository.ts` ni `become-seller.repository.ts` (`ls packages/db/src/repositories/`), y el barrel no gana ninguna línea `export {` nueva (diff de 2 líneas, ambas de tipo). | **PASS** |
| R10 | `just db-check` permanece verde con el par nuevo | CA-4, CA-5 | 1/1 | **Reproducido (E1+E2)**: typecheck limpio + **12 archivos / 225 tests**, desde la línea base de 10/210 (+2 archivos, +15 tests). Los tests de esquema viven en `packages/db/src/repositories/{shop-staff,become-seller}.integration.test.ts` y consultan **Prisma directo** (`prisma.shopStaff`, `prisma.becomeSeller`, `$queryRaw`), no un repositorio de funciones planas. | **PASS** |

### capability `data-layer-clock-policy` (2 requirements, 4 scenarios)

| # | Requirement | CA | Scenarios | Evidencia que lo zanja | Veredicto |
|---|---|---|---|---|---|
| R11 | `become_seller` vincula su primera ruta de update a esta política | CA-3 | 2/3 verificables hoy + 1 obligación diferida | **S1** `updated_at = created_at`: test `become-seller…:57-62` verde (E2) y psql `created_at = updated_at` → `t` (E5). **S3** sin trigger: test `:64-72` + E8. **S2** "la primera función de update que se cree hereda la política" es una obligación **prospectiva sobre US-44**: la propia requirement prohíbe crear esa función aquí, y se verificó que no existe (no hay repositorio ni ninguna escritura sobre `become_seller` en `packages/db/src/`). Por construcción no es testeable en este change; no es un hueco de cobertura, es el contrato pactado. | **PASS** (S2 diferido a US-44, por diseño) |
| R12 | `shop_staff` queda fuera de esta política por construcción | — | 1/1 | La tabla no tiene `updated_at`: `information_schema.columns` da exactamente `{user_id, shop_id, created_at}` (test `shop-staff…:194-201` verde + E4). Sin columna no hay reloj que gobernar, así que no entra en el inventario exhaustivo de rutas de `UPDATE` de `openspec/specs/data-layer-clock-policy/spec.md`. | **PASS** |

**Resumen: 12/12 PASS. 22/22 scenarios cubiertos** (21 con test o consulta
ejecutada; 1 —R11/S2— es una obligación prospectiva que la propia requirement
declara fuera de este change).

---

## 4. Contraste independiente Prisma ↔ base viva (E9)

Requerido explícitamente por el encargo: los modelos se escribieron a mano, no
se tomaron del volcado crudo de `prisma db pull`.

### 4.1 Cruce columna a columna

| `schema.prisma` | `information_schema` / `pg_constraint` / `pg_indexes` | ¿Coincide? |
|---|---|---|
| `ShopStaff.userId BigInt @map("user_id")` | `shop_staff.user_id bigint NOT NULL`, pos 1 | ✅ |
| `ShopStaff.shopId BigInt @map("shop_id")` | `shop_staff.shop_id bigint NOT NULL`, pos 2 | ✅ |
| `ShopStaff.createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)` | `created_at timestamptz NOT NULL DEFAULT now()`, pos 3 | ✅ |
| `@@id([userId, shopId])` | `shop_staff_pkey PRIMARY KEY (user_id, shop_id)` | ✅ |
| `@@index([shopId], map: "shop_staff_tienda_idx")` | `CREATE INDEX shop_staff_tienda_idx ON public.shop_staff USING btree (shop_id)` | ✅ |
| `shop @relation(… onDelete: Cascade, onUpdate: NoAction)` | `shop_staff_shop_id_fkey … REFERENCES shops(id) ON DELETE CASCADE` (sin cláusula `ON UPDATE` ⇒ `NO ACTION`) | ✅ |
| `user @relation(… onDelete: Cascade, onUpdate: NoAction)` | `shop_staff_user_id_fkey … REFERENCES users(id) ON DELETE CASCADE` | ✅ |
| `@@map("shop_staff")` | tabla `public.shop_staff` | ✅ |
| `BecomeSeller.id Int @id @default(1) @db.SmallInt` | `id smallint NOT NULL DEFAULT 1`, `become_seller_pkey PRIMARY KEY (id)` | ✅ |
| `pageOptions Json @map("page_options")` | `page_options jsonb NOT NULL`, pos 2 | ✅ |
| `commissions Json` (sin `@map`: el nombre ya coincide) | `commissions jsonb NOT NULL`, pos 3 | ✅ |
| `language String @default("es")` | `language text NOT NULL DEFAULT 'es'::text`, pos 4 | ✅ |
| `createdAt` / `updatedAt` `@db.Timestamptz(6) @default(now())` | `timestamptz NOT NULL DEFAULT now()`, pos 5 y 6 | ✅ |
| `@@map("become_seller")` | tabla `public.become_seller` | ✅ |
| *(no modelado, por diseño)* | `become_seller_fila_unica CHECK (id = 1)` — declarada en la cabecera de `schema.prisma:10-17` junto a `settings_fila_unica` | ✅ |

**Cero divergencias.** Además, `prisma generate` corre limpio dentro de
`just db-build` (dist reconstruido, `index.d.ts` contiene los dos tipos), lo que
descarta drift detectable por Prisma.

### 4.2 Diff final de `schema.prisma` clasificado (tarea 4.7)

`git diff --numstat 5af81ad~1..HEAD -- packages/db/prisma/schema.prisma` → **33
adiciones / 2 borrados**, en 4 hunks:

| Hunk | Contenido | Clasificación |
|---|---|---|
| `@@ -12,7 +12,8 @@` | cabecera: `become_seller_fila_unica` añadida a la lista de "lo que Prisma NO modela" | **esperado** (documental, refleja la CHECK nueva) |
| `@@ -81,8 +82,9 @@` | `Shop.owner`: realineado de espacios; `+ staff ShopStaff[]` | **cosmético** + **back-relation esperada** |
| `@@ -244,6 +246,7 @@` | `+ staffShops ShopStaff[]` en `User` | **back-relation esperada** |
| `@@ -317,3 +320,31 @@` | banner `// Identidad extendida (US-41)` + `model ShopStaff` + `model BecomeSeller` | **esperado** (CA-4) |

**Ningún cambio semántico en los 15 modelos preexistentes**: ningún tipo de campo
cambió, ningún `@@map`/`@map` se perdió, `User.email` sigue **sin** `@unique`
(el índice único parcial `users_email_lower_idx` sigue siendo el garante), el
preview `partialIndexes` sigue declarado y `products_procedencia_key` sigue
siendo el unique parcial. Ni un solo modelo apareció o desapareció fuera de los
dos esperados. **Veredicto: cosmético + esperado. Sin STOP.**

---

## 5. Definición de Done de la US, ítem por ítem

### 5.1 Autorización del dueño para `just db-reset` — **CUMPLE (documental, verificado)**

Citada en tres lugares durables y coherentes entre sí:
`docs/product/40-identidad-extendida-postgres/41-esquema-identidad-extendida.md:138-141`
("Concedida el 2026-09-15"), las "Notas para el agente ejecutor" `:246-249` (que
además declaran que **no se hereda** la autorización del 2026-09-14 de US-32/34,
conforme a la decisión 1 del Épico 26), la decisión 3 del README del Épico 40 y
la sección "Migration / Rollout" del `design.md`. Registrada en el repo por el
commit `e2e6231` ("Registra la autorizacion de just db-reset para US-41").
Alcance declarado: **solo US-41**, la única US del épico que toca DDL.
*(Verificación de la cita, no de la conversación: un agente no puede auditar el
consentimiento del dueño más allá del registro escrito.)*

### 5.2 Salida de `just db-reset` con conteos verificados — **CUMPLE (heredado + corroborado)**

Salida pegada: heredada (`apply-progress.md` §"Phase 3", replicada en la DoD de
la US). **No reproducida**: correr `db-reset` está prohibido en esta fase.

**Corroboración independiente fuerte (E12)**: todas las filas sembradas —de
tablas viejas *y* nuevas— comparten el mismísimo timestamp de transacción:

```
       t       |              min              |              max
---------------+-------------------------------+-------------------------------
 products      | 2026-09-15 17:41:00.858127+00 | 2026-09-15 17:41:00.858127+00
 shops         | 2026-09-15 17:41:00.858127+00 | 2026-09-15 17:41:00.858127+00
 become_seller | 2026-09-15 17:41:00.858127+00 | 2026-09-15 17:41:00.858127+00
 shop_staff    | 2026-09-15 17:41:00.858127+00 | 2026-09-15 17:41:00.858127+00

 pg_postmaster_start_time
-------------------------------
 2026-09-15 17:40:51.532963+00
```

El postmaster arrancó 9 segundos antes del seed: contenedor recreado y base
sembrada de cero en una sola transacción, con las dos tablas nuevas dentro. Eso
solo lo produce un `db-reset` con el `schema.sql` ya modificado — no una
migración incremental.

Conteos **reproducidos por mí** (E5), idénticos a los declarados:

```
         t         | count
-------------------+-------
 categories        |   198
 categories_raices |    83
 shops             |    12
 users             |     3
 products          |  1200
 shop_staff        |     3
 become_seller     |     1
```

```
 user_id | shop_id            id | language | tiers | page_options_keys | anidado | reloj_ok
---------+---------           ----+----------+-------+-------------------+---------+----------
       2 |       1             1 | en       |     2 |                24 | f       | t
       2 |       2
       3 |       1     -- count(*) FROM pg_trigger WHERE NOT tgisinternal -> 0
```

Ninguna fila con `user_id = 1`. **Extra no exigido por la DoD pero decisivo
(E11)**: reejecuté `db/generate-seed.mjs` con la escritura redirigida al
scratchpad y la salida es **byte-idéntica** a `db/seed.sql` commiteado ⇒ el seed
es generado, no editado a mano, y sus 4 validaciones nuevas (FK de
`user_id`/`shop_id`, dueño-vs-staff, par duplicado, forma de `become-seller`)
pasan hoy contra el mock real.

### 5.3 `psql` con ambas cascadas y el rechazo del singleton — **CUMPLE (reproducido, E6+E7)**

Ejecutado por mí en esta sesión, fixtures desechables dentro de
`BEGIN … ROLLBACK`:

```
        momento         | pivote            momento          | pivote       chequeo       | existe
------------------------+--------  --------------------------+--------  --------------------+--------
 antes de borrar tienda |      1    despues de borrar tienda |      0   usuario sigue vivo |      1

         momento         | pivote            momento           | pivote       chequeo      | existe
-------------------------+--------  ---------------------------+--------  -------------------+--------
 antes de borrar usuario |      1    despues de borrar usuario |      0   tienda sigue viva |      1
ROLLBACK
```

```
INSERT INTO become_seller (id, page_options, commissions) VALUES (2, '{}'::jsonb, '[]'::jsonb);
ERROR:  new row for relation "become_seller" violates check constraint "become_seller_fila_unica"
DETAIL:  Failing row contains (2, {}, [], es, 2026-09-15 18:37:23.478118+00, …).
```

Conteos **después** del `ROLLBACK`, verificados en la misma sesión psql: 198/83,
12, 3, 1200, 3, 1 — sin residuo. `git status` limpio al cierre.

### 5.4 `git diff` de `schema.prisma` clasificado — **CUMPLE (reproducido, §4.2)**

El estado final se cruzó contra el catálogo vivo (§4.1) además de clasificar el
diff, que es una garantía más fuerte que la clasificación textual sola.

### 5.5 `just db-check` verde sin bajar de 210 — **CUMPLE (reproducido, E1+E2)**

```
> tsc --noEmit
(sin errores)

> vitest run
 Test Files  12 passed (12)
      Tests  225 passed (225)
   Duration  28.90s
```

Línea base 10 archivos / 210 tests → **12 / 225**. Cifra idéntica a la
declarada por la fase apply.

### 5.6 `cd apps/api/rest && npx jest` verde — **CUMPLE (reproducido, E3)**

```
Test Suites: 9 passed, 9 total
Tests:       285 passed, 285 total
Time:        90.386 s
```

Sin movimiento respecto a la línea base de 285: confirma que la API mockea
`@safari/db` y que la capa de datos quedó aislada.

### 5.7 `just build-api` — **HEREDADO, NO REPRODUCIDO**

`apply-progress.md`: `rimraf dist` + `nest build`, `Done in 49.38s`. No está en
el conjunto de comandos que esta fase puede correr. **No lo declaro verificado
por mí.** Mitigante parcial: `npx jest` compila todo `apps/api/rest/src` vía
ts-jest y pasó (E3); y este change no modificó ningún archivo de `apps/` (§7).

### 5.8 `just verify` — **HEREDADO, NO REPRODUCIDO**

`apply-progress.md`: `API :9001/api/settings 200 5503B 30ms` · `Shop :3003/en
200 190788B cards:30` · `Admin :3002/en/login 200 72821B cards:1`. Requiere tres
servidores de desarrollo levantados; fuera de lo permitido aquí. **No lo declaro
verificado por mí.** Riesgo residual bajo: el change no toca `apps/` ni el
contrato HTTP de ningún endpoint, y `/api/settings` (el único endpoint del
`verify` que va a Postgres) no comparte tabla con nada de US-41.

### 5.9 Status de la US actualizado y fila del épico marcada — **CUMPLE (reproducido)**

- `41-esquema-identidad-extendida.md:10-11`: `**Status:** Hecho — ejecutada en
  dos cortes (5af81ad + capa de datos/tests), Definición de Done cerrada con
  evidencia real abajo`. Los 7 checkboxes de la DoD están en `[x]` con salida
  real embebida.
- `docs/product/40-identidad-extendida-postgres/README.md`: la tabla de US ganó
  columna `Status` y US-41 figura como `✅ Implementada`; US-42/43/44 en blanco
  (misma convención que el Épico 19).
- `db/README.md`: subsección "Identidad extendida: staff por tienda y 'vender
  con nosotros'" añadida tras el cierre de "Identidad", documentando ambas
  tablas y el porqué del pivote sin rol y de las dos columnas `jsonb`.

---

## 6. Alcance: fugas de US-42 / US-44 — **NINGUNA**

| Prohibición del "NO incluye" | Comprobación | Resultado |
|---|---|---|
| Repositorios de funciones planas | `ls packages/db/src/repositories/` | no existen `shop-staff.repository.ts` ni `become-seller.repository.ts`; los 2 archivos nuevos son `*.integration.test.ts` |
| Funciones de repositorio en el barrel | diff de `packages/db/index.ts` | +2 líneas, **ambas tipos**, dentro del `export type { … }` existente; cero `export {` nuevo |
| Servicio / controlador / DTO / guard de Nest | `git diff --stat 5af81ad~1..HEAD` | **ningún archivo bajo `apps/` fue tocado**. El módulo `apps/api/rest/src/become-seller/` que existe es el mock original de Pickbazar (sirve `become-seller.json` vía `plainToClass`), intacto — US-44 lo migrará |
| Tablas `balance` / `withdraws` / `ownership_transfers` | `information_schema.tables` | no existen (17 tablas: 15 + las 2 de US-41) |
| Levantar la exclusión de `db/schema.sql:13-16` | `git diff` de `db/schema.sql` | **0 borrados** en todo el archivo; el bloque de exclusión está intacto |
| Frontend | `git diff --stat` | ningún archivo de `apps/shop` ni `apps/admin` |

Los mappers `_toShopStaffRecord` / `_toBecomeSellerRecord` quedan sin consumidor
de producción hasta US-42/US-44 (hoy solo los usan los dos tests). Es el orden
declarado del épico, no código muerto — y el commit `f06f0e3` lo dice
explícitamente.

---

## 7. Coherencia con el design y verificación de la corrección de CA-1

### 7.1 Desviaciones del design

Las dos que `apply-progress.md` declara se confirman benignas:

1. **Rutas de las citas (Fase 6)**: la tarea apuntaba a
   `apps/api/rest/src/{manufacturers,tags}/…`; los archivos reales son
   `packages/db/src/repositories/{manufacturers,tags}.repository.ts`. Corregido
   al ejecutar. Verificado: ambas citas leen ahora `db/schema.sql:540-550`, y
   `sed -n '540,550p' db/schema.sql` devuelve exactamente el bloque de política
   de reloj. **Cita viva, no colgante.**
2. **Reconstrucción desde `.pre` en vez del volcado crudo**: produce un diff de
   35 líneas en vez de ~140. El design pedía "re-aplicar contra la copia `.pre`";
   no exigía partir del pull crudo. El riesgo real de este atajo —que el archivo
   escrito a mano no describa la base— se **anuló con el cruce de §4.1**.

Ninguna desviación rompe un requirement.

### 7.2 La corrección "con rol" → "sin rol" — **TEXTO VERIFICADO COMO EXACTO**

El encargo pedía confirmar que la prosa corregida es verdadera. Verifiqué las
cinco afirmaciones una por una contra el código actual:

| Afirmación del texto corregido | Código real | ¿Cierta? |
|---|---|---|
| "`GetStaffsDto` solo declara page/limit/orderBy/sortedBy/shop_id" | `apps/api/rest/src/shops/dto/get-staffs.dto.ts:3-7`: `extends PaginationArgs { orderBy?; sortedBy?; shop_id? }` | ✅ (matiz en §8-S3) |
| "`StaffsController.getStaffs` devuelve `UserPaginator`" | `shops.controller.ts:109`: `async getStaffs(@Query() query: GetStaffsDto): Promise<UserPaginator>` | ✅ |
| "`AddStaffInput` del admin es `{email, password, name, shop_id}`" | `apps/admin/rest/src/types/index.ts:1562-1567`: exactamente esos 4 campos | ✅ |
| "`StaffList` solo pinta `name/email/is_active`" | `apps/admin/rest/src/components/shop/staff-list.tsx`: `dataIndex` = `name`, `email`, `is_active`, `id` (acciones) | ✅ |
| "`users` no tiene columna `shop_id`" | `information_schema.columns` de `users`: `id, name, email, password_hash, is_active, email_verified_at, created_at, updated_at` | ✅ |

Los tres textos durables están alineados entre sí y con el código:
`41-…-extendida.md:61-76` (CA-1 con el bloque de corrección fechado),
`docs/product/40-identidad-extendida-postgres/README.md` D-2 (reescrita), y
`specs/extended-identity-schema/spec.md:24-27` (que zanja que una columna de rol
futura sería un **requirement nuevo**, no una corrección). La base viva confirma
el hecho: `shop_staff` tiene 3 columnas y ninguna es un rol.

---

## 8. Issues

### CRITICAL — ninguna

### WARNING

**W1 — Cita colgante dentro de la delta spec, que el archive fusionaría a las
specs principales.**
`openspec/changes/esquema-identidad-extendida/specs/extended-identity-schema/spec.md:105`
dice:

> `El comentario de política de `db/schema.sql:477-487` MUST permanecer sin modificar`

El bloque ya **no** está en `:477-487`: la inserción del DDL de este mismo change
lo desplazó a **`:540-550`**. La *obligación* se cumple (el comentario está
intacto, §3/R5), pero el puntero es falso. El resto del repo sí se re-numeró en
este change (`manufacturers.repository.ts:196`, `tags.repository.ts:170`,
`41-…-extendida.md:91`, `34-esquema-capa-datos-contenido.md:250`) y la otra cita
de esta misma spec —`:15`, `:472`→`:530`— también se corrigió; esta se quedó
fuera. Como `sdd-archive` fusiona el delta en `openspec/specs/`, la cita errónea
se volvería permanente. **Reparar antes de archivar** (cambio de una palabra;
NO lo aplico: verificación y reparación son fases distintas).

### SUGGESTION

**S1 — El "diff final" pegado en `apply-progress.md` no es el diff final.**
`apply-progress.md` §"Phase 4" presenta un diff de "32 líneas"; el commiteado es
33+/2− = **35 líneas** e incluye un cuarto hunk (la cabecera `:12-16`, que añade
`become_seller_fila_unica` a la lista de lo que Prisma no modela). La diferencia
se explica sola —ese hunk fue un ajuste del coordinador posterior, como el propio
documento reconoce en otra sección— pero el diff transcrito induce a error a
quien lo lea como evidencia. Sin impacto en el código. §4.2 de este informe
contiene la clasificación del diff realmente embarcado.

**S2 — Citas `db/schema.sql:N` pre-existentes y obsoletas, ajenas a este change.**
`docs/product/26-escrituras-catalogo-postgres/{27,27b,README}.md`,
`docs/product/32-deriva-reloj-updated-at-created-at.md` y
`docs/product/33-contenido-configuracion-postgres/README.md` apuntan a
`schema.sql:479-500` para el bloque de reloj. Ya estaban obsoletas **antes** de
US-41 (el bloque estaba en `:477-487`), así que **no son una regresión de este
change** y no correspondía arreglarlas aquí (regla de "una US = un alcance").
Se anotan para que alguien las barra cuando toque.

**S3 — Imprecisión menor en la prosa de la spec.** `GetStaffsDto` hereda también
`first?: number` de `PaginationArgs`, además de `limit`/`page`; la spec enumera
"page/limit/orderBy/sortedBy/shop_id". Inmaterial para la conclusión (ninguno de
los campos es un rol), pero la enumeración no es exhaustiva.

---

## 9. Dimensiones omitidas

Ninguna. Existían proposal, design, las 3 delta specs y tasks, así que se
verificaron completitud, corrección y coherencia. Las únicas piezas no
reproducidas son los 3 comandos de §0.2, etiquetados como heredados.

---

## 10. Veredicto y disposición de archivado

**PASS WITH WARNINGS.**

- 12/12 requirements PASS · 22/22 scenarios cubiertos (21 ejercitados, 1
  prospectivo por contrato) · 53/53 tareas hechas · 0 tareas devueltas a `[ ]`.
- Evidencia de ejecución reproducida en esta sesión para lo sustancial:
  typecheck limpio, 225 tests de `packages/db`, 285 tests de la API, catálogo
  vivo cruzado contra Prisma, cascadas y CHECK ejercitadas en psql, `jsonb`
  deep-equal contra el mock, seed probado como generado y no editado.
- Tres comandos quedan sobre evidencia heredada (`just db-reset`,
  `just build-api`, `just verify`), cada uno etiquetado como tal; el primero
  está corroborado indirectamente por los timestamps de la base.

**¿Listo para archivar? Sí, con una reparación previa de un renglón.**
Corregir **W1** (`spec.md:105`: `db/schema.sql:477-487` → `:540-550`) antes de
que `sdd-archive` fusione el delta en `openspec/specs/extended-identity-schema/`,
para no fosilizar una cita falsa en la spec durable. S1/S2/S3 no bloquean.
