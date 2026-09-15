# Design: US-41 — Esquema y capa de datos de identidad extendida

## Technical Approach

Se ejecuta el Approach 1 de `proposal.md` (decisión cerrada): dos tablas en
`db/schema.sql` (`shop_staff` bare, `become_seller` con dos columnas `jsonb`),
su seed, la re-introspección de Prisma, dos `*Record` con sus mappers, el barrel
y dos suites de esquema. **Un solo `just db-reset`**, destructivo y autorizado
por el dueño el 2026-09-15
(`docs/product/40-identidad-extendida-postgres/41-esquema-identidad-extendida.md:142-145`).

Cuatro superficies de riesgo desiguales: **DDL** (bajo, calcado de dos
precedentes), **seed** (medio — el generador tiene una trampa de anidamiento
que fosilizaría fechas del mock), **re-introspección** (el riesgo real) y
**records + tests** (mecánico). Satisface `extended-identity-schema` (6
requirements), `extended-identity-data-layer` (4) y el delta de
`data-layer-clock-policy` (2).

Estado verificado hoy en `psql` (read-only): `to_regclass` de ambas tablas es
`NULL`; 198 categorías / 83 raíces, 12 shops, 3 users, 1200 products; y
`count(*) FROM pg_trigger WHERE NOT tgisinternal` = **0**.

---

## Architecture Decisions

### D-1: Las dos tablas van al FINAL del bloque de tablas, no junto a sus hermanas

**Choice**: un único bloque entre `db/schema.sql:435` (el `);` de `product_tag`)
y `:438` (el banner `Índices`), con las dos líneas en blanco de separación que
usa el archivo. El índice va aparte (D-2).

**Alternatives**: (a) `become_seller` tras `settings` (`:80`) y `shop_staff`
tras `shops` (`:244`), que es donde "semánticamente" van; (b) tras el comentario
de política, antes del `COMMIT;` de `:490`.

**Rationale**: (a) desplazaría **15 de las 16** citas `db/schema.sql:N` vivas
del repo (solo `slug.ts:11`, que cita `:39-61`, sobreviviría a un inserto tras
`:80`). Las 16, verificadas hoy en `packages/db/src/**` y
`apps/api/rest/src/types/dto/create-type.dto.ts:8`, apuntan a `:39-61`,
`:90-101`, `:175`, `:189`, `:231-244`, `:269`, `:288`, `:302`, `:331-332`,
`:333` (`manufacturers.repository.ts:232`), `:427`/`:433`
(`products.repository.ts:1060`), `:433` y `:477-487`. Insertar tras `:435` deja
**solo dos** desactualizadas —`manufacturers.repository.ts:196` y
`tags.repository.ts:170`, ambas citando `:477-487`—, y esas se desplazan igual
porque el índice nuevo entra antes de ese comentario (D-2). (b) pondría DDL
tras los índices y la política, rompiendo el orden del archivo (tablas →
índices → política → `COMMIT`). Restricción dura: `shop_staff` referencia
`users` (`:116`) y `shops` (`:231`).

**Consecuencia declarada**: se re-citan esos dos comentarios — mantenimiento de
una cita que ESTE change invalida (criterio de D-6 de US-32), no una mejora
oportunista. **`db/schema.sql:13-16` no se toca**: ninguna de las dos tablas
está en su lista de exclusión y "el resto del dominio transaccional sigue
fuera" sigue siendo cierto.

#### Texto exacto del bloque (entra tras `:435`)

