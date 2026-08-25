/**
 * pagination.ts — el envoltorio de paginación del mock de Pickbazar.
 *
 * Reproduce EXACTAMENTE la forma que hoy devuelve
 * `apps/api/rest/src/common/pagination/paginate.ts` (incluida su rareza:
 * `prev_page_url` apunta a la página ACTUAL, no a la anterior — se copia
 * tal cual para no cambiar el contrato que el frontend ya consume).
 *
 * Única divergencia: las `*_page_url` son `null` si no se pasa `baseUrl`,
 * porque APP_URL es configuración de la app, no de la capa de datos.
 */

export interface Paginator<T> {
  data: T[];
  total: number;
  current_page: number;
  count: number;
  last_page: number;
  firstItem: number;
  lastItem: number;
  per_page: number;
  first_page_url: string | null;
  last_page_url: string | null;
  next_page_url: string | null;
  prev_page_url: string | null;
}

export interface BuildPaginatorInput<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  /** P. ej. `${APP_URL}/products?search=...&limit=30`. Opcional. */
  baseUrl?: string;
}

export function buildPaginator<T>(input: BuildPaginatorInput<T>): Paginator<T> {
  const { data, total, limit, baseUrl } = input;
  const lastPage = Math.ceil(total / limit);

  // Misma corrección de rango que el mock.
  let page = input.page;
  if (page < 1) page = 1;
  else if (page > lastPage) page = lastPage;

  const startIndex = (page - 1) * limit;
  const endIndex = Math.min(startIndex + limit - 1, total - 1);

  const url = (n: number) => (baseUrl ? `${baseUrl}&page=${n}` : null);

  return {
    data,
    total,
    current_page: page,
    count: data.length,
    last_page: lastPage,
    firstItem: startIndex,
    lastItem: endIndex,
    per_page: limit,
    first_page_url: url(1),
    last_page_url: url(lastPage),
    next_page_url: lastPage > page ? url(page + 1) : null,
    prev_page_url: lastPage > page ? url(page) : null,
  };
}
