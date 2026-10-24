# US-68 — Cupones del seed vigentes

> Desde US-52, `is_valid` se calcula con la vigencia real, y los 10 cupones
> del mock vencieron entre 2024-03 y 2025-05. Con el seed en reposo, las
> páginas `/offers` y `/shops/[slug]/offers` del shop quedan vacías, y ningún
> cupón sirve para probar `POST /coupons/verify` con éxito. Esta US deja
> cupones vigentes en el seed sin volver al `is_valid` literal.

**Épico:** ninguno (US standalone). Nace de V-1 de
[US-52](./46-api-sin-mocks-json/52-coupons-postgres.md).
**Fecha:** 2026-10-22
**Status:** ✅ Completada (2026-10-23), opción (b) +5 años
**Depende de:** US-52 (crea `coupons` y el cálculo de `is_valid`). Toca
`db/generate-seed.mjs` y `db/seed.sql`, compartidos con el Épico 46, así que
**no puede ir en paralelo** con ninguna US de ese épico (R-2): va entre dos de
ellas. Exige `just db-reset`, que hay que **autorizar** para esta US: la
autorización del Épico 46 cubre solo sus 17 US.
**LOC est.:** ~120 si se elige la opción (b) o la (c); ~10 si se elige la (d).

## Historia

**Como** cliente del shop y como quien prueba el checkout en local,
**quiero** que el seed traiga cupones vigentes, **para** ver la página de
ofertas con contenido y poder aplicar un cupón de verdad, sin perder la
vigencia real que introdujo US-52.

## Contexto — verificado en código (2026-10-22)

**Las fechas del mock** (`apps/api/rest/src/db/pickbazar/coupons.json`,
medido con `node -e`):

| id | code | `active_from` | `expire_at` | tienda | mínimo |
|---|---|---|---|---|---|
| 10 | `4OFF` | 2021-03-28 | 2024-03-28 | 1 | 160 |
| 9 | `5OFF` | 2021-03-28 | 2024-06-23 | 2 | 0 |
| 8 | `OFF6` | 2021-03-28 | 2024-07-14 | 3 | 0 |
| 7 | `BAZAR10` | 2021-03-28 | **2025-05-26** | 1 | 0 |
| 6 | `BAZAR20` | 2021-03-27 | 2024-04-26 | 1 | 0 |
| 5 | `BAZAR18` | 2021-03-27 | 2024-04-15 | 2 | 0 |
| 4 | `HELLO15` | 2021-03-27 | 2024-04-23 | 3 | 100 |
| 3 | `EID12` | 2021-03-27 | 2024-05-26 | 1 | 0 |
| 2 | `FOO` | 2021-03-27 | 2024-05-26 | 1 | 0 |
| 1 | `EID2` | 2021-03-10 | 2024-07-27 | 1 | 0 |

Todos empiezan en marzo de 2021 y el que más dura vence el 2025-05-26. Hoy
es 2026-10-22.

**Cómo se siembran:** `db/generate-seed.mjs:853-871` (bloque `coupons`)
copia `active_from` y `expire_at` **tal cual** con `txt()`.

**Cómo se calcula `is_valid`:** `apps/api/rest/src/coupons/coupons.service.ts:39-42`
(`isInForce`) aplica `active_from <= now() < expire_at`, con el reloj de
`packages/db/src/clock.ts`. `POST /coupons/verify` (`:255-276`) exige además
`is_approve` y `sub_total >= minimum_cart_amount`.

**Qué filtra el shop:** `apps/shop/src/pages/offers.tsx:26-28` y
`apps/shop/src/pages/shops/[slug]/offers.tsx:40` muestran solo los cupones
con `Boolean(is_approve) && Boolean(is_valid)`. Los 10 están aprobados, así
que lo único que los esconde es la vigencia.

**El choque con el Épico 46.** Su decisión 6
(`docs/product/46-api-sin-mocks-json/README.md:81`) dice: «Los JSON del mock
son la fuente del seed». US-52 declaró V-1 y dejó escrito que «renovar las
fechas del seed **no** es de esta US (decisión 6: los registros son los del
mock)» (`52-coupons-postgres.md:181`). `db/README.md:255-259` repite que el
seed está vencido y que renovarlo «sería otra US». Esta es esa US. Cualquier
opción salvo la (d) **se aparta de la decisión 6** para los cupones, y eso lo
decide el dueño.