```sql
-- =====================================================================
-- Identidad extendida (US-41, Épico 40) — staff por tienda y la página
-- "vender con nosotros".
--
-- Van al FINAL del bloque de tablas: shop_staff referencia users y shops
-- (ambas arriba), y así las citas `db/schema.sql:N` vivas del repo no se
-- desplazan más de lo inevitable.
--
-- NINGUNA lleva trigger: la política de reloj único de abajo las gobierna
-- igual que al resto -- `updated_at` lo fija la capa de datos, y shop_staff
-- ni siquiera tiene esa columna.
-- =====================================================================

-- shop_staff — pivote puro user<->shop, calco de permission_user.
--
-- SIN columna de rol, a propósito: StaffsController.getStaffs devuelve
-- UserPaginator (usuarios, no filas de pivote), GetStaffsDto solo filtra por
-- shop_id y AddStaffInput del admin es {email,password,name,shop_id}. Un
-- `role` sería especulativo. Sin `updated_at`: un pivote se crea o se borra,
-- nunca se actualiza (igual que permission_user y product_tag).
--
-- El título de CA-1 en la US dice "con rol"
-- (41-esquema-identidad-extendida.md:61); el código no lo respalda y la spec
-- ya zanja que gana el código (extended-identity-schema/spec.md:24-26).
CREATE TABLE IF NOT EXISTS shop_staff (
    user_id     bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id     bigint       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, shop_id)
);


-- ---------------------------------------------------------------------
-- become_seller — la fila única de la página "vender con nosotros".
--
-- Mismo patrón que settings: id smallint fijo + CHECK de fila única. DOS
-- columnas jsonb, no una: become-seller.json trae `page_options` y
-- `commissions` como claves HERMANAS y el GET real sirve ambas
-- (plainToClass sin excludeExtraneousValues); fundirlas bajo un nombre que
-- dice `page_options` haría mentir a la columna.
--
-- `page_options` guarda el objeto INTERNO (data.page_options.page_options,
-- 24 claves), NO el envoltorio con forma de settings: los id/language/
-- created_at/updated_at de ese envoltorio son exactamente estas cuatro
-- columnas y meterlos en el jsonb fosilizaría las fechas del mock. El
-- envoltorio se recompone en el servicio (US-44).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS become_seller (
    id            smallint     PRIMARY KEY DEFAULT 1,
    page_options  jsonb        NOT NULL,
    commissions   jsonb        NOT NULL,
    language      text         NOT NULL DEFAULT 'es',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT become_seller_fila_unica CHECK (id = 1)
);
```

### D-2: El índice del segundo lado se añade al final del bloque de índices

**Choice**: tras `db/schema.sql:474` (`otp_codes_phone_idx`), fin del bloque
abierto en `:438`:

```sql
-- El inverso del pivote de staff: GetStaffsDto filtra por shop_id, que la PK
-- (user_id, shop_id) no cubre por la izquierda. Gemelo de
-- permission_user_permiso_idx.
CREATE INDEX IF NOT EXISTS shop_staff_tienda_idx ON shop_staff (shop_id);
```

**Alternatives**: pegarlo a `:472` (`permission_user_permiso_idx`), su gemelo.
**Rationale**: el comentario de `:471` gobierna solo `:472` y el bloque crece
por append, una US por vez. Ningún índice sobre `user_id`: lo cubre la PK.

**Ninguna de las dos tablas recibe trigger** (CA-3) y el comentario de política
`:477-487` queda **literal**: ya dice "toda tabla nueva hereda esta política".

### D-3: las dos tablas se siembran desde el generador, ninguna a mano

**Choice**: ambas pasan por `db/generate-seed.mjs` — `become_seller` leyendo el
mock (`leer('become-seller')`), `shop_staff` desde un array literal validado.

**Alternatives**: escribir las 3 filas del pivote a mano en `db/seed.sql`.
**Rationale**: ese archivo es GENERADO y se rehace con `just db-seed-generate`;
la edición manual se perdería. El precedente de seed inventado-y-validado es
`permissionsCatalogo` + `asignaciones` (`db/generate-seed.mjs:64-81`): array a
mano, validado en `problemas` antes de emitir SQL.

### D-4: `ShopStaffRecord` sin `updatedAt`; `BecomeSellerRecord.id` sin `_id()`

**Choice**: `ShopStaffRecord` expone `userId`, `shopId` y `createdAt`, nada más;
`BecomeSellerRecord.id` se copia **directo**, sin `_id()`.

**Rationale**: lo primero refleja la tabla (CA-4 lo exige). Lo segundo no es
excepción a la frontera de serialización: `become_seller.id` es `smallint` →
`Int`, no `BigInt`, y `_id()` no compila contra un `number`. Precedente
literal: `_toSettingRecord` (`packages/db/src/records.ts:180`, `id: row.id`)
frente a `_toTypeRecord` (`:190`, `id: _id(row.id)`). `_dec()` no interviene:
ninguna tabla tiene columna `numeric` (el `commission: 15` va DENTRO del
`jsonb`).

---

## Data Flow

`become-seller.json` → `generate-seed.mjs` → `seed.sql` → `db-reset` → Postgres
→ `db pull` → `schema.prisma` → `records.ts` → `index.ts` → `@safari/db`.

---

## File Changes

