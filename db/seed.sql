-- =====================================================================
-- Datos de referencia mínimos para que un producto scrapeado sea
-- visible en la tienda.
--
-- Idempotente: se puede correr las veces que haga falta.
-- =====================================================================

BEGIN;

-- Moneda colombiana sin decimales. El mock traía USD con 2 decimales;
-- las seis tiendas scrapeadas son colombianas.
INSERT INTO settings (id, options, language) VALUES (
    1,
    jsonb_build_object(
        'siteTitle',       'Safari Marketplace',
        'siteSubtitle',    'Comparador de precios de tecnología en Colombia',
        'currency',        'COP',
        'currencyOptions', jsonb_build_object('formation', 'es-CO', 'fractions', 0)
    ),
    'es'
)
ON CONFLICT (id) DO UPDATE SET options = EXCLUDED.options, language = EXCLUDED.language;


-- La vertical bajo la que cuelga todo lo scrapeado. Sin un type el
-- producto no tiene ruta donde mostrarse: la tienda enruta por
-- /{locale}/{type.slug}.
INSERT INTO types (name, slug, icon, settings) VALUES (
    'Tecnología', 'tecnologia', 'FruitsVegetable',
    jsonb_build_object('isHome', true, 'productCard', 'neon', 'layoutType', 'classic')
)
ON CONFLICT (slug) DO NOTHING;


-- Los seis retailers, como shops del marketplace.
INSERT INTO shops (name, slug, description, address, settings)
SELECT
    v.nombre,
    slugify(v.nombre),
    'Retailer colombiano. Los productos se recolectan automáticamente.',
    jsonb_build_object('country', 'Colombia', 'city', v.ciudad),
    jsonb_build_object('website', v.web)
FROM (VALUES
    ('Alkosto',      'Bogotá',       'https://www.alkosto.com'),
    ('Exito',        'Envigado',     'https://www.exito.com'),
    ('Falabella',    'Bogotá',       'https://www.falabella.com.co'),
    ('CompuLago',    'Bogotá',       'https://www.compulago.com'),
    ('CompuWorking', 'Bogotá',       'https://www.compuworking.com'),
    ('Tauret',       'Bucaramanga',  'https://www.tauretcomputadores.com')
) AS v(nombre, ciudad, web)
ON CONFLICT (slug) DO NOTHING;


-- Categorías que los spiders ya producen (ver el método categorizar()
-- de cada spider). Cuelgan todas del type 'tecnologia'.
INSERT INTO categories (name, slug, type_id)
SELECT v.nombre, slugify(v.nombre), t.id
FROM (VALUES
    ('Portátiles'), ('Computadores'), ('Celulares'), ('Tablets'),
    ('Gaming'), ('Monitores'), ('Periféricos'), ('Componentes'),
    ('Impresoras'), ('Almacenamiento'), ('Audio'), ('Televisores'),
    ('Otros')
) AS v(nombre)
CROSS JOIN types t
WHERE t.slug = 'tecnologia'
ON CONFLICT (slug) DO NOTHING;

COMMIT;
