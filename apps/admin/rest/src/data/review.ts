import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next/pages';
import { mapPaginatorData } from '@/utils/data-mappers';
import { API_ENDPOINTS } from './client/api-endpoints';
import { useModalAction } from '@/components/ui/modal/modal.context';
import { Review, ReviewPaginator, ReviewQueryOptions } from '@/types';
import { reviewClient } from '@/data/client/review';

export const useAbuseReportMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const { closeModal } = useModalAction();
  return useMutation({
    mutationFn: reviewClient.reportAbuse,
    onSuccess: () => {
      toast.success(t('text-abuse-report-submitted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.refetchQueries({ queryKey: [API_ENDPOINTS.REVIEWS] });
      closeModal();
    },
  });
};

export const useDeclineReviewMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');

  return useMutation({
    mutationFn: reviewClient.decline,
    onSuccess: () => {
      toast.success(t('successfully-decline'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.refetchQueries({ queryKey: [API_ENDPOINTS.REVIEWS] });
    },
  });
};

export const useDeleteReviewMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: reviewClient.delete,
    onSuccess: () => {
      toast.success(t('common:successfully-deleted'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.REVIEWS] });
    },
  });
};

export const useReviewQuery = (id: string) => {
  return useQuery<Review, Error>({
    queryKey: [API_ENDPOINTS.REVIEWS, id],
    queryFn: () => reviewClient.get({ id }),
  });
};

export const useReviewsQuery = (
  params: Partial<ReviewQueryOptions>,
  options: any = {},
) => {
  const { data, error, isLoading } = useQuery<ReviewPaginator, Error>({
    queryKey: [API_ENDPOINTS.REVIEWS, params],
    queryFn: ({ queryKey }) =>
      reviewClient.paginated(Object.assign({}, queryKey[1])),
    placeholderData: keepPreviousData,
    ...options,
  });

  return {
    reviews: data?.data ?? [],
    paginatorInfo: mapPaginatorData(data),
    error,
    loading: isLoading,
  };
};
