# db/ — el catálogo compartido

Una sola base para dos consumidores: el **scraper escribe** productos y la
**tienda Next.js los consulta**, desde las mismas tablas.

| Archivo | Qué es |
|---|---|
| [`schema.sql`](schema.sql) | El DDL, con las decisiones de modelado comentadas |
| [`seed.sql`](seed.sql) | **Generado.** Los datos reales de la aplicación |
| [`generate-seed.mjs`](generate-seed.mjs) | Produce `seed.sql` desde los JSON del mock |

```bash
just db-up              # levanta Postgres, aplica esquema y seed
just db-seed-generate   # regenera seed.sql desde los JSON
just db-shell           # sesión psql
```

## De dónde salen los datos

`seed.sql` no se escribe a mano: sale de `apps/api/rest/src/db/pickbazar/*.json`,
que es el mock que la API sirve hoy. El generador valida antes de emitir, así
que si el mock violara alguna restricción del esquema falla en vez de producir
SQL inaplicable.

```
10 types · 12 shops · 198 categorías · 14 manufacturers · 10 tags · 1200 productos · 3 usuarios · 4 permisos
· 1 become_seller · 3 shop_staff · 19 faqs · 5 terms_and_conditions
· 5 refund_policies · 8 refund_reasons · 1 taxes · 1 shippings
```

**Los ids del mock se preservan** para no romper las relaciones, y al final se
adelantan las secuencias. Dos cosas que el generador resuelve y conviene saber:

- **Tres shops se reconstruyen.** 190 productos referencian `shop_id` 12, 14 y
  15, que no existen en `shops.json`. Con claves foráneas reales esas filas
  serían imposibles. La identidad sí está disponible porque cada producto
  embebe su objeto `shop`, así que se recuperan de ahí en lugar de descartar
  190 productos o inventar tiendas de relleno.
- **`category_product` queda vacía a propósito.** Ninguno de los 1200 productos
  del mock trae categorías, aunque la entidad las declara y el buscador filtra
  por `categories.slug`. En la app original, hoy, buscar por categoría devuelve
  cero resultados. No se inventan enlaces.

## Identidad: usuarios, perfiles y permisos

Desde US-20, `users.json` (el mismo mock) siembra 6 tablas: `users`, `profiles`
(1:1), `permissions`, el pivote `permission_user`, y `password_reset_tokens` /
`otp_codes` (vacías, sin consumidor todavía). El login del mock sigue
aceptando cualquier contraseña hasta US-22 — este dato solo queda sembrado y
disponible.

**Credencial demo**: los 3 usuarios comparten la contraseña `demodemo`,
guardada como hash bcrypt (costo 10). El literal vive en
`generate-seed.mjs` como constante `HASH_DEMO`, con el comando de
regeneración en un comentario junto a ella — nunca se hashea en tiempo de
generación, porque el salt aleatorio de bcrypt rompería el determinismo del
seed.

**Matriz de permisos** (`guard_name = 'api'`, 4 filas: `super_admin`,
`customer`, `store_owner`, `staff`):

| Usuario | id | Permisos |
|---|---|---|
| `admin@demo.com` | 3 | `super_admin` + `customer` + `store_owner` |
| `store_owner@demo.com` | 1 | `customer` + `store_owner` |
| `customer@demo.com` | 2 | `customer` |
| — | 4 | `staff` existe en el catálogo, sin asignar hasta US-25 |

**Por qué `lower(email)` y no `citext`**: el índice único vive sobre
`lower(email)`, no sobre la columna `email` (que sigue siendo `text` plano).
Consistente con `products_nombre_trgm_idx`, que ya indexa `lower(name)`, y
sin introducir el primer `CREATE EXTENSION` del DDL versionado. La
consecuencia práctica: **todo lookup por email debe escribirse
`WHERE lower(email) = lower($1)`**, o Postgres no usa el índice — un
`WHERE email = $1` hace table scan igual de correcto pero sin aprovecharlo.

