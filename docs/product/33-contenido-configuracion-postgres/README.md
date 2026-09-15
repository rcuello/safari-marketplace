# Épico 33 — Contenido y configuración desde Postgres

> Ocho módulos de la API dejan de servir JSON estático y pasan a Postgres:
> `faqs`, `terms-and-conditions`, `refund-policies`, `refund-reasons`,
> `taxes`, `shippings`, `attributes` y `store-notices`. Es la Fase 1 del
> inventario de `_backlog/api-mock-restante-dominio-transaccional.md`: la
> única que **no** necesita levantar la exclusión transaccional de
> `db/schema.sql:13-16`.

**Fecha:** 2026-09-14
**Status:** Refinado

## Por qué este corte y no otro

De los 42 módulos con controlador de `apps/api/rest`, 9 están en Postgres, 24
sirven JSON y 9 son stubs puros. Llegar a "cero mocks" son ~28 tablas nuevas
sobre las 15 que hay hoy. Este épico coge las **8 que no chocan con nada**:
CRUD de contenido y configuración, todas con consumidor real verificado en el
admin y la mitad también en la tienda (evidencia hook por hook en el
inventario del backlog). Ninguna necesita órdenes, carritos, wallets ni
reviews, que es lo que `db/schema.sql:13-16` excluye a propósito.

`attributes` entra aquí por una razón de segundo orden: es el prerrequisito de
las variaciones de producto que el Épico 26 dejó sin persistir.

## Subdivisión en sub-historias

| US | Título | Releasable solo | Depende de | LOC est. |
|----|--------|-----------------|------------|----------|
| US-34 | Esquema y capa de datos de contenido y configuración | No (habilitadora) | ninguna | ~1200 |
| US-35 | `faqs` y `terms-and-conditions` desde Postgres | Sí | US-34 | ~1500 |
| US-36 | `refund-policies` y `refund-reasons` desde Postgres | Sí | US-34 | ~1400 |
| US-37 | `taxes` y `shippings` desde Postgres | Sí | US-34 | ~1300 |
| US-38 | `attributes` y sus valores desde Postgres | Sí | US-34 | ~1600 |
| US-39 | `store-notices` desde Postgres (N:M + estado de lectura) | Sí | US-34 | ~1800 |

**Total estimado: ~8800 LOC.** No es un error de tecleo — ver R-1. US-35 a
US-39 no dependen entre sí: tras US-34 pueden ir en paralelo con agentes
distintos, siempre que no coincidan en el barrel `packages/db/index.ts`.

Son 43 rutas HTTP en total: `faqs` 5, `terms-and-conditions` 7,
`refund-policies` 5, `refund-reasons` 5, `taxes` 5, `shippings` 5,
`attributes` 5, `store-notices` 6.

## Refinamiento — Decisiones tomadas

| # | Tema | Decisión |
|---|------|----------|
| 1 | Exclusión transaccional de `db/schema.sql:13-16` | **NO se levanta.** El dueño la mantiene en pie: este épico no toca órdenes, carritos, wallets, direcciones ni reviews. La decisión sobre el núcleo transaccional se reevalúa cuando este épico cierre. |
| 2 | Módulos que no se desmockean con una tabla | **Mock declarado permanente**: `payment-intent` y `payment-method` (dependen de Stripe/PayPal reales, misma clase de decisión que el social login del Épico 19) y `authors` y `flash-sale` (vivos en ambos frontends, pero de valor bajo para un marketplace de tecnología: `products` no tiene `author_id` y `authors.enable` es `false` en el único type `compact`). Salen del objetivo de "cero mocks", que pasa a significar "cero mocks **no declarados**". |
| 3 | DDL del épico | **Todo en US-34, un solo `just db-reset`.** Precedente del Épico 19 y del 26: este repo no tiene migraciones incrementales, así que el esquema completo se diseña antes de escribir la primera línea de servicio. |
| 4 | Alcance de `attributes` | Entra el CRUD de `attributes` + `attribute_values`. **NO entra** persistir las variaciones de producto que desbloquea: eso es épico aparte. |
| 5 | `store-notices` | Va en su propia US. No es CRUD plano: trae N:M con `users` y con `shops`, más estado de lectura por usuario. |

## Visión técnica compartida

### Decisiones de Diseño (D-N)

**D-1 — Tablas nuevas: 12, no 8.** Un módulo no es una tabla. El desglose
real, leído de la forma de los JSON del mock:

