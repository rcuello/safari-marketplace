import { Product, ProductQueryOptions } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { API_ENDPOINTS } from './client/api-endpoints';
import { dashboardClient } from '@/data/client/dashboard';
import { productClient } from '@/data/client/product';

export function useAnalyticsQuery() {
  return useQuery({
    queryKey: [API_ENDPOINTS.ANALYTICS],
    queryFn: dashboardClient.analytics,
  });
}

export function usePopularProductsQuery(options: Partial<ProductQueryOptions>) {
  return useQuery<Product[], Error>({
    queryKey: [API_ENDPOINTS.POPULAR_PRODUCTS, options],
    queryFn: ({ queryKey }) =>
      productClient.popular(Object.assign({}, queryKey[1])),
  });
}

export function useLowProductStockQuery(options: Partial<ProductQueryOptions>) {
  return useQuery<Product[], Error>({
    queryKey: [API_ENDPOINTS.LOW_STOCK_PRODUCTS_ANALYTICS, options],
    queryFn: ({ queryKey }) =>
      productClient.lowStock(Object.assign({}, queryKey[1])),
  });
}

export function useProductByCategoryQuery({
  limit,
  language,
}: {
  limit?: number;
  language?: string;
}) {
  return useQuery({
    queryKey: [API_ENDPOINTS.CATEGORY_WISE_PRODUCTS, { limit, language }],
    queryFn: () => productClient.productByCategory({ limit, language }),
  });
}

// export function useProductByCategoryQuery(
//   options: Partial<ProductQueryOptions>
// ) {
//   return useQuery<Product[], Error>(
//     [API_ENDPOINTS.CATEGORY_WISE_PRODUCTS, options],
//     ({ queryKey, pageParam }) =>
//       productClient.productByCategory(Object.assign({}, pageParam, queryKey[1]))
//   );
// }

export function useMostSoldProductByCategoryQuery(
  options: Partial<ProductQueryOptions>,
) {
  return useQuery<Product[], Error>({
    queryKey: [API_ENDPOINTS.CATEGORY_WISE_PRODUCTS_SALE, options],
    queryFn: ({ queryKey }) =>
      productClient.mostSoldProductByCategory(Object.assign({}, queryKey[1])),
  });
}

export function useTopRatedProductsQuery(
  options: Partial<ProductQueryOptions>,
) {
  return useQuery<Product[], Error>({
    queryKey: [API_ENDPOINTS.TOP_RATED_PRODUCTS, options],
    queryFn: ({ queryKey }) =>
      productClient.topRated(Object.assign({}, queryKey[1])),
  });
}
