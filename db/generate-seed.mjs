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
const popularProducts = leer('popular-products');
const bestSellingProducts = leer('best-selling-products');
const users = leer('users');
const becomeSeller = leer('become-seller');
const faqs = leer('faqs');
const termsAndConditions = leer('terms-and-conditions');
const refundPolicies = leer('refund-policies');
const refundReasons = leer('refund-reasons');
const taxes = leer('taxes');
const shippings = leer('shippings');
const attributes = leer('attributes');
const storeNotices = leer('store-notices');
const coupons = leer('coupons');

// ── Literales SQL ────────────────────────────────────────────────────────
const txt = (v) =>
  v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const num = (v) => (v === null || v === undefined || v === '' ? 'NULL' : Number(v));
const bool = (v) => (v ? 'true' : 'false');
const json = (v) =>
  v === null || v === undefined ? 'NULL' : `${txt(JSON.stringify(v))}::jsonb`;
// Para columnas `json` (D-5 del Épico 46): castear a jsonb reordenaría las
// claves ANTES de llegar a la columna, que es justo lo que `json` evita.
const jsonTal = (v) =>
  v === null || v === undefined ? 'NULL' : `${txt(JSON.stringify(v))}::json`;
const arr = (v) =>
  !Array.isArray(v) || !v.length
    ? `ARRAY[]::text[]`
    : `ARRAY[${v.map(txt).join(',')}]::text[]`;
const ts = (v) => (v ? txt(v) : 'now()');

// ── Credencial demo compartida por los 3 usuarios (Decision E) ───────────
// Los tres usuarios de users.json comparten la contraseña `demodemo`.
// bcrypt embebe un salt aleatorio: hashear en tiempo de generación haría
// que cada corrida produjera un seed.sql distinto sin que nada cambiara,
// rompiendo el chequeo de determinismo. Por eso el hash es un LITERAL fijo,
// producido una única vez fuera del repo (no hay bcryptjs en ningún
// package.json del monorepo, y así se queda):
//
//   cd "$(mktemp -d)" && npm install --no-save bcryptjs \
//     && node -e "console.log(require('bcryptjs').hashSync('demodemo', 10))"
//
// Regenerarlo produce OTRA cadena igual de válida (el salt cambia); lo
// importante es que quede fijo, no que sea reproducible byte a byte.
const HASH_DEMO = '$2b$10$j/.1t7ZmKUU4qHu8Elw3dO6N4udivEj1oxeVxA1m6HOnp7D4J761S';

// ── Catálogo de permisos y su matriz de asignación (D-5, D-9) ────────────
// guard_name = 'api' para las 4, como en el origen Laravel. `staff` (4) es
// nueva -- no está en users.json pero hasAccess() en ambos frontends
// compara contra un universo de 4 valores -- y queda sin asignar hasta
// que US-25 la reparta.
const permissionsCatalogo = [
  { id: 1, name: 'super_admin', guard_name: 'api' },
  { id: 2, name: 'customer', guard_name: 'api' },
  { id: 3, name: 'store_owner', guard_name: 'api' },
  { id: 4, name: 'staff', guard_name: 'api' },
];

// user_id sale del `id` real del usuario iterado, NUNCA de
// `permissions[].pivot.model_id`: el de admin vale 6, que no es un usuario
// real y violaría la FK de permission_user.user_id (R-1).
const asignaciones = users.flatMap((u) =>
  (u.permissions ?? []).map((p) => ({ user_id: u.id, permission_id: p.id }))
);

// ── Staff por tienda (US-41, array literal validado, no viene del mock) ──
// Usuario 1 excluido a propósito: es dueño de las 12 tiendas de shops.json
// (owner_id ?? 1), así que asignarlo como staff de sus propias tiendas sería
// redundante con la relación de propiedad que ya expresa shops.owner_id.
const staffAsignaciones = [
  { user_id: 2, shop_id: 1 },
  { user_id: 2, shop_id: 2 },
  { user_id: 3, shop_id: 1 },
];

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

// ── Validación de identidad (US-20, Decision F) ──────────────────────────
const idsDeUsers = new Set(users.map((u) => u.id));
const idsDePermisos = new Set(permissionsCatalogo.map((p) => p.id));

