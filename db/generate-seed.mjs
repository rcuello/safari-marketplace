// Genera db/seed.sql a partir de los JSON del mock de la aplicación.
//
// El seed NO se escribe a mano: son 1.200 productos, 198 categorías y 10
// verticales. La fuente de verdad son los archivos que hoy sirve la API mock
// (apps/api/rest/src/db/pickbazar/), así que este script es también la
// documentación de la procedencia de cada fila.
//
//   node db/generate-seed.mjs        (o: just db-seed-generate)
//
// Principio de diseño: el seed contiene SOLO datos de la aplicación. El
// scraper no aporta nada aquí; es él quien debe adaptarse a esta taxonomía
// (buscar el type y las categorías que ya existen) y crear únicamente lo
// que es genuinamente suyo, en tiempo de ejecución.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const MOCK = join(aqui, '..', 'apps', 'api', 'rest', 'src', 'db', 'pickbazar');
const SALIDA = join(aqui, 'seed.sql');

const leer = (n) => JSON.parse(readFileSync(join(MOCK, `${n}.json`), 'utf8'));

const settings = leer('settings');
const types = leer('types');
const shops = leer('shops');
const categories = leer('categories');
const manufacturers = leer('manufacturers');
const tags = leer('tags');
const products = leer('products');

// ── Literales SQL ────────────────────────────────────────────────────────
const txt = (v) =>
  v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const num = (v) => (v === null || v === undefined || v === '' ? 'NULL' : Number(v));
const bool = (v) => (v ? 'true' : 'false');
const json = (v) =>
  v === null || v === undefined ? 'NULL' : `${txt(JSON.stringify(v))}::jsonb`;
const arr = (v) =>
  !Array.isArray(v) || !v.length
    ? `ARRAY[]::text[]`
    : `ARRAY[${v.map(txt).join(',')}]::text[]`;
const ts = (v) => (v ? txt(v) : 'now()');

// ── Recuperación de los shops que shops.json no trae ─────────────────────
// 190 de los 1.200 productos apuntan a shop_id 12, 14 y 15, que NO existen
// en shops.json. Con claves foráneas reales esas filas serían imposibles de
// insertar. La identidad sí está disponible: cada producto embebe su objeto
// `shop` completo, así que los reconstruimos desde ahí en lugar de descartar
// 190 productos o inventar tiendas de relleno.
const idsDeShops = new Set(shops.map((s) => s.id));
const recuperados = new Map();
for (const p of products) {
  const s = p.shop;
  if (s && !idsDeShops.has(s.id) && !recuperados.has(s.id)) recuperados.set(s.id, s);
}
const shopsTodos = [
  ...shops.map((s) => ({ ...s, _recuperado: false })),
  ...[...recuperados.values()].map((s) => ({ ...s, _recuperado: true })),
];

// ── Validación previa: que el DDL no rechace lo generado ─────────────────
const problemas = [];
const idsDeTypes = new Set(types.map((t) => t.id));
const idsFinalesShops = new Set(shopsTodos.map((s) => s.id));

for (const p of products) {
  if (!idsDeTypes.has(p.type?.id)) problemas.push(`producto ${p.id}: type_id ${p.type?.id} inexistente`);
  if (!idsFinalesShops.has(p.shop?.id)) problemas.push(`producto ${p.id}: shop_id ${p.shop?.id} inexistente`);
  // CHECK products_simple_con_precio
  if (p.product_type === 'simple' && (p.price === null || p.price === undefined))
    problemas.push(`producto ${p.id}: 'simple' sin precio`);
  // CHECK products_rebaja_valida
  if (p.sale_price != null && p.price != null && Number(p.sale_price) >= Number(p.price))
    problemas.push(`producto ${p.id}: sale_price >= price`);
}
for (const c of categories) {
  if (!idsDeTypes.has(c.type_id)) problemas.push(`categoria ${c.id}: type_id ${c.type_id} inexistente`);
}
if (problemas.length) {
  console.error(`\nEl mock viola ${problemas.length} restriccion(es) del esquema:`);
  problemas.slice(0, 20).forEach((p) => console.error('  - ' + p));
  if (problemas.length > 20) console.error(`  ... y ${problemas.length - 20} mas`);
  process.exit(1);
}

// ── Emisión ──────────────────────────────────────────────────────────────
const L = [];
const bloque = (titulo) => L.push('', `-- ${'─'.repeat(68)}`, `-- ${titulo}`, `-- ${'─'.repeat(68)}`);

