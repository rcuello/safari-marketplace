import { useModalAction } from '@/components/ui/modal/modal.context';
import type { Review, ReviewPaginator, ReviewQueryOptions } from '@/types';
import { useTranslation } from 'next-i18next';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'react-toastify';
import client from './client';
import { API_ENDPOINTS } from './client/api-endpoints';
import { mapPaginatorData } from './utils/data-mappers';

export function useReviews(options?: Partial<ReviewQueryOptions>) {
  const {
    data: response,
    isLoading,
    error,
    isFetching,
  } = useQuery<ReviewPaginator, Error>({
    queryKey: [API_ENDPOINTS.PRODUCTS_REVIEWS, options],
    queryFn: ({ queryKey }) =>
      client.reviews.all(Object.assign({}, queryKey[1] as ReviewQueryOptions)),
    placeholderData: keepPreviousData,
  });
  return {
    reviews: response?.data ?? [],
    paginatorInfo: mapPaginatorData(response),
    isLoading,
    error,
    isFetching,
    hasMore: response && response?.last_page > response?.current_page,
  };
}

export function useReview({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery<Review, Error>({
    queryKey: [API_ENDPOINTS.PRODUCTS_REVIEWS, id],
    queryFn: () => client.reviews.get({ id }),
    enabled: Boolean(id),
  });
  return {
    review: data,
    isLoading,
    error,
  };
}

export function useCreateReview() {
  const { t } = useTranslation('common');
  const { closeModal } = useModalAction();
  const queryClient = useQueryClient();
  const { mutate: createReview, isPending: isLoading } = useMutation({
    mutationFn: client.reviews.create,
    onSuccess: (res) => {
      toast.success(`${t('text-review-request-submitted')}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ORDERS] });
      closeModal();
    },
  });
  return {
    createReview,
    isLoading,
  };
}

export function useUpdateReview() {
  const { t } = useTranslation('common');
  const { closeModal } = useModalAction();
  const queryClient = useQueryClient();
  const { mutate: updateReview, isPending: isLoading } = useMutation({
    mutationFn: client.reviews.update,
    onSuccess: (res) => {
      toast.success(`${t('text-review-request-update-submitted')}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ORDERS] });
      closeModal();
    },
  });
  return {
    updateReview,
    isLoading,
  };
}