**El determinismo del seed.** El generador produce un `seed.sql` versionado
que no debe cambiar si nada cambió. `db/generate-seed.mjs:69-81` lo explica a
propósito de `HASH_DEMO`: hashear en cada corrida «haría que cada corrida
produjera un seed.sql distinto sin que nada cambiara, rompiendo el chequeo de
determinismo». No hay una receta de `just` que lo compruebe: es una
convención, y la sostienen todos los bloques (por ejemplo, el `created_at`
determinista de `wishlists`, `db/generate-seed.mjs:380`).

**Tests que miran fechas de cupones:**

- `packages/db/src/repositories/coupons.integration.test.ts:83` aserta el
  `expire_at` sembrado de `4OFF`: `'2024-03-28T05:46:42.000Z'`. Es el único
  assert que lee fechas **del seed**.
- El resto de ese archivo usa fechas propias (`FROM`/`TO`) en cupones
  centinela `zz-coupon-*`, y no depende del seed.
- `apps/api/rest/src/coupons/coupons.service.spec.ts:89,102-104,125` usa
  fechas de un fixture con `@safari/db` mockeado. **No** lee el seed y no
  cambia.

## Decisión del dueño — estrategia (bloquea la ejecución)

> **Decidida (2026-10-23): opción (b) con +5 años**, la recomendada. El
> dueño autorizó también el `just db-reset` de esta US. Los cupones se
> apartan de la decisión 6 del Épico 46 solo en las fechas: los registros
> siguen siendo los del mock.

| Opción | Qué hace | Determinista | Respeta la decisión 6 | Contra |
|---|---|---|---|---|
| **(a)** Ventana relativa a la fecha de generación | El generador recalcula las fechas a partir de `new Date()` (p. ej. `active_from` = hoy − 30 días) | **No** | No | Cada `just db-seed-generate` en un día distinto cambia `seed.sql` sin que cambie el mock, igual que el caso que `HASH_DEMO` evita. Además, el seed queda vigente solo respecto del día en que se generó, no del día en que se aplica |
| **(b)** Desplazamiento fijo de N años | Una constante (p. ej. `DESPLAZAMIENTO_CUPONES_ANIOS = 5`) se suma a `active_from` y a `expire_at` de cada cupón, y se documenta en el bloque | Sí | Parcial: los registros son los del mock y solo se transforman las fechas, como ya hacen el remapeo por email (D-4) y `fechaUtc` (US-56) | Vuelve a vencer: con +5 años, entre 2029-03 y 2030-05. Habría que subir la constante entonces |
| **(c)** Cupones demo aparte | Los 10 del mock siguen vencidos y se añade un array literal de cupones vigentes, ids 11 en adelante, con el precedente de `staffAsignaciones` (US-41, `db/generate-seed.mjs` «array literal validado, no viene del mock») | Sí | Sí para los 10 del mock; añade filas que no son del mock | Cambia los conteos que asertan US-52 y su integration test (`total 10`, ids `10→1`, reparto por tienda 6/2/2) y la evidencia de US-52. `/offers` mostraría solo los demo. También vencen algún día |
| **(d)** Dejarlo y documentar | Sin cambios de datos. Se documenta en `apps/README.md` cómo crear un cupón vigente vía `POST /coupons` + `approve-coupon` | Sí | Sí | `/offers` sigue vacía y `verify` no se puede probar con el seed |

**Recomendación: (b), con +5 años.**

- Es determinista y no toca el mock en disco.
- Preserva los 10 registros, sus ids, códigos, duraciones y el orden
  relativo de las fechas, así que el resto de la evidencia de US-52 sigue
  valiendo.
- Cambia un solo assert (`coupons.integration.test.ts:83`).
- Los 10 quedan vigentes hoy: el `active_from` más tardío pasa a 2026-03-28,
  anterior a 2026-10-22. Siguen vigentes hasta 2029-03-28 (`4OFF`, el
  primero en vencer).
- La transformación queda a la vista en el generador, igual que el remapeo
  por email.

La menor cifra que deja vigentes los 10 hoy es **+3**: con +2, `4OFF`
vencería el 2026-03-28, antes de hoy. +3 los mantiene vigentes solo hasta
2027-03-28; +5 da dos años más de margen sin ningún `active_from` futuro (el
más tardío queda en 2026-03-28). La cifra exacta la elige el dueño.

## Scope

**Incluye (con la opción recomendada):**

- en el bloque `coupons` de `db/generate-seed.mjs`, la constante de
  desplazamiento y su aplicación a `active_from` y `expire_at`, con un
  comentario que cite esta US y la decisión del dueño;
