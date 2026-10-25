import type {
  FlashSalePaginator,
  FlashSaleQueryOptions,
  FlashSale,
  ProductPaginator,
  FlashSaleProductsQueryOptions,
} from '@/types';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import client from '@/framework/client';
import { API_ENDPOINTS } from '@/framework/client/api-endpoints';
import { useRouter } from 'next/router';
import { mapPaginatorData } from '@/framework/utils/data-mappers';

export function useFlashSales(options?: Partial<FlashSaleQueryOptions>) {
  const { locale } = useRouter();

  const formattedOptions = {
    ...options,
    language: locale,
  };

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery<FlashSalePaginator, Error>({
    queryKey: [API_ENDPOINTS.FLASH_SALE, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.flashSale.all(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    flashSales: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    isLoading,
    error,
    isFetching,
    isLoadingMore: isFetchingNextPage,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
}

export const useFlashSale = ({
  slug,
  language,
}: {
  slug: string;
  language: string;
}) => {
  const { data, error, isLoading } = useQuery<FlashSale, Error>({
    queryKey: [API_ENDPOINTS.FLASH_SALE, { slug, language }],
    queryFn: () => client?.flashSale?.get({ slug, language }),
  });

  return {
    flashSale: data,
    error,
    loading: isLoading,
  };
};

export function useFlashSaleProductBySlug(
  options: FlashSaleProductsQueryOptions,
) {
  const { locale } = useRouter();

  const formattedOptions = {
    ...options,
    language: locale,
  };

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery<ProductPaginator, Error>({
    queryKey: [API_ENDPOINTS.PRODUCTS_BY_FLASH_SALE, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client?.flashSale?.getProductsByFlashSale(
        Object.assign(
          {},
          queryKey[1] as FlashSaleProductsQueryOptions,
          pageParam,
        ),
      ),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    products: data?.pages?.flatMap((page) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    isLoading,
    error,
    isFetching,
    isLoadingMore: isFetchingNextPage,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
}
