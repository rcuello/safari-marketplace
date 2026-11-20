import type { GetServerSidePropsContext } from 'next';
import { Routes } from '@/config/routes';
import client from './client';
import { HttpError } from './client/http-client';

/**
 * Sitemap y robots.txt generados en ejecución (US-108).
 *
 * Antes los escribía `next-sitemap` al terminar el build, con la URL del
 * build y sin contenido dinámico. Ahora cada petición los arma con el
 * dominio con que corre el contenedor (`NEXTAUTH_URL`, D-2) y con los
 * listados de la API (D-3). Sin caché en servidor: solo `Cache-Control`
 * (D-6).
 */

const CACHE_CONTROL = 'public, max-age=3600';
// Páginas grandes para pocas llamadas, sin depender de que la API no tenga
// tope: se pagina hasta `last_page` (D-6).
const PAGE_SIZE: string = 500;

// Páginas públicas sin datos por slug (D-3). El inicio es `/`: el type que
// muestra no se repite como `/<slug>`.
const STATIC_PATHS = [
  Routes.home,
  Routes.becomeSeller,
  Routes.coupons,
  Routes.help,
  Routes.contactUs,
  Routes.terms,
  Routes.privacy,
  Routes.customerRefundPolicies,
  Routes.vendorRefundPolicies,
  Routes.shops,
  Routes.authors,
  Routes.manufacturers,
  Routes.flashSale,
];

// Los 4 de next-sitemap, más las páginas privadas o de usuario que salen
// del sitemap (D-4).
const DISALLOW = [
  '*/logout',
  '*/checkout*',
  '*/404',
  '*/profile',
  '/orders',
  '/cards',
  '/wishlists',
  '/notification',
  '/reports',
  '/questions',
  '/downloads',
  '/refunds',
  '/change-password',
  '/verify-email',
  '/products/preview',
];

/** La URL pública de la tienda, sin `/` final, o `null` si falta. */
function siteUrl(): string | null {
  const url = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, '');
  return url ? url : null;
}

function send(
  res: GetServerSidePropsContext['res'],
  status: number,
  contentType: string,
  body: string,
) {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  if (status === 200) res.setHeader('Cache-Control', CACHE_CONTROL);
  else res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/**
 * Sin `NEXTAUTH_URL` no hay dominio: 500 con un cuerpo que la nombra.
 * Lanzar un error daría la página 500 genérica, sin el mensaje (D-2).
 */
function missingSiteUrl(res: GetServerSidePropsContext['res']) {
  const message =
    'NEXTAUTH_URL is not defined: set it to the public URL of the shop (e.g. https://shop.example.com)';
  console.error(`[sitemap] ${message}`);
  send(res, 500, 'text/plain; charset=utf-8', `${message}\n`);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Pide todas las páginas de un listado paginado de la API. */
async function allPages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; last_page: number }>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const result = await fetchPage(page);
    items.push(...result.data);
    lastPage = result.last_page;
    page += 1;
  } while (page <= lastPage);
  return items;
}

/**
 * Las rutas del sitemap, desde los listados de la API con sus filtros por
 * defecto (productos publicados y públicos, tiendas activas). No basta con
 * «la página responde 200»: el detalle de producto también sirve un draft.
 */
async function sitemapPaths(language: string): Promise<string[]> {
  const [types, products, shops] = await Promise.all([
    client.types.all({ language }),
    allPages((page) =>
      client.products.all({ limit: PAGE_SIZE, page, language }),
    ),
    allPages((page) => client.shops.all({ limit: PAGE_SIZE, page })),
  ]);
  // El mismo criterio que el inicio (`home-pages.ssr.ts`): ese type ya es `/`.
  const homeType =
    types.find((type) => type?.settings?.isHome)?.slug ?? types?.[0]?.slug;
  return [
    ...STATIC_PATHS,
    ...types
      .filter((type) => type.slug !== homeType)
      .map((type) => `/${encodeURIComponent(type.slug)}`),
    ...shops.map((shop) => Routes.shop(shop.slug)),
    ...products.map((product) => Routes.product(product.slug)),
  ];
}

export async function serveSitemap({ res, locale }: GetServerSidePropsContext) {
  const base = siteUrl();
  if (!base) return missingSiteUrl(res);

  let paths: string[];
  try {
    paths = await sitemapPaths(locale ?? 'en');
  } catch (error) {
    // Ni un 200 vacío ni uno parcial: un buscador reintenta un 503, pero un
    // sitemap vacío lo lee como «el sitio ya no tiene páginas» (D-5).
    if (!(error instanceof HttpError)) throw error;
    console.warn(`[sitemap] API no disponible: ${error.message}`);
    return send(
      res,
      503,
      'text/plain; charset=utf-8',
      'Sitemap temporarily unavailable: the API did not respond\n',
    );
  }

  const urls = Array.from(new Set(paths))
    .map((path) => `<url><loc>${escapeXml(base + path)}</loc></url>`)
    .join('\n');
  send(
    res,
    200,
    'application/xml; charset=utf-8',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
}

/** robots.txt no depende de la API: responde aunque esté caída (D-5). */
export function serveRobots({ res }: GetServerSidePropsContext) {
  const base = siteUrl();
  if (!base) return missingSiteUrl(res);
  const body = [
    'User-agent: *',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
  send(res, 200, 'text/plain; charset=utf-8', body);
}