- una validación previa: con la fecha de generación, cada cupón queda
  vigente (`active_from <= ahora < expire_at`). Si alguno no lo queda, el
  generador avisa (no falla) de que hay que subir la constante;
- `db/seed.sql` regenerado y `just db-reset`;
- el assert de `coupons.integration.test.ts:83` con la fecha desplazada;
- la sección de cupones de `db/README.md`, que hoy dice que el seed está
  vencido;
- una nota en la evidencia de US-52 que enlace a esta US.

**NO incluye:**

- cambiar `coupons.json` en disco (la decisión 6 lo mantiene como
  procedencia);
- volver al `is_valid` literal o cambiar la regla de `isInForce`;
- tocar el shop o el admin;
- fechas de otras tablas sembradas (avisos, reseñas, preguntas…);
- crear cupones demo nuevos (sería la opción (c)).

## Criterios de aceptación

### CA-1 — Decisión registrada

La opción elegida por el dueño, con su fecha, queda escrita en esta US antes
de tocar código. Si elige (c) o (d), se reescriben el Scope y los CA según
corresponda y se para hasta que estén aprobados.

### CA-2 — Seed determinista

- Dos corridas de `just db-seed-generate` seguidas, y otra al día siguiente,
  producen el mismo `db/seed.sql` (`git diff --quiet db/seed.sql`).
- Sigue habiendo 10 cupones, con los mismos ids, códigos, tiendas e
  imágenes.
- Para cada cupón, la duración `expire_at − active_from` es la del mock.

### CA-3 — Las ofertas tienen contenido

Con el seed en reposo:

- `GET /api/coupons?limit=20` devuelve las 10 filas con `is_valid: true`;
- `/offers` del shop pinta 10 cupones;
- `/shops/furniture-shop/offers` pinta los 6 de la tienda 1.

### CA-4 — `verify` acepta un cupón del seed

`POST /api/coupons/verify`:

| Cuerpo | Resultado |
|---|---|
| `{code:"BAZAR10", sub_total:10}` | `is_valid: true` con el cupón |
| `{code:"4OFF", sub_total:100}` | `is_valid: false` (mínimo 160) |
| `{code:"4OFF", sub_total:200}` | `is_valid: true` |
| `{code:"NOEXISTE"}` | `is_valid: false, message: "error-invalid-coupon"` |

### CA-5 — Sin regresión

- `just db-check`, `npx jest`, `just build-api` y `just verify` en verde, con
  los recuentos.
- El único assert cambiado es `coupons.integration.test.ts:83`, y se
  justifica en el reporte.
- Los conteos de las demás tablas del seed no cambian.

## Escenarios Gherkin

```gherkin
Feature: Cupones vigentes en el seed
  Scenario: CA-3 — la pagina de ofertas tiene contenido
    Given el seed recien aplicado con las fechas desplazadas
    When el cliente abre /offers
    Then ve los 10 cupones del mock

  Scenario: CA-4 — un cupon del seed se puede aplicar
    Given el cupon BAZAR10 vigente y aprobado
    When POST /api/coupons/verify con code BAZAR10 y sub_total 10
    Then is_valid es true

  Scenario: CA-2 — el seed no cambia solo
    Given db/seed.sql generado hoy
    When se regenera manana sin cambios en el mock
    Then git diff de db/seed.sql esta vacio
```

## Archivos a crear / modificar

| Archivo | Cambio |
|---------|--------|
| `db/generate-seed.mjs` | constante de desplazamiento, su aplicación en el bloque `coupons` y la validación de vigencia (aviso) |
| `db/seed.sql` | regenerado |
| `db/README.md` | sección de cupones: el seed ya no está vencido y por qué |
| `packages/db/src/repositories/coupons.integration.test.ts` | el assert de la línea 83 |
| `docs/product/46-api-sin-mocks-json/52-coupons-postgres.md` | nota en la evidencia que enlace aquí |

## Definición de Done

- [x] Decisión del dueño registrada (CA-1).
- [x] Línea base con el seed actual: `GET /coupons?limit=20` con
  `is_valid: false` en las 10 y `/offers` vacía.
- [x] `just db-seed-generate` dos veces y `git diff --quiet db/seed.sql` tras
  la segunda (CA-2), más la comprobación de duraciones con `node -e`.
- [x] `just db-reset` y `psql` con 10 cupones y sus fechas desplazadas.
- [x] CA-3 y CA-4 con `curl` y la página del shop (status y número de
  cupones pintados).
