# Delta for Authorization Guards Api

> Texto actual en `openspec/specs/authorization-guards-api/spec.md:47-76`,
> citado antes de editar:
>
> ```
> ### Requirement: Las 250 rutas se clasifican en cuatro buckets verificables
>
> El sistema MUST clasificar las 250 rutas en exactamente cuatro buckets, y
> su suma MUST ser 250:
>
> | Bucket | Anotación | # |
> |---|---|---|
> | Pública | `@Public()` | 64 |
> | Autenticada | ninguna (token válido basta) | 63 |
> | Con permiso | `@Permissions(...)` | 117 |
> | Especial | `web-hook` público + `profiles` sin anotar | 6 |
>
> Los permisos usados MUST ser únicamente los 4 existentes: `super_admin`,
> `store_owner`, `staff`, `customer`. Dentro de "Especial": las 3 GET de
> `web-hook` (Stripe, Razorpay, PayPal) MUST llevar `@Public()` con comentario
> sobre la llamada de terceros sin JWT (firma fuera de alcance, D-7); las 3
> `profiles` (stubs muertos) MUST quedar sin anotar, cayendo en el
> deny-by-default sin que el sistema elimine el controller.
>
> #### Scenario: El inventario cuadra con las rutas medidas
>
> - GIVEN el parser que cuenta decoradores HTTP por `@Controller`
> - WHEN se suman las anotaciones de los cuatro buckets
> - THEN el total es 250, igual al conteo estructural independiente
>
> #### Scenario: Un webhook responde sin token, profiles no
>
> - WHEN `GET /api/web-hook/stripe` y `POST /api/profiles` se llaman sin `Authorization`
> - THEN el webhook no es `401` y `profiles` sí lo es, por ausencia de anotación
>
> ### Requirement: Las rutas de administración exigen el permiso equivalente
>
> Las 117 rutas "Con permiso" (`/api/users`, todo `*/list`, escrituras de
> catálogo/tiendas/cupones/taxes, moderación) MUST llevar `@Permissions()`
> con el conjunto correspondiente (`[super_admin]`, `[super_admin,
> store_owner]` o `[super_admin, store_owner, staff]`, `auth-utils.ts:13-18`).
> Un token con únicamente `customer` MUST recibir `403`, nunca `200`.
>
> #### Scenario: customer no lista usuarios, admin sí escribe
>
> - GIVEN un token `customer` y otro `super_admin`
> - WHEN el primero hace `GET /api/users` o `*/list`, y el segundo escribe sobre el catálogo
> - THEN el primero recibe `403` y el segundo no es rechazado por autorización
> ```

## MODIFIED Requirements

### Requirement: Las 250 rutas se clasifican en cuatro buckets verificables

El sistema MUST clasificar las 250 rutas en exactamente cuatro buckets, y
su suma MUST ser 250:

| Bucket | Anotación | # |
|---|---|---|
| Pública | `@Public()` | 64 |
| Autenticada | ninguna (token válido basta) | 63 |
| Con permiso | `@Permissions(...)` | 120 |
| Especial | `web-hook` público | 3 |

Los permisos usados MUST ser únicamente los 4 existentes: `super_admin`,
`store_owner`, `staff`, `customer`. Dentro de "Especial": las 3 GET de
`web-hook` (Stripe, Razorpay, PayPal) MUST llevar `@Public()` con comentario
sobre la llamada de terceros sin JWT (firma fuera de alcance, D-7). Las 3
rutas de `profiles` (`POST /`, `PUT /:id`, `DELETE /:id`), único grupo del
módulo de usuarios sin `@Permissions()` hasta esta US, MUST llevar
`@Permissions(...ADMIN_ONLY)` — salen del bucket "Especial" y entran al
bucket "Con permiso", cerrando el único hueco de anotación que quedaba en
`users.controller.ts`.

(Previously: bucket "Con permiso" en 117, bucket "Especial" en 6 —
`profiles` caía en deny-by-default sin `@Permissions()` propio, junto a
`web-hook`.)

#### Scenario: El inventario cuadra con las rutas medidas

- GIVEN el parser que cuenta decoradores HTTP por `@Controller`
- WHEN se suman las anotaciones de los cuatro buckets
- THEN el total es 250, igual al conteo estructural independiente

#### Scenario: Un webhook responde sin token, profiles no

- WHEN `GET /api/web-hook/stripe` y `POST /api/profiles` se llaman sin `Authorization`
- THEN el webhook no es `401` y `profiles` sí lo es

#### Scenario: profiles con token customer ya no entra, solo con permiso admin

- GIVEN un token `customer` y otro `super_admin`
- WHEN ambos hacen `POST /api/profiles`
- THEN el primero recibe `403` y el segundo no es rechazado por autorización

### Requirement: Las rutas de administración exigen el permiso equivalente

Las 120 rutas "Con permiso" (`/api/users`, `/api/profiles`, todo `*/list`,
escrituras de catálogo/tiendas/cupones/taxes, moderación) MUST llevar
`@Permissions()` con el conjunto correspondiente (`[super_admin]`,
`[super_admin, store_owner]` o `[super_admin, store_owner, staff]`,
`auth-utils.ts:13-18`). Un token con únicamente `customer` MUST recibir
`403`, nunca `200`.

(Previously: 117 rutas "Con permiso"; `/api/profiles` no estaba entre
ellas.)

#### Scenario: customer no lista usuarios, admin sí escribe

- GIVEN un token `customer` y otro `super_admin`
- WHEN el primero hace `GET /api/users` o `*/list`, y el segundo escribe sobre el catálogo
- THEN el primero recibe `403` y el segundo no es rechazado por autorización

## Notas de alcance (no estándar, informativas)

`auth-jwt-api` (`openspec/specs/auth-jwt-api/spec.md`) NO se modifica por
este change: la extracción de los mappers de `auth.service.ts` a un archivo
neutral (`user-dto.mapper.ts`) es un refactor puro sin cambio de contrato —
`/me` (único call site de `toMeDto`, `auth.service.ts:525`) sigue
publicando el mismo shape. `otpLogin` no consume estos mappers. Si
`sdd-verify` detecta una divergencia de key-set en `/me`, es una regresión
de este change, no un requisito nuevo a especificar aquí.