**Por qué `otp_codes` no tiene FK a `users`**: se clave por `phone` en texto
plano porque `POST /api/send-otp-code` recibe un teléfono, no un id de
usuario, y no existe una columna de teléfono única en `users`/`profiles`
(solo `profile.contact`, texto libre). Es la única tabla de identidad que se
aparta del estilo FK-everywhere del resto del archivo.

Ninguna de las 6 tablas tiene consumidor en código de aplicación todavía:
el login sigue siendo mock (US-22) y recuperación/OTP no tienen endpoint
real (US-24).

## Identidad extendida: staff por tienda y "vender con nosotros"

Desde US-41, dos tablas más, ninguna con trigger de `updated_at` (misma
política que el resto del archivo desde US-32):

- **`shop_staff`** — pivote puro `user_id`/`shop_id`, calco de
  `permission_user`. PK compuesta, ambas FK `ON DELETE CASCADE`. **Sin
  columna de rol, a propósito**: ningún consumidor real la pide hoy
  (`StaffsController.getStaffs` devuelve `UserPaginator`, no filas de
  pivote; `AddStaffInput` del admin es `{email, password, name, shop_id}`
  sin rol). Solo `created_at`: un pivote se crea o se borra, nunca se
  actualiza. Sembrado con 3 filas deterministas — `(2,1)`, `(2,2)`, `(3,1)`
  — inventadas (no hay mock de staff), excluyendo siempre al usuario 1
  (dueño de las 12 tiendas).
- **`become_seller`** — singleton calco de `settings`: `id smallint
  DEFAULT 1` + `CHECK become_seller_fila_unica`. Dos columnas `jsonb`
  hermanas, no una: `page_options` (el objeto INTERNO de
  `become-seller.json`, 24 claves — NO el envoltorio con forma de
  `settings` que trae el mock, cuyos `id`/`language`/`created_at`/
  `updated_at` son estas mismas columnas) y `commissions` (el array
  completo de 2 tiers). Fundirlas en una sola columna perdería
  `commissions` en silencio.

## Contenido: FAQ y términos y condiciones

Desde US-47 (primera US del
[Épico 46](../docs/product/46-api-sin-mocks-json/README.md), que levanta la
exclusión transaccional de la cabecera de `schema.sql`), dos tablas con la
misma forma: contenido **global** (emitido por el super admin, `shop_id`
NULL) o **de una tienda**.

- **`faqs`** — 19 filas de `faqs.json`. `faq_type ∈ {global, shop}` (CHECK).
  `issued_by` es **texto**, no FK: es el nombre del emisor («Super Admin» o
  el de la tienda), que es lo que la tienda filtra por igualdad exacta.
  **`shop_id` se deriva en el generador**: el mock no trae la clave, solo
  `issued_by`; las 14 FAQ de tienda casan exactamente con las tiendas 1-7 por
  nombre (dos cada una). Un nombre que no case detiene la generación.
  Varios slugs terminan en `?` y se siembran tal cual (la FAQ se edita por id).
- **`terms_and_conditions`** — **5 filas de 10**. El mock trae los ids
  `8,9,10,11,12,1,2,3,4,5` y los 1-5 son copias exactas de 8-12; con `slug`
  UNIQUE se conserva la **primera aparición en el orden del archivo** (8-12),
  que es la que `GET /:slug` devolvía. Una repetición con contenido distinto
  detiene la generación. `is_approved` es boolean (el mock trae `1`); la
  proyección a entero `1/0` del contrato vive en el servicio de Nest.

En las dos, `shop_id → shops ON DELETE CASCADE` (el contenido de una tienda
borrada no tiene a quién pertenecer) y `user_id → users ON DELETE SET NULL`
(el autor se puede borrar sin perder el contenido). Al **crear**, el tipo y
el emisor no los elige quien escribe: los deriva el repositorio de `shop_id`
(`resolveContentIssuer`), para que una FAQ de tienda no quede invisible en
su propia página.

## Reembolsos: políticas y motivos

Desde US-48, las dos listas de contenido que rodean el reembolso. No son el
reembolso en sí: el módulo `refunds` de la API es un stub sin JSON.