- [x] CA-5: los cuatro comandos en verde con recuentos.
- [x] Status actualizado aquí y en el mapa de `docs/product/README.md`.

## Notas para el agente ejecutor

- **No ejecutar sin la decisión del dueño.** Si al empezar la US no tiene la
  opción registrada, se para y se pregunta.
- **Sumar años con UTC.** `setUTCFullYear(getUTCFullYear() + N)` sobre un
  `Date` construido desde el ISO del mock conserva la hora. Ningún cupón cae
  en 29 de febrero, pero conviene validarlo en el generador por si el mock
  cambia.
- **El aviso de vigencia usa la fecha de generación**, así que no puede
  fallar la generación: eso volvería no determinista el resultado (un mismo
  mock pasaría hoy y fallaría en 2029). Es un `console.warn`, no un
  `problemas.push`.
- **`verify` con `HELLO15`** es el caso `percentage` y pide mínimo 100. Sirve
  como caso extra si se quiere cubrir el tipo.
- **La evidencia de US-52 queda histórica.** Sus `curl` mostraban `4OFF`
  vencido. No se reescribe: se añade una nota que enlace a esta US.

## Evidencia (2026-10-23)

**Implementación** (`db/generate-seed.mjs`, bloque de cupones):

- `DESPLAZAMIENTO_CUPONES_ANIOS = 5`.
- `desplazarAnios` usa `setUTCFullYear`. Si una fecha cae en un día que no
  existe N años después (un 29 de febrero), lo registra con `problemas.push`
  y el generador falla, como cualquier validación del mock.
- `cuponesSembrados` alimenta el `INSERT`.
- El aviso de vigencia es un `console.warn` y usa la fecha de generación.

**Línea base** (seed anterior, API recién arrancada):

```
GET /coupons?limit=20 → 10 filas; 4OFF:false 5OFF:false OFF6:false BAZAR10:false BAZAR20:false BAZAR18:false HELLO15:false EID12:false FOO:false EID2:false
is_valid true: 0
verify {"code":"BAZAR10","sub_total":10} → 201 is_valid:false message:error-invalid-coupon
verify {"code":"4OFF","sub_total":200} → 201 is_valid:false message:error-invalid-coupon
```

La línea base de `/offers` se midió sobre el HTML del servidor (0 cupones).
Esa medición no prueba nada: la página pide los cupones en el cliente, así
que el HTML del SSR no los trae nunca. El after se midió en un navegador
real (Chrome DevTools, abajo). Que la página saliera vacía antes se deduce
de los 10 `is_valid: false` y del filtro del shop
(`Boolean(is_approve) && Boolean(is_valid)`).

**CA-2, determinismo:**

```
just db-seed-generate ×2  →  cmp: seed.sql idéntico
git diff --stat db/seed.sql  →  1 file changed, 12 insertions(+), 12 deletions(-)   (cabecera del bloque + 10 filas)
```

Para el «día siguiente» se falseó el reloj del generador (`globalThis.Date`
con `node --import`):

```
== reloj 2026-10-24T12:00:00Z
db/seed.sql generado (880 KB)
  seed.sql idéntico
== reloj 2029-04-01T00:00:00Z
AVISO coupons: fuera de vigencia hoy: 4OFF; sube DESPLAZAMIENTO_CUPONES_ANIOS (US-68).
db/seed.sql generado (880 KB)
  seed.sql idéntico
```

Duraciones, tiendas e imágenes contra `coupons.json` (`node`):

```
10 4OFF    tienda 1  2026-03-28 → 2029-03-28  duración 1096 d (seed 1096 d)  imagen true  OK
9 5OFF    tienda 2  2026-03-28 → 2029-06-23  duración 1183 d (seed 1183 d)  imagen true  OK
8 OFF6    tienda 3  2026-03-28 → 2029-07-14  duración 1204 d (seed 1204 d)  imagen true  OK
7 BAZAR10 tienda 1  2026-03-28 → 2030-05-26  duración 1520 d (seed 1520 d)  imagen true  OK
6 BAZAR20 tienda 1  2026-03-27 → 2029-04-26  duración 1126 d (seed 1126 d)  imagen true  OK
5 BAZAR18 tienda 2  2026-03-27 → 2029-04-15  duración 1115 d (seed 1115 d)  imagen true  OK
4 HELLO15 tienda 3  2026-03-27 → 2029-04-23  duración 1123 d (seed 1123 d)  imagen true  OK
3 EID12   tienda 1  2026-03-27 → 2029-05-26  duración 1156 d (seed 1156 d)  imagen true  OK
2 FOO     tienda 1  2026-03-27 → 2029-05-26  duración 1156 d (seed 1156 d)  imagen true  OK
1 EID2    tienda 1  2026-03-10 → 2029-07-27  duración 1235 d (seed 1235 d)  imagen true  OK
CA-2: las 10 conservan duración, tienda e imagen
```