| File | Action | Description |
|---|---|---|
| `db/schema.sql` | Modify | 2 tablas tras `:435` (D-1); índice tras `:474` (D-2). `:13-16` y `:477-487` intactos |
| `db/generate-seed.mjs` | Modify | `leer('become-seller')`, `staffAsignaciones`, 4 validaciones, 2 emisiones |
| `db/seed.sql` | Regenerate | `just db-seed-generate`. NO se edita a mano |
| `db/README.md` | Modify | Subsección nueva tras `:83` (cierre de "Identidad") |
| `packages/db/prisma/schema.prisma` | Modify | `db pull` + renombres; +2 modelos, +2 back-relations |
| `packages/db/src/records.ts` | Modify | 2 imports, 2 interfaces tras `:172`, 2 mappers tras `:303` |
| `packages/db/index.ts` | Modify | 2 tipos en el bloque `:30-40`. **Cero funciones nuevas** |
| `packages/db/src/repositories/shop-staff.integration.test.ts` | Create | Suite de esquema del pivote |
| `packages/db/src/repositories/become-seller.integration.test.ts` | Create | Suite de esquema del singleton |
| `manufacturers.repository.ts:196`, `tags.repository.ts:170` | Modify | Re-citar `db/schema.sql:477-487` (D-1, solo comentario) |

**No se tocan** (no-goals vinculantes): repositorios de funciones planas,
servicios/controladores/DTO/guards de Nest, `balance`/`withdraws`/
`ownership_transfers`, `db/schema.sql:13-16`, frontend, y el bloque `Secuencias`
del generador (`:410-419`) — `become_seller` es `smallint DEFAULT 1` (como
`settings`, tampoco listada) y `shop_staff` no tiene `id`.

---

## Interfaces / Contracts

### Seed — los cambios exactos de `db/generate-seed.mjs`

| # | Dónde | Qué |
|---|---|---|
| 1 | tras `:34` | `const becomeSeller = leer('become-seller');` |
| 2 | tras `:81` | `const staffAsignaciones = [{user_id:2,shop_id:1},{user_id:2,shop_id:2},{user_id:3,shop_id:1}]` + comentario de por qué esas 3 |
| 3 | tras `:133` | las validaciones de abajo |
| 4 | tras `:181` (cierre del `L.push` de `settings`) | emitir `become_seller` |
| 5 | tras `:279` (cierre del `L.push` de `shops`) | emitir `shop_staff` |
| 6 | `:165-167` y `:426-430` | el resumen suma `1 become_seller` + 3 staff |

El punto 5 no es negociable: `shop_staff` tiene FK inmediatas a `users`
(`:200-217`) y `shops` (`:260-279`). El 4 es de estilo: `become_seller` no tiene
FK y va junto al otro singleton.

Validaciones (punto 3), en el estilo de `:123-133`:

```js
for (const s of staffAsignaciones) {
  if (!idsDeUsers.has(s.user_id)) problemas.push(`shop_staff: user_id ${s.user_id} inexistente`);
  if (!idsFinalesShops.has(s.shop_id)) problemas.push(`shop_staff: shop_id ${s.shop_id} inexistente`);
  const tienda = shopsTodos.find((t) => t.id === s.shop_id);
  if ((tienda?.owner_id ?? 1) === s.user_id)
    problemas.push(`shop_staff: el usuario ${s.user_id} ya es dueño de la tienda ${s.shop_id}`);
}
if (new Set(staffAsignaciones.map((s) => `${s.user_id}:${s.shop_id}`)).size !== staffAsignaciones.length)
  problemas.push('shop_staff: par (user_id, shop_id) duplicado');
if (!becomeSeller.page_options?.page_options)
  problemas.push('become-seller: falta data.page_options.page_options');
if (!Array.isArray(becomeSeller.commissions) || becomeSeller.commissions.length !== 2)
  problemas.push('become-seller: commissions no es un array de 2 tiers');
```

`idsDeUsers` (`:120`) e `idsFinalesShops` (`:103`) ya existen; la validación
dueño-vs-staff hace ejecutable el "nunca el usuario 1" de CA-5.

Emisión de `become_seller`, calco de `settings` (`:174-181`): `bloque(...)`, 3
líneas de comentario, `INSERT INTO become_seller (id, page_options, commissions,
language) VALUES` y la fila

