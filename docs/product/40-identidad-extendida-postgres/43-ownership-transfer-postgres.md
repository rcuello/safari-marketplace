# US-43 — `ownership-transfer` desde Postgres

> Las 5 rutas de transferencia de propiedad de tienda. **Bloqueada**: su
> contrato incluye una fila completa de `balance`, que es territorio *wallet*
> y está excluido de `db/schema.sql:13-16`.

**Épico:** [Épico 40](./README.md)
**Fecha:** 2026-09-15
**Status:** **Bloqueada por decisión de producto** — ver «El bloqueo»
**Depende de:** [US-41](./41-esquema-identidad-extendida.md) + decisión del dueño
**LOC est.:** ~1300 (sin dimensionar el coste de `balance`)

## El bloqueo

`apps/api/rest/src/db/pickbazar/ownership-transfer.json` tiene 6 filas cuyas
claves son:

```
id, transaction_identifier, previous_owner, current_owner, message,
created_by, status, order_info, balance_info, refund_info, withdrawal_info
```

`order_info`, `refund_info` y `withdrawal_info` son `null` en el mock, pero
**`balance_info` no**: trae una fila entera de la tabla wallet.

```json
{"id":24,"shop_id":22,"admin_commission_rate":10,"total_earnings":0,
 "withdrawn_amount":0,"current_balance":0,
 "payment_info":"{\"name\":\"1313\",...,\"account\":131313}",
 "created_at":"2024-07-26 03:47:01","updated_at":"2024-08-03 16:19:21"}
```

La regla del repo es preservar el contrato HTTP **byte a byte** al migrar un
endpoint del mock a Postgres (precedente `/api/settings`, 5503 B). Para
emitir `balance_info` desde la base hace falta una tabla de balance, y
*wallets* está nombrado en la exclusión de `db/schema.sql:13`:

> «Fuera de alcance deliberado: wallets, direcciones, órdenes, carritos y
> reviews. […] El resto del dominio transaccional sigue fuera.»

El dueño decidió el **2026-09-14** no levantar esa exclusión hasta que cierre
la Fase 1 (Épico 33). Verificado además que la tabla `shops` no tiene columna
`balance`: es un objeto anidado de la entidad
(`apps/api/rest/src/shops/entities/shop.entity.ts:14,27,33`).

## Qué decisión la desbloquea

Es una decisión del dueño, no de una US. Las tres salidas, con su coste:

| Opción | Qué implica | Coste |
|---|---|---|
| **A — Crear una tabla `balance` mínima** | Levanta parcialmente la exclusión, solo para el balance de tienda. Desbloquea también las 5 rutas de `withdraws` (R-1 del épico). | Decisión escrita del dueño, como US-20 la levantó solo para identidad. DDL extra en US-41 y otro `db-reset`. |
| **B — Emitir `balance_info` como mock declarado** | Las filas de transferencia salen de Postgres; `balance_info` sigue viniendo del JSON. Rompe la pureza de «cero mocks no declarados» dentro de una respuesta ya migrada. | Barato, pero deja una respuesta híbrida — hay que declararlo, no esconderlo. |
| **C — Aplazar la US al corte transaccional** | `ownership-transfer` se va con la Fase 3, donde `balance` se decide junto a órdenes y retiros. | Cero coste hoy. El admin sigue con las 5 rutas en mock, como hoy. |

**Recomendación:** la **C**. La A arrastra el épico a la decisión que se quiso
evitar al promoverlo, y la B deja una respuesta mitad base mitad JSON dentro
de un repo cuyo objetivo declarado es «cero mocks **no declarados**».

## Además: una ruta que el frontend llama y no existe

Independiente del bloqueo, y barato de resolver: el admin declara

```
TRANSFER_SHOP_OWNERSHIP: 'transfer-shop-ownership'
```

en `apps/admin/rest/src/data/client/api-endpoints.ts:102`, y **ninguna ruta
de la API la sirve** (verificado con grep sobre `apps/api/rest/src`). Antes de
crearla hay que comprobar si algún componente la consume de verdad; si no,
lo correcto es retirar la constante. Esto **no** depende de `balance` y puede
resolverse en cualquier momento, incluso como US standalone pequeña.

## Scope (para cuando se desbloquee)

**Incluye:** las 5 rutas de `apps/api/rest/src/ownership-transfer/` leyendo y
escribiendo Postgres; el repositorio y sus tests; la decisión sobre
`transfer-shop-ownership`.

**NO incluye:** `withdraws` (sus 5 rutas siguen mock salvo que la opción A lo
cambie); órdenes, reembolsos ni ningún otro dominio de la Fase 3; frontend.

## Criterios de aceptación (borrador — refinar al desbloquear)

### CA-1 — Las 5 rutas leen y escriben Postgres, contrato intacto
Incluido `balance_info` con la forma exacta que emite hoy el mock, sea cual
sea la opción elegida.

### CA-2 — `previous_owner` y `current_owner` salen de `users`
Son objetos de usuario embebidos: se proyectan desde la tabla ya migrada, sin
duplicar datos de identidad en la tabla de transferencias.

### CA-3 — `transaction_identifier` y `status`
`transaction_identifier` es único por transferencia. El mock solo tiene
`status: "pending"`; hay que determinar el enumerado real antes de escribir
la CHECK.

### CA-4 — La ruta `transfer-shop-ownership`, resuelta
Creada con evidencia de consumidor, o la constante retirada del admin.

## Notas para el agente ejecutor

- **No arrancar esta US sin la decisión del dueño.** Si se elige la opción C,
  esta US se archiva y su contenido se traslada al épico de la Fase 3.
- El enumerado de `status` no se puede inferir del mock (todas las filas son
  `pending`): mirar el admin (`data/ownership-transfer.ts` y sus vistas
  approve/disapprove) antes de escribir la CHECK.
- `created_by` es un id de usuario (`6` en las 6 filas del mock): es una FK,
  no un texto.
