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
-- Fuera de alcance deliberado: órdenes, usuarios, carritos, reviews y
-- pagos. Este esquema cubre el catálogo, que es lo que el scraper
-- alimenta y la tienda consulta.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Slug determinista y estable entre corridas.
--
-- La app identifica productos por `slug` (la URL es /products/{slug}) y
-- exige que sea único global. El scraper identifica por (tienda,
-- product_id). Esta función es el puente: mismo producto -> mismo slug,
-- siempre, sin depender de un contador ni del orden de inserción.
-- ---------------------------------------------------------------------
-- Quita tildes sin depender de la extensión `unaccent`, que en algunos
-- servicios gestionados de Postgres no está disponible.
-- Se define ANTES de slugify porque Postgres valida el cuerpo de una
-- función SQL en el momento de crearla.
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
-- moneda para todo el marketplace. Como las seis tiendas scrapeadas son
-- colombianas, el valor correcto es COP sin decimales (el mock traía
-- USD con 2).
-- ---------------------------------------------------------------------
CREATE TABLE settings (
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
CREATE TABLE types (
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


-- ---------------------------------------------------------------------
-- shops — el vendedor.
--
-- En Pickbazar un shop es un vendedor del marketplace con dueño. Aquí
-- cada retailer scrapeado (Alkosto, Éxito, Falabella...) se modela como
-- un shop. El mock usaba owner_id=1 para todos; se mantiene ese
-- precedente y se deja sin clave foránea porque `users` está fuera de
-- alcance.
-- ---------------------------------------------------------------------
CREATE TABLE shops (
    id             bigserial    PRIMARY KEY,
    name           text         NOT NULL,
    slug           text         NOT NULL UNIQUE,
    description    text,
    owner_id       bigint       NOT NULL DEFAULT 1,
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
-- En el mock hay 198 categorías: 83 raíces y 115 hijas (2 niveles
-- reales). ON DELETE SET NULL para que borrar una madre no arrastre a
-- las hijas.
-- ---------------------------------------------------------------------
CREATE TABLE categories (
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
CREATE TABLE manufacturers (
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


CREATE TABLE tags (
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
CREATE TABLE products (
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
CREATE UNIQUE INDEX products_procedencia_key
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
CREATE TABLE category_product (
    product_id   bigint  NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
    category_id  bigint  NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, category_id)
);

CREATE TABLE product_tag (
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
CREATE INDEX products_visibles_idx
    ON products (type_id, id)
    WHERE status = 'publish' AND visibility = 'visibility_public';

CREATE INDEX products_shop_idx          ON products (shop_id);
CREATE INDEX products_manufacturer_idx  ON products (manufacturer_id);
-- Soporta los filtros min_price / max_price.
CREATE INDEX products_precio_idx        ON products (price);
CREATE INDEX products_scraped_idx       ON products (scraped_at DESC NULLS LAST);

-- Búsqueda por nombre. En el mock la hacía Fuse.js en memoria sobre
-- 1.200 productos; con un catálogo real hay que resolverla en la base.
CREATE INDEX products_nombre_trgm_idx
    ON products USING gin (lower(name) gin_trgm_ops);

CREATE INDEX categories_parent_idx  ON categories (parent_id);
CREATE INDEX categories_type_idx    ON categories (type_id);
-- Para navegar de categoría a productos hace falta el sentido inverso
-- de la clave primaria de la tabla puente.
CREATE INDEX category_product_categoria_idx ON category_product (category_id);
CREATE INDEX product_tag_tag_idx            ON product_tag (tag_id);


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

CREATE TRIGGER products_updated_at   BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();
CREATE TRIGGER shops_updated_at      BEFORE UPDATE ON shops
    FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();


COMMIT;