```js
`  (1, ${json(becomeSeller.page_options.page_options)}, ${json(becomeSeller.commissions)}, ` +
  `${txt(becomeSeller.page_options.language ?? 'en')})`
```

y un `ON CONFLICT (id) DO UPDATE SET` de las 3 columnas.

**La trampa**: `becomeSeller.page_options.page_options`, dos niveles. Verificado
con `node -e`: el externo tiene 5 claves (`id, page_options, language,
created_at, updated_at`), el interno **24** (9859 caracteres). Emitir el externo
metería `created_at: "2024-06-06T10:30:48.000000Z"` en el `jsonb`: fechas del
mock fosilizadas en una columna que ya existe como `timestamptz`. `language`
sale de `becomeSeller.page_options.language` y vale `'en'`, como `settings`
(`db/seed.sql:22-24`), no el `DEFAULT 'es'` del DDL.

Emisión de `shop_staff` (calco de `permission_user`, `:249-258`): `INSERT INTO
shop_staff (user_id, shop_id) VALUES` + `staffAsignaciones.map(...)` +
`ON CONFLICT (user_id, shop_id) DO NOTHING;`. Ninguno de los dos INSERT nombra
columnas de fecha. **En `become_seller`** —la única con `updated_at`— eso
implica `created_at = updated_at` exactamente: el seed corre en una transacción
(`BEGIN;` en `:170`) y `now()` es el timestamp de transacción, así que ambos
DEFAULT dan el mismo valor. Es el primer scenario del delta de
`data-layer-clock-policy`, satisfecho por construcción. `shop_staff` queda fuera
de esa política por no tener la columna.

### `records.ts` y el barrel

Imports de tipo (`records.ts:20-31`, alfabéticos por el assist
`organizeImports` de biome): `BecomeSeller` antes de `Category`, `ShopStaff`
entre `Shop` y `Tag`. Interfaces tras `PermissionRecord` (`:166-172`) y mappers
tras `_toPermissionRecord` (`:295-303`), últimos de sus bloques y en el mismo
orden relativo.

