import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useTranslation } from 'next-i18next';
import { API_ENDPOINTS } from '@/data/client/api-endpoints';
import { BecomeSeller } from '@/types';
import { becomeSellerClient } from '@/data/client/become-seller';

export const useBecomeSellerQuery = ({ language }: { language: string }) => {
  const { data, error, isLoading } = useQuery<BecomeSeller, Error>({
    queryKey: [API_ENDPOINTS.BECAME_SELLER, { language }],
    queryFn: () => becomeSellerClient.all({ language }),
  });

  return {
    becomeSellerData: data,
    error,
    loading: isLoading,
  };
};

export const useUpdateBecomeSellerMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: becomeSellerClient.update,
    onError: (error) => {
      console.log(error);
    },
    onSuccess: async (data) => {
      toast.success(t('common:successfully-updated'));
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [API_ENDPOINTS.BECAME_SELLER],
      });
    },
  });
};
