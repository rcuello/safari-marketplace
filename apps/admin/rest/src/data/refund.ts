import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { API_ENDPOINTS } from './client/api-endpoints';
import { Order, OrderPaginator, OrderQueryOptions } from '@/types';
import { mapPaginatorData } from '@/utils/data-mappers';
import { refundClient } from '@/data/client/refund';

export const useUpdateRefundMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refundClient.update,
    onSuccess: () => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.REFUNDS] });
    },
  });
};

export const useRefundQuery = (id: string) => {
  return useQuery<Order, Error>({
    queryKey: [API_ENDPOINTS.REFUNDS, id],
    queryFn: () => refundClient.get({ id }),
  });
};

export const useRefundsQuery = (
  params: Partial<OrderQueryOptions>,
  options: any = {},
) => {
  const { data, error, isLoading } = useQuery<OrderPaginator, Error>({
    queryKey: [API_ENDPOINTS.REFUNDS, params],
    queryFn: ({ queryKey }) =>
      refundClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
    ...options,
  });

  return {
    data: data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};
