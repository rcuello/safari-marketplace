# Delta for Identity Schema

> **Nota de convención — leer antes de archivar.** `openspec-convention.md`
> solo define secciones de delta para `## ADDED/MODIFIED/REMOVED/RENAMED
> Requirements`; no define un mecanismo de merge para prosa de cabecera
> (`Out of Scope`). Este cambio solo toca esa línea de prosa, no un
> `Requirement`. Precedente ya aplicado en este repo:
> `archive/2026-08-31-endpoints-derivados-postgres/specs/
> flat-catalogs-api/spec.md` (US-5), donde `sdd-archive` aplicó el
> reemplazo a mano y lo registró en el archive report. Este delta sigue el
> mismo patrón con la sección no estándar de abajo.

## MODIFIED Out of Scope (no-estándar — ver nota arriba)

Reemplaza la lista completa de `## Out of Scope` de
`openspec/specs/identity-schema/spec.md`:

> `apps/api/rest` (US-22) · wallets, direcciones, órdenes, reviews ·
> `apps/README.md` (D-2, hand-off a US-22) · `services/scraper-worker/**` ·
> frontends · `test_pipeline.py` (US-6, ajeno) · repositorios de
> `password_reset_tokens`/`otp_codes` (US-24 — sus **modelos** Prisma sí se
> introspeccionan en `capa-datos-identidad`/US-21 para que el gate de drift
> cierre en verde; sus repositorios siguen sin consumidor) ·
> `grantPermission`/asignar `staff` a un usuario (US-25).

(Previously: la lista excluía `packages/db`/Prisma en bloque, marcado como
"US-21", sin distinguir modelos de repositorios. `capa-datos-identidad`
(US-21) sí trae `packages/db`/Prisma: los 6 modelos de identidad entran por
introspección y `users.repository.ts` queda tipado sobre `users`/
`profiles`/`permissions`/`permission_user`. Lo que sigue fuera de alcance
son los repositorios de `password_reset_tokens`/`otp_codes` — solo sus
modelos entran, no su lógica de consumo — y `grantPermission`, ambos
reservados para US-24/US-25 respectivamente.)