for (const a of asignaciones) {
  if (!idsDeUsers.has(a.user_id))
    problemas.push(`permission_user: user_id ${a.user_id} inexistente`);
  if (!idsDePermisos.has(a.permission_id))
    problemas.push(`permission_user: permission_id ${a.permission_id} inexistente`);
}
if (idsDeUsers.has(4)) problemas.push(`permissions: el id 4 ('staff') ya lo usa un usuario del mock`);
for (const s of shopsTodos) {
  if (!idsDeUsers.has(s.owner_id ?? 1))
    problemas.push(`shop ${s.id}: owner_id ${s.owner_id ?? 1} inexistente entre los usuarios`);
}
const emailsVistos = new Set();
for (const u of users) {
  const clave = String(u.email).toLowerCase();
  if (emailsVistos.has(clave)) problemas.push(`users: email duplicado (case-insensitive) ${u.email}`);
  emailsVistos.add(clave);
}
if (!HASH_DEMO.startsWith('$2')) problemas.push(`HASH_DEMO no parece un hash bcrypt (prefijo esperado '$2')`);

// ── Validación de shop_staff / become_seller (US-41) ─────────────────────
for (const s of staffAsignaciones) {
  if (!idsDeUsers.has(s.user_id)) problemas.push(`shop_staff: user_id ${s.user_id} inexistente`);
  if (!idsFinalesShops.has(s.shop_id)) problemas.push(`shop_staff: shop_id ${s.shop_id} inexistente`);
  const tienda = shopsTodos.find((t) => t.id === s.shop_id);
  if ((tienda?.owner_id ?? 1) === s.user_id)
    problemas.push(`shop_staff: el usuario ${s.user_id} ya es dueño de la tienda ${s.shop_id}`);
}
if (new Set(staffAsignaciones.map((s) => `${s.user_id}:${s.shop_id}`)).size !== staffAsignaciones.length)
  problemas.push('shop_staff: par (user_id, shop_id) duplicado');
if (!becomeSeller.page_options?.page_options)
  problemas.push('become-seller: falta data.page_options.page_options');
if (!Array.isArray(becomeSeller.commissions) || becomeSeller.commissions.length !== 2)
  problemas.push('become-seller: commissions no es un array de 2 tiers');

// ── Contenido: FAQ y términos (US-47) ────────────────────────────────────
// faqs.json no trae shop_id: las FAQ de tienda solo dicen `issued_by` con el
// NOMBRE de la tienda. Se deriva contra las tiendas sembradas; un nombre que
// no casa es error, no NULL silencioso (la tienda dejaría de ver su FAQ).
const shopIdPorNombre = new Map(shopsTodos.map((s) => [s.name, s.id]));
const faqsFilas = faqs.map((f) => ({
  ...f,
  _shop_id: f.faq_type === 'shop' ? shopIdPorNombre.get(f.issued_by) : null,
}));
for (const f of faqsFilas) {
  if (!['global', 'shop'].includes(f.faq_type))
    problemas.push(`faqs ${f.id}: faq_type '${f.faq_type}' fuera del CHECK`);
  if (f.faq_type === 'shop' && f._shop_id === undefined)
    problemas.push(`faqs ${f.id}: issued_by '${f.issued_by}' no casa con ninguna tienda sembrada`);
}
if (new Set(faqs.map((f) => f.slug)).size !== faqs.length) problemas.push('faqs: slug duplicado');

// terms-and-conditions.json repite 5 slugs (ids 8-12 son copias exactas de
// 1-5). Se conserva la PRIMERA aparición en el orden del archivo -- la que
// devolvía GET /:slug con Array.find -- y no el id más bajo. Una repetición
// con contenido distinto ya no es ruido: detiene la generación.
const termsPorSlug = new Map();
const termsDescartados = [];
for (const t of termsAndConditions) {
  const previo = termsPorSlug.get(t.slug);
  if (!previo) {
    termsPorSlug.set(t.slug, t);
    continue;
  }
  const mismoContenido = ['title', 'description', 'type', 'issued_by', 'is_approved'].every(
    (k) => previo[k] === t[k]
  );
  if (!mismoContenido)
    problemas.push(`terms ${t.id}: slug '${t.slug}' repetido con contenido distinto al id ${previo.id}`);
  termsDescartados.push(t.id);
}
const termsFilas = [...termsPorSlug.values()];
for (const t of termsFilas) {
  if (!['global', 'shop'].includes(t.type))
    problemas.push(`terms ${t.id}: type '${t.type}' fuera del CHECK`);
}