**`just db-reset`** (autorizado) y `psql`:

```
 id |  code   | shop_id |      active_from       |       expire_at        | is_approve
----+---------+---------+------------------------+------------------------+------------
 10 | 4OFF    |       1 | 2026-03-28 05:46:42+00 | 2029-03-28 05:46:42+00 | t
  9 | 5OFF    |       2 | 2026-03-28 05:46:42+00 | 2029-06-23 05:46:42+00 | t
  8 | OFF6    |       3 | 2026-03-28 05:46:42+00 | 2029-07-14 05:46:42+00 | t
  7 | BAZAR10 |       1 | 2026-03-28 05:46:42+00 | 2030-05-26 05:46:42+00 | t
  6 | BAZAR20 |       1 | 2026-03-27 20:55:49+00 | 2029-04-26 20:55:49+00 | t
  5 | BAZAR18 |       2 | 2026-03-27 20:55:49+00 | 2029-04-15 20:55:49+00 | t
  4 | HELLO15 |       3 | 2026-03-27 20:48:28+00 | 2029-04-23 20:48:28+00 | t
  3 | EID12   |       1 | 2026-03-27 20:48:28+00 | 2029-05-26 20:48:28+00 | t
  2 | FOO     |       1 | 2026-03-27 05:33:22+00 | 2029-05-26 05:33:22+00 | t
  1 | EID2    |       1 | 2026-03-10 21:48:15+00 | 2029-07-27 21:48:15+00 | t
```

Conteos de las demás tablas, antes y después del reset (`diff` vacío):

```
types|10 shops|12 categories|198 products|1200 users|11 permission_user|20 coupons|10 reviews|85 questions|68 orders|40 withdraws|2 ownership_transfers|6
```

**CA-3:**

```
GET /coupons?limit=20 → 10 filas; 4OFF:true 5OFF:true OFF6:true BAZAR10:true BAZAR20:true BAZAR18:true HELLO15:true EID12:true FOO:true EID2:true
is_valid true: 10
```

En el shop, con Chrome DevTools sobre `http://localhost:3003`:

```
/en/offers                        → 10 tarjetas con botón «Copy»: 4OFF, 5OFF, OFF6, BAZAR10, BAZAR20, BAZAR18, HELLO15, EID12, FOO, EID2
/en/shops/furniture-shop/offers   → {"pintados":6,"codigos":["4OFF","BAZAR10","BAZAR20","EID12","FOO","EID2"]}
```

**CA-4:**

```
verify {"code":"BAZAR10","sub_total":10} → 201 is_valid:true coupon BAZAR10 (fixed, 10)
verify {"code":"4OFF","sub_total":100} → 201 is_valid:false message:error-invalid-coupon
verify {"code":"4OFF","sub_total":200} → 201 is_valid:true coupon 4OFF (fixed, 4)
verify {"code":"HELLO15","sub_total":150} → 201 is_valid:true coupon HELLO15 (percentage, 15)
verify {"code":"NOEXISTE"} → 201 is_valid:false message:error-invalid-coupon
```

**CA-5:**

```
just db-check                      →  Test Files  32 passed (32) / Tests  410 passed (410)
npx jest                           →  Test Suites: 34 passed, 34 total / Tests: 565 passed, 565 total
npx tsc --noEmit -p tsconfig.json  →  EXIT=0
just build-api                     →  Done in 22.43s.
just verify
OK   API    :9001/api/settings  200  5503B  529ms
OK   Shop   :3003/en  200  190788B  677ms  cards:30
OK   Admin  :3002/en/login  200  72821B  1802ms  cards:1
```

El único assert que cambió es `coupons.integration.test.ts:83`: el
`expire_at` sembrado de `4OFF` pasa de `2024-03-28T05:46:42.000Z` a
`2029-03-28T05:46:42.000Z`. Es justo lo que la US cambia: la fecha
sembrada. El mock en disco sigue diciendo 2024. Además se actualizaron el
`db/README.md` (sección de cupones) y una nota en la evidencia de US-52
que enlaza aquí.
