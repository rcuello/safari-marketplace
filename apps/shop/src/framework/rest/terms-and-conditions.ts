import { mapPaginatorData } from '@/framework/utils/data-mappers';
import type {
  TermsAndConditionsPaginator,
  TermsAndConditionsQueryOptions,
} from '@/types';
import { useRouter } from 'next/router';
import { useInfiniteQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';

export function useTermsAndConditions(
  options?: Partial<TermsAndConditionsQueryOptions>,
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
  } = useInfiniteQuery<TermsAndConditionsPaginator, Error>({
    queryKey: [API_ENDPOINTS.TERMS_AND_CONDITIONS, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.termsAndConditions.all(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    termsAndConditions: data?.pages?.flatMap((page) => page.data) ?? [],
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
