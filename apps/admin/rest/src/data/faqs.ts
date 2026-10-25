import Router, { useRouter } from 'next/router';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next/pages';
import { mapPaginatorData } from '@/utils/data-mappers';
import type { UseInfiniteQueryOptions } from '@tanstack/react-query';
import { FAQs, FAQsPaginator, FAQsQueryOptions } from '@/types';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from './client/api-endpoints';
import { Config } from '@/config';
import { faqsClient } from '@/data/client/faqs';

// Read Single FAQ

export const useFaqQuery = ({
  id,
  language,
}: {
  id: string;
  language: string;
}) => {
  const { data, error, isLoading } = useQuery<FAQs, Error>({
    queryKey: [API_ENDPOINTS.FAQS, { id, language }],
    queryFn: () => faqsClient.get({ id, language }),
  });

  return {
    faqs: data,
    error,
    loading: isLoading,
  };
};

// Read All FAQs

export const useFaqsQuery = (options: Partial<FAQsQueryOptions>) => {
  const { data, error, isLoading } = useQuery<FAQsPaginator, Error>({
    queryKey: [API_ENDPOINTS.FAQS, options],
    queryFn: ({ queryKey }) =>
      faqsClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    faqs: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

// Read All FAQs paginated

export const useFaqsLoadMoreQuery = (
  options: Partial<FAQsQueryOptions>,
  config?: Omit<
    UseInfiniteQueryOptions<FAQsPaginator, Error>,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >,
) => {
  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery<FAQsPaginator, Error>({
    queryKey: [API_ENDPOINTS.FAQS, options],
    queryFn: ({ queryKey, pageParam }) =>
      faqsClient.all(Object.assign({}, queryKey[1], pageParam)),
    ...config,
    initialPageParam: undefined,
    getNextPageParam: ({ current_page, last_page }) =>
      last_page > current_page ? { page: current_page + 1 } : undefined,
  });

  function handleLoadMore() {
    fetchNextPage();
  }

  return {
    faqs: data?.pages.flatMap((page) => page?.data) ?? [],
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

// Create FAQ

export const useCreateFaqsMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: faqsClient.create,
    onSuccess: async () => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.faqs.list}`
        : Routes.faqs.list;
      await Router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.FAQS] });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

// Update FAQ

export const useUpdateFaqsMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: faqsClient.update,
    onSuccess: async (data) => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.faqs.list}`
        : Routes.faqs.list;
      await router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.FAQS] });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

// Delete FAQ

export const useDeleteFaqsMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: faqsClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.FAQS] });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};
