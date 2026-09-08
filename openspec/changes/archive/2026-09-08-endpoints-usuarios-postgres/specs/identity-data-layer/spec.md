# Delta for Identity Data Layer

> Texto actual en `openspec/specs/identity-data-layer/spec.md:91-98`, citado
> antes de editar:
>
> ```
> ### Requirement: Las tres escrituras de identidad de esta US
>
> El sistema MUST exponer exactamente tres escrituras: crear usuario (con
> perfil y permisos iniciales), actualizar el hash de contraseña, y
> activar/desactivar (`isActive`). `grantPermission` (asignar un permiso a un
> usuario existente, p. ej. `make-admin`) MUST NOT formar parte de esta
> capability — es de US-25 (D-3), que ya declara que volverá a tocar este
> mismo archivo.
> ```

## ADDED Requirements

### Requirement: Listado paginado con relaciones para los listados de administración

El sistema MUST exponer `listUsersWithRelations(input)` con el mismo filtro
que `listUsers` (`permissionName`, `text`, vía el helper `_usersWhere`
compartido) pero devolviendo `{ items: UserWithRelations[], total: number }`
— cada ítem con `profile` y `permissions[]` incluidos (mismo `include` que
`findUserWithRelations`), sin N+1. Esta función existe porque los seis
listados de administración (`GET /api/users`, `admin/list`, `vendors/list`,
`customers/list`, `my-staffs`, `all-staffs`) renderizan avatar y chips de
permiso por fila, no solo el registro plano de `users`.

#### Scenario: Filtrar por permiso trae relaciones incluidas

- GIVEN usuarios con distintos permisos sembrados
- WHEN se llama `listUsersWithRelations({ permissionName: 'customer' })`
- THEN cada ítem de `items` incluye su `profile` y su(s) `permissions[]`, sin consultas adicionales por ítem

#### Scenario: Un permiso sin titulares devuelve total 0, no un error

- GIVEN que ningún usuario sembrado tiene el permiso `staff`
- WHEN se llama `listUsersWithRelations({ permissionName: 'staff' })`
- THEN el resultado es `{ items: [], total: 0 }`

### Requirement: Concesión de permiso idempotente

El sistema MUST exponer `grantPermission(userId, permissionName)`, que
asocia el permiso al usuario en `permission_user`. Conceder un permiso que
el usuario ya posee MUST tener éxito sin crear una fila duplicada y MUST
ser seguro de repetir cualquier número de veces (garantía observable; el
mecanismo concreto —p. ej. un `upsert` sobre la clave compuesta— es
decisión del diseño, no de esta spec). La función MUST NOT aplicar ninguna
regla de autorización (quién puede conceder qué permiso a quién) — esa
lógica es responsabilidad exclusiva del caller (D-1: el repositorio son
funciones planas, sin reglas de dominio). Un `permissionName` que no existe
en el catálogo `permissions` MUST fallar con un error de dominio
(`UnknownPermissionError`), MUST NOT dejar una fila huérfana ni propagar el
error crudo de Prisma.

#### Scenario: Conceder un permiso nuevo

- GIVEN un usuario sin el permiso `store_owner`
- WHEN se llama `grantPermission(userId, 'store_owner')`
- THEN `findUserWithRelations(userId)` incluye `store_owner` entre sus `permissions[]`

#### Scenario: Conceder un permiso ya poseído es idempotente

- GIVEN un usuario que ya tiene el permiso `store_owner`
- WHEN se llama `grantPermission(userId, 'store_owner')` una segunda vez
- THEN no se lanza error y `permission_user` no gana una fila duplicada para ese par

#### Scenario: Un nombre de permiso inexistente falla como error de dominio

- GIVEN un `permissionName` que no existe en el catálogo `permissions`
- WHEN se llama `grantPermission(userId, permissionName)`
- THEN la llamada falla con `UnknownPermissionError`, no con un error crudo de Prisma (P2003/P2025)

## MODIFIED Requirements

### Requirement: Las cuatro escrituras de identidad de esta capability

El sistema MUST exponer exactamente cuatro escrituras: crear usuario (con
perfil y permisos iniciales), actualizar el hash de contraseña,
activar/desactivar (`isActive`), y conceder un permiso a un usuario
existente (`grantPermission`, consumido por `make-admin` de US-25).

(Previously: exactamente tres escrituras; `grantPermission` estaba
explícitamente excluido de esta capability y diferido a US-25.)

#### Scenario: Crear usuario con perfil y permiso inicial

- GIVEN un email no usado
- WHEN se llama `createUser` con `name`, `email`, `passwordHash` y un permiso inicial
- THEN el `UserRecord` devuelto existe en `users`, su `profile` en `profiles`, y su permiso en `permission_user`

#### Scenario: Actualizar el hash de contraseña

- GIVEN un usuario existente
- WHEN se llama `updateUserPasswordHash(id, nuevoHash)`
- THEN `findUserCredentialsByEmail` de ese usuario devuelve `passwordHash === nuevoHash`

#### Scenario: Activar y desactivar un usuario

- GIVEN un usuario con `isActive = true`
- WHEN se llama `setUserActive(id, false)` y luego `setUserActive(id, true)`
- THEN cada llamada devuelve el `UserRecord` con el `isActive` correspondiente

#### Scenario: Conceder un permiso es la cuarta escritura

- GIVEN el inventario de funciones de escritura de `users.repository.ts`
- WHEN se cuentan las exportadas por `packages/db/index.ts`
- THEN son exactamente cuatro: `createUser`, `updateUserPasswordHash`, `setUserActive`, `grantPermission`

## Notas de alcance (no estándar, informativas)

`openspec/specs/identity-data-layer/spec.md` sección "Out of Scope" lista
hoy `grantPermission`/asignar `staff` a un usuario` como excluido de esta
capability y diferido a US-25. Ese cambio de alcance queda reflejado en el
ADDED/MODIFIED de arriba; el archivo mergeado ya no debe listar
`grantPermission` como fuera de alcance.
