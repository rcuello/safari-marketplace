import { StoreNoticePaginator, StoreNoticeQueryOptions } from '@/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';

export const useStoreNotices = (options: Partial<StoreNoticeQueryOptions>) => {
  const { data, error, isLoading } = useQuery<StoreNoticePaginator, Error>({
    queryKey: [API_ENDPOINTS.STORE_NOTICES, options],
    queryFn: ({ queryKey }) =>
      client.storeNotice.all(
        Object.assign({}, queryKey[1] as StoreNoticeQueryOptions)
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return {
    storeNotices: data?.data ?? [],
    error,
    loading: isLoading,
  };
};
