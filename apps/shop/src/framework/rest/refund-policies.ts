import { mapPaginatorData } from '@/framework/utils/data-mappers';
import type { RefundPolicyPaginator, RefundPolicyQueryOptions } from '@/types';
import { useRouter } from 'next/router';
import { useInfiniteQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';

export function useRefundPolicies(options?: Partial<RefundPolicyQueryOptions>) {
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
  } = useInfiniteQuery<RefundPolicyPaginator, Error>({
    queryKey: [API_ENDPOINTS.REFUND_POLICIES, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.refundPolicies.all(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    refundPolicies: data?.pages?.flatMap((page) => page.data) ?? [],
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
