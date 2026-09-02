# US-21 — Capa de datos de identidad en `@safari/db`

> Exponer las tablas de identidad a través de la misma capa que ya sirve el
> catálogo: modelos Prisma por introspección, `UserRecord`, un repositorio de
> funciones planas y sus tests de integración. Sin tocar la API.

**Épico:** [Épico 19](./README.md)
**Fecha:** 2026-08-31
**Status:** Listo para ejecución
**Depende de:** US-20
**LOC est.:** ~450

## Historia
**Como** servicio de Nest, **quiero** pedir usuarios a `@safari/db` con la
misma forma que pido productos o tiendas, **para** que la migración de
`auth.service.ts` sea un cambio de fuente de datos y no un rediseño.

## Contexto

- `packages/db` ya tiene repositorios para los 7 agregados del catálogo, todos
  con la misma forma: funciones planas exportadas, un `*Record` en
  `src/records.ts` y un `*.integration.test.ts`. El precedente más simple es
  `packages/db/src/repositories/settings.repository.ts`.
- `packages/db/prisma/schema.prisma` **se regenera por introspección**
  (`prisma db pull` + renombres manuales) y nunca genera migraciones. Su
  cabecera documenta qué constraints Prisma no modela y que el preview
  `partialIndexes` no se quita.
- `packages/db` es autónomo (npm, no yarn workspace) y se construye con tsup a
  `dist/` para que Nest lo consuma vía `link:`.
- Los tests de integración corren contra la base real (`just db-check` exige
  `just db-up` antes). Hoy son 6 archivos / 57 tests.

## Scope

**Incluye:** re-introspección del esquema con los modelos de identidad y sus
renombres; `UserRecord` / `ProfileRecord` / `PermissionRecord` en
`src/records.ts`; `users.repository.ts` con las lecturas y escrituras que el
épico necesita; los exports en `packages/db/index.ts`; y
`users.integration.test.ts`.

**NO incluye:** JWT, hashing ni verificación de contraseñas (eso vive en la
API — US-22), los repositorios de tokens de recuperación y OTP (US-24), ni
ningún cambio en `apps/api/rest`.

## Criterios de aceptación

### CA-1 — Modelos introspeccionados, no escritos a mano
`schema.prisma` incorpora `User`, `Profile`, `Permission` y el pivote vía
`prisma db pull`, con los renombres de campos aplicados a mano y la relación
`Shop.owner` cerrada. `prisma validate` no acusa drift.

### CA-2 — Lectura de credenciales aislada
Existe una función dedicada —p. ej. `findUserCredentialsByEmail`— que es **la
única** que devuelve el `password_hash`. El `UserRecord` general no lo lleva
(D-2 del épico). La búsqueda por email es insensible a mayúsculas.

### CA-3 — Lectura del usuario completo
Una función devuelve el usuario por id con su perfil, sus permisos y sus
tiendas, que es exactamente lo que `/me` necesita publicar.

### CA-4 — Escrituras de identidad
El repositorio cubre: crear usuario (con perfil y permisos iniciales),
actualizar el hash de contraseña, y activar/desactivar
(`is_active`) — las tres operaciones que US-22 y US-25 van a consumir.

### CA-5 — Listado paginado
`listUsers` devuelve el envoltorio de paginación estándar de la casa
(`buildPaginator`), con filtro por permiso y búsqueda por nombre o email. Es
lo que alimentará `/api/users`, `/api/customers/list` y compañía en US-25.

### CA-6 — Cobertura de integración
`users.integration.test.ts` cubre cada función contra la base sembrada,
incluyendo: email inexistente devuelve `null`, email con mayúsculas encuentra
al usuario, y el `UserRecord` público **no** contiene el hash.

## Escenarios Gherkin

```gherkin
Feature: Capa de datos de identidad
  Scenario: CA-2 — el hash no se filtra
    Given la base sembrada
    When se pide el usuario admin@demo.com por el lector general
    Then el objeto devuelto no tiene ninguna clave con el hash de la contrasena

  Scenario: CA-2 — email insensible a mayusculas
    Given la base sembrada
    When se buscan las credenciales de "ADMIN@Demo.com"
    Then se devuelve el usuario admin@demo.com

  Scenario: CA-3 — el usuario completo trae sus relaciones
    Given la base sembrada
    When se pide el usuario 1 con relaciones
    Then trae su perfil, sus permisos y las tiendas de las que es dueno
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `packages/db/prisma/schema.prisma` | modelos de identidad por `db pull` + renombres; relación `Shop.owner` |
| `packages/db/src/records.ts` | `UserRecord`, `ProfileRecord`, `PermissionRecord` y sus mappers |
| `packages/db/src/repositories/users.repository.ts` | nuevo: lecturas, escrituras y listado paginado |
| `packages/db/src/repositories/users.integration.test.ts` | nuevo: cobertura de lo anterior |
| `packages/db/index.ts` | exports de tipos y funciones nuevas |
| `packages/db/README.md` | documentar el agregado de identidad |

## Definición de Done

- [ ] `just db-check` verde con los tests nuevos, con el recuento pegado
      (hoy: 6 archivos / 57 tests — debe subir).
- [ ] `prisma validate` sin drift, con la salida pegada.
- [ ] `just db-build` limpio (tsup genera CJS + `.d.ts` sin errores).
- [ ] Salida pegada del test que demuestra que el `UserRecord` público no
      expone el hash (CA-2).
- [ ] `packages/db/README.md` actualizado.
- [ ] Status de esta US actualizado y fila del épico marcada.

## Notas para el agente ejecutor

- **No editar `schema.prisma` a mano para cambiar el modelo.** Si falta algo,
  se corrige `db/schema.sql`, se hace `just db-reset` y se re-introspecciona.
  Es un antipatrón declarado en `docs/product/README.md`.
- **No quitar el preview `partialIndexes`**: el unique parcial de procedencia
  de `products` lo necesita, y `prisma validate` acusaría drift sin él.
- Los ids del catálogo son `BigInt` en Prisma. Revisar cómo lo resolvieron los
  repositorios existentes antes de inventar una conversión propia — el
  contrato HTTP publica números, no strings.
- Recordar la trampa de Windows registrada en memoria: vitest reporta
  "0 tests" si el `cwd` tiene la unidad en minúscula. Si los tests nuevos no
  aparecen, mirar el casing de la ruta antes que la base de datos.
- La verificación de contraseña **no va aquí**. El repositorio devuelve el
  hash; comparar es responsabilidad de la API (US-22). Mantener `bcryptjs`
  fuera de `packages/db`.
