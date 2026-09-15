# Proposal: Esquema y capa de datos de identidad extendida (US-41)

## Intent

El Épico 40 necesita dos tablas que no existen: la relación staff↔tienda
(`ShopsService.getStaffs` devuelve `{ data: [] }` literal,
`apps/api/rest/src/shops/shops.service.ts:220-226`) y el singleton de
`become-seller` (JSON estático servido verbatim,
`apps/api/rest/src/become-seller/become-seller.service.ts:8,18-20`). Sin
migraciones incrementales, todo el DDL del épico entra aquí para gastar **un
solo `just db-reset`** (decisión 2), autorizado por el dueño el 2026-09-15
(decisión 3; `41-esquema-identidad-extendida.md:142-145`). US-42 y US-44
quedan desbloqueadas sin volver a tocar DDL.

## Scope

### In Scope

1. DDL de `shop_staff` y `become_seller` en `db/schema.sql` + sus índices.
2. Seed de ambas: `become_seller` generado desde el mock por
   `db/generate-seed.mjs`; `shop_staff` inventado y validado (no hay mock).
3. `just db-reset` con los conteos verificados.
4. Re-introspección `prisma db pull` + reaplicación manual de renombres.
5. `ShopStaffRecord` / `BecomeSellerRecord` + mappers en
   `packages/db/src/records.ts`; exportación por `packages/db/index.ts`.
6. Tests de integración **de esquema** (FK, CASCADE, CHECK, conteos).
7. `db/README.md`: el modelo nuevo en su sección "Identidad" (`:42-83`).

### Out of Scope (vinculante — el "NO incluye" de la US)

- Repositorios de funciones planas y sus tests de caso de uso (US-42, US-44).
- Cualquier servicio, controlador, DTO o guard de Nest.
- Tablas `balance`/`withdraws`/`ownership_transfers` (US-43 bloqueada, 1b).
- Levantar la exclusión de `db/schema.sql:13-16`. Frontend.
- Cualquier trigger de `updated_at` sobre las tablas nuevas (CA-3).

## Capabilities

### New Capabilities

- `extended-identity-schema`: DDL y seed de `shop_staff` y `become_seller`
  (PK compuesta, CASCADE, CHECK de fila única, conteos intactos).
- `extended-identity-data-layer`: modelos introspectados + renombres, `*Record`
  y mappers, barrel.

Espejo del par ya existente `identity-schema` / `identity-data-layer`.

### Modified Capabilities

- `data-layer-clock-policy`: delta ADDED — las tablas nuevas nacen sin trigger
  y la PRIMERA ruta de update sobre `become_seller` (llega en US-44) MUST fijar
  `updatedAt: now()` desde `clock.ts`. Mismo patrón que la requirement de
  `profiles` (`openspec/specs/data-layer-clock-policy/spec.md:101-109`).
  `shop_staff` no tiene `updated_at`: la política no lo gobierna.

## Approach

### a. Pivote staff — se copia `permission_user` verbatim

`db/schema.sql:173-178` (verificado): PK compuesta, ambas FK
`ON DELETE CASCADE`, **solo `created_at`**.

```sql
CREATE TABLE IF NOT EXISTS shop_staff (
    user_id     bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id     bigint       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, shop_id)
);
```

Sin `updated_at`: un pivote puro se crea o se borra, no se actualiza (igual que
`permission_user`, `category_product`, `product_tag`); nada que gobernar por la
política de reloj. Se indexan **ambos lados**: la PK cubre `user_id`, y
`shop_staff_tienda_idx ON shop_staff (shop_id)` cubre el filtro real de
`GetStaffsDto` (`apps/api/rest/src/shops/dto/get-staffs.dto.ts:3-7`), con el
nombre de `permission_user_permiso_idx` (`db/schema.sql:472`).

### b. Pivote **bare**, sin columna de rol — se adopta la recomendación

Cuatro fuentes confirmadas: `StaffsController.getStaffs` devuelve
`UserPaginator` —usuarios, no filas de pivote— (`shops.controller.ts:108-111`);
`AddStaffInput = {email,password,name,shop_id}`
(`apps/admin/rest/src/types/index.ts:1562-1567`); `StaffList` pinta
`name/email/is_active` (`staff-list.tsx:54-104`); y `users` **no tiene columna
`shop_id`** (`db/schema.sql:116-125`; el del mock es siempre `null`). Una
columna `role` sería especulativa. Divergencia anotada: el título de CA-1 y
D-2 dicen "con rol"; el código no lo respalda y aquí gana el código.

### c. Singleton `become_seller` — **dos** columnas `jsonb`

Verificado con `node -e`: el JSON tiene dos claves top-level, `page_options` y
`commissions` (array de 2 tiers con `id/level/sub_level/description/
min_balance/max_balance/commission/image/language/timestamps`), y
`plainToClass` sin `excludeExtraneousValues` las sirve ambas.

