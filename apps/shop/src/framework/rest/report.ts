import { MyReportsQueryOptions, ReportsPaginator } from '@/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { mapPaginatorData } from './utils/data-mappers';

export function useMyReports(options?: MyReportsQueryOptions) {
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery<ReportsPaginator, Error>({
    queryKey: [API_ENDPOINTS.MY_REPORTS, options],
    queryFn: ({ queryKey, pageParam }) =>
      client.myReports.all(
        Object.assign({}, queryKey[1] as MyReportsQueryOptions, pageParam)
      ),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });
  function handleLoadMore() {
    fetchNextPage();
  }
  return {
    reports: data?.pages?.flatMap((page) => page.data) ?? [],
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
