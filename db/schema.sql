-- =====================================================================
-- safari-marketplace — esquema del catálogo
--
-- UNA sola base para dos consumidores:
--   · el scraper (services/scraper-worker) ESCRIBE productos
--   · la tienda Next.js (apps/shop) los CONSULTA
--
-- Diseñado por ingeniería inversa del mock de Pickbazar
-- (apps/api/rest/src/db/pickbazar/*.json, 1.200 productos) y de los
-- filtros que el frontend envía de verdad
-- (apps/shop/src/framework/rest/client/index.ts).
--
-- Identidad entra desde US-20. El resto del dominio entra por el Épico 46
-- (2026-10-20), una US por bloque de tablas, sembradas desde los mismos JSON.
-- Siguen fuera de alcance deliberado: carritos, direcciones y wallets/
-- balances, porque ningún mock JSON los respalda.
--
-- Idempotente: todo va con IF NOT EXISTS, así que aplicarlo dos veces no
-- rompe nada. OJO: por eso mismo NO aplica cambios a tablas que ya existan.
-- Para adoptar una modificación del esquema hay que recrear la base con
-- `just db-reset`. Este repo no tiene migraciones incrementales.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Generación de slugs.
--
-- La app identifica productos por `slug` (la URL es /products/{slug}) y
-- exige que sea único global. El scraper identifica por (tienda,
-- product_id). slugify() es el puente: mismo producto -> mismo slug,
-- siempre, sin depender de un contador ni del orden de inserción.
-- ---------------------------------------------------------------------

-- Quita tildes sin depender de la extensión `unaccent`, que en algunos
-- servicios gestionados de Postgres no está disponible. Se define ANTES
-- de slugify porque Postgres valida el cuerpo de una función SQL en el
-- momento de crearla.
CREATE OR REPLACE FUNCTION unaccent_simple(texto text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT translate(texto,
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC');
$$;

CREATE OR REPLACE FUNCTION slugify(texto text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT trim(both '-' from
        regexp_replace(
            regexp_replace(
                lower(unaccent_simple(texto)),
                '[^a-z0-9]+', '-', 'g'
            ),
            '-{2,}', '-', 'g'
        )
    );
$$;


-- ---------------------------------------------------------------------
-- settings — configuración global de la tienda.
--
-- Es la PRIMERA llamada que hace el shop en cada render (/api/settings).
-- La moneda vive aquí y NO en el producto: Pickbazar asume una única
-- moneda para todo el marketplace. El seed copia la que trae la app
-- (USD, 2 decimales); reconciliarla con los precios en COP del scraper
-- es una decisión abierta, documentada en db/README.md.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    id          smallint     PRIMARY KEY DEFAULT 1,
    options     jsonb        NOT NULL,
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT settings_fila_unica CHECK (id = 1)
);


-- ---------------------------------------------------------------------
-- types — las "verticales" del marketplace (grocery, gadget, books...).
--
-- No son categorías de navegación: controlan el layout del home y las
-- rutas son /{locale}/{type.slug}. Un producto SIN type no tiene página
-- donde mostrarse, por eso type_id es NOT NULL.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS types (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    slug        text         NOT NULL UNIQUE,
    icon        text,
    -- {isHome, productCard, layoutType}: la UI del home los lee.
    settings    jsonb        NOT NULL DEFAULT '{}'::jsonb,
    banners     jsonb        NOT NULL DEFAULT '[]'::jsonb,
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- users — identidad para autenticación (US-20).
--
-- Hasta esta US no existía tabla de usuarios: el login del mock acepta
-- cualquier contraseña. Este esquema deja sembrados los 3 usuarios demo
-- de users.json con un hash bcrypt real; el login en sí sigue mock hasta
-- US-22, que es quien lo consulta.
--
-- Sin columna `email_verified`: el mock trae ambas (booleano y
-- timestamp) pero son redundantes -- email_verified_at ya dice si y
-- cuándo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
    id                  bigserial    PRIMARY KEY,
    name                text         NOT NULL,
    email               text         NOT NULL,  -- unicidad vía el índice funcional de abajo
    password_hash       text         NOT NULL,  -- bcrypt costo 10; demo: `demodemo`
    is_active           boolean      NOT NULL DEFAULT true,
    email_verified_at   timestamptz,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- Case-insensitive sin `citext`, como la búsqueda por nombre de productos
-- (products_nombre_ilike_trgm_idx) y sin introducir el primer CREATE EXTENSION del
-- DDL versionado (las extensiones se activan en justfile). Consecuencia:
-- todo lookup por email debe escribirse `WHERE lower(email) = lower($1)`
-- o este índice no se usa -- lo hereda US-21.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));


-- ---------------------------------------------------------------------
-- profiles — datos de perfil, 1:1 con users.
--
-- La PK es user_id, no un id propio: el mock (`profile.id`) colisiona
-- entre usuarios (admin y customer declaran ambos profile.id = 2) y no
-- aporta nada que user_id no resuelva ya.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    user_id         bigint       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    avatar          jsonb,
    bio             text,
    socials         jsonb,
    contact         text,
    notifications   jsonb,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- permissions — catálogo estático de roles (4 filas, ver seed).
--
-- guard_name viene del origen Laravel del mock; se conserva porque
-- hasAccess() en ambos frontends compara el nombre en snake_case, no el
-- guard. `staff` (id 4) es nueva: no está en users.json pero el
-- universo de 4 valores es lo que comparan los frontends -- queda sin
-- asignar hasta US-25.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    id           bigserial    PRIMARY KEY,
    name         text         NOT NULL UNIQUE,
    guard_name   text         NOT NULL DEFAULT 'api',
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);

-- permission_user — pivote puro user<->permission. Comparte el banner de
-- permissions, como product_tag comparte el de category_product.
CREATE TABLE IF NOT EXISTS permission_user (
    user_id         bigint       NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    permission_id   bigint       NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_id)
);


-- ---------------------------------------------------------------------
-- password_reset_tokens — sin consumidor todavía (llega en US-24).
--
-- Por user_id, no por email al estilo Laravel: todos los usuarios ya
-- existen en el seed, no hay flujo de pre-existencia que resolver.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id            bigserial    PRIMARY KEY,
    user_id       bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token         text         NOT NULL UNIQUE,
    expires_at    timestamptz  NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- otp_codes — sin consumidor todavía (llega en US-24).
--
-- Única tabla de identidad SIN FK a users: se clave por teléfono en
-- texto plano porque POST /api/send-otp-code recibe un teléfono, no un
-- id, y no existe columna de teléfono en users/profiles (solo
-- profile.contact, texto libre sin unicidad).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
    id            bigserial    PRIMARY KEY,
    phone         text         NOT NULL,
    code          text         NOT NULL,
    expires_at    timestamptz  NOT NULL,
    consumed_at   timestamptz,
    created_at    timestamptz  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- shops — el vendedor.
--
-- En Pickbazar un shop es un vendedor del marketplace con dueño. El seed
-- trae los 12 del mock; los retailers que scrapea el worker (Alkosto,
-- Éxito, Falabella...) los crea él en tiempo de ejecución, porque no
-- forman parte de los datos de la app.
--
-- owner_id referencia users(id) ON DELETE RESTRICT (US-20): el default 1
-- ya no es relleno, es un hecho -- store_owner@demo.com. Se queda porque
-- pipelines.py:187-190 crea shops con `INSERT INTO shops (name, slug)
-- VALUES (...)`, sin owner_id; sin el DEFAULT ese INSERT violaría el
-- NOT NULL. Nunca CASCADE aquí: products.shop_id ya es CASCADE, así que
-- borrar el usuario 1 arrastraría en cadena las 12 tiendas y sus 1200
-- productos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shops (
    id             bigserial    PRIMARY KEY,
    name           text         NOT NULL,
    slug           text         NOT NULL UNIQUE,
    description    text,
    owner_id       bigint       NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE RESTRICT,
    is_active      boolean      NOT NULL DEFAULT true,
    logo           jsonb,
    cover_image    jsonb,
    address        jsonb        NOT NULL DEFAULT '{}'::jsonb,
    settings       jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- categories — taxonomía de navegación, jerárquica por adyacencia.
--
-- 198 categorías en TRES niveles, no dos: 83 raíces + 109 hijas + 6
-- NIETAS. Las nietas son 165,166,167,168 (bajo 164 "Dairy") y 169,170
-- (bajo 163 "Eggs"); 163 y 164 cuelgan de la raíz 124 "Dairy & Eggs",
-- toda la rama en type_id 7 (daily-needs). Profundidad máxima = 2
-- saltos; 0 bisnietos. Medido con WITH RECURSIVE contra esta misma
-- base, no leyendo el seed (el comentario anterior decía "2 niveles
-- reales" y por eso packages/db perdía esas 6 filas — ver US-4b).
-- ON DELETE SET NULL para que borrar una madre no arrastre a las hijas.
-- El CHECK de abajo prohíbe la autorreferencia, pero NO un ciclo
-- A->B->A: quien recorra el árbol necesita su propia guarda.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    slug        text         NOT NULL UNIQUE,
    icon        text,
    details     text,
    image       jsonb,
    parent_id   bigint       REFERENCES categories(id) ON DELETE SET NULL,
    type_id     bigint       NOT NULL REFERENCES types(id) ON DELETE CASCADE,
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    -- Una categoría no puede ser su propia madre.
    CONSTRAINT categories_no_autoreferencia CHECK (parent_id IS DISTINCT FROM id)
);


-- ---------------------------------------------------------------------
-- manufacturers — destino natural del campo `marca` del scraper.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturers (
    id           bigserial    PRIMARY KEY,
    name         text         NOT NULL,
    slug         text         NOT NULL UNIQUE,
    description  text,
    website      text,
    image        jsonb,
    type_id      bigint       REFERENCES types(id) ON DELETE SET NULL,
    is_approved  boolean      NOT NULL DEFAULT true,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS tags (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    slug        text         NOT NULL UNIQUE,
    details     text,
    icon        text,
    image       jsonb,
    type_id     bigint       REFERENCES types(id) ON DELETE SET NULL,
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- products — la tabla compartida.
--
-- Aquí está la decisión central del diseño: NO hay una tabla de staging
-- para el scraper y otra para la app. Es una sola tabla, y las columnas
-- `source_*` son NULL para los productos sembrados a mano y se rellenan
-- solo en los que vienen del scraper.
--
-- Eso resuelve el choque de claves:
--   · la app identifica por `slug` (único global, va en la URL)
--   · el scraper identifica por (source_store, source_product_id)
--
-- Ambas conviven como restricciones UNIQUE independientes, y el scraper
-- puede hacer upsert idempotente sin saber nada del slug.
-- =====================================================================
CREATE TABLE IF NOT EXISTS products (
    id                bigserial     PRIMARY KEY,

    name              text          NOT NULL,
    slug              text          NOT NULL UNIQUE,
    description       text          NOT NULL DEFAULT '',

    type_id           bigint        NOT NULL REFERENCES types(id) ON DELETE CASCADE,
    shop_id           bigint        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    manufacturer_id   bigint        REFERENCES manufacturers(id) ON DELETE SET NULL,

    product_type      text          NOT NULL DEFAULT 'simple'
                                    CHECK (product_type IN ('simple', 'variable')),

    -- Precios en NUMERIC, nunca FLOAT: el dinero no se guarda en binario
    -- de punto flotante. La moneda es global (tabla settings), no por
    -- fila, siguiendo el modelo de Pickbazar.
    --
    -- min_price/max_price existen porque un producto 'variable' no tiene
    -- precio propio sino un rango derivado de sus variaciones. Para los
    -- 'simple' los tres valen lo mismo.
    price             numeric(12,2),
    sale_price        numeric(12,2),
    min_price         numeric(12,2),
    max_price         numeric(12,2),

    quantity          integer       NOT NULL DEFAULT 0,
    in_stock          boolean       NOT NULL DEFAULT true,
    sold_quantity     integer       NOT NULL DEFAULT 0,

    sku               text,
    unit              text          NOT NULL DEFAULT '1 pc',

    -- El frontend SIEMPRE filtra por estos dos. Un producto que no los
    -- tenga en estos valores es invisible en la tienda.
    status            text          NOT NULL DEFAULT 'publish'
                                    CHECK (status IN ('publish', 'draft')),
    visibility        text          NOT NULL DEFAULT 'visibility_public',

    -- La app espera {id, original, thumbnail}. Se guarda como jsonb en
    -- vez de una tabla `attachments` porque siempre se lee entero, nunca
    -- se filtra por él, y en el mock el tipo era inestable (a veces
    -- objeto, a veces array vacío).
    image             jsonb,
    gallery           jsonb         NOT NULL DEFAULT '[]'::jsonb,

    ratings           numeric(3,2)  NOT NULL DEFAULT 0,
    total_reviews     integer       NOT NULL DEFAULT 0,

    is_taxable        boolean       NOT NULL DEFAULT false,
    is_digital        boolean       NOT NULL DEFAULT false,
    is_external       boolean       NOT NULL DEFAULT false,
    external_product_url text,

    language              text      NOT NULL DEFAULT 'es',
    translated_languages  text[]    NOT NULL DEFAULT ARRAY['es'],

    -- ── Procedencia (solo productos del scraper) ─────────────────────
    -- NULL en productos sembrados o creados desde el admin.
    source_store       text,        -- 'Alkosto', 'Exito', 'Falabella'...
    source_product_id  text,        -- id del producto en la tienda origen
    source_url         text,        -- enlace al producto original
    scraped_at         timestamptz,

    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),

    -- Invariante observada en los 1.200 productos del mock: cuando hay
    -- precio rebajado, siempre es menor que el de lista.
    CONSTRAINT products_rebaja_valida
        CHECK (sale_price IS NULL OR price IS NULL OR sale_price < price),

    -- Un producto 'simple' necesita precio; uno 'variable' lo deriva de
    -- sus variaciones y lo deja en NULL.
    CONSTRAINT products_simple_con_precio
        CHECK (product_type <> 'simple' OR price IS NOT NULL),

    -- La procedencia va completa o no va: evita filas a medio marcar
    -- que el upsert del scraper no podría volver a encontrar.
    CONSTRAINT products_procedencia_completa
        CHECK (num_nonnulls(source_store, source_product_id) IN (0, 2))
);

-- Clave natural del scraper. Es PARCIAL: solo aplica a las filas que
-- vienen del scraper, así que los productos sembrados a mano (con
-- source_* en NULL) no compiten por ella. Es el índice sobre el que
-- opera el ON CONFLICT del pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS products_procedencia_key
    ON products (source_store, source_product_id)
    WHERE source_store IS NOT NULL;


-- =====================================================================
-- category_product — la tabla puente que el mock NUNCA materializó.
--
-- La entidad del backend declara `Product.categories: Category[]` y el
-- buscador filtra por `categories.slug`, pero los 1.200 productos del
-- mock traen la relación VACÍA: hoy cualquier búsqueda por categoría
-- devuelve cero resultados. Esta tabla es lo que hace que ese filtro
-- funcione de verdad.
-- =====================================================================
CREATE TABLE IF NOT EXISTS category_product (
    product_id   bigint  NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
    category_id  bigint  NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, category_id)
);

CREATE TABLE IF NOT EXISTS product_tag (
    product_id  bigint  NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tag_id      bigint  NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
    PRIMARY KEY (product_id, tag_id)
);


-- =====================================================================
-- Identidad extendida (US-41, Épico 40) — staff por tienda y la página
-- "vender con nosotros".
--
-- Van al FINAL del bloque de tablas: shop_staff referencia users y shops
-- (ambas arriba), y así las citas `db/schema.sql:N` vivas del repo no se
-- desplazan más de lo inevitable.
--
-- NINGUNA lleva trigger: la política de reloj único de abajo las gobierna
-- igual que al resto -- `updated_at` lo fija la capa de datos, y shop_staff
-- ni siquiera tiene esa columna.
-- =====================================================================

-- shop_staff — pivote puro user<->shop, calco de permission_user.
--
-- SIN columna de rol, a propósito: StaffsController.getStaffs devuelve
-- UserPaginator (usuarios, no filas de pivote), GetStaffsDto solo filtra por
-- shop_id y AddStaffInput del admin es {email,password,name,shop_id}. Un
-- `role` sería especulativo. Sin `updated_at`: un pivote se crea o se borra,
-- nunca se actualiza (igual que permission_user y product_tag).
--
-- El título de CA-1 en la US dice "con rol"
-- (41-esquema-identidad-extendida.md:61); el código no lo respalda y la spec
-- ya zanja que gana el código (extended-identity-schema/spec.md:24-26).
CREATE TABLE IF NOT EXISTS shop_staff (
    user_id     bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id     bigint       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, shop_id)
);


-- ---------------------------------------------------------------------
-- become_seller — la fila única de la página "vender con nosotros".
--
-- Mismo patrón que settings: id smallint fijo + CHECK de fila única. DOS
-- columnas jsonb, no una: become-seller.json trae `page_options` y
-- `commissions` como claves HERMANAS y el GET real sirve ambas
-- (plainToClass sin excludeExtraneousValues); fundirlas bajo un nombre que
-- dice `page_options` haría mentir a la columna.
--
-- `page_options` guarda el objeto INTERNO (data.page_options.page_options,
-- 24 claves), NO el envoltorio con forma de settings: los id/language/
-- created_at/updated_at de ese envoltorio son exactamente estas cuatro
-- columnas y meterlos en el jsonb fosilizaría las fechas del mock. El
-- envoltorio se recompone en el servicio (US-44).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS become_seller (
    id            smallint     PRIMARY KEY DEFAULT 1,
    page_options  jsonb        NOT NULL,
    commissions   jsonb        NOT NULL,
    language      text         NOT NULL DEFAULT 'es',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT become_seller_fila_unica CHECK (id = 1)
);


-- =====================================================================
-- Contenido (US-47, Épico 46) — FAQ y términos y condiciones.
--
-- Sembradas desde faqs.json y terms-and-conditions.json. Las dos tienen
-- la misma forma: contenido global (emitido por el super admin) o de una
-- tienda. `issued_by` es TEXTO, no FK: es lo que la tienda filtra (el nombre
-- del emisor, "Super Admin" o el de la tienda), y el mock no trae otra cosa.
-- `shop_id` sí es FK: el seed lo deriva de `issued_by` en las FAQ de tienda.
--
-- ON DELETE: el contenido de una tienda borrada no tiene a quién pertenecer
-- (CASCADE); el autor se puede borrar sin perder la FAQ (SET NULL).
-- Sin trigger de updated_at: reloj único, ver el final del archivo.
-- =====================================================================
CREATE TABLE IF NOT EXISTS faqs (
    id               bigserial    PRIMARY KEY,
    faq_title        text         NOT NULL,
    slug             text         NOT NULL UNIQUE,
    faq_description  text         NOT NULL,
    faq_type         text         NOT NULL
                                  CHECK (faq_type IN ('global', 'shop')),
    issued_by        text         NOT NULL,
    shop_id          bigint       REFERENCES shops(id) ON DELETE CASCADE,
    user_id          bigint       REFERENCES users(id) ON DELETE SET NULL,
    language         text         NOT NULL DEFAULT 'es',
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- terms_and_conditions — misma forma que faqs, más la cola de moderación.
--
-- El mock trae 10 filas con 5 slugs repetidos (los ids 8-12 son copias
-- exactas de 1-5); con `slug` UNIQUE el seed conserva la primera aparición
-- en el orden del archivo, que es la que GET /:slug devolvía.
-- `is_approved` es boolean aunque el mock emita 1/0: la proyección a entero
-- vive en el servicio de Nest.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terms_and_conditions (
    id           bigserial    PRIMARY KEY,
    title        text         NOT NULL,
    slug         text         NOT NULL UNIQUE,
    description  text         NOT NULL,
    type         text         NOT NULL
                              CHECK (type IN ('global', 'shop')),
    issued_by    text         NOT NULL,
    is_approved  boolean      NOT NULL DEFAULT false,
    shop_id      bigint       REFERENCES shops(id) ON DELETE CASCADE,
    user_id      bigint       REFERENCES users(id) ON DELETE SET NULL,
    language     text         NOT NULL DEFAULT 'es',
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Reembolsos (US-48, Épico 46) — políticas y motivos.
--
-- Sembradas desde refund-policies.json y refund-reasons.json. NO es el
-- dominio de reembolsos (el módulo `refunds` es un stub sin JSON): son las
-- dos listas de contenido que lo rodean.
--
-- refund_policies — `target` dice a quién aplica (la tienda filtra por él en
-- /customer-refund-policies y /vendor-refund-policies) y `status` es la cola
-- de moderación que el admin conoce (approved | pending). `shop_id` es
-- opcional, como en el resto del contenido: CASCADE, sin tienda no hay a
-- quién aplicarla.
-- =====================================================================
CREATE TABLE IF NOT EXISTS refund_policies (
    id           bigserial    PRIMARY KEY,
    title        text         NOT NULL,
    slug         text         NOT NULL UNIQUE,
    description  text,
    target       text         NOT NULL
                              CHECK (target IN ('vendor', 'customer')),
    status       text         NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('approved', 'pending')),
    shop_id      bigint       REFERENCES shops(id) ON DELETE CASCADE,
    language     text         NOT NULL DEFAULT 'es',
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- refund_reasons — catálogo plano de motivos que el cliente elige al pedir
-- un reembolso. Es la primera tabla del épico cuyo contrato EMITE
-- created_at/updated_at, así que el seed inserta las fechas del mock en vez
-- de dejar el DEFAULT now().
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refund_reasons (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    slug        text         NOT NULL UNIQUE,
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Configuración fiscal y de envío (US-49, Épico 46) — taxes y shippings.
--
-- Una fila cada una en el mock ("Global", id 1). La relación con settings
-- es BLANDA: settings.options.taxClass/shippingClass guardan el id "1" como
-- texto dentro del jsonb, sin FK. Por eso los ids 1 se preservan, y por eso
-- estas tablas no tocan el contrato congelado de /api/settings.
--
-- `numeric` SIN escala a propósito: `rate 2` y `amount 50` vuelven como 2 y
-- 50, no como 2.00 (el contrato los emite como número JSON). Sin `language`:
-- ninguno de los dos mocks lo trae. Sin trigger (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS taxes (
    id           bigserial    PRIMARY KEY,
    name         text         NOT NULL,
    rate         numeric      NOT NULL CHECK (rate >= 0),
    is_global    boolean      NOT NULL DEFAULT true,
    country      text,
    state        text,
    zip          text,
    city         text,
    priority     integer,
    on_shipping  boolean      NOT NULL DEFAULT true,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS shippings (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    amount      numeric      NOT NULL CHECK (amount >= 0),
    is_global   boolean      NOT NULL DEFAULT true,
    type        text         NOT NULL
                             CHECK (type IN ('fixed', 'percentage', 'free')),
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Atributos de producto (US-50, Épico 46) — attributes + attribute_values.
--
-- Agregado padre-hijo sembrado desde attributes.json (8 atributos, 27
-- valores). Es la base de las variaciones de producto que todavía no se
-- persisten (épico aparte): aquí solo vive el catálogo de atributos.
--
-- Un atributo es de SU tienda (shop_id NOT NULL, CASCADE, igual que
-- products.shop_id). Sin type_id: el mock trae `type` todo null. Los valores
-- no llevan shop_id: lo heredan del padre. El slug del valor es único DENTRO
-- de su atributo, no globalmente ("Color" existe en tres tiendas).
-- Sin trigger de updated_at (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS attributes (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    slug        text         NOT NULL UNIQUE,
    shop_id     bigint       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS attribute_values (
    id            bigserial    PRIMARY KEY,
    attribute_id  bigint       NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
    value         text         NOT NULL,
    slug          text         NOT NULL,
    meta          text,
    language      text         NOT NULL DEFAULT 'es',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (attribute_id, slug)
);


-- =====================================================================
-- Avisos de tienda (US-51, Épico 46) — store_notices + 3 pivotes.
--
-- Los avisos que el super admin (o un dueño, para su tienda) publica en la
-- barra superior del panel. Primera tabla del épico que toca identidad: el
-- autor y los destinatarios son usuarios reales. El mock trae created_by = 6
-- (admin@demo.com en el Laravel original); el generador lo resuelve POR EMAIL
-- al id del seed (3), nunca copia el id.
--
-- ON DELETE del autor: RESTRICT, como shops.owner_id. Un aviso que otros ya
-- leyeron no puede quedarse sin autor en silencio. El último editor sí puede
-- borrarse (SET NULL). Sin trigger de updated_at (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS store_notices (
    id              bigserial    PRIMARY KEY,
    priority        text         NOT NULL
                                 CHECK (priority IN ('high', 'medium', 'low')),
    notice          text         NOT NULL,
    description     text,
    effective_from  timestamptz,
    expired_at      timestamptz  NOT NULL,
    type            text         NOT NULL
                                 CHECK (type IN ('all_vendor', 'specific_vendor', 'all_shop', 'specific_shop')),
    created_by      bigint       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by      bigint       REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT store_notices_vigencia_valida
        CHECK (effective_from IS NULL OR effective_from <= expired_at)
);


-- ---------------------------------------------------------------------
-- Destinatarios y estado de lectura. Tres pivotes puros, calco de
-- permission_user: PK compuesta, las dos FK en CASCADE (borrar el aviso, el
-- usuario o la tienda se lleva su fila) y solo created_at.
--
--   store_notice_user  — usuarios destinatarios (avisos *_vendor).
--   store_notice_shop  — tiendas destinatarias (avisos *_shop).
--   store_notice_read  — si cada usuario ya lo leyó; el is_read que emite la
--                        API es el del usuario que consulta, no uno global.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_notice_user (
    store_notice_id  bigint       NOT NULL REFERENCES store_notices(id) ON DELETE CASCADE,
    user_id          bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (store_notice_id, user_id)
);


CREATE TABLE IF NOT EXISTS store_notice_shop (
    store_notice_id  bigint       NOT NULL REFERENCES store_notices(id) ON DELETE CASCADE,
    shop_id          bigint       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (store_notice_id, shop_id)
);


CREATE TABLE IF NOT EXISTS store_notice_read (
    store_notice_id  bigint       NOT NULL REFERENCES store_notices(id) ON DELETE CASCADE,
    user_id          bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_read          boolean      NOT NULL DEFAULT false,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (store_notice_id, user_id)
);


-- =====================================================================
-- Cupones (US-52, Épico 46) — primera tabla del dominio transaccional.
--
-- Sembrada desde coupons.json (10 cupones). `is_valid` NO es columna: la API
-- lo calcula en cada lectura desde la vigencia (active_from <= now() <
-- expire_at). Con el seed del mock las 10 filas ya vencieron.
--
-- `image` es `json`, no `jsonb` (D-5): el contrato preserva el orden de
-- claves y dos filas traen {thumbnail, original, id}. Un cupón de tienda
-- muere con su tienda (CASCADE, como products.shop_id); shop_id NULL es un
-- cupón global de super_admin. El autor puede borrarse (SET NULL).
-- Sin trigger de updated_at (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS coupons (
    id                   bigserial    PRIMARY KEY,
    code                 text         NOT NULL UNIQUE,
    description          text,
    image                json,
    type                 text         NOT NULL
                                      CHECK (type IN ('fixed', 'percentage', 'free_shipping')),
    amount               numeric      NOT NULL CHECK (amount >= 0),
    minimum_cart_amount  numeric      NOT NULL DEFAULT 0 CHECK (minimum_cart_amount >= 0),
    active_from          timestamptz  NOT NULL,
    expire_at            timestamptz  NOT NULL,
    target               boolean      NOT NULL DEFAULT false,
    is_approve           boolean      NOT NULL DEFAULT false,
    shop_id              bigint       REFERENCES shops(id) ON DELETE CASCADE,
    user_id              bigint       REFERENCES users(id) ON DELETE SET NULL,
    language             text         NOT NULL DEFAULT 'es',
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT coupons_vigencia_valida CHECK (expire_at > active_from)
);


-- =====================================================================
-- Lista de deseos (US-53, Épico 46) — wishlists, pivote usuario ↔ producto.
--
-- Calco de permission_user/product_tag: PK compuesta y las dos FK en
-- CASCADE, porque un favorito no sobrevive a su usuario ni a su producto.
-- Sin updated_at: la fila no se edita, se crea o se borra. created_at ordena
-- la lista (más reciente primero).
--
-- El mock (wishlists.json) trae 10 productos sin dueño; el seed se los da a
-- customer@demo.com, el único cliente del seed.
-- =====================================================================
CREATE TABLE IF NOT EXISTS wishlists (
    user_id     bigint       NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    product_id  bigint       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);


-- =====================================================================
-- Reseñas y reportes de abuso (US-54, Épico 46) — reviews + abusive_reports.
--
-- Sembradas desde reviews.json (85) y reports.json (3). Las reseñas son de
-- los usuarios 2, 4 y 5 del mock; el 4 y el 5 no estaban en users.json y el
-- generador los SIEMBRA desde el `user` embebido (D-4).
--
-- reviews: contenido de su autor sobre un producto de una tienda; sin
-- cualquiera de los tres no tiene sentido (CASCADE en las tres FK, mismo
-- criterio que products.shop_id). order_id y variation_option_id van SIN FK:
-- orders llega en US-58 y no hay tabla de variaciones. Los contadores de
-- feedback son columnas: no hay filas de votos que los respalden. `photos`
-- es `json`, no `jsonb` (D-5): el orden de claves de cada foto es contrato.
--
-- abusive_reports: polimórfica (model_type + model_id, sin FK); el
-- repositorio valida que el objeto exista. model_type guarda el nombre
-- corto ('Review'), la API emite el FQCN de Laravel. Un reporte por usuario
-- y objeto. Sin trigger de updated_at (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS reviews (
    id                        bigserial    PRIMARY KEY,
    order_id                  bigint,
    user_id                   bigint       NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    shop_id                   bigint       NOT NULL REFERENCES shops(id)    ON DELETE CASCADE,
    product_id                bigint       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variation_option_id       bigint,
    comment                   text         NOT NULL,
    rating                    smallint     NOT NULL CHECK (rating BETWEEN 1 AND 5),
    photos                    json         NOT NULL DEFAULT '[]'
                                           CHECK (json_typeof(photos) = 'array'),
    positive_feedbacks_count  integer      NOT NULL DEFAULT 0 CHECK (positive_feedbacks_count >= 0),
    negative_feedbacks_count  integer      NOT NULL DEFAULT 0 CHECK (negative_feedbacks_count >= 0),
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now()
);

-- Una reseña por compra, y una sin orden por producto. Índice de expresión:
-- Prisma no lo modela (cabecera de schema.prisma), igual que
-- users_email_lower_idx.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_autor_producto_orden_key
    ON reviews (user_id, product_id, COALESCE(order_id, 0));


CREATE TABLE IF NOT EXISTS abusive_reports (
    id          bigserial    PRIMARY KEY,
    user_id     bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_type  text         NOT NULL CHECK (model_type IN ('Review', 'Question')),
    model_id    bigint       NOT NULL,
    message     text         NOT NULL CHECK (length(message) > 0),
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (user_id, model_type, model_id)
);


-- =====================================================================
-- Preguntas sobre productos (US-55, Épico 46) — questions.
--
-- Sembradas desde questions.json (68). Sus autores son los usuarios 2 y 4;
-- el 4 (customer2@demo.com) lo siembra el bloque de reseñas (US-54).
--
-- CASCADE en las tres FK por el mismo criterio que reviews: la pregunta es
-- contenido de su autor sobre un producto de una tienda. SIN UNIQUE (user,
-- product): el mock trae 20 pares repetidos legítimos (varias preguntas del
-- mismo usuario sobre el mismo producto). `answer` NULL = sin responder.
-- Los contadores de feedback son columnas, como en reviews. Es reportable
-- desde abusive_reports (model_type 'Question'). Sin trigger de updated_at.
-- =====================================================================
CREATE TABLE IF NOT EXISTS questions (
    id                        bigserial    PRIMARY KEY,
    user_id                   bigint       NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    shop_id                   bigint       NOT NULL REFERENCES shops(id)    ON DELETE CASCADE,
    product_id                bigint       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    question                  text         NOT NULL CHECK (length(question) > 0),
    answer                    text,
    positive_feedbacks_count  integer      NOT NULL DEFAULT 0 CHECK (positive_feedbacks_count >= 0),
    negative_feedbacks_count  integer      NOT NULL DEFAULT 0 CHECK (negative_feedbacks_count >= 0),
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Mensajería cliente ↔ tienda (US-56, Épico 46) — conversations + messages.
--
-- Un solo agregado: la conversación de un usuario con una tienda y sus
-- mensajes. Sembradas desde conversations.json (2) y messages.json (5).
-- El usuario 6 del mock es admin@demo.com, que aquí es el 3 (D-4).
--
-- Una conversación por par (user, shop), que es lo que hace Pickbazar: el
-- POST la reutiliza. CASCADE en todas las FK: sin usuario, tienda o
-- conversación, un mensaje no tiene a quién pertenecer.
--
-- latest_message y unseen NO son columnas: la API los calcula desde los
-- mensajes (el mock los traía incoherentes). Escribir un mensaje fija
-- conversations.updated_at con el reloj de Node, para que la conversación
-- suba al ordenar por updated_at. El estado de lectura vive aparte, en
-- conversation_reads (US-64). Sin triggers (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS conversations (
    id          bigserial    PRIMARY KEY,
    user_id     bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id     bigint       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (user_id, shop_id)
);


CREATE TABLE IF NOT EXISTS messages (
    id               bigserial    PRIMARY KEY,
    conversation_id  bigint       NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id          bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body             text         NOT NULL CHECK (length(btrim(body)) > 0),
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Estado de lectura de las conversaciones (US-64) — conversation_reads.
--
-- Calco de store_notice_read: una fila por (conversación, usuario) con la
-- última vez que ese participante la leyó (POST /messages/seen/:id). Va por
-- participante y no como columna de conversations porque la leen al menos
-- dos personas (el cliente y quien atiende la tienda), cada una con su
-- propio «sin leer». La API calcula unseen comparando last_seen_at con el
-- created_at del último mensaje; los dos salen de now() de clock.ts.
--
-- Arranca VACÍA: el mock no trae estado de lectura. Las dos FK en CASCADE:
-- sin conversación o sin usuario, la marca no tiene a quién pertenecer.
-- =====================================================================
CREATE TABLE IF NOT EXISTS conversation_reads (
    conversation_id  bigint       NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id          bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_seen_at     timestamptz  NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);


-- =====================================================================
-- Catálogo de estados de pedido (US-57, Épico 46) — order_statuses.
--
-- Sembrado desde order-statuses.json (10 filas) con sus ids y sus fechas.
-- `serial` es la posición en el flujo: única y positiva, y es el orden de
-- la lista (el 7 «Delivered» lleva el serial 11; el 7 no existe).
--
-- NO es el vocabulario de orders.order_status: las órdenes usan el enum
-- OrderStatusType (order-pending, order-completed…) y este catálogo usa
-- otros slugs. Por eso no hay FK desde orders, y borrar un estado no
-- afecta a ninguna orden. translated_languages no es columna: la API lo
-- emite como constante. Sin trigger (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS order_statuses (
    id          bigserial    PRIMARY KEY,
    name        text         NOT NULL,
    slug        text         NOT NULL UNIQUE,
    serial      integer      NOT NULL UNIQUE CHECK (serial > 0),
    color       text         NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    language    text         NOT NULL DEFAULT 'es',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Órdenes (US-58, Épico 46) — orders + order_products.
--
-- Sembradas desde orders.json: 20 padres con 1 hija cada uno (40 filas) y
-- 76 líneas. Padres e hijas comparten tabla, como en Pickbazar: el padre
-- agrupa la compra y no tiene tienda; cada hija es la parte de una tienda.
-- La CHECK orders_padre_o_hija lo exige.
--
-- Los snapshots (customer_snapshot, product_snapshot) y las direcciones
-- van en json, NO en jsonb: jsonb reordena las claves y el contrato emite
-- las 43 del producto y las 9 del cliente en el orden del mock. Son el
-- estado en el momento de la compra, no la fila viva.
--
-- Dinero en numeric SIN escala (el mock trae 3 decimales: sales_tax 0.044),
-- salvo cancelled_*, que el contrato emite como string con 2 decimales.
-- order_status/payment_status/payment_gateway son los enums de la API
-- (orders/entities/order.entity.ts), NO el catálogo order_statuses (US-57).
--
-- FK: el cliente se pone a NULL si se borra (la orden es histórica, y NULL
-- es también el invitado); la tienda es RESTRICT (no hay deleteShop); el
-- producto de una línea se pone a NULL para que DELETE /products siga
-- funcionando con productos vendidos. Sin triggers (reloj único).
-- =====================================================================
CREATE TABLE IF NOT EXISTS orders (
    id                       bigserial    PRIMARY KEY,
    tracking_number          text         NOT NULL UNIQUE
                                          CHECK (tracking_number ~ '^[0-9]{14}$'),
    parent_id                bigint       REFERENCES orders(id)  ON DELETE CASCADE,
    customer_id              bigint       REFERENCES users(id)   ON DELETE SET NULL,
    customer_contact         text,
    customer_name            text,
    customer_snapshot        json,
    shop_id                  bigint       REFERENCES shops(id)   ON DELETE RESTRICT,
    amount                   numeric      NOT NULL DEFAULT 0 CHECK (amount >= 0),
    sales_tax                numeric      NOT NULL DEFAULT 0 CHECK (sales_tax >= 0),
    paid_total               numeric      NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
    total                    numeric      NOT NULL DEFAULT 0 CHECK (total >= 0),
    discount                 numeric      NOT NULL DEFAULT 0 CHECK (discount >= 0),
    delivery_fee             numeric      NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    cancelled_amount         numeric(12,2) NOT NULL DEFAULT 0,
    cancelled_tax            numeric(12,2) NOT NULL DEFAULT 0,
    cancelled_delivery_fee   numeric(12,2) NOT NULL DEFAULT 0,
    note                     text,
    altered_payment_gateway  text,
    logistics_provider       text,
    delivery_time            text,
    language                 text         NOT NULL DEFAULT 'es',
    coupon_id                bigint       REFERENCES coupons(id) ON DELETE SET NULL,
    payment_gateway          text         NOT NULL
                                          CHECK (payment_gateway IN ('STRIPE', 'CASH_ON_DELIVERY', 'CASH',
                                                                     'FULL_WALLET_PAYMENT', 'PAYPAL', 'RAZORPAY')),
    order_status             text         NOT NULL
                                          CHECK (order_status IN ('order-pending', 'order-processing',
                                                                  'order-completed', 'order-cancelled',
                                                                  'order-refunded', 'order-failed',
                                                                  'order-at-local-facility',
                                                                  'order-out-for-delivery')),
    payment_status           text         NOT NULL
                                          CHECK (payment_status IN ('payment-pending', 'payment-processing',
                                                                    'payment-success', 'payment-failed',
                                                                    'payment-reversal', 'payment-cash-on-delivery',
                                                                    'payment-cash', 'payment-wallet',
                                                                    'payment-awaiting-for-approval')),
    shipping_address         json         CHECK (shipping_address IS NULL
                                                 OR json_typeof(shipping_address) IN ('object', 'array')),
    billing_address          json         CHECK (billing_address IS NULL
                                                 OR json_typeof(billing_address) IN ('object', 'array')),
    created_at               timestamptz  NOT NULL DEFAULT now(),
    updated_at               timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT orders_padre_o_hija CHECK (
        (parent_id IS NULL AND shop_id IS NULL) OR (parent_id IS NOT NULL AND shop_id IS NOT NULL)
    )
);


-- Una línea por producto (y variación) de la orden. line_no conserva el
-- orden del products[] del mock. variation_option_id sin FK: no hay tabla
-- de variaciones. El snapshot es el producto sin su pivot; las columnas
-- son el pivot.
CREATE TABLE IF NOT EXISTS order_products (
    order_id             bigint       NOT NULL REFERENCES orders(id)   ON DELETE CASCADE,
    line_no              smallint     NOT NULL CHECK (line_no > 0),
    product_id           bigint       REFERENCES products(id) ON DELETE SET NULL,
    variation_option_id  bigint,
    order_quantity       integer      NOT NULL CHECK (order_quantity > 0),
    unit_price           numeric      NOT NULL CHECK (unit_price >= 0),
    subtotal             numeric      NOT NULL CHECK (subtotal >= 0),
    product_snapshot     json         NOT NULL,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, line_no),
    UNIQUE (order_id, product_id, variation_option_id)
);


-- FK pendiente de US-54: reviews.order_id existía sin FK porque orders no
-- existía. No se edita el CREATE TABLE reviews: se añade aquí, idempotente
-- (db-up re-aplica este archivo sobre un volumen vivo y un ALTER desnudo
-- fallaría la segunda vez). SET NULL: la reseña sobrevive a su orden.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_order_id_fkey') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;


-- =====================================================================
-- Descargas digitales (US-60, Épico 46) — order_files.
--
-- Sembradas desde order-files.json (10 filas, todas de customer@demo.com
-- y sin orden). Una fila es el derecho de un cliente a descargar un archivo
-- digital comprado; la API solo le muestra las suyas.
--
-- digital_file_id NO es UNIQUE: el mock lo repite (42 en 4 filas) y la
-- descarga toma la primera por id. No hay tabla digital_files: ningún mock
-- la respalda. `file` es el snapshot del archivo con su `fileable`
-- (producto o variación), en json y no en jsonb, porque el orden de sus
-- claves es contrato. El cliente es CASCADE (la descarga es suya); la orden,
-- SET NULL. Sin trigger (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS order_files (
    id               bigserial    PRIMARY KEY,
    purchase_key     text         NOT NULL UNIQUE,
    digital_file_id  bigint       NOT NULL,
    order_id         bigint       REFERENCES orders(id) ON DELETE SET NULL,
    customer_id      bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file             json         NOT NULL,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now()
);


-- =====================================================================
-- Retiros de tienda (US-62, Épico 46) — withdraws.
--
-- Sembrada desde withdraws.json (2 solicitudes de la tienda 3). Un retiro
-- es lo que una tienda pide cobrar; el super admin le cambia el estado. El
-- vocabulario de status es la minúscula del dato y del admin (on_hold con
-- guion bajo), no el TitleCase del enum de la entidad Nest.
--
-- No hay columna ni tabla de balance: aprobar no descuenta nada (decisión 4
-- del épico). Sin deleted_at: se borra de verdad y la API emite null. Un
-- retiro muere con su tienda (CASCADE, como products.shop_id). Sin trigger
-- (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS withdraws (
    id              bigserial      PRIMARY KEY,
    shop_id         bigint         NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    amount          numeric(12,2)  NOT NULL CHECK (amount > 0),
    payment_method  text           NOT NULL,
    status          text           NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'on_hold', 'rejected', 'processing')),
    details         text,
    note            text,
    created_at      timestamptz    NOT NULL DEFAULT now(),
    updated_at      timestamptz    NOT NULL DEFAULT now()
);


-- =====================================================================
-- Transferencias de propiedad de tienda (US-63, Épico 46) —
-- ownership_transfers.
--
-- Sembrada desde ownership-transfer.json (6 solicitudes pending, sin tienda).
-- Una fila registra que una tienda pasa (o pidió pasar) de previous_owner a
-- current_owner; POST /transfer-shop-ownership inserta una 'approved' en la
-- misma transacción que cambia shops.owner_id.
--
-- balance_info es la FOTO del balance al crear la transferencia (D-5): no se
-- proyecta de ninguna tabla (no hay tabla de balances, decisión 4) ni se
-- valida su shop_id. Va en json y no en jsonb, igual que order_info,
-- refund_info y withdrawal_info: jsonb reordena las claves y el orden es
-- contrato; payment_info sigue siendo un string dentro del documento.
--
-- Los usuarios son RESTRICT: el historial no se pierde al borrar a alguien
-- (mismo criterio que shops.owner_id). La tienda es SET NULL. created_at y
-- updated_at ordenan y siguen el reloj único, pero la API no los emite (el
-- mock no los trae). Sin trigger (reloj único, ver abajo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS ownership_transfers (
    id                      bigserial    PRIMARY KEY,
    transaction_identifier  text         NOT NULL UNIQUE,
    shop_id                 bigint       REFERENCES shops(id) ON DELETE SET NULL,
    previous_owner_id       bigint       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    current_owner_id        bigint       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by              bigint       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    message                 text,
    status                  text         NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending', 'processing', 'approved', 'rejected')),
    order_info              json,
    balance_info            json,
    refund_info             json,
    withdrawal_info         json,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    updated_at              timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ownership_transfers_owners_distintos CHECK (previous_owner_id <> current_owner_id)
);


-- =====================================================================
-- Índices.
--
-- No son decorativos: cada uno responde a un filtro que el frontend
-- envía de verdad. La lista sale de formatSearchParams() en
-- apps/shop/src/framework/rest/client/http-client.ts.
-- =====================================================================

-- El shop manda status='publish' y visibility='visibility_public' en
-- TODAS las consultas de catálogo. Índice parcial: solo indexa las filas
-- visibles, que es sobre las que siempre se pregunta.
CREATE INDEX IF NOT EXISTS products_visibles_idx
    ON products (type_id, id)
    WHERE status = 'publish' AND visibility = 'visibility_public';

CREATE INDEX IF NOT EXISTS products_shop_idx          ON products (shop_id);
CREATE INDEX IF NOT EXISTS products_manufacturer_idx  ON products (manufacturer_id);
-- Soporta los filtros min_price / max_price.
CREATE INDEX IF NOT EXISTS products_precio_idx        ON products (price);
CREATE INDEX IF NOT EXISTS products_scraped_idx       ON products (scraped_at DESC NULLS LAST);

-- Búsqueda por nombre. En el mock la hacía Fuse.js en memoria sobre
-- 1.200 productos; con un catálogo real hay que resolverla en la base.
-- Sobre la COLUMNA, no sobre lower(name) (US-69): Prisma traduce
-- `contains` + `mode: insensitive` a `name ILIKE '%x%'`, y un índice de
-- expresión solo sirve a consultas con la misma expresión. gin_trgm_ops
-- resuelve el ILIKE porque el trigrama ya es insensible a mayúsculas. El
-- nombre es nuevo a propósito: IF NOT EXISTS no reemplaza el índice viejo
-- (products_nombre_trgm_idx) en una base ya creada; adoptarlo pide db-reset.
CREATE INDEX IF NOT EXISTS products_nombre_ilike_trgm_idx
    ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS categories_parent_idx  ON categories (parent_id);
CREATE INDEX IF NOT EXISTS categories_type_idx    ON categories (type_id);
-- Para navegar de categoría a productos hace falta el sentido inverso
-- de la clave primaria de la tabla puente.
CREATE INDEX IF NOT EXISTS category_product_categoria_idx ON category_product (category_id);
CREATE INDEX IF NOT EXISTS product_tag_tag_idx            ON product_tag (tag_id);

-- El inverso del pivote de permisos: lo pide US-25 CA-2.
CREATE INDEX IF NOT EXISTS permission_user_permiso_idx    ON permission_user (permission_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS otp_codes_phone_idx            ON otp_codes (phone);

-- El inverso del pivote de staff: GetStaffsDto filtra por shop_id, que la PK
-- (user_id, shop_id) no cubre por la izquierda. Gemelo de
-- permission_user_permiso_idx.
CREATE INDEX IF NOT EXISTS shop_staff_tienda_idx ON shop_staff (shop_id);

-- Contenido (US-47): cada FK saliente con su índice. El shop filtra FAQ y
-- términos por shop_id en las páginas de cada tienda.
CREATE INDEX IF NOT EXISTS faqs_shop_idx                  ON faqs (shop_id);
CREATE INDEX IF NOT EXISTS faqs_user_idx                  ON faqs (user_id);
CREATE INDEX IF NOT EXISTS terms_and_conditions_shop_idx  ON terms_and_conditions (shop_id);
CREATE INDEX IF NOT EXISTS terms_and_conditions_user_idx  ON terms_and_conditions (user_id);

-- Reembolsos (US-48).
CREATE INDEX IF NOT EXISTS refund_policies_shop_idx       ON refund_policies (shop_id);

-- Atributos (US-50): el admin filtra por shop_id (pantalla de tienda y
-- formulario de producto variable). attribute_values.attribute_id ya queda
-- cubierto por la izquierda del UNIQUE (attribute_id, slug).
CREATE INDEX IF NOT EXISTS attributes_shop_idx            ON attributes (shop_id);

-- Avisos (US-51): cada FK saliente con su índice. Los inversos de los
-- pivotes responden a los filtros del admin (users.id, shops.slug).
CREATE INDEX IF NOT EXISTS store_notices_created_by_idx   ON store_notices (created_by);
CREATE INDEX IF NOT EXISTS store_notices_updated_by_idx   ON store_notices (updated_by);
CREATE INDEX IF NOT EXISTS store_notice_user_usuario_idx  ON store_notice_user (user_id);
CREATE INDEX IF NOT EXISTS store_notice_shop_tienda_idx   ON store_notice_shop (shop_id);
CREATE INDEX IF NOT EXISTS store_notice_read_usuario_idx  ON store_notice_read (user_id);

-- Cupones (US-52): el shop filtra por shop_id en /shops/[slug]/offers.
CREATE INDEX IF NOT EXISTS coupons_shop_idx               ON coupons (shop_id);
CREATE INDEX IF NOT EXISTS coupons_user_idx               ON coupons (user_id);

-- Lista de deseos (US-53): el inverso del pivote, para la cascada desde
-- products y para saber quién marcó un producto.
CREATE INDEX IF NOT EXISTS wishlists_producto_idx         ON wishlists (product_id);

-- Reseñas (US-54): el shop filtra por product_id y el admin por shop_id.
-- user_id queda cubierto por la izquierda del único de expresión. El índice
-- polimórfico de abusive_reports sirve al conteo por reseña.
CREATE INDEX IF NOT EXISTS reviews_shop_idx               ON reviews (shop_id);
CREATE INDEX IF NOT EXISTS reviews_producto_idx           ON reviews (product_id);
CREATE INDEX IF NOT EXISTS abusive_reports_modelo_idx     ON abusive_reports (model_type, model_id);

-- Preguntas (US-55): cada FK con su índice (my-questions filtra por user_id,
-- el shop por product_id y el admin por shop_id). La búsqueda por texto
-- sigue el precedente de products_nombre_ilike_trgm_idx: trigram sobre la
-- columna para que la use el ILIKE de Prisma (US-69; antes era
-- questions_question_trgm_idx, sobre lower(question)).
CREATE INDEX IF NOT EXISTS questions_user_idx             ON questions (user_id);
CREATE INDEX IF NOT EXISTS questions_shop_idx             ON questions (shop_id);
CREATE INDEX IF NOT EXISTS questions_producto_idx         ON questions (product_id);
CREATE INDEX IF NOT EXISTS questions_question_ilike_trgm_idx
    ON questions USING gin (question gin_trgm_ops);

-- Mensajería (US-56): conversations.user_id ya queda cubierto por la
-- izquierda del UNIQUE (user_id, shop_id). El índice de messages sirve al
-- último mensaje por conversación y al listado paginado.
CREATE INDEX IF NOT EXISTS conversations_shop_idx         ON conversations (shop_id);
CREATE INDEX IF NOT EXISTS messages_conversacion_idx
    ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_user_idx              ON messages (user_id);
-- Lecturas (US-64): la PK cubre conversation_id; user_id sirve a su FK.
CREATE INDEX IF NOT EXISTS conversation_reads_user_idx    ON conversation_reads (user_id);

-- Órdenes (US-58): el listado del cliente filtra customer_id, el de una
-- tienda shop_id y el detalle embebe hijas por parent_id. order_products
-- ya queda cubierto por su PK para order_id.
CREATE INDEX IF NOT EXISTS orders_parent_idx              ON orders (parent_id);
CREATE INDEX IF NOT EXISTS orders_customer_idx            ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_shop_idx                ON orders (shop_id);
CREATE INDEX IF NOT EXISTS orders_coupon_idx              ON orders (coupon_id);
CREATE INDEX IF NOT EXISTS order_products_producto_idx    ON order_products (product_id);

-- Descargas (US-60): la lista y la descarga filtran por cliente y por
-- digital_file_id; order_id sirve a su FK.
CREATE INDEX IF NOT EXISTS order_files_customer_idx       ON order_files (customer_id);
CREATE INDEX IF NOT EXISTS order_files_digital_file_idx   ON order_files (digital_file_id);
CREATE INDEX IF NOT EXISTS order_files_order_idx          ON order_files (order_id);

-- Retiros (US-62): la lista filtra por tienda (la del dueño o la de la query).
CREATE INDEX IF NOT EXISTS withdraws_shop_idx             ON withdraws (shop_id);

-- Transferencias (US-63): el dueño ve las filas donde es previous o current
-- owner; shop_id filtra la lista y created_by sirve a su FK.
CREATE INDEX IF NOT EXISTS ownership_transfers_shop_idx       ON ownership_transfers (shop_id);
CREATE INDEX IF NOT EXISTS ownership_transfers_previous_idx   ON ownership_transfers (previous_owner_id);
CREATE INDEX IF NOT EXISTS ownership_transfers_current_idx    ON ownership_transfers (current_owner_id);
CREATE INDEX IF NOT EXISTS ownership_transfers_created_by_idx ON ownership_transfers (created_by);


-- ---------------------------------------------------------------------
-- updated_at — reloj único, sin triggers (US-32 CA-1).
-- NINGUNA tabla lleva trigger BEFORE UPDATE. `updated_at` lo fija la capa de
-- datos con el reloj de Node (`packages/db/src/clock.ts` -> `now()`), el mismo
-- del que sale `created_at` (`@default(now())` de Prisma): una fila, un reloj.
-- Hasta 2026-09-14 hubo un `tocar_updated_at()` sobre products/categories/
-- shops/users/profiles; el reloj de Postgres derivaba del de Node hasta
-- ±676 ms y con signo variable, así que una fila podía servirse con
-- `updated_at` ANTERIOR a `created_at`. NO re-añadir triggers: toda tabla
-- nueva hereda esta política y cada `update`/`upsert` fija `updatedAt: now()`.
-- ---------------------------------------------------------------------


COMMIT;