- **`refund_policies`** — 5 filas de `refund-policies.json`: 1 de vendedor y
  4 de cliente, las 5 `approved`. Tiene dos CHECK: `target ∈ {vendor,
  customer}`, que es lo que filtran `/customer-refund-policies` y
  `/vendor-refund-policies`, y `status ∈ {approved, pending}`, la cola de
  moderación que conoce el admin. `status` vale por defecto `pending`.
  `shop_id` es opcional (CASCADE) y el seed lo deja NULL.
- **`refund_reasons`** — 8 filas, plana. Es **la primera tabla cuyo contrato
  emite `created_at`/`updated_at`**, así que el seed inserta las fechas del
  mock (`2023-11-12T10:58:58Z`) con el helper `ts()` y no usa el `DEFAULT
  now()`. Sin eso, cada `db-reset` cambiaría la respuesta de `GET
  /refund-reasons`.

## Configuración fiscal y de envío: `taxes` y `shippings`

Desde US-49, una fila cada una, la clase «Global» con **id 1**, sembrada con
las fechas del mock (en `taxes`, `created_at` y `updated_at` son distintos).

- **La relación con `settings` es blanda.** `settings.options.taxClass` y
  `shippingClass` guardan `"1"` como texto dentro del `jsonb`, sin FK. Por eso
  los ids 1 se preservan, y por eso estas tablas no tocan el contrato
  congelado de `/api/settings` (5504 B).
- **`numeric` sin escala** en `rate` y `amount`: vuelven como `2` y `50`, no
  como `2.00`, que es lo que el contrato emite. CHECK `rate >= 0`, `amount >=
  0` y `type ∈ {fixed, percentage, free}`.
- **No se paginan**: el admin de `/settings` pide `limit=999` y espera un
  array para poblar el selector de clase.

Son la configuración que el checkout real (US-59) leerá para calcular
impuesto y envío.

## Cómo se adapta el scraper

**El seed contiene solo datos de la aplicación.** El scraper no aporta filas
aquí: es él quien debe encajar en esta taxonomía.

El type `gadget` ya trae diez categorías que cubren lo que los spiders
recolectan. El método `categorizar()` de cada spider debe devolver **estos
slugs**, no inventar los suyos:

| Lo que produce el spider | Categoría que ya existe |
|---|---|
| portátiles | `laptop` |
| celulares | `mobiles` |
| monitores | `monitor` |
| gaming / consolas | `console` |
| audio / parlantes | `headphone`, `sound-box` |
| cámaras | `camera` |
| redes | `router` |
| relojes | `smart-watch` |
| periféricos y demás | `accessories-gfa` |

Lo que el scraper **sí** crea en tiempo de ejecución, porque es genuinamente
suyo y no existe en la app:

- **Los retailers como `shops`** (Alkosto, Éxito, Falabella, CompuLago,
  CompuWorking, Tauret). Ninguno es un shop de Pickbazar.
- **Las marcas como `manufacturers`**. Las 14 del mock son casi todas
  editoriales de libros; no hay ni una marca de tecnología real.
- **Las filas de `category_product`**, que la app dejó vacías.

## Decisión pendiente: la moneda

`settings.options.currency` es **`USD` con 2 decimales**, tal como lo trae la
app. Los precios que scrapea el worker son **pesos colombianos sin decimales**.

Pickbazar asume una única moneda para todo el marketplace, así que hay tres
salidas y ninguna es gratis:

1. **Cambiar el setting a `COP` / `es-CO` / 0 decimales.** Lo más simple, pero
   los 1200 productos del mock (con precios de 2 a 421 USD) quedarían
   mostrándose como si fueran pesos.
2. **Convertir los precios scrapeados a USD** al guardarlos. Coherente con el
   mock, pero introduce una tasa de cambio que hay que mantener.
3. **Moneda por producto.** Lo correcto de verdad, pero se desvía del modelo de
   Pickbazar y obliga a tocar el formateo en el frontend.

Es una decisión de producto, no técnica.