```ts
/** Pivote puro: la tabla no tiene `updated_at` (US-41 CA-1). */
export interface ShopStaffRecord {
  userId: number;
  shopId: number;
  createdAt: Date;
}

/**
 * Singleton de "vender con nosotros". `pageOptions` es el objeto INTERNO del
 * mock (24 claves) y `commissions` la lista de tiers: hermanas (US-41 CA-2).
 */
export interface BecomeSellerRecord {
  id: number;
  pageOptions: Prisma.JsonValue;
  commissions: Prisma.JsonValue;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

export function _toShopStaffRecord(row: ShopStaff): ShopStaffRecord {
  return {
    userId: _id(row.userId),
    shopId: _id(row.shopId),
    createdAt: row.createdAt,
  };
}

export function _toBecomeSellerRecord(row: BecomeSeller): BecomeSellerRecord {
  return {
    id: row.id, // smallint -> Int: sin _id(), como _toSettingRecord (:180)
    pageOptions: row.pageOptions,
    commissions: row.commissions,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

Barrel: el bloque `export type { … } from './src/records'` de
`packages/db/index.ts:30-40` está alfabetizado → `BecomeSellerRecord` antes de
`CategoryRecord`, `ShopStaffRecord` entre `ShopRecord` y `TagRecord`. **Ninguna
línea `export {` nueva** — ese scenario es una aserción sobre este diff.

**Los dos mappers quedan sin importar en producción** hasta US-42/US-44 (el
barrel solo re-exporta tipos y ningún repositorio los llama): no es código
muerto por descuido sino el orden del épico, y los tests 12-13 son su único
consumidor aquí.

---

## El paso de re-introspección

`packages/db/prisma/schema.prisma` mide hoy **319 líneas / 15 modelos**.
`prisma db pull` reescribe el archivo entero y pisa los renombres manuales
(`packages/db/README.md:99`: `npx prisma db pull   # OJO: pisa los renombres
manuales`). **Cita rancia a no propagar**: la US apunta a `README.md:97`
(`41-esquema-identidad-extendida.md:152`), que es la línea de `just db-reset`;
no se corrige porque ese archivo no es de este change.

### Predicción falsable

Tras el pull aparecen **exactamente 2 modelos nuevos** y **2 campos de
back-relation** en modelos existentes; ningún otro cambio semántico. Esos 2
campos son el matiz que `proposal.md:192-200` no nombra: al existir `ShopStaff`,
la introspección añade una relación inversa a `User` (`schema.prisma:243-246`) y
otra a `Shop` (`:84-85`). **Obligatorias**: sin ellas Prisma no valida.

### Clasificación del diff (paso adaptado del diseño de US-32)

| Clase | Ejemplos | Acción |
|---|---|---|
| **Cosmético / re-aplicable** | cabecera `:1-29` y banner `:225-231` perdidos; modelos en snake_case sin `@@map`; campos sin `@map`; `previewFeatures = ["partialIndexes"]` (`:34`) ausente; `url = env("DATABASE_URL")` re-añadido al `datasource` (`:37-39`); bloques reordenados | Re-aplicar y continuar (`README.md:95-102`) |
| **Esperado en ESTE change** | `model ShopStaff`, `model BecomeSeller` y las 2 back-relations en `User`/`Shop` | Renombrar y continuar; CA-4 lo declara |
| **Semántico → STOP** | tipo de campo distinto en cualquiera de los 15 modelos; `@@map`/`@map` irrestaurable; `@unique` nuevo en `User.email` (`:236`); `products_procedencia_key` degradado a total; `@default(now())` perdido o vuelto `dbgenerated`; un modelo desaparecido o un tercero aparecido | No aceptar el archivo: o la base no quedó como el DDL declara, o la introspección cambió |

### Procedimiento

1. **Precondición de árbol limpio**: `git status --porcelain
   packages/db/prisma/schema.prisma` vacío; si no, commitear o stashear, o
   `git checkout --` de ese archivo deja de ser una red. Restaura **ese único
   archivo**; `db/schema.sql` ya estará editado, que es lo correcto.
2. `cp packages/db/prisma/schema.prisma <scratchpad>/schema.prisma.pre`.
3. `cd packages/db && npx prisma db pull` (la URL sale de `prisma.config.ts`).
4. `git diff packages/db/prisma/schema.prisma` **completo**, los 17 modelos.
5. Clasificar con la tabla de arriba antes de tocar nada.
6. Re-aplicar contra la copia del paso 2: cabecera `:1-29`, `previewFeatures`,
   `datasource` sin `url`, PascalCase + `@@map` en los 15 modelos, camelCase +
   `@map` en los campos, `User.email` **sin** `@unique`, banner `:225-231`. El
   **atajo** de US-32 (`git checkout --` con diff 100 % cosmético) **no aplica**:
   lo que se perdería no son los dos modelos —el paso 7 los escribe a mano— sino
   **la salida del pull recién clasificada**, única evidencia de que la base
   quedó como el DDL declara; la restitución es la copia `.pre`. Sigue prohibido
   `prisma migrate dev` / `db push` (`packages/db/README.md:104`).
7. Los dos modelos nuevos, tras `OtpCode` (`:309-319`), bajo un banner
   `// Identidad extendida (US-41)`:

```prisma
model ShopStaff {
  userId    BigInt   @map("user_id")
  shopId    BigInt   @map("shop_id")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@id([userId, shopId])
  @@index([shopId], map: "shop_staff_tienda_idx")
  @@map("shop_staff")
}

model BecomeSeller {
  id          Int      @id @default(1) @db.SmallInt
  pageOptions Json     @map("page_options")
  commissions Json
  language    String   @default("es")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@map("become_seller")
}
```

`ShopStaff` calca `PermissionUser` (`:278-289`); `BecomeSeller`, `Setting`
(`:41-49`). Back-relations, siguiendo el par `User.permissions`/
`Permission.users`: `staffShops ShopStaff[]` en `User` (`shops` ya lo ocupa la
propiedad) y `staff ShopStaff[]` en `Shop`.

---

## Testing Strategy

Todo es **integración** (vitest + Postgres real) en dos archivos nuevos bajo
`packages/db/src/repositories/`: tests 1-6 y 12 en `shop-staff`, 7-11 y 13 en
`become-seller`. La capa unit de Nest no cambia: mockea `@safari/db`.
**Archivos nuevos, no ampliación de los existentes**: sin
repositorio no hay archivo "dueño", y meterlos en `users.integration.test.ts`
obligaría a crear tiendas centinela desde el archivo de usuarios, compartiendo
su propiedad con `shops.integration.test.ts`. Línea base **10 archivos / 210
tests** → 12 archivos, ≥ 210 tests (9 de los 10 en `src/repositories/`; el
décimo es `src/slug.integration.test.ts`).

**Regla del tripwire, citada literal** (`shops.integration.test.ts:472-476`):

> `// VA EL ÚLTIMO A PROPÓSITO. […] vitest ejecuta los describe de un archivo en`
> `// orden de declaración, así que solo desde el final cubre toda la batería.`
> `// Al añadir un describe de escritura nuevo, va ANTES de este.`

Aquí **no se añade nada a `shops.integration.test.ts`**: su tripwire de
`:478-483` (`prisma.shop.count()` → 12 sin filtro) sigue siendo el último, y lo
protege el centinela de abajo.

### Centinelas y fixtures

- Tiendas: prefijo **`zz-tiendas-staff-`**, que empieza por `zz-tiendas-`
  (`shops.integration.test.ts:37`), así que el `beforeAll(cleanupSentinel)` de
  **ese** archivo (`:38-41`, `startsWith`) barre también los restos de una
  corrida abortada de este. Con `fileParallelism: false` nunca coexisten con el
  tripwire.
- `ownerId: 3` (admin) en las tiendas centinela, por la razón de
  `shops.integration.test.ts:28-36` (una superviviente no degrada
  `users.integration.test.ts:84-92,141-151`) y, decisiva aquí, porque
  `shops.owner_id` es **`ON DELETE RESTRICT`** (`db/schema.sql:236`): si la
  tienda perteneciera al usuario centinela, el test de cascada de usuario
  fallaría por violación de FK en vez de ejercitar la cascada.
- Usuarios: dominio **`@shop-staff-integration.test`** (RFC 2606), como
  `users.integration.test.ts:34`. `afterAll` borra tiendas y luego usuarios.
- Fixtures con `prisma.user.create` / `prisma.shop.create` /
  `prisma.shopStaff.*` **directos**: el patrón que la spec exige
  (`users.integration.test.ts:332-335,355-358`).

### Los tests

| # | Requirement | Forma |
|---|---|---|
| 1 | Seed determinista | `prisma.shopStaff.count()` → 3 (va el PRIMERO, antes de crear filas propias); pares `(2,1),(2,2),(3,1)`, ninguno con `userId` 1 |
| 2 | Idempotencia | `prisma.shopStaff.upsert({ where: { userId_shopId: {…} }, create: {…}, update: {} })` dos veces → `not.toThrow()` y `count` del par = 1. Forma de `grantPermission` (`users.repository.ts:368-388`) |
| 3 | Un usuario, dos tiendas | 2 filas del mismo `userId` coexisten |
| 4 | Cascada de tienda | `prisma.shop.delete` → pivote a 0, usuario vivo |
| 5 | Cascada de usuario | `prisma.user.delete` → pivote a 0, tienda viva |
| 6 | Sin rol / `updated_at` / trigger | `$queryRaw` a `information_schema.columns` → `{user_id, shop_id, created_at}`; `pg_trigger WHERE NOT tgisinternal AND tgrelid = 'shop_staff'::regclass` → 0 |
| 7 | Singleton | `prisma.becomeSeller.count()` → 1, `id` = 1 |
| 8 | CHECK de fila única | `prisma.$executeRaw` **tagged template, sentencia 100 % literal y sin interpolación** (la forma tagged no acepta sentencia armada): `INSERT INTO become_seller (id, page_options, commissions) VALUES (2, '{}'::jsonb, '[]'::jsonb)` → `rejects.toThrow(/become_seller_fila_unica/)`. Id 2, no 1: prueba la CHECK, no la PK |
| 9 | Las 2 colecciones | `Object.keys(row.pageOptions as Record<string, unknown>)` = 24, incluido `defaultCommissionRate`; `(row.commissions as unknown[])` de longitud 2; ninguno anidado en el otro |
| 10 | Reloj sin update | `updatedAt.getTime() === createdAt.getTime()` |
| 11 | Sin trigger | `pg_trigger` sobre `become_seller` → 0 |
| 12 | Mapper del pivote (`…data-layer/spec.md:54-59`) | `_toShopStaffRecord(fila)` → `typeof userId`/`shopId === 'number'`, sin `updatedAt`, `JSON.stringify(...)` `not.toThrow()` |
| 13 | Mapper del singleton (`:61-66`) | `_toBecomeSellerRecord(fila)` → `pageOptions` y `commissions` sueltos |

**Los aserts sobre `jsonb` necesitan narrowing explícito**: una columna `Json`
requerida se genera como `runtime.JsonValue`
(`…/generated/prisma/client/models/Setting.ts:180`), no asignable a
`Object.keys(o: object)`; con `"strict": true` (`packages/db/tsconfig.json:7`)
fallaría el `npm run typecheck` que `db-check` corre **antes** de vitest
(`justfile:343-345`). De ahí los `as` de arriba, acotados al test y nunca
`as any`.

**Los tests 12 y 13 cierran `extended-identity-data-layer`**: sin ellos los dos
mappers embarcarían con cobertura cero (el resto de `_to*Record` se ejercita vía
repositorio, y aquí no hay ninguno por diseño). Importan
`{ _toShopStaffRecord, _toBecomeSellerRecord }` de `'../records'`, leen la fila
con `prisma.shopStaff.findFirst` / `prisma.becomeSeller.findUniqueOrThrow` y la
mapean: siguen siendo de esquema, sin crear repositorio alguno.

**No regresión que declarar**: sembrar `shop_staff` **no** concede el permiso
`staff` (id 4) a nadie, así que `users.integration.test.ts:153-158`
(`permissionName: 'staff'` → `total` 0) sigue verde: el permiso global vive en
`permission_user`; la relación por tienda, en `shop_staff`.

---

## Migration / Rollout

No hay migración de datos: el repo no tiene migraciones incrementales y el seed
es determinista. `just db-reset` es **destructivo** (`docker compose down -v`,
`justfile:322-324`) y ya invoca `db-up` → `db-migrate`; **autorizado por el
dueño el 2026-09-15 solo para esta US** (la de 2026-09-14 no es heredable).

| # | Paso | Falla ⇒ |
|---|---|---|
| 1 | DDL: bloque tras `:435` + índice tras `:474` (D-1, D-2) | `git checkout -- db/schema.sql` |
| 2 | `db/generate-seed.mjs` (6 cambios) + `just db-seed-generate` | El script aborta listando `problemas`; corregir y repetir |
| 3 | `just db-reset` | `ON_ERROR_STOP=1`: si `psql` aborta, el error está en 1 o 2 |
| 4 | Conteos por `psql`: **198**/**83**, **12**, **3**, **1200**, **3** `shop_staff` (ninguna con `user_id = 1`), **1** `become_seller` con `jsonb_array_length(commissions) = 2`; `pg_trigger WHERE NOT tgisinternal` → **0** | Si no cuadra, NO continuar; repetir o revertir 1-2 |
| 5 | `npx prisma db pull` + clasificar el diff | **Parada condicional**: cosmético/esperado ⇒ seguir; semántico ⇒ STOP |
| 6 | `records.ts` + `index.ts` | `git checkout --` de ambos |
| 7 | `just db-build` | Sin esto el typecheck no ve `prisma.shopStaff` ni los tipos |
| 8 | Las 2 suites nuevas + re-citas de D-1 | `git checkout --` del archivo |
| 9 | `db/README.md` (subsección tras `:83`) | — |
| 10 | `just db-check`, `cd apps/api/rest && npx jest`, y el `SELECT count(*)` externo antes/después del paso 4 (`users.integration.test.ts:366-371` explica por qué va fuera de la suite) | — |

**Rollback**: `git checkout -- db/ packages/db/` (o `git revert`) → `just
db-reset` con el `schema.sql` restaurado → `npx prisma db pull` (misma
clasificación) → `just db-build` → `just db-check`. Estado conocido-bueno:
198/83, 12, 3, 1200 y 10 archivos / 210 tests.

---

## Open Questions

Ninguna que bloquee. Cinco matices del código sobre los artefactos de entrada,
ya incorporados arriba:

1. **`db pull` añade 2 back-relations a modelos EXISTENTES**: `proposal.md:192-200`
   solo contempla modelos nuevos, así que el paso 5 pararía por un cambio
   obligatorio.
2. **Insertar el DDL "donde toca" rompe 15 de 16 citas `db/schema.sql:N`**; D-1
   lo deja en 2.
3. **`BecomeSellerRecord.id` no usa `_id()`**: es `smallint` → `Int`.
4. **La base de 10 archivos incluye `src/slug.integration.test.ts`**, fuera de
   `src/repositories/`.
5. **Los aserts sobre `jsonb` no compilan sin narrowing** con `strict: true`.
