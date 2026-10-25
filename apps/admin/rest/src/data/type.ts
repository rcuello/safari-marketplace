import Router, { useRouter } from 'next/router';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from './client/api-endpoints';
import { GetParams, Type, TypeQueryOptions } from '@/types';
import { typeClient } from '@/data/client/type';
import { Config } from '@/config';

export const useCreateTypeMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: typeClient.create,
    onSuccess: () => {
      Router.push(Routes.type.list, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TYPES] });
    },
  });
};

export const useDeleteTypeMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: typeClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TYPES] });
    },
  });
};

export const useUpdateTypeMutation = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: typeClient.update,
    onSuccess: async (data) => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.type.list}`
        : Routes.type.list;
      await router.push(
        `${generateRedirectUrl}/${data?.slug}/edit`,
        undefined,
        {
          locale: Config.defaultLanguage,
        }
      );
      toast.success(t('common:successfully-updated'));
    },
    // onSuccess: () => {
    //   toast.success(t('common:successfully-updated'));
    // },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TYPES] });
    },
  });
};

export const useTypeQuery = ({ slug, language }: GetParams) => {
  return useQuery<Type, Error>({
    queryKey: [API_ENDPOINTS.TYPES, { slug, language }],
    queryFn: () => typeClient.get({ slug, language }),
  });
};

export const useTypesQuery = (options?: Partial<TypeQueryOptions>) => {
  const { data, isLoading, error } = useQuery<Type[], Error>({
    queryKey: [API_ENDPOINTS.TYPES, options],
    queryFn: ({ queryKey }) => typeClient.all(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    types: data ?? [],
    loading: isLoading,
    error,
  };
};
