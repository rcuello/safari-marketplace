import { Config } from '@/config';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from '@/data/client/api-endpoints';
import { Shop, ShopPaginator, ShopQueryOptions } from '@/types';
import { adminOnly, getAuthCredentials, hasAccess } from '@/utils/auth-utils';
import { mapPaginatorData } from '@/utils/data-mappers';
import { useTranslation } from 'next-i18next';
import Router, { useRouter } from 'next/router';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { shopClient } from './client/shop';

export const useApproveShopMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: shopClient.approve,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHOPS] });
    },
  });
};

export const useDisApproveShopMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: shopClient.disapprove,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHOPS] });
    },
  });
};

export const useCreateShopMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: shopClient.create,
    onSuccess: () => {
      const { permissions } = getAuthCredentials();
      if (hasAccess(adminOnly, permissions)) {
        return router.push(Routes.adminMyShops);
      }
      router.push(Routes.dashboard);
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHOPS] });
    },
  });
};

export const useUpdateShopMutation = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: shopClient.update,
    onSuccess: async (data) => {
      await router.push(`/${data?.slug}/edit`, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-updated'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHOPS] });
    },
  });
};
export const useTransferShopOwnershipMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: shopClient.transferShopOwnership,
    onSuccess: (shop: Shop) => {
      toast.success(
        `${t('common:successfully-transferred')}${shop.owner?.name}`,
      );
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHOPS] });
    },
  });
};

export const useShopQuery = ({ slug }: { slug: string }, options?: any) => {
  return useQuery<Shop, Error>({
    queryKey: [API_ENDPOINTS.SHOPS, { slug }],
    queryFn: () => shopClient.get({ slug }),
    ...options,
  });
};

export const useShopsQuery = (options: Partial<ShopQueryOptions>) => {
  const { data, error, isLoading } = useQuery<ShopPaginator, Error>({
    queryKey: [API_ENDPOINTS.SHOPS, options],
    queryFn: ({ queryKey }) =>
      shopClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    shops: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};

export const useInActiveShopsQuery = (options: Partial<ShopQueryOptions>) => {
  const { data, error, isLoading } = useQuery<ShopPaginator, Error>({
    queryKey: [API_ENDPOINTS.NEW_OR_INACTIVE_SHOPS, options],
    queryFn: ({ queryKey }) =>
      shopClient.newOrInActiveShops(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    shops: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};