```sql
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

Calco de `settings` (`db/schema.sql:73-80`). `page_options` guarda el
**contenido anidado** (`data.page_options.page_options`, 24 claves), de modo
que US-44 recompone `{ page_options: {id, page_options, language, created_at,
updated_at}, commissions }` sin inventar nada. **Una sola columna rompería
US-44**: su CA-1 exige el `GET` byte a byte y `commissions` no cabe bajo un
nombre que miente sin anidarla a mano; descubrir el fallo en US-44 obligaría a
un **segundo `db-reset`**, justo lo que la decisión 2 prohíbe.

### d. Seed de staff inventado — 3 filas, deterministas

Verificado en `psql` (read-only): users `1 store_owner / 2 customer /
3 admin`; **las 12 tiendas tienen `owner_id = 1`**; shops `1 furniture-shop`,
`2 clothing-shop`. El usuario 1 queda **excluido**: dueño y staff de la misma
tienda es una contradicción que el DDL no prohíbe pero el seed no debe modelar.

| user_id | shop_id | Por qué |
|---------|---------|---------|
| 2 | 1 | usuario staff de dos tiendas (Gherkin CA-1) |
| 2 | 2 | ídem |
| 3 | 1 | tienda con dos staff (Gherkin CA-1 de US-42) |

**Exactamente 3 filas.** Cifra fija para que los count-asserts posteriores sean
predecibles. No toca `owner_id` ni ningún conteo vivo.

### e. Naming

| SQL | Prisma | Precedente |
|-----|--------|-----------|
| `shop_staff (user_id, shop_id, created_at)` | `ShopStaff` + `@@map("shop_staff")` | `PermissionUser` (`schema.prisma:278-289`) |
| `become_seller (…)` | `BecomeSeller` + `@@map("become_seller")` | `Setting` (`schema.prisma:41-49`) |
| `become_seller_fila_unica` | — | `settings_fila_unica` (`:79`) |
| `shop_staff_tienda_idx` | — | `permission_user_permiso_idx` (`:472`) |

**Discrepancia documental**: la US manda revisar "la tabla de nomenclatura" de
`db/README.md`; ese archivo (131 líneas, 5 secciones) **no contiene ninguna**.
La convención real (inglés, snake_case, `_id` en FK, `smallint` para singleton,
sufijo `_idx`) se infiere de `db/schema.sql`.

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `db/schema.sql` | Modified | 2 `CREATE TABLE` + 1 índice, con banner |
| `db/seed.sql` (generado) | Modified | 2 bloques nuevos |
| `db/generate-seed.mjs` | Modified | `leer('become-seller')` + 2 `json(...)`; array del pivote |
| `db/README.md` | Modified | el modelo nuevo |
| `packages/db/prisma/schema.prisma` | Modified | 2 modelos + renombres en los 15 existentes |
| `packages/db/src/records.ts` | Modified | 2 `*Record` + 2 mappers |
| `packages/db/index.ts` | Modified | barrel |
| `packages/db/src/repositories/*.integration.test.ts` | New | 2 suites de esquema |

**LOC**: la US estima ~700 y el alcance real cabe, pero el sesgo medido del
repo es a la baja (Épico 26 ×2.0–×4.6, US-32 ×5). Previsión para `sdd-tasks`:
**700–1400 LOC**, con el riesgo en el diff de re-introspección y las suites.

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| `prisma db pull` pisa los 15 modelos existentes | Alta | Checklist previo: cabecera `:1-29`, `previewFeatures=["partialIndexes"]`, `datasource` sin `url`, `@@map`/`@map`, `User.email` sin `@unique` |
| `db-reset` altera un conteo vivo | Baja | Asserts en `categories.integration.test.ts:61,66,114,703` y `shops.integration.test.ts:51,125,480`; se comparan antes/después |
| Rechazo de la decisión (c) en revisión | Media | Evidencia citada arriba; alternativa (1 columna) documentada y descartada |
| `commissions` se queda fuera del seed | Media | Test de esquema que assert `jsonb_array_length(commissions) = 2` |
| Seed de staff arbitrario | Alta (aceptada) | 3 filas declaradas aquí; no reutiliza `owner_id = 1` |

## Rollback Plan

`just db-reset` es destructivo (borra el volumen). **Autorizado por el dueño el
2026-09-15**, solo para esta US (decisión 3 del épico; la autorización de
2026-09-14 cubría por nombre US-32/US-34 y este repo la declara no heredable).

Revertir, en orden:

1. `git checkout -- db/ packages/db/` (o `git revert` del commit si ya está en la rama).
2. `just db-reset` con el `schema.sql` restaurado: reconstruye el estado previo desde cero, no hay migración que deshacer.
3. `just db-build` (regenera `dist/` y `generated/`, gitignored).
4. `just db-check`.

**Estado conocido-bueno** (verificado hoy en `psql`, read-only): 198
categorías / 83 raíces, 12 shops (`owner_id = 1` en las 12), 3 users, 1200
products; `just db-check` en **10 archivos / 210 tests** en verde. Si tras el
revert alguna cifra no cuadra, el problema no es este change.

### Clasificación del diff de `schema.prisma` (paso de US-32)

- **Cosmético, esperado**: renombres reaplicados, cabecera reescrita,
  `previewFeatures`, `datasource` sin `url`, y **2 modelos nuevos**
  (`ShopStaff`, `BecomeSeller`) — no son sorpresa semántica.
- **Semántico, para y se reporta**: un tipo de campo cambiado en cualquiera de
  los 15 modelos existentes, un `@@map`/`@map` perdido, un `@unique` aparecido
  en `User.email`, el índice parcial de `products` degradado a total, o un
  modelo desaparecido/añadido que no sea uno de los dos esperados.

## Dependencies

- Postgres arriba (`just db-up`) y autorización de reset (concedida).
- Ninguna US previa: US-41 no depende de nada.

## Success Criteria

- [ ] `shop_staff` y `become_seller` existen con PK compuesta, CASCADE y CHECK.
- [ ] `psql` demuestra: borrar una tienda arrastra sus `shop_staff` y el usuario sobrevive; la segunda fila de `become_seller` es rechazada.
- [ ] El seed inserta 3 filas en `shop_staff` y 1 en `become_seller`, con `commissions` de longitud 2.
- [ ] Conteos vivos intactos: 198/83, 12, 3, 1200.
- [ ] `git diff packages/db/prisma/schema.prisma` clasificado según la tabla de arriba.
- [ ] `just db-check` verde, ≥ 210 tests.
- [ ] `cd apps/api/rest && npx jest` verde (no debería tocarse: mockea `@safari/db`).
