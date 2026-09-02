# US-25 — Endpoints de usuarios y staff desde Postgres

> Cierra el épico: los 7 controladores de `users.controller.ts` dejan de leer
> `users.json` con `fuse.js` y pasan a la base, con los permisos que US-23
> introdujo. Es también la US que desbloquea el `getStaffs` que US-5 dejó
> declarado como imposible.

**Épico:** [Épico 19](./README.md)
**Fecha:** 2026-08-31
**Status:** Listo para ejecución
**Depende de:** US-21, US-23
**LOC est.:** ~420

## Historia
**Como** administrador del marketplace, **quiero** que la lista de usuarios,
vendedores y clientes salga de la base, **para** que administrar usuarios deje
de ser una vista de tres registros congelados que ninguna acción modifica.

## Contexto

- `users.service.ts` carga los 3 usuarios de `users.json` y busca con
  `fuse.js` en memoria. `create()` devuelve `this.users[0]` sin crear nada.
- `users.controller.ts` expone **7 controladores**: `users` (CRUD +
  `block-user`, `unblock-user`, `make-admin`), `profiles`, `admin/list`,
  `vendors/list`, `my-staffs`, `all-staffs` y `customers/list`.
- **US-5 declaró `getStaffs` fuera de alcance** por escrito: *"no existe tabla
  de usuarios/staff — es dominio transaccional, de otro épico"*
  ([5-endpoints-derivados-postgres.md:53](../1-catalogo-desde-postgres/5-endpoints-derivados-postgres.md#L53)).
  Este es ese épico.
- US-21 dejó `listUsers` paginado con filtro por permiso y búsqueda, y las
  escrituras de activación/desactivación.
- La base trae **3** usuarios. Las listas van a ser cortas: `admin/list`
  devolverá 1, `customers/list` 1, `vendors/list` 1. Es el dato real, no un
  fallo de la migración — y hay que decirlo en el reporte para que nadie lo
  confunda con una regresión.
- El shape de paginación estilo Laravel (`data`, `total`, `current_page`, …)
  es contrato: el admin lo consume para su scroll (R-1 del Épico 1).

## Scope

**Incluye:** migrar los 7 controladores a `@safari/db`; implementar
`block-user`, `unblock-user` y `make-admin` como escrituras reales; aplicar
`@Permissions()` a todo el módulo; y eliminar los imports de `users.json` que
queden huérfanos.

**NO incluye:** `create`/`update`/`delete` de perfiles más allá de lo que la
tabla `profiles` de US-20 soporta, wallets, direcciones, órdenes,
`ownership-transfer`, `become-seller`, ni ningún cambio en el frontend.

## Criterios de aceptación

### CA-1 — Listado paginado desde la base
`GET /api/users` devuelve los usuarios de Postgres con el envoltorio de
paginación intacto, y la búsqueda por texto filtra por nombre o email.

### CA-2 — Listas por rol
`admin/list`, `vendors/list`, `customers/list`, `my-staffs` y `all-staffs`
filtran por el permiso correspondiente contra la base. Las cifras cortas (1
por lista con el seed actual) se declaran como dato real en el reporte.

### CA-3 — Detalle y perfil
`GET /api/users/:id` devuelve el usuario con su perfil, permisos y tiendas.
Un id inexistente devuelve **404**, no `undefined` ni 500.

### CA-4 — Bloqueo y promoción persisten
`block-user` y `unblock-user` cambian `is_active` en la base, y el efecto es
verificable: un usuario bloqueado no puede iniciar sesión (CA-2 de US-22).
`make-admin` concede el permiso `super_admin` y el cambio se refleja en el
siguiente login.

### CA-5 — Protegido por permisos
Todo el módulo exige permiso de administración. Un token de `customer` recibe
**403**. Sin token, **401**.

### CA-6 — Contratos preservados y sin mock huérfano
Las claves y el casing no cambian. Los imports de `users.json` y el índice de
`fuse.js` desaparecen del servicio; si algún método fuera de esta US los
sigue necesitando, se declara cuál y por qué.

## Escenarios Gherkin

```gherkin
Feature: Usuarios y staff desde Postgres
  Scenario: CA-1 — listado paginado
    Given un token con permiso super_admin
    When se consulta GET /api/users
    Then la respuesta conserva el envoltorio de paginacion del mock
    And los usuarios son los de la base

  Scenario: CA-3 — usuario inexistente
    Given un token con permiso super_admin
    When se consulta GET /api/users/99999
    Then la respuesta es 404

  Scenario: CA-4 — el bloqueo tiene efecto real
    Given un usuario activo con credenciales validas
    When un admin lo bloquea
    And ese usuario intenta iniciar sesion
    Then la respuesta es 401

  Scenario: CA-5 — un cliente no lista usuarios
    Given un token con permiso customer
    When se consulta GET /api/users
    Then la respuesta es 403
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `apps/api/rest/src/users/users.service.ts` | migrar los 7 controladores a `@safari/db`; quitar `fuse.js` y el JSON |
| `apps/api/rest/src/users/users.controller.ts` | anotar con `@Permissions()` |
| `packages/db/src/repositories/users.repository.ts` | lo que falte para las listas por rol y `make-admin` |
| `packages/db/src/repositories/users.integration.test.ts` | cobertura de lo anterior |

## Definición de Done

- [ ] `curl` pegado de los 7 grupos de rutas con token de admin, mostrando
      datos de la base y el envoltorio de paginación intacto.
- [ ] Comparación de key-sets mock vs Postgres para `GET /api/users` y
      `GET /api/users/:id`, con las divergencias declaradas.
- [ ] `curl` pegado de la secuencia de CA-4: bloquear → login (401) →
      desbloquear → login (200).
- [ ] `curl` pegado de CA-5: sin token (401) y con token de `customer` (403).
- [ ] `just db-check` verde con los tests nuevos, recuento pegado.
- [ ] `just build-api` limpio y `just verify` verde.
- [ ] Nota explícita en el reporte sobre las cifras de las listas (3 usuarios
      en total), para que no se lea como regresión.
- [ ] Status de esta US actualizado, fila del épico marcada y **épico cerrado**.

## Notas para el agente ejecutor

- **`make-admin` es una escalada de privilegios.** Debe exigir `super_admin`,
  nunca `store_owner`, y no debe permitir que un usuario se promocione a sí
  mismo sin serlo ya. Es el endpoint más sensible del épico.
- **Un admin no debería poder bloquearse a sí mismo** ni bloquear al último
  `super_admin` que queda: dejaría el panel inaccesible sin forma de
  recuperarlo salvo `just db-reset`. Implementar la guarda o, si se decide no
  hacerlo, declararlo explícitamente en el reporte.
- Recordar que `make-admin` concede un permiso que **el guard lee del token**
  (D-5 del épico): el usuario promovido no ve el cambio hasta que vuelve a
  iniciar sesión. Documentarlo; no añadir consultas a la base en el guard para
  taparlo.
- El shape de paginación se reproduce con el `buildPaginator` de
  `packages/db`, igual que en las US del Épico 1. No escribir uno nuevo.
- `become-seller` y `ownership-transfer` son módulos aparte que tocan usuarios
  y siguen siendo mock. **No se tocan** aunque queden a un import de distancia:
  se mencionan en el reporte final.
- Al cerrar esta US, actualizar también la nota del "NO incluye" de US-5 si
  procede: el `getStaffs` que aquella declaró imposible ya tiene tabla.
