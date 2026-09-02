# Tasks: Esquema de identidad en Postgres (US-20)

## Review Workload Forecast

| Campo | Valor |
|---|---|
| Líneas manuales | ~260-300 (ver `design.md` § File Changes) |
| Líneas generadas (`seed.sql`) | ~90-130, diff aditivo pre-`shops` |
| Chained PRs recommended | No |
| Chain strategy | pending |
| 400-line budget risk | Medium |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

Review real es manual; `seed.sql` en commit aparte (precedente US-5). PR único.

## Fase 1: DDL — `db/schema.sql` (CA-1/CA-2)

- [x] 1.1 6 `CREATE TABLE` (`users`, `profiles`, `permissions`, `permission_user`,
      `password_reset_tokens`, `otp_codes`) tras `:100` (Decision D).
- [x] 1.2 `CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email))` (D-1).
- [x] 1.3 FK inline `shops.owner_id` (~`:119`): `REFERENCES users(id) ON DELETE RESTRICT`,
      `DEFAULT 1` conserva (B, C).
- [x] 1.4 3 índices tras `:352`: `permission_user_permiso_idx`, `password_reset_tokens_user_idx`,
      `otp_codes_phone_idx`.
- [x] 1.5 2 triggers `tocar_updated_at()` tras `:371` en `users`/`profiles`, sin `permissions` (A).
- [x] 1.6 Reescribir comentarios `:13-15` y `:111-112` (C).

## Fase 2: Generador — `db/generate-seed.mjs` (D-5..D-9)

- [x] 2.1 Hash bcrypt `demodemo` (fuera del repo; comando en `design.md`); fijar `HASH_DEMO`,
      regeneración en comentario (E).
- [x] 2.2 `leer('users')` + catálogo 4 permisos + matriz `asignaciones` (`user_id` del usuario
      iterado, nunca `pivot.model_id`) (D-5, D-9).
- [x] 2.3 Extender validación `:65-88`: 5 comprobaciones (F) — `user_id`/`permission_id` del
      pivote, id `staff` libre, `owner_id` de shops existe, emails únicos, prefijo `$2` `HASH_DEMO`.
- [x] 2.4 4 bloques emisión pre-`:140` (`users`→`profiles`→`permissions`→`permission_user`),
      helpers `txt`/`bool`/`json`, `ON CONFLICT` por PK real.
- [x] 2.5 `setval` `:297` + `users`/`permissions`; cabeceras conteo `:106-107`.

## Fase 3: Regeneración y determinismo

- [x] 3.1 `node db/generate-seed.mjs` x2; `cmp` los `seed.sql` — prueba: sin diferencias.
- [x] 3.2 `git diff --stat db/seed.sql` — prueba: solo bloques nuevos pre-`shops`.

## Fase 4: Aplicar y verificar (GATE de confirmación)

- [x] 4.1 **GATE**: confirmar con dueño INMEDIATAMENTE ANTES — `db-reset` borra el volumen (D-10).
      Mitigante: `products WHERE source_store IS NOT NULL` = 0.
- [x] 4.2 `just db-reset 2>&1 | tee db-reset.log`; `grep -iE "error|violat"` — prueba: vacío (CA-5).
- [x] 4.3 `\d` 6 tablas + `pg_constraint` `users` (3 `c` + `shops`=`r`) + `INSERT
      'ADMIN@demo.com'` en `BEGIN/ROLLBACK` — prueba: falla por `users_email_lower_idx` (D-1).
- [x] 4.4 `SELECT` 3 usuarios + conteos `profiles`/`permissions`/`permission_user`/huérfanas +
      matriz — prueba: 3/4/6/0 (CA-3/CA-4).
- [x] 4.5 3 hashes + `bcryptjs.compareSync('demodemo', hash)` — prueba: prefijo `$2` y `true` x3 (CA-4).
- [x] 4.6 `just db-build` (si falta `dist/`) + `just db-check` + conteo `products`/`shops`/
      `categories` — prueba: verde y 1200/12/198 (CA-6).

## Fase 5: Documentación y cierre

- [x] 5.1 `db/README.md`: sección identidad (modelo, matriz, `demodemo`, por qué `lower(email)`
      y `otp_codes` sin FK, sin consumidor hasta US-24) + conteo `:26`.
- [x] 5.2 Reporte final, sin accionar: hand-off US-21 (`WHERE lower(email) = lower($1)`) y US-22
      (documentar `demodemo` en `apps/README.md`).
- [x] 5.3 Reporte final: `just db-test` sigue roto por `test_pipeline.py` (tabla legada
      `productos`), NO por `pipelines.py` (ya migrado) — corrige `CLAUDE.md` (US-6).
- [x] 5.4 Última: `Status` en `20-esquema-identidad-postgres.md` + fila US-20 en
      `docs/product/19-autenticacion-autorizacion/README.md`, tras evidencia.
