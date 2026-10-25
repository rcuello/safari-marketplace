import { Routes } from '@/config/routes';
import { useRouter } from 'next/router';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/data/client/api-endpoints';
import { useTranslation } from 'next-i18next/pages';
import { ShippingUpdateInput } from '@/types';
import { toast } from 'react-toastify';
import { Shipping } from '@/types';
import { ShippingQueryOptions } from '@/types';
import { shippingClient } from './client/shipping';

export const useCreateShippingMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: shippingClient.create,
    onSuccess: () => {
      router.push(Routes.shipping.list);
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHIPPINGS] });
    },
  });
};

export const useDeleteShippingClassMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: shippingClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHIPPINGS] });
    },
  });
};

export const useUpdateShippingMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: shippingClient.update,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.SHIPPINGS] });
    },
  });
};

export const useShippingQuery = (id: string) => {
  return useQuery<Shipping, Error>({
    queryKey: [API_ENDPOINTS.SHIPPINGS, id],
    queryFn: () => shippingClient.get({ id }),
  });
};

export const useShippingClassesQuery = (
  options: Partial<ShippingQueryOptions> = {},
) => {
  const { data, error, isLoading } = useQuery<Shipping[], Error>({
    queryKey: [API_ENDPOINTS.SHIPPINGS, options],
    queryFn: ({ queryKey }) =>
      shippingClient.all(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    shippingClasses: data ?? [],
    error,
    loading: isLoading,
  };
};
