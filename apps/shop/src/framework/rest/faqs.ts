import type { FAQS, FaqsPaginator, FaqsQueryOptions } from '@/types';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { useRouter } from 'next/router';
import { mapPaginatorData } from '@/framework/utils/data-mappers';

export function useFAQs(options?: Partial<FaqsQueryOptions>) {
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
  } = useInfiniteQuery<FaqsPaginator, Error>({
    queryKey: [API_ENDPOINTS.FAQS, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.faqs.all(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    faqs: data?.pages?.flatMap((page) => page.data) ?? [],
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
