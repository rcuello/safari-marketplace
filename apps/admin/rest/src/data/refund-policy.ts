import Router, { useRouter } from 'next/router';
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next/pages';
import { Routes } from '@/config/routes';
import { API_ENDPOINTS } from './client/api-endpoints';
import {
  RefundPolicyQueryOptions,
  RefundPolicyPaginator,
  GetParams,
  RefundPolicy,
} from '@/types';
import { mapPaginatorData } from '@/utils/data-mappers';
import { RefundPolicyClient } from '@/data/client/refund-policy';
import { Config } from '@/config';

export const useCreateRefundPolicyMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const router = useRouter();

  return useMutation({
    mutationFn: RefundPolicyClient.create,
    onSuccess: async () => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.refundPolicies.list}`
        : Routes.refundPolicies.list;
      await Router.push(generateRedirectUrl, undefined, {
        locale: Config.defaultLanguage,
      });
      toast.success(t('common:successfully-created'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.REFUND_POLICIES],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useDeleteRefundPolicyMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: RefundPolicyClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.REFUND_POLICIES],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useUpdateRefundPolicyMutation = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: RefundPolicyClient.update,
    onSuccess: async (data) => {
      const generateRedirectUrl = router.query.shop
        ? `/${router.query.shop}${Routes.refundPolicies.list}`
        : Routes.refundPolicies.list;
      await router.push(
        `${generateRedirectUrl}/${data?.slug!}/edit`,
        undefined,
        {
          locale: Config.defaultLanguage,
        },
      );
      toast.success(t('common:successfully-updated'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.REFUND_POLICIES],
      });
    },
    onError: (error: any) => {
      toast.error(t(`common:${error?.response?.data.message}`));
    },
  });
};

export const useRefundPolicyQuery = ({ slug, language }: GetParams) => {
  const { data, error, isLoading } = useQuery<RefundPolicy, Error>({
    queryKey: [API_ENDPOINTS.REFUND_POLICIES, { slug, language }],
    queryFn: () => RefundPolicyClient.get({ slug, language }),
  });

  return {
    refundPolicy: data,
    error,
    loading: isLoading,
  };
};

export const useRefundPoliciesQuery = (
  options: Partial<RefundPolicyQueryOptions>,
) => {
  const { data, error, isLoading } = useQuery<RefundPolicyPaginator, Error>({
    queryKey: [API_ENDPOINTS.REFUND_POLICIES, options],
    queryFn: ({ queryKey }) =>
      RefundPolicyClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
  });

  return {
    refundPolicies: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};