L.push(
  '-- =====================================================================',
  '-- Datos de la aplicación. GENERADO — no editar a mano.',
  '--',
  '-- Fuente: apps/api/rest/src/db/pickbazar/*.json (el mock que sirve la',
  '-- API hoy). Regenerar con:  just db-seed-generate',
  '--',
  '-- Contiene SOLO datos de la aplicación. El scraper no aporta filas aquí:',
  '-- debe adaptarse a esta taxonomía, buscando el type y las categorías que',
  '-- ya existen, y creando en tiempo de ejecución únicamente lo que es suyo',
  '-- (los retailers como shops, las marcas como manufacturers).',
  '--',
  `-- ${types.length} types · ${shopsTodos.length} shops · ${categories.length} categorías · ` +
    `${manufacturers.length} manufacturers · ${tags.length} tags · ${products.length} productos`,
  '-- =====================================================================',
  '',
  'BEGIN;'
);

// settings ---------------------------------------------------------------
bloque('settings — configuración global (primera llamada del shop)');
L.push(
  '-- La moneda vive aquí, no en el producto: Pickbazar asume una sola para',
  '-- todo el marketplace. Se copia tal cual la trae la app.',
  'INSERT INTO settings (id, options, language) VALUES',
  `  (1, ${json(settings.options)}, ${txt(settings.language ?? 'en')})`,
  'ON CONFLICT (id) DO UPDATE SET options = EXCLUDED.options, language = EXCLUDED.language;'
);

