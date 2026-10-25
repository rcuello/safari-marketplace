import Router, { useRouter } from 'next/router';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { mapPaginatorData } from '@/utils/data-mappers';
import { storeNoticeClient } from './client/store-notice';
import type {
  UseInfiniteQueryOptions,
  UseQueryOptions,
} from '@tanstack/react-query';

import {
  StoreNotice,
  StoreNoticePaginator,
  StoreNoticeQueryOptions,
} from '@/types';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from './client/api-endpoints';
import { Config } from '@/config';

export const useCreateStoreNoticeMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: storeNoticeClient.create,
    onSuccess: async () => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.storeNotice.list}`
        : Routes.storeNotice.list;
      await Router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.STORE_NOTICES],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useDeleteStoreNoticeMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: storeNoticeClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.STORE_NOTICES],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useUpdateStoreNoticeMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: storeNoticeClient.update,
    onSuccess: async (data) => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.storeNotice.list}`
        : Routes.storeNotice.list;
      await router.push(`${generateRedirectUrl}/${data?.id}/edit`, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.STORE_NOTICES],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useListMutation = () => {
  const { t } = useTranslation();
  return useMutation({ mutationFn: storeNoticeClient.getUserOrShopList });
};

export const useStoreNoticeQuery = ({
  id,
  language,
}: {
  id: string;
  language: string;
}) => {
  const { data, error, isLoading } = useQuery<StoreNotice, Error>({
    queryKey: [API_ENDPOINTS.STORE_NOTICES, { id, language }],
    queryFn: () => storeNoticeClient.get({ id, language }),
  });

  return {
    storeNotice: data,
    error,
    loading: isLoading,
  };
};

export const useStoreNoticesQuery = (
  options: Partial<StoreNoticeQueryOptions>,
  config: Omit<
    UseQueryOptions<StoreNoticePaginator, Error>,
    'queryKey' | 'queryFn'
  > = {}
) => {
  const { data, error, isLoading } = useQuery<StoreNoticePaginator, Error>({
    queryKey: [API_ENDPOINTS.STORE_NOTICES, options],
    queryFn: ({ queryKey }) =>
      storeNoticeClient.paginated(Object.assign({}, queryKey[1])),
    ...config,
    placeholderData: keepPreviousData,
  });

  return {
    storeNotices: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

export const useStoreNoticesLoadMoreQuery = (
  options: Partial<StoreNoticeQueryOptions>,
  config?: Omit<
    UseInfiniteQueryOptions<StoreNoticePaginator, Error>,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >
) => {
  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery<StoreNoticePaginator, Error>({
    queryKey: [API_ENDPOINTS.STORE_NOTICES, options],
    queryFn: ({ queryKey, pageParam }) =>
      storeNoticeClient.all(Object.assign({}, queryKey[1], pageParam)),
    ...config,
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    storeNotices: data?.pages.flatMap((page) => page?.data) ?? [],
    paginatorInfo: Array.isArray(data?.pages)
      ? data?.pages[data.pages.length - 1]
      : null,
    error,
    hasNextPage,
    loading: isLoading,
    isLoadingMore: isFetchingNextPage,
    loadMore: handleLoadMore,
  };
};

export const useStoreNoticeTypeQuery = (
  options: Partial<{ type: string }> = {}
) => {
  const { data, error, isLoading } = useQuery<any, Error>({
    queryKey: [API_ENDPOINTS.STORE_NOTICE_GET_STORE_NOTICE_TYPE, options],
    queryFn: ({ queryKey }) =>
      storeNoticeClient.getTypeList(
        Object.assign({}, queryKey[1] as { type: string })
      ),
    placeholderData: keepPreviousData,
  });

  return {
    noticeTypes: data ?? [],
    error,
    loading: isLoading,
  };
};
export const useUsersOrShopsQuery = (
  options: Partial<{ type: string }> = {}
) => {
  const { data, error, isLoading } = useQuery<any, Error>({
    queryKey: [API_ENDPOINTS.STORE_NOTICES_USER_OR_SHOP_LIST, options],
    queryFn: ({ queryKey }) =>
      storeNoticeClient.getUserOrShopList(
        Object.assign({}, queryKey[1] as { type: string })
      ),
    placeholderData: keepPreviousData,
  });

  return {
    usersOrShops: data ?? [],
    error,
    loading: isLoading,
  };
};

export function useStoreNoticeRead() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const {
    mutate: readStoreNotice,
    isPending: isLoading,
    isSuccess,
  } = useMutation({
    mutationFn: storeNoticeClient.toggle,
    onSuccess: () => {},
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.STORE_NOTICES_IS_READ],
      });
    },
  });

  return { readStoreNotice, isLoading, isSuccess };
}