// ── Reembolsos: políticas y motivos (US-48) ──────────────────────────────
for (const p of refundPolicies) {
  if (!['vendor', 'customer'].includes(p.target))
    problemas.push(`refund_policies ${p.id}: target '${p.target}' fuera del CHECK`);
  if (!['approved', 'pending'].includes(p.status))
    problemas.push(`refund_policies ${p.id}: status '${p.status}' fuera del CHECK`);
}
if (new Set(refundPolicies.map((p) => p.slug)).size !== refundPolicies.length)
  problemas.push('refund_policies: slug duplicado');
if (new Set(refundReasons.map((r) => r.slug)).size !== refundReasons.length)
  problemas.push('refund_reasons: slug duplicado');
for (const r of refundReasons) {
  if (!r.created_at || !r.updated_at)
    problemas.push(`refund_reasons ${r.id}: sin created_at/updated_at (el contrato los emite)`);
}

// ── Configuración fiscal y de envío (US-49) ──────────────────────────────
// settings.options.taxClass/shippingClass apuntan al id 1 como texto: si el
// mock dejara de traerlo, los selectores del admin quedarían sin resolver.
for (const [nombre, filas, campo] of [['taxes', taxes, 'rate'], ['shippings', shippings, 'amount']]) {
  if (!filas.some((f) => f.id === 1)) problemas.push(`${nombre}: falta el id 1 que referencia settings.options`);
  for (const f of filas) {
    if (typeof f[campo] !== 'number' || f[campo] < 0)
      problemas.push(`${nombre} ${f.id}: ${campo} '${f[campo]}' no es un número >= 0`);
  }
}
for (const s of shippings) {
  if (!['fixed', 'percentage', 'free'].includes(s.type))
    problemas.push(`shippings ${s.id}: type '${s.type}' fuera del CHECK`);
}

// ── Atributos de producto (US-50) ────────────────────────────────────────
// El attribute_id de cada valor sale del PADRE iterado, no del campo del
// hijo: si los dos no coinciden, el JSON es incoherente y se para.
const valoresAtributo = attributes.flatMap((a) => (a.values ?? []).map((v) => ({ ...v, _padre: a.id })));
if (new Set(attributes.map((a) => a.slug)).size !== attributes.length)
  problemas.push('attributes: slug duplicado');
for (const a of attributes) {
  if (!idsFinalesShops.has(a.shop_id))
    problemas.push(`attributes ${a.id}: shop_id ${a.shop_id} inexistente`);
}
for (const v of valoresAtributo) {
  if (v.attribute_id !== v._padre)
    problemas.push(`attribute_values ${v.id}: attribute_id ${v.attribute_id} no coincide con su padre ${v._padre}`);
}
if (new Set(valoresAtributo.map((v) => `${v._padre}:${v.slug}`)).size !== valoresAtributo.length)
  problemas.push('attribute_values: slug duplicado dentro de un atributo');

// ── Identidad referenciada por el mock (D-4 del Épico 46) ────────────────
// Los mocks que no son users.json apuntan a ids de usuario del Laravel
// original que el seed no tiene (6 = admin@demo.com, que aquí es el 3).
// Contrato de resolverUsuarioPorEmail(snapshot, donde):
//   · recibe cualquier objeto con `email` (el `creator`, un `users[]`, un
//     `customer` embebido…) y una descripción de dónde salió, para el error;
//   · busca el email case-insensitive entre los usuarios que el generador
//     siembra y devuelve SU id, nunca el `id` del snapshot;
//   · email ausente o desconocido ⇒ anota el problema y devuelve null: la
//     generación se detiene antes de escribir seed.sql.
// US-51 solo remapea. US-54 lo extiende para SEMBRAR los usuarios que falten.
const idPorEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u.id]));
function resolverUsuarioPorEmail(snapshot, donde) {
  const email = snapshot?.email ? String(snapshot.email).toLowerCase() : null;
  const id = email ? idPorEmail.get(email) : undefined;
  if (id === undefined) {
    problemas.push(`${donde}: email '${snapshot?.email}' no casa con ningún usuario del seed`);
    return null;
  }
  return id;
}