| Tabla | Origen | Notas |
|---|---|---|
| `faqs` | `faqs.json` (19 filas) | plana; `faq_title`, `slug`, `faq_description`, `faq_type`, `issued_by` |
| `terms_and_conditions` | `terms-and-conditions.json` (10) | plana + `is_approved` (cola de moderación en el admin) |
| `refund_policies` | `refund-policies.json` (5) | plana; `target`, `status` |
| `refund_reasons` | `refund-reasons.json` (8) | plana |
| `taxes` | `taxes.json` (1) | plana; `rate`, `is_global`, `on_shipping`, geo (`country`/`state`/`zip`/`city`) |
| `shippings` | `shippings.json` (1) | plana; `amount`, `type`, `is_global` |
| `attributes` | `attributes.json` (8) | FK `shop_id` → `shops` |
| `attribute_values` | `attributes[].values` | hijo de `attributes` |
| `store_notices` | `store-notices.json` (3) | `priority`, `type`, `effective_from`, `expired_at`, `created_by`/`updated_by` → `users` |
| `store_notice_user` | `store-notices[].users` | pivote N:M |
| `store_notice_shop` | `store-notices[].shops` | pivote N:M |
| `store_notice_read` | `is_read` / `read_status` | estado de lectura por usuario |

**D-2 — `language` es columna; `translated_languages` casi nunca lo es.**
Precedente ya embarcado: `language text NOT NULL DEFAULT 'es'` existe en
`db/schema.sql:76,98,270,303`. `translated_languages` solo es columna real en
`products` (`:379`, `text[]`); en el resto el servicio lo emite como constante
y lo documenta, como hace `types.service.ts:29,39`. Este épico **sigue ese
precedente**, no inventa un modelo de i18n.

**D-3 — Contratos HTTP preservados byte a byte.** Regla del repo, con
precedente verificado (`/api/settings`, 5503 bytes idénticos). La API publica
snake_case; la capa de datos devuelve camelCase; la traducción vive en los
servicios de Nest.

**D-4 — La divergencia conocida de timestamps se repite y se espera.** El seed
no inserta `created_at`/`updated_at` (las filas toman `now()` del último
`db-up`) y `Date.toJSON()` emite 3 decimales donde el JSON de Laravel trae 6.
Está documentado en `CLAUDE.md`; no es un defecto de este épico.

**D-5 — Sin mock huérfano al cerrar.** Cada US retira el import del JSON que
sustituye. Los ficheros pueden quedarse en disco como referencia del contrato
heredado (precedente: los servicios migrados los citan en comentarios), pero
ningún `import` debe sobrevivir.

**D-6 — `attributes.shop_id` es FK real a `shops`.** `shops` ya está migrada
(Épico 26), así que la FK se puede declarar de verdad en vez de simularla.

### Riesgos (R-N)

**R-1 — El sesgo de estimación de este repo es grande y está medido.** En el
Épico 26: US-27a estimó ~725 y salieron ~1470 (×2.0); US-27b ~825 → ~2109
(×2.6); US-28 ~350 → ~1612 (×4.6). Las estimaciones de arriba **ya llevan la
corrección aplicada** (parten de los reales del Épico 26 para US de 2
agregados, no de una intuición optimista). Aun así, tratar cualquier número de
este documento como suelo, no como techo.

**R-2 — `store-notices` toca identidad, que ya está migrada.** Sus pivotes
apuntan a `users` y `shops`. Es la única US del épico que puede romper algo
que hoy funciona; por eso va sola y al final.

**R-3 — Colisión de `db-reset` con US-32.** La US-32 standalone (deriva de
reloj `created_at`/`updated_at`) también exige `just db-reset` y toca DDL.
Conviene **plegarla dentro de US-34** o ejecutarla antes, para no gastar dos
recreaciones de la base. Decisión para el refinamiento de US-34.

**R-4 — US-34 es cuello de botella.** Bloquea las cinco siguientes. Si se
desborda, se desborda el épico entero. Argumento a favor de mantenerla
estrictamente en DDL + repositorios, sin tocar ningún servicio de Nest.

**R-5 — `taxes` y `shippings` se leen desde `settings`.** El admin los
consume también en `pages/settings/*`. Verificar en el refinamiento de US-37
que migrarlos no altera la respuesta de `/api/settings`, que es el contrato
más vigilado del repo.

## Notas globales para los agentes

- Leer antes de tocar código: la US completa, este README, el `CLAUDE.md` de
  la raíz y `db/README.md`.
- El DDL vive en `db/schema.sql`. `packages/db/prisma/schema.prisma` se
  regenera por introspección (`prisma db pull` + renombres), nunca genera
  migraciones. Las CHECK que Prisma no modela se validan en los repositorios.
- 1 US = 1 sesión. Lo que el "NO incluye" excluye no se implementa aunque sea
  adyacente: se menciona en el reporte final.
- La Definición de Done se cierra con salida real pegada (`just db-check`,
  `cd apps/api/rest && npx jest`, `just build-api`, `just verify`, `curl` con
  Bearer cuando la ruta lo exija), nunca con "debería funcionar".
- **Trampa de evidencia heredada de US-31**: un `curl` sin token contra una
  ruta protegida devuelve 401/403, que satisface "4xx" sin ejecutar nada. Todo
  `curl` de la DoD lleva token y comprueba status exacto.
