import { Routes } from '@/config/routes';
import { useRouter } from 'next/router';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { API_ENDPOINTS } from '@/data/client/api-endpoints';
import { Tax } from '@/types';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next/pages';
import { TaxQueryOptions } from '@/types';
import { taxClient } from './client/tax';

export const useCreateTaxClassMutation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: taxClient.create,
    onSuccess: () => {
      router.push(Routes.tax.list);
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TAXES] });
    },
  });
};

export const useDeleteTaxMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: taxClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TAXES] });
    },
  });
};

export const useUpdateTaxClassMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: taxClient.update,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TAXES] });
    },
  });
};

export const useTaxQuery = (id: string) => {
  return useQuery<Tax, Error>({
    queryKey: [API_ENDPOINTS.TAXES, id],
    queryFn: () => taxClient.get({ id }),
  });
};

export const useTaxesQuery = (options: Partial<TaxQueryOptions> = {}) => {
  const { data, error, isLoading } = useQuery<Tax[], Error>({
    queryKey: [API_ENDPOINTS.TAXES, options],
    queryFn: ({ queryKey }) => taxClient.all(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    taxes: data ?? [],
    error,
    loading: isLoading,
  };
};
