import { QueryOptions, TagPaginator } from '@/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { mapPaginatorData } from '@/framework/utils/data-mappers';
import { useRouter } from 'next/router';

export const useTags = (options: Pick<QueryOptions, 'limit'>) => {
  const { locale } = useRouter();

  const formattedOptions = {
    ...options,
    language: locale,
  };

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
  } = useInfiniteQuery<TagPaginator, Error>({
    queryKey: [API_ENDPOINTS.TAGS, formattedOptions],
    queryFn: ({ queryKey, pageParam }) =>
      client.tags.all(Object.assign({}, queryKey[1], pageParam)),
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    tags: data?.pages?.flatMap((page: any) => page.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? mapPaginatorData(data?.pages[data.pages.length - 1])
      : null,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    error,
    loadMore: handleLoadMore,
    hasMore: Boolean(hasNextPage),
  };
};