// ── Avisos de tienda (US-51) ─────────────────────────────────────────────
// created_by/updated_by vienen como el id 6 del mock: se resuelven vía
// creator.email (updated_by solo existe en el aviso 2, y es el mismo admin).
const avisos = storeNotices.map((n) => {
  const creador = resolverUsuarioPorEmail(n.creator, `store_notices ${n.id}.creator`);
  return {
    ...n,
    _created_by: creador,
    _updated_by: n.updated_by == null ? null : creador,
    _destinatarios: (n.users ?? []).map((u) =>
      resolverUsuarioPorEmail(u, `store_notices ${n.id}.users`)
    ),
    _lecturas: (n.read_status ?? []).map((u) => ({
      user_id: resolverUsuarioPorEmail(u, `store_notices ${n.id}.read_status`),
      is_read: u.pivot?.is_read,
    })),
  };
});
for (const n of avisos) {
  if (!['high', 'medium', 'low'].includes(n.priority))
    problemas.push(`store_notices ${n.id}: priority '${n.priority}' fuera del CHECK`);
  if (!['all_vendor', 'specific_vendor', 'all_shop', 'specific_shop'].includes(n.type))
    problemas.push(`store_notices ${n.id}: type '${n.type}' fuera del CHECK`);
  if (n.updated_by != null && n.updated_by !== n.created_by)
    problemas.push(`store_notices ${n.id}: updated_by distinto del creador; no hay snapshot para resolverlo`);
  if ((n.shops ?? []).length)
    problemas.push(`store_notices ${n.id}: trae shops[] y el generador no los siembra todavía`);
}

// ── Cupones (US-52) ──────────────────────────────────────────────────────
// is_valid NO se siembra: la API lo calcula desde la vigencia. user_id es
// null en las 10 filas del mock; si alguna lo trajera, tendría que pasar por
// resolverUsuarioPorEmail (D-4) y aquí no hay snapshot con email.
if (new Set(coupons.map((c) => c.code)).size !== coupons.length)
  problemas.push('coupons: code duplicado');