// types ------------------------------------------------------------------
bloque(`types — las ${types.length} verticales (ids preservados del mock)`);
L.push(
  '-- Las rutas de la tienda son /{locale}/{type.slug}, así que un producto',
  '-- sin type no tiene página donde mostrarse.',
  'INSERT INTO types (id, name, slug, icon, settings, banners, language) VALUES'
);
L.push(
  types
    .map(
      (t) =>
        `  (${t.id}, ${txt(t.name)}, ${txt(t.slug)}, ${txt(t.icon)}, ` +
        `${json(t.settings ?? {})}, ${json(t.banners ?? [])}, ${txt(t.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// shops ------------------------------------------------------------------
bloque(`shops — ${shops.length} de shops.json + ${recuperados.size} recuperados de los productos`);
L.push(
  `-- Los shops ${[...recuperados.keys()].join(', ')} no están en shops.json pero`,
  '-- 190 productos los referencian. Se reconstruyen desde el objeto `shop`',
  '-- que cada producto embebe. Sin esto, esas 190 filas no podrían insertarse.',
  'INSERT INTO shops (id, name, slug, description, owner_id, is_active, logo, cover_image, address, settings) VALUES'
);
L.push(
  shopsTodos
    .map(
      (s) =>
        `  (${s.id}, ${txt(s.name)}, ${txt(s.slug)}, ` +
        `${txt(s._recuperado ? 'Reconstruido desde los productos: no estaba en shops.json.' : s.description)}, ` +
        `${num(s.owner_id ?? 1)}, ${bool(s.is_active ?? true)}, ` +
        `${json(s.logo ?? null)}, ${json(s.cover_image ?? null)}, ` +
        `${json(s.address ?? {})}, ${json(s.settings ?? {})})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// categories -------------------------------------------------------------
const raices = categories.filter((c) => !c.parent_id).length;
bloque(`categories — ${categories.length} (${raices} raíces, ${categories.length - raices} hijas)`);
L.push(
  '-- Se insertan en dos pasos: primero todas sin madre, después se enlaza la',
  '-- jerarquía. La clave foránea a categories(id) se valida fila por fila, así',
  '-- que insertar una hija antes que su madre fallaría.',
  'INSERT INTO categories (id, name, slug, icon, details, image, type_id, language) VALUES'
);
L.push(
  categories
    .map(
      (c) =>
        `  (${c.id}, ${txt(c.name)}, ${txt(c.slug)}, ${txt(c.icon)}, ${txt(c.details)}, ` +
        `${json(c.image && !Array.isArray(c.image) ? c.image : null)}, ` +
        `${c.type_id}, ${txt(c.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);
const conMadre = categories.filter((c) => c.parent_id);
if (conMadre.length) {
  L.push('', '-- Paso 2: jerarquía');
  L.push(
    `UPDATE categories AS c SET parent_id = v.parent_id`,
    `FROM (VALUES\n${conMadre.map((c) => `  (${c.id}, ${c.parent_id})`).join(',\n')}\n) AS v(id, parent_id)`,
    'WHERE c.id = v.id;'
  );
}

// manufacturers ----------------------------------------------------------
bloque(`manufacturers — ${manufacturers.length}`);
L.push(
  '-- Destino natural del campo `marca` del scraper.',
  'INSERT INTO manufacturers (id, name, slug, description, website, image, type_id, is_approved) VALUES'
);
L.push(
  manufacturers
    .map(
      (m) =>
        `  (${m.id}, ${txt(m.name)}, ${txt(m.slug)}, ${txt(m.description)}, ${txt(m.website)}, ` +
        `${json(m.image ?? null)}, ${num(m.type?.id ?? null)}, ${bool(m.is_approved ?? true)})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// tags -------------------------------------------------------------------
bloque(`tags — ${tags.length}`);
L.push('INSERT INTO tags (id, name, slug, details, icon, image, type_id, language) VALUES');
L.push(
  tags
    .map(
      (g) =>
        `  (${g.id}, ${txt(g.name)}, ${txt(g.slug)}, ${txt(g.details)}, ${txt(g.icon)}, ` +
        `${json(g.image && !Array.isArray(g.image) ? g.image : null)}, ` +
        `${num(g.type?.id ?? null)}, ${txt(g.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// products ---------------------------------------------------------------
const variables = products.filter((p) => p.product_type === 'variable').length;
bloque(`products — ${products.length} (${products.length - variables} simple, ${variables} variable)`);
L.push(
  '-- products.json trae la forma RECORTADA que la API usa para listados: no',
  '-- incluye description, gallery, categories ni tags. Las columnas que faltan',
  '-- toman el valor por defecto del esquema.',
  '--',
  '-- Los `variable` van sin price (lo derivan de sus variaciones) pero con el',
  '-- rango min/max, que es lo que el mock trae.',
  'INSERT INTO products (',
  '  id, name, slug, type_id, shop_id, product_type,',
  '  price, sale_price, min_price, max_price,',
  '  quantity, in_stock, sold_quantity, sku, unit,',
  '  status, visibility, image, ratings, language, translated_languages',
  ') VALUES'
);
L.push(
  products
    .map(
      (p) =>
        `  (${p.id}, ${txt(p.name)}, ${txt(p.slug)}, ${p.type.id}, ${p.shop.id}, ${txt(p.product_type)}, ` +
        `${num(p.price)}, ${num(p.sale_price)}, ${num(p.min_price)}, ${num(p.max_price)}, ` +
        `${num(p.quantity ?? 0)}, ${bool((p.quantity ?? 0) > 0)}, ${num(p.sold_quantity ?? 0)}, ` +
        `${txt(p.sku)}, ${txt(p.unit || '1 pc')}, ${txt(p.status)}, ${txt(p.visibility)}, ` +
        `${json(p.image && !Array.isArray(p.image) ? p.image : null)}, ` +
        `${num(p.ratings ?? 0)}, ${txt(p.language ?? 'en')}, ${arr(p.translated_languages ?? ['en'])})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// category_product -------------------------------------------------------
bloque('category_product — deliberadamente VACÍA');
L.push(
  `-- Ninguno de los ${products.length} productos del mock trae la relación con`,
  '-- categorías poblada, aunque la entidad la declara y el buscador filtra por',
  '-- `categories.slug`. Es decir: hoy, en la app original, cualquier búsqueda',
  '-- por categoría devuelve cero resultados.',
  '--',
  '-- No se inventan enlaces aquí. Este hueco es precisamente lo que los',
  '-- productos del scraper sí podrán rellenar, porque ellos sí traen categoría.'
);

// secuencias -------------------------------------------------------------
bloque('Secuencias');
L.push(
  '-- Los ids se insertaron explícitamente para preservar las relaciones del',
  '-- mock, así que hay que adelantar las secuencias o el primer INSERT nuevo',
  '-- chocaría con una clave existente.'
);
for (const t of ['types', 'shops', 'categories', 'manufacturers', 'tags', 'products']) {
  L.push(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 1) FROM ${t}), 1));`);
}

L.push('', 'COMMIT;', '');

writeFileSync(SALIDA, L.join('\n'), 'utf8');
const kb = (Buffer.byteLength(L.join('\n'), 'utf8') / 1024).toFixed(0);
console.log(
  `db/seed.sql generado (${kb} KB)\n` +
    `  ${types.length} types · ${shopsTodos.length} shops (${recuperados.size} recuperados) · ` +
    `${categories.length} categorías · ${manufacturers.length} manufacturers · ` +
    `${tags.length} tags · ${products.length} productos`
);
