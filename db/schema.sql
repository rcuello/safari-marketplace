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
-- Fuera de alcance deliberado: wallets, direcciones, órdenes, carritos
-- y reviews. Identidad SÍ entra (US-20): usuarios, perfiles, permisos y
-- recuperación de contraseña/OTP, lo mínimo para autenticación real. El
-- resto del dominio transaccional sigue fuera.
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

-- Case-insensitive sin `citext`: consistente con products_nombre_trgm_idx
-- (ya indexa lower(name)) y sin introducir el primer CREATE EXTENSION del
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
CREATE INDEX IF NOT EXISTS products_nombre_trgm_idx
    ON products USING gin (lower(name) gin_trgm_ops);

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


-- ---------------------------------------------------------------------
-- updated_at automático.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER products_updated_at   BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
CREATE OR REPLACE TRIGGER categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
CREATE OR REPLACE TRIGGER shops_updated_at      BEFORE UPDATE ON shops
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
-- users y profiles reciben UPDATE de verdad (US-25 block-user/unblock-user,
-- PUT /api/users/:id): igual criterio que products/categories/shops.
-- permissions NO: 4 filas de catálogo estático, el perfil de types/tags.
CREATE OR REPLACE TRIGGER users_updated_at      BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
CREATE OR REPLACE TRIGGER profiles_updated_at   BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();


COMMIT;