for (const c of coupons) {
  if (c.shop_id != null && !idsFinalesShops.has(c.shop_id))
    problemas.push(`coupons ${c.id}: shop_id ${c.shop_id} inexistente`);
  if (!['fixed', 'percentage', 'free_shipping'].includes(c.type))
    problemas.push(`coupons ${c.id}: type '${c.type}' fuera del CHECK`);
  if (!(new Date(c.expire_at) > new Date(c.active_from)))
    problemas.push(`coupons ${c.id}: expire_at no es posterior a active_from`);
  if (c.user_id != null)
    problemas.push(`coupons ${c.id}: trae user_id y no hay snapshot para resolverlo por email`);
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
    `${manufacturers.length} manufacturers · ${tags.length} tags · ${products.length} productos · ` +
    `${users.length} usuarios · ${permissionsCatalogo.length} permisos · ` +
    `1 become_seller · ${staffAsignaciones.length} shop_staff · ` +
    `${faqsFilas.length} faqs · ${termsFilas.length} terms_and_conditions · ` +
    `${refundPolicies.length} refund_policies · ${refundReasons.length} refund_reasons · ` +
    `${taxes.length} taxes · ${shippings.length} shippings · ` +
    `${attributes.length} attributes · ${valoresAtributo.length} attribute_values · ` +
    `${avisos.length} store_notices · ${coupons.length} coupons`,
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

// become_seller ------------------------------------------------------------
bloque('become_seller — la fila única de la página "vender con nosotros"');
L.push(
  '-- page_options guarda el objeto INTERNO del mock (data.page_options.',
  '-- page_options, 24 claves), NO el envoltorio con forma de settings: sus',
  '-- id/language/created_at/updated_at son estas mismas columnas, y meterlos',
  '-- en el jsonb fosilizaría las fechas del mock.',
  'INSERT INTO become_seller (id, page_options, commissions, language) VALUES',
  `  (1, ${json(becomeSeller.page_options.page_options)}, ${json(becomeSeller.commissions)}, ` +
    `${txt(becomeSeller.page_options.language ?? 'en')})`,
  'ON CONFLICT (id) DO UPDATE SET page_options = EXCLUDED.page_options, ' +
    'commissions = EXCLUDED.commissions, language = EXCLUDED.language;'
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

// users --------------------------------------------------------------------
// Identidad antes que shops (US-20): shops.owner_id ahora es una FK real.
bloque(`users — ${users.length} usuarios demo (ids preservados del mock)`);
L.push(
  '-- password_hash usa HASH_DEMO (arriba): los 3 comparten la contraseña',
  "-- `demodemo`. is_active llega como entero 1 en el mock -> bool(). El",
  '-- índice de unicidad case-insensitive vive en el DDL (users_email_lower_idx).',
  'INSERT INTO users (id, name, email, password_hash, is_active, email_verified_at) VALUES'
);
L.push(
  users
    .map(
      (u) =>
        `  (${u.id}, ${txt(u.name)}, ${txt(u.email)}, ${txt(HASH_DEMO)}, ` +
        `${bool(u.is_active)}, ${txt(u.email_verified_at)})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// profiles -------------------------------------------------------------
bloque(`profiles — ${users.filter((u) => u.profile).length} (1:1 con users, PK = user_id)`);
L.push(
  '-- `profile.id` del mock NO se persiste: admin y customer declaran ambos',
  '-- profile.id = 2, y la PK real es user_id (D-4).',
  'INSERT INTO profiles (user_id, avatar, bio, socials, contact, notifications) VALUES'
);
L.push(
  users
    .filter((u) => u.profile)
    .map(
      (u) =>
        `  (${u.id}, ${json(u.profile.avatar ?? null)}, ${txt(u.profile.bio)}, ` +
        `${json(u.profile.socials ?? null)}, ${txt(u.profile.contact)}, ` +
        `${json(u.profile.notifications ?? null)})`
    )
    .join(',\n') + '\nON CONFLICT (user_id) DO NOTHING;'
);

// permissions ------------------------------------------------------------
bloque(`permissions — ${permissionsCatalogo.length} (catálogo estático, incluye 'staff' sin asignar)`);
L.push('INSERT INTO permissions (id, name, guard_name) VALUES');
L.push(
  permissionsCatalogo
    .map((p) => `  (${p.id}, ${txt(p.name)}, ${txt(p.guard_name)})`)
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// permission_user ----------------------------------------------------------
bloque(`permission_user — ${asignaciones.length} asignaciones reales (D-5: user_id del usuario iterado)`);
L.push(
  '-- NUNCA permissions[].pivot.model_id: el de admin vale 6, que no es un',
  '-- usuario real y violaría esta misma FK (R-1).',
  'INSERT INTO permission_user (user_id, permission_id) VALUES'
);
L.push(
  asignaciones
    .map((a) => `  (${a.user_id}, ${a.permission_id})`)
    .join(',\n') + '\nON CONFLICT (user_id, permission_id) DO NOTHING;'
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

// shop_staff (US-41, orden obligatorio: referencia shops recién insertadas) -
bloque(`shop_staff — ${staffAsignaciones.length} asignaciones deterministas (array literal, no del mock)`);
L.push(
  'INSERT INTO shop_staff (user_id, shop_id) VALUES',
  staffAsignaciones.map((s) => `  (${s.user_id}, ${s.shop_id})`).join(',\n') +
    '\nON CONFLICT (user_id, shop_id) DO NOTHING;'
);

// faqs (US-47; tras shops y users: las dos FK lo exigen) -------------------
const faqsDeTienda = faqsFilas.filter((f) => f._shop_id != null).length;
bloque(`faqs — ${faqsFilas.length} (${faqsFilas.length - faqsDeTienda} globales, ${faqsDeTienda} de tienda)`);
L.push(
  '-- shop_id derivado de issued_by contra el nombre de la tienda (el mock no',
  '-- trae la clave). user_id queda NULL: el mock no dice quién las escribió.',
  '-- Slugs tal cual, incluidos los que terminan en `?`.',
  'INSERT INTO faqs (id, faq_title, slug, faq_description, faq_type, issued_by, shop_id, language) VALUES'
);
L.push(
  faqsFilas
    .map(
      (f) =>
        `  (${f.id}, ${txt(f.faq_title)}, ${txt(f.slug)}, ${txt(f.faq_description)}, ` +
        `${txt(f.faq_type)}, ${txt(f.issued_by)}, ${num(f._shop_id)}, ${txt(f.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// terms_and_conditions (US-47) -----------------------------------------------
bloque(
  `terms_and_conditions — ${termsFilas.length} de ${termsAndConditions.length} ` +
    `(${termsDescartados.length} copias exactas descartadas por slug)`
);
L.push(
  `-- Descartados los ids ${termsDescartados.join(', ')}: repiten el slug de una fila`,
  '-- anterior en el archivo con el mismo contenido. is_approved llega como',
  '-- entero 1 en el mock -> bool().',
  'INSERT INTO terms_and_conditions (id, title, slug, description, type, issued_by, is_approved, language) VALUES'
);
L.push(
  termsFilas
    .map(
      (t) =>
        `  (${t.id}, ${txt(t.title)}, ${txt(t.slug)}, ${txt(t.description)}, ` +
        `${txt(t.type)}, ${txt(t.issued_by)}, ${bool(t.is_approved)}, ${txt(t.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// refund_policies (US-48) -----------------------------------------------------
bloque(`refund_policies — ${refundPolicies.length}`);
L.push(
  '-- shop_id queda NULL: el mock no lo trae. Sin timestamps del mock (el',
  '-- contrato no los emite): toman el DEFAULT now().',
  'INSERT INTO refund_policies (id, title, slug, description, target, status, language) VALUES'
);
L.push(
  refundPolicies
    .map(
      (p) =>
        `  (${p.id}, ${txt(p.title)}, ${txt(p.slug)}, ${txt(p.description)}, ` +
        `${txt(p.target)}, ${txt(p.status)}, ${txt(p.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// refund_reasons (US-48) ------------------------------------------------------
bloque(`refund_reasons — ${refundReasons.length} (con las fechas del mock)`);
L.push(
  '-- Primer bloque que inserta created_at/updated_at del mock (D-3 del Épico',
  '-- 46): el contrato los emite y el DEFAULT now() los cambiaría en cada reset.',
  'INSERT INTO refund_reasons (id, name, slug, language, created_at, updated_at) VALUES'
);
L.push(
  refundReasons
    .map(
      (r) =>
        `  (${r.id}, ${txt(r.name)}, ${txt(r.slug)}, ${txt(r.language ?? 'en')}, ` +
        `${ts(r.created_at)}, ${ts(r.updated_at)})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// taxes / shippings (US-49) ---------------------------------------------------
bloque(`taxes — ${taxes.length} · shippings — ${shippings.length} (ids y fechas del mock)`);
L.push(
  '-- El id 1 lo referencian settings.options.taxClass/shippingClass (texto, sin',
  '-- FK). Fechas del mock: el contrato las emite y taxes trae created_at y',
  '-- updated_at distintos.',
  'INSERT INTO taxes (id, name, rate, is_global, country, state, zip, city, priority, on_shipping, created_at, updated_at) VALUES'
);
L.push(
  taxes
    .map(
      (t) =>
        `  (${t.id}, ${txt(t.name)}, ${num(t.rate)}, ${bool(t.is_global)}, ${txt(t.country)}, ` +
        `${txt(t.state)}, ${txt(t.zip)}, ${txt(t.city)}, ${num(t.priority)}, ${bool(t.on_shipping)}, ` +
        `${ts(t.created_at)}, ${ts(t.updated_at)})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);
L.push('INSERT INTO shippings (id, name, amount, is_global, type, created_at, updated_at) VALUES');
L.push(
  shippings
    .map(
      (s) =>
        `  (${s.id}, ${txt(s.name)}, ${num(s.amount)}, ${bool(s.is_global)}, ${txt(s.type)}, ` +
        `${ts(s.created_at)}, ${ts(s.updated_at)})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// attributes / attribute_values (US-50; tras shops: la FK lo exige) ---------
bloque(`attributes — ${attributes.length} · attribute_values — ${valoresAtributo.length}`);
L.push(
  '-- Slugs tal cual, incluidas las mayúsculas del mock (color-OMG, size-zLh,',
  '-- color-A6u): el DDL no impone formato. Sin timestamps del mock (no los trae).',
  'INSERT INTO attributes (id, name, slug, shop_id, language) VALUES'
);
L.push(
  attributes
    .map((a) => `  (${a.id}, ${txt(a.name)}, ${txt(a.slug)}, ${a.shop_id}, ${txt(a.language ?? 'en')})`)
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);
L.push(
  '-- attribute_id = id del padre iterado (validado arriba contra el del hijo).',
  'INSERT INTO attribute_values (id, attribute_id, value, slug, meta, language) VALUES'
);
L.push(
  valoresAtributo
    .map(
      (v) =>
        `  (${v.id}, ${v._padre}, ${txt(v.value)}, ${txt(v.slug)}, ${txt(v.meta)}, ${txt(v.language ?? 'en')})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);

// store_notices + pivotes (US-51; tras users y shops: las FK lo exigen) ------
const lecturas = avisos.flatMap((n) => n._lecturas.map((l) => ({ ...l, notice: n.id })));
bloque(
  `store_notices — ${avisos.length} · store_notice_user — ${avisos.reduce((s, n) => s + n._destinatarios.length, 0)} · ` +
    `store_notice_read — ${lecturas.length}`
);
L.push(
  '-- created_by/updated_by y los usuarios de los pivotes resueltos POR EMAIL',
  '-- (resolverUsuarioPorEmail): el 6 del mock es admin@demo.com = 3 aquí.',
  '-- effective_from/expired_at son literales sin zona: Postgres los toma en la',
  '-- zona del servidor (UTC en la imagen) y la API los reformatea igual.',
  'INSERT INTO store_notices (id, priority, notice, description, effective_from, expired_at, type, created_by, updated_by, created_at, updated_at) VALUES'
);
L.push(
  avisos
    .map(
      (n) =>
        `  (${n.id}, ${txt(n.priority)}, ${txt(n.notice)}, ${txt(n.description)}, ` +
        `${txt(n.effective_from)}, ${txt(n.expired_at)}, ${txt(n.type)}, ` +
        `${n._created_by}, ${num(n._updated_by)}, ${ts(n.created_at)}, ${ts(n.updated_at)})`
    )
    .join(',\n') + '\nON CONFLICT (id) DO NOTHING;'
);
L.push('INSERT INTO store_notice_user (store_notice_id, user_id) VALUES');
L.push(
  avisos
    .flatMap((n) => n._destinatarios.map((u) => `  (${n.id}, ${u})`))
    .join(',\n') + '\nON CONFLICT (store_notice_id, user_id) DO NOTHING;'
);
L.push(
  '-- store_notice_shop queda vacía: los 3 avisos del mock traen shops: [].',
  '-- pivot.is_read llega como entero 1/0 -> bool().',
  'INSERT INTO store_notice_read (store_notice_id, user_id, is_read) VALUES'
);
L.push(
  lecturas
    .map((l) => `  (${l.notice}, ${l.user_id}, ${bool(l.is_read)})`)
    .join(',\n') + '\nON CONFLICT (store_notice_id, user_id) DO NOTHING;'
);

// coupons (US-52; tras shops: la FK lo exige) --------------------------------
bloque(`coupons — ${coupons.length} (vigencia del mock; is_valid se calcula en la API)`);
L.push(
  '-- target/is_approve llegan como entero 1/0 -> bool(). image va a una columna',
  '-- json (no jsonb) para conservar el orden de claves. Sin timestamps: el mock',
  '-- no los trae.',
  'INSERT INTO coupons (id, code, description, image, type, amount, minimum_cart_amount, active_from, expire_at, target, is_approve, shop_id, user_id, language) VALUES'
);
L.push(
  coupons
    .map(
      (c) =>
        `  (${c.id}, ${txt(c.code)}, ${txt(c.description)}, ${jsonTal(c.image)}, ${txt(c.type)}, ` +
        `${num(c.amount)}, ${num(c.minimum_cart_amount ?? 0)}, ${txt(c.active_from)}, ${txt(c.expire_at)}, ` +
        `${bool(c.target)}, ${bool(c.is_approve)}, ${num(c.shop_id)}, ${num(c.user_id)}, ${txt(c.language ?? 'en')})`
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

// ranking (US-5) ───────────────────────────────────────────────────────
// `products.json` no trae `ratings`/`total_reviews`/`sold_quantity` para
// ningún producto: sin esto no hay criterio por el que ordenar "popular" ni
// "más vendido" (0 filas con ratings>0, 2/1200 con sold_quantity>0). Los dos
// JSON de ranking curado del mock SÍ los traen, para 15 ids concretos. Se
// fusiona por CAMPO, no por fila: primero `popular-products.json` aporta
// `ratings`/`total_reviews`, después `best-selling-products.json` aporta
// `sold_quantity` (de `total_sales`). El id 888 está en los dos JSON y
// termina con datos de ambos. `orders_count` (solo en popular) se descarta:
// no hay columna destino y crearla es DDL, fuera de scope de este generador.
const ranking = new Map();
for (const p of popularProducts) {
  ranking.set(p.id, { ratings: p.ratings, totalReviews: p.total_reviews });
}
for (const p of bestSellingProducts) {
  const previo = ranking.get(p.id) ?? {};
  ranking.set(p.id, { ...previo, soldQuantity: p.total_sales });
}

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
  '--',
  '-- `ratings`/`total_reviews`/`sold_quantity` NO salen de este JSON: lo llena',
  '-- el mapa `ranking` (arriba), fusionado desde los dos JSON de ranking',
  '-- curado. Para los 1185 productos sin ranking, caen al `p.X ?? 0` de',
  '-- siempre (products.json no trae ninguna de las tres claves).',
  'INSERT INTO products (',
  '  id, name, slug, type_id, shop_id, product_type,',
  '  price, sale_price, min_price, max_price,',
  '  quantity, in_stock, sold_quantity, sku, unit,',
  '  status, visibility, image, ratings, total_reviews, language, translated_languages',
  ') VALUES'
);
L.push(
  products
    .map((p) => {
      const r = ranking.get(p.id) ?? {};
      return (
        `  (${p.id}, ${txt(p.name)}, ${txt(p.slug)}, ${p.type.id}, ${p.shop.id}, ${txt(p.product_type)}, ` +
        `${num(p.price)}, ${num(p.sale_price)}, ${num(p.min_price)}, ${num(p.max_price)}, ` +
        `${num(p.quantity ?? 0)}, ${bool((p.quantity ?? 0) > 0)}, ${num(r.soldQuantity ?? p.sold_quantity ?? 0)}, ` +
        `${txt(p.sku)}, ${txt(p.unit || '1 pc')}, ${txt(p.status)}, ${txt(p.visibility)}, ` +
        `${json(p.image && !Array.isArray(p.image) ? p.image : null)}, ` +
        `${num(r.ratings ?? p.ratings ?? 0)}, ${num(r.totalReviews ?? p.total_reviews ?? 0)}, ` +
        `${txt(p.language ?? 'en')}, ${arr(p.translated_languages ?? ['en'])})`
      );
    })
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
for (const t of ['types', 'users', 'permissions', 'shops', 'categories', 'manufacturers', 'tags', 'products', 'faqs', 'terms_and_conditions', 'refund_policies', 'refund_reasons', 'taxes', 'shippings', 'attributes', 'attribute_values', 'store_notices', 'coupons']) {
  L.push(`SELECT setval('${t}_id_seq', GREATEST((SELECT COALESCE(max(id), 1) FROM ${t}), 1));`);
}

L.push('', 'COMMIT;', '');

writeFileSync(SALIDA, L.join('\n'), 'utf8');
const kb = (Buffer.byteLength(L.join('\n'), 'utf8') / 1024).toFixed(0);
console.log(
  `db/seed.sql generado (${kb} KB)\n` +
    `  ${types.length} types · ${shopsTodos.length} shops (${recuperados.size} recuperados) · ` +
    `${categories.length} categorías · ${manufacturers.length} manufacturers · ` +
    `${tags.length} tags · ${products.length} productos · ` +
    `${users.length} usuarios · ${permissionsCatalogo.length} permisos · ` +
    `1 become_seller · ${staffAsignaciones.length} shop_staff · ` +
    `${faqsFilas.length} faqs · ${termsFilas.length} terms_and_conditions ` +
    `(${termsDescartados.length} duplicados descartados) · ` +
    `${refundPolicies.length} refund_policies · ${refundReasons.length} refund_reasons · ` +
    `${taxes.length} taxes · ${shippings.length} shippings · ` +
    `${attributes.length} attributes · ${valoresAtributo.length} attribute_values · ` +
    `${avisos.length} store_notices · ${coupons.length} coupons`
);
